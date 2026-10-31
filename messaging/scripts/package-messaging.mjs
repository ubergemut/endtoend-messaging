// SPDX-License-Identifier: AGPL-3.0-only
// Local checkpoint packaging for the complete reusable messaging stack.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyClosure } from './release-source-closure.mjs';
import { parseYarnLock } from './release-expanded-inventory.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const version = '0.2.1';
export const workspaces = ['packages/crypto', 'packages/session', 'packages/agent', 'packages/protocol', 'packages/client', 'packages/contract', 'packages/headless', 'apps/api', 'apps/agent-browser', 'apps/messaging-reference'];
// Explicit public boundary: the separately assessed web and desk consumers are
// built independently and are never copied into this subsystem source offer.
export const publicSourceInputs = ['LICENSE', 'LICENSING.md', 'docs/PROTOCOL.md', 'docs/HEADLESS.md', 'docs/THREAT-MODEL.md', 'docs/SESSION-PLAN.md', 'docs/architecture', 'docs/deployment', 'docs/release/third-party', ...['AGPL_MVP_TEN_STEP_PLAN.md', 'BASELINE.json', 'FEATURE_MATRIX.md', 'FRONTEND_BOUNDARY_ASSESSMENT.json', 'FRONTEND_BOUNDARY_ASSESSMENT.md', 'NOTICE.md', 'README.md', 'RELEASE_CHECKLIST.md', 'REVIEW_DECISIONS.json', 'RIGHTS_DEPENDENCIES.md', 'STEP_4_COMPLETION.md', 'STEP_5_COMPLETION.md', 'STEP_6_COMPLETION.md', 'STEP_7_DURABILITY_ACCEPTANCE.md', 'STEPS_1_3_COMPLETION.md', 'TOOLCHAIN.json'].map(name => `docs/release/${name}`), ...workspaces, 'scripts/package-messaging.mjs', 'scripts/package-messaging.test.mjs', 'scripts/package-sdk.mjs', 'scripts/package-sdk.test.mjs', 'scripts/serve-messaging.mjs', 'scripts/serve-endtoend.mjs', 'scripts/source-disclosure.mjs', 'scripts/messaging-state.mjs', 'scripts/messaging-storage.mjs', 'scripts/release-build-crypto.mjs', 'scripts/release-reproduce-crypto.mjs', 'scripts/release-files.mjs', 'scripts/release-files.test.mjs', 'scripts/release-audit.mjs', 'scripts/test-host-integration.mjs'];
publicSourceInputs.push('scripts/assemble-source-disclosure.mjs', 'scripts/source-disclosure.mjs', 'scripts/source-disclosure.test.mjs', 'docs/release/STEP_8_DISTRIBUTION_POLICY.md');
publicSourceInputs.push('scripts/hosted-controls.test.mjs','docs/release/HOSTED_CONTROLS_0_2_1.md');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = file => hash(fs.readFileSync(file));
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const invariant = (value, message) => { if (!value) throw new Error(message); };
const portable = value => value.replaceAll('\\', '/');

export function sourceExcluded(name) {
  const parts = name.split('/');
  return parts.some(part => ['node_modules', '.git'].includes(part))
    || /^(?:\.build|work|outputs|artifacts|coverage|test-results|data|vaults)(?:\/|$)/.test(name)
    || /^packages\/crypto\/(?:pkg-node|pkg-web|target)(?:\/|$)/.test(name)
    || /^packages\/(?:client|protocol)\/dist(?:\/|$)/.test(name)
    || /^apps\/[^/]+\/dist(?:\/|$)/.test(name);
}
function safeRelative(name) {
  invariant(name && !path.isAbsolute(name) && !name.includes('\\') && !/[\r\n\0]/.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..'), `Unsafe public path: ${name}`);
  return name;
}
function localOnly(name) {
  return name.split('/').some(part => /^\.env(?:\..*)?$/.test(part) || part === '.local-ports.json' || part === '.messaging-state' || /\.(?:vault|sqlite|sqlite3|db)$/i.test(part));
}
export function publicFiles(root, { source = true, prefix = '' } = {}) {
  return fs.readdirSync(path.join(root, prefix)).sort().flatMap(name => {
    const relative = prefix ? `${prefix}/${name}` : name;
    safeRelative(relative);
    if (source && sourceExcluded(relative)) return [];
    invariant(!localOnly(relative), `User state or local configuration in public input: ${relative}`);
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    invariant(!stat.isSymbolicLink(), `Unexpected public symlink: ${relative}`);
    if (stat.isDirectory()) return publicFiles(root, { source, prefix: relative });
    invariant(stat.isFile(), `Nonregular public file: ${relative}`);
    return [{ path: relative, bytes: stat.size, sha256: digest(file) }];
  });
}
function copyOne(from, to) {
  invariant(fs.lstatSync(from).isFile() && !fs.lstatSync(from).isSymbolicLink(), `Required regular source file missing: ${from}`);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to);
}
function copyInput(root, relative, destination, { source = true } = {}) {
  safeRelative(relative);
  invariant(fs.existsSync(path.join(root, relative)), `Required standalone input missing: ${relative}`);
  const stat = fs.lstatSync(path.join(root, relative));
  invariant(!stat.isSymbolicLink(), `Source symlink: ${relative}`);
  if (stat.isDirectory()) {
    for (const file of publicFiles(root, { source, prefix: relative })) copyOne(path.join(root, file.path), path.join(destination, file.path));
  } else {
    invariant(!source || !sourceExcluded(relative), `Generated input cannot enter source: ${relative}`);
    invariant(!localOnly(relative), `Local configuration cannot enter source: ${relative}`);
    copyOne(path.join(root, relative), path.join(destination, relative));
  }
}
export function publicManifest() {
  return {
    name: 'endtoend-messaging-public', version, private: true, license: 'AGPL-3.0-only', type: 'module', packageManager: 'yarn@1.22.22', workspaces,
    scripts: {
      'build:crypto': 'node scripts/release-build-crypto.mjs .',
      'build:agent': 'yarn workspace @e2ee/agent-browser build',
      'build:reference': 'yarn workspace @e2ee/messaging-reference build',
      'build:sdk': 'yarn workspace @e2ee/protocol build && yarn workspace @e2ee/client build',
      build: 'yarn build:sdk && yarn build:agent && yarn build:reference',
      'build:all': 'yarn build:crypto && yarn build',
      test: 'node --test packages/crypto/test/roundtrip.mjs && yarn workspace @e2ee/api test && yarn workspace @e2ee/agent test && yarn workspace @e2ee/protocol test && yarn workspace @e2ee/client test && yarn workspace @e2ee/headless test && node --test scripts/release-files.test.mjs scripts/package-sdk.test.mjs scripts/package-messaging.test.mjs scripts/messaging-state.test.mjs scripts/source-disclosure.test.mjs && node --import tsx --test scripts/messaging-source-disclosure.test.mjs apps/messaging-reference/test/config.test.ts && yarn test:hosted-controls',
      'test:hosts': 'node --import tsx scripts/test-host-integration.mjs',
      'test:messaging:standalone': 'node --import tsx scripts/test-messaging-standalone.mjs',
      'test:reference:browser': 'yarn workspace @e2ee/messaging-reference test:browser',
      'test:package': 'node --test scripts/package-messaging.test.mjs',
      'test:hosted-controls': 'node --import tsx --test scripts/hosted-controls.test.mjs',
      'test:hosted-browser': 'node --import tsx apps/agent-browser/test/hosted-browser.mjs',
      'audit:preferred': 'node scripts/hacl-source-closure.mjs --audit && node scripts/release-mpl-check.mjs && node scripts/release-mpl-pg-uuidv7-check.mjs && node scripts/release-expanded-inventory.mjs --audit',
      start: 'node --import tsx scripts/serve-messaging.mjs',
      agent: 'node packages/agent/src/cli.mjs',
      'headless:help': 'node --import tsx packages/headless/src/bin.ts --help',
      'headless:http': 'node --import tsx packages/headless/src/bin.ts http',
      'headless:graphql': 'node --import tsx packages/headless/src/bin.ts graphql',
      'headless:mcp': 'node --import tsx packages/headless/src/bin.ts mcp',
    },
    devDependencies: { tsx: '^4.20.5', vite: '^7.1.3', typescript: '^5.8.3' },
  };
}
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function command(command, args, cwd, log) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (log) writeText(log, `$ ${path.basename(command)} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  invariant(!result.error && result.status === 0, `${path.basename(command)} ${args.join(' ')} failed (${result.status}): ${result.error?.message ?? result.stderr?.slice(-5000)}`);
  return result.stdout;
}
function checkNewOutput(root, output) {
  const relative = path.relative(root, output);
  invariant(relative && (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)), 'Packaging output must be outside the source checkout');
  invariant(!fs.existsSync(output), 'Output already exists; choose a fresh directory. Existing evidence is never removed');
}
function readNoticePaths(root, prefix = '', inside = false) {
  return fs.readdirSync(path.join(root, prefix)).sort().flatMap(name => {
    const rel = prefix ? `${prefix}/${name}` : name, file = path.join(root, rel), stat = fs.lstatSync(file);
    invariant(!stat.isSymbolicLink(), `Notice symlink: ${rel}`);
    if (stat.isDirectory()) return readNoticePaths(root, rel, inside || /^(?:licen[cs]es?|notices?|copyrights?)$/i.test(name));
    return stat.isFile() && (inside || /^(?:LICEN[CS]E|COPYING|NOTICE|COPYRIGHT|AUTHORS)(?:[.\-_]|$)/i.test(name) || /\.LICENSE$/i.test(name)) ? [rel] : [];
  });
}
function installedPackages(root, prefix = 'node_modules') {
  const output = [];
  function moduleDirectory(relative) {
    if (!fs.existsSync(path.join(root, relative))) return;
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      if (name.startsWith('.')) continue;
      const location = `${relative}/${name}`, absolute = path.join(root, location), stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      if (name.startsWith('@')) { for (const child of fs.readdirSync(absolute).sort()) packageDirectory(`${location}/${child}`); }
      else packageDirectory(location);
    }
  }
  function packageDirectory(location) {
    const absolute = path.join(root, location);
    if (fs.lstatSync(absolute).isSymbolicLink() || !fs.existsSync(path.join(absolute, 'package.json'))) return;
    const meta = json(path.join(absolute, 'package.json'));
    if (meta.name && meta.version) output.push({ ...meta, installedPath: location });
    moduleDirectory(`${location}/node_modules`);
  }
  moduleDirectory(prefix);
  for (const workspace of workspaces) moduleDirectory(`${workspace}/node_modules`);
  return output;
}
export function materializeSupplementalNotice(stage, entry, records) {
  safeRelative(entry.path);
  const destination = path.join(stage, entry.path);
  if (!fs.existsSync(destination)) {
    const candidate = records.find(row => row.sha256 === entry.sha256 && fs.existsSync(path.join(stage, row.path)));
    invariant(candidate && digest(path.join(stage, safeRelative(candidate.path))) === entry.sha256, `Supplemental notice bytes unavailable: ${entry.path}`);
    copyOne(path.join(stage, candidate.path), destination);
  }
  invariant(digest(destination) === entry.sha256, `Supplemental notice alias hash differs: ${entry.path}`);
  return entry.path;
}
export function createNotices(stage, cargo, installed) {
  const prior = json(path.join(stage, 'docs/release/inventory/EXPANDED_INVENTORY.json'));
  const supplemental = json(path.join(stage, 'docs/release/third-party/DEPENDENCY_LICENSE_SOURCES.json'));
  const rows = [], corpus = new Map();
  function notice(packageName, sourcePath, expected, destination) {
    safeRelative(sourcePath);
    const file = path.join(stage, sourcePath), sha256 = digest(file);
    invariant(!expected || sha256 === expected, `Notice/source hash differs: ${sourcePath}`);
    if (destination) copyOne(file, path.join(stage, destination));
    const at = destination ?? sourcePath;
    const entry = corpus.get(sha256) ?? { packages: new Set(), paths: new Set(), text: fs.readFileSync(file, 'utf8') };
    entry.packages.add(packageName); entry.paths.add(at); corpus.set(sha256, entry);
    return { path: at, sourcePath, sha256 };
  }
  const cargoRows = cargo.map(item => {
    const base = `dependencies/cargo/${item.directory}`, notices = readNoticePaths(path.join(stage, base));
    if (item.licenseFile && !notices.includes(item.licenseFile)) notices.push(item.licenseFile);
    const entries = notices.map(file => notice(item.directory, `${base}/${file}`, null, `dependencies/cargo-notices/${item.directory}/${file}`));
    for (const file of supplemental.cargo?.[item.directory] ?? []) entries.push(notice(item.directory, file.path, file.sha256, `dependencies/cargo-notices/${item.directory}/supplemental/${file.path}`));
    invariant(entries.length, `No retained Cargo notices: ${item.directory}`);
    return { ...item, notices: entries };
  });
  const unique = new Map(installed.map(item => [`${item.name}@${item.version}`, item]));
  for (const [key, item] of [...unique].sort(([a], [b]) => a.localeCompare(b))) {
    const recorded = prior.npm.packages.find(row => row.name === item.name && row.version === item.version);
    invariant(recorded?.preferredSource, `Unassessed/new public dependency: ${key}`);
    const source = recorded.preferredSource;
    invariant(digest(path.join(stage, source.archive)) === source.sha256, `Npm preferred-source mismatch: ${key}`);
    const notices = recorded.notices.map(row => notice(key, row.path, row.sha256));
    for (const file of supplemental.npm?.[item.name] ?? []) {
      materializeSupplementalNotice(stage, file, prior.npm.packages.flatMap(row => row.notices));
      notices.push(notice(key, file.path, file.sha256));
    }
    invariant(notices.length, `No retained npm notices: ${key}`);
    rows.push({ name: item.name, version: item.version, license: item.license ?? item.licenses, notices, preferredSource: source, preferredUpstream: recorded.preferredUpstream, originalInventoryObservation: recorded.originalInventoryObservation ?? { roles: recorded.roles, parents: recorded.parents, dependencies: recorded.dependencies, installedPath: recorded.installedPath } });
  }
  const pglite = prior.pglite.components.map(component => ({ name: component.name, license: component.license, notices: component.notices.map(row => notice(component.name, row.path, row.sha256)) }));
  const workspaceLicenses = ['client', 'protocol'].map(name => ({ name: `@e2ee/${name}`, license: 'MIT', notices: [notice(`@e2ee/${name} (first-party MIT SDK)`, `packages/${name}/LICENSE`)] }));
  const text = ['EndToEnd reusable messaging 0.2.0: third-party notices', 'Original component grants, copyright, patent and warranty notices remain effective.', 'The paired source archive includes dependency sources, preferred forms and provenance.', ''];
  for (const [sha256, entry] of [...corpus].sort(([a], [b]) => a.localeCompare(b))) text.push(`===== ${[...entry.packages].sort().join(', ')} =====`, `Original notice paths: ${[...entry.paths].sort().join(', ')}`, `Notice SHA-256: ${sha256}`, '', entry.text, '');
  for (const workspace of ['apps/agent-browser', 'apps/messaging-reference']) writeText(path.join(stage, workspace, 'public/THIRD_PARTY_NOTICES.txt'), text.join('\n'));
  const coverage = { kind: 'endtoend-messaging-notice-coverage', cargo: cargoRows, npm: rows, pglite, workspaceLicenses, originalNoticesPreserved: true, legalCertification: false };
  writeJson(path.join(stage, 'dependencies/cargo-notices/INDEX.json'), coverage);
  return { cargo: cargoRows, npm: rows, pglite, workspaceLicenses, uniqueNoticeTexts: corpus.size };
}
export function verifyCryptoReuse(stage, runtime, proof) {
  invariant(proof.success === true && proof.prebuiltFallback === false && proof.inputs?.length && proof.outputs?.length === 10, 'An actual ten-output source-build proof is required for explicit reuse');
  const requiredInputs = ['packages/crypto/Cargo.toml', 'packages/crypto/Cargo.lock', 'packages/crypto/.cargo/config.toml', ...publicFiles(stage, { prefix: 'packages/crypto/src' }).filter(file => /\.(rs|ts)$/.test(file.path)).map(file => file.path)].sort();
  invariant(JSON.stringify(proof.inputs.map(item => item.path).sort()) === JSON.stringify(requiredInputs), 'Crypto build proof does not cover every current source input');
  invariant(new Set(proof.outputs.map(item => item.path)).size === 10, 'Duplicate crypto outputs in source-build proof');
  for (const input of proof.inputs) {
    safeRelative(input.path); invariant(input.path.startsWith('packages/crypto/'), `Unexpected crypto input: ${input.path}`);
    invariant(digest(path.join(stage, input.path)) === input.sha256, `Reused crypto source input differs: ${input.path}`);
  }
  for (const output of proof.outputs) {
    safeRelative(output.path); invariant(/^packages\/crypto\/pkg-(?:node|web)\/[^/]+$/.test(output.path), `Unexpected crypto artifact: ${output.path}`);
    invariant(digest(path.join(runtime, output.path)) === output.sha256, `Reused crypto output differs: ${output.path}`);
  }
  return { kind: 'explicit-verified-crypto-reuse', sourceIdentityVerified: true, outputs: proof.outputs, inputs: proof.inputs, originalBuildCompletedAt: proof.completedAt, originalBuildVersions: proof.versions, freshRustBuildForExpandedRelease: false };
}
export function verifyPackage(root, manifest, { source = true } = {}) {
  const errors = [], seen = new Set();
  for (const row of manifest.files ?? []) {
    try {
      safeRelative(row.path); invariant(!seen.has(row.path), `Duplicate manifest member: ${row.path}`); seen.add(row.path);
      invariant(!source || !sourceExcluded(row.path), `Generated/installed member in source manifest: ${row.path}`);
      let current = root;
      for (const part of row.path.split('/')) { current = path.join(current, part); invariant(!fs.lstatSync(current).isSymbolicLink(), `Manifest symlink: ${row.path}`); }
      invariant(fs.statSync(current).isFile() && fs.statSync(current).size === row.bytes && digest(current) === row.sha256, `Manifest hash mismatch: ${row.path}`);
    } catch (error) { errors.push(error.message); }
  }
  for (const row of publicFiles(root, { source })) if (!seen.has(row.path) && row.path !== 'SOURCE_MANIFEST.json') errors.push(`Unmanifested file: ${row.path}`);
  if (!seen.size) errors.push('Empty public manifest');
  return { passed: errors.length === 0, filesChecked: seen.size, errors };
}
export function lockMetadata(text, installed) {
  const records = parseYarnLock(text), present = new Set(installed.map(item => `${item.name}@${item.version}`));
  return { lockedEntries: records.length, lockedNotInstalled: records.filter(row => !row.selectors.some(selector => present.has(`${selector.slice(0, selector.lastIndexOf('@'))}@${row.version}`))).map(row => ({ ...row, disposition: 'Locked but not installed in this public workspace on the recorded platform; not a shipped runtime payload by this inventory' })) };
}
export function engineSourceIdentity(stage) {
  const files = workspaces.flatMap(prefix => publicFiles(stage, { prefix }));
  for (const file of ['scripts/serve-messaging.mjs', 'scripts/serve-endtoend.mjs', 'scripts/source-disclosure.mjs', 'scripts/messaging-state.mjs', 'scripts/messaging-storage.mjs']) files.push({ path: file, sha256: digest(path.join(stage, file)), bytes: fs.statSync(path.join(stage, file)).size });
  return hash(Buffer.from(JSON.stringify(files.sort((a, b) => a.path.localeCompare(b.path)))));
}
/** Rebuild in memory and compare with the actual browser files without changing source. */
export async function inspectPublicBrowserBuild(stage) {
  const require = createRequire(path.join(stage, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  const browserBundles = [];
  for (const workspace of ['apps/agent-browser', 'apps/messaging-reference']) {
    const chunks = [];
    const result = await build({ root: path.join(stage, workspace), configFile: path.join(stage, workspace, 'vite.config.ts'), logLevel: 'silent', build: { write: false, emptyOutDir: false }, plugins: [{ name: 'public-packaging-module-inventory', generateBundle(_options, bundle) {
      for (const [file, value] of Object.entries(bundle)) if (value.type === 'chunk') chunks.push({ file, modules: Object.entries(value.modules).filter(([, details]) => details.renderedLength > 0).map(([id, details]) => ({ id: id.startsWith('\0') ? portable(id).replaceAll(portable(stage) + '/', '') : portable(path.relative(stage, id)), renderedLength: details.renderedLength })) });
    } }] });
    const artifacts = result.output.map(item => ({ path: item.fileName, type: item.type, sha256: hash(item.type === 'chunk' ? Buffer.from(item.code) : Buffer.from(item.source)) }));
    for (const item of artifacts) invariant(digest(path.join(stage, workspace, 'dist', item.path)) === item.sha256, `Inspected browser output differs from actual runtime: ${workspace}/${item.path}`);
    browserBundles.push({ workspace: json(path.join(stage, workspace, 'package.json')).name, chunks, artifacts });
  }
  return browserBundles;
}
async function derivePublicInventory(stage, installed, { built, originalInventorySha256, originalYarnLockSha256 }) {
  const file = path.join(stage, 'docs/release/inventory/EXPANDED_INVENTORY.json'), prior = json(file);
  const selected = new Set(installed.map(item => `${item.name}@${item.version}`));
  prior.npm.packages = prior.npm.packages.filter(item => selected.has(`${item.name}@${item.version}`));
  invariant(new Set(prior.npm.packages.map(item => `${item.name}@${item.version}`)).size === selected.size, 'Public inventory cannot account for every installed package version');
  prior.npm.installedPackages = selected.size;
  Object.assign(prior.npm, lockMetadata(fs.readFileSync(path.join(stage, 'yarn.lock'), 'utf8'), installed));
  const publicLock = parseYarnLock(fs.readFileSync(path.join(stage, 'yarn.lock'), 'utf8'));
  prior.npm.packages = prior.npm.packages.map(row => {
    const actual = installed.find(item => item.name === row.name && item.version === row.version);
    const result = { ...row, installedPath: actual.installedPath, lockedSources: publicLock.filter(entry => entry.version === row.version && entry.selectors.some(selector => selector.slice(0, selector.lastIndexOf('@')) === row.name)).map(({ selectors, resolved, integrity }) => ({ selectors, resolved, integrity })), originalInventoryObservation: row.originalInventoryObservation ?? { parents: row.parents, roles: row.roles, dependencies: row.dependencies, installedPath: row.installedPath }, declaredDependencies: actual.dependencies ?? {}, declaredOptionalDependencies: actual.optionalDependencies ?? {} };
    delete result.parents; delete result.roles; delete result.dependencies;
    return result;
  });
  prior.workspaces = [{ path: '.', ...publicManifest() }, ...workspaces.map(relative => ({ path: relative, ...json(path.join(stage, relative, 'package.json')) }))].map(({ path, name, license, dependencies = {}, devDependencies = {} }) => ({ path, name, license, dependencies, devDependencies }));
  prior.yarnLockSha256 = digest(path.join(stage, 'yarn.lock'));
  prior.publicDependencyGraph = { semantics: 'Current declared workspace/npm dependency ranges plus exact installed version/path records; historical resolved parent/role observations are explicitly nested under originalInventoryObservation', workspaceDeclarations: prior.workspaces, npmDeclarations: prior.npm.packages.map(row => ({ name: row.name, version: row.version, installedPath: row.installedPath, dependencies: row.declaredDependencies, optionalDependencies: row.declaredOptionalDependencies })) };
  prior.derivation = { kind: 'isolated-public-workspace-selection', originalInventorySha256, originalYarnLockSha256, originalInventoryPath: 'docs/release/scope/STEP_1_3_INPUT_EXPANDED_INVENTORY.json', originalLockPath: 'docs/release/scope/STEP_1_3_INPUT_YARN.lock', inputSourceRecordsPreserved: true, explanation: 'Selected already assessed package versions and unchanged source/notice hashes; new private workspace edges are not inferred. Full original provenance remains supplied.' };
  prior.browserBundles = built ? await inspectPublicBrowserBuild(stage) : [];
  prior.assets = { scope: 'Public reference/trusted browser outputs only; original product asset assessment remains in retained step-1–3 input inventory', assets: built ? ['apps/agent-browser', 'apps/messaging-reference'].flatMap(workspace => publicFiles(stage, { source: false, prefix: `${workspace}/dist` })) : [] };
  prior.scope = 'Complete standalone public messaging source checkpoint, derived from the retained steps 1–3 source/provenance packet. Not a publication authorization.';
  prior.generatedAt = new Date().toISOString();
  writeJson(file, prior);
}
function archive(output, name, stage, files) {
  const list = path.join(output, name + '.paths.txt');
  writeText(list, files.map(row => typeof row === 'string' ? row : row.path).sort().join('\n') + '\n');
  const destination = path.join(output, name);
  command('tar', ['-czf', destination, '-C', stage, '-T', list], stage);
  const actual = command('tar', ['-tzf', destination], stage).trim().split(/\r?\n/).sort();
  invariant(JSON.stringify(actual) === JSON.stringify(files.map(row => typeof row === 'string' ? row : row.path).sort()), 'Archive membership differs from explicit file manifest');
  return { filename: name, bytes: fs.statSync(destination).size, sha256: digest(destination) };
}
function cargoSource(root, supplied, stage) {
  invariant(digest(path.join(root, 'packages/crypto/Cargo.lock')) === digest(path.join(supplied, 'packages/crypto/Cargo.lock')), 'Supplied Cargo source does not match current public lock');
  for (const relative of ['dependencies/cargo', 'dependencies/upstream-notices']) copyInput(supplied, relative, stage, { source: false });
  const portableConfig = fs.readFileSync(path.join(supplied, 'packages/crypto/.cargo/config.toml'), 'utf8');
  invariant(portableConfig.includes('directory = "../../dependencies/cargo"') && !/directory = "(?:[A-Za-z]:|\/)/.test(portableConfig), 'Cargo vendor configuration must be portable');
  const rootConfig = fs.readFileSync(path.join(root, 'packages/crypto/.cargo/config.toml'), 'utf8');
  invariant(portableConfig.startsWith(rootConfig.trimEnd()), 'Portable Cargo config changes the current crypto build flags');
  writeText(path.join(stage, 'packages/crypto/.cargo/config.toml'), portableConfig);
  let checked = 0;
  const cargo = fs.readdirSync(path.join(stage, 'dependencies/cargo')).sort().map(directory => {
    const base = path.join(stage, 'dependencies/cargo', directory), checksums = json(path.join(base, '.cargo-checksum.json'));
    for (const [file, expected] of Object.entries(checksums.files)) { safeRelative(file); invariant(digest(path.join(base, file)) === expected, `Cargo source checksum mismatch: ${directory}/${file}`); checked++; }
    const toml = fs.readFileSync(path.join(base, 'Cargo.toml'), 'utf8');
    return { directory, license: /^license\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null, licenseFile: /^license-file\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null };
  });
  return { cargo, checkedSourceFiles: checked };
}
export async function packageMessaging({ root = repository, output, closureSource, cargoSource: suppliedCargo, yarnCli, reuseCrypto, cryptoProof, build = false, buildCrypto = false, resume = false, reusePassedChecks = false, sourcePreparation = false }) {
  root = path.resolve(root); output = path.resolve(output); closureSource = path.resolve(closureSource); suppliedCargo = path.resolve(suppliedCargo);
  if (!resume) checkNewOutput(root, output);
  else invariant(fs.existsSync(path.join(output, 'PREPARATION.json')) && !fs.readdirSync(output).some(name => name.endsWith('.tar.gz') || name === 'RELEASE_INDEX.json' || name === 'runtime'), 'Only a receipted pre-archive preparation may resume');
  invariant(build || !reuseCrypto, 'Crypto reuse is only relevant with --build');
  invariant(!build || buildCrypto || (reuseCrypto && cryptoProof), 'Use --build-crypto or explicit --reuse-crypto and --crypto-proof with --build');
  const closureManifest = json(path.join(closureSource, 'CLOSURE_MANIFEST.json'));
  const stage = path.join(output, 'source'), preparationPath = path.join(output, 'PREPARATION.json');
  let verified, cargo, originalInventorySha256, originalYarnLockSha256, lockHash;
  yarnCli = yarnCli ?? process.env.ENDTOEND_YARN_JS ?? path.join(path.dirname(process.execPath), 'node_modules/yarn/bin/yarn.js');
  invariant(fs.existsSync(yarnCli), 'Provide Yarn 1.22.22 via --yarn-cli or ENDTOEND_YARN_JS');
  const yarn = (args, label) => command(process.execPath, [yarnCli, ...args], stage, path.join(output, label + '.log'));
  if (resume) {
    const preparation = json(preparationPath);
    invariant(preparation.kind === 'endtoend-messaging-completed-preparation' && preparation.passed === true, 'Preparation receipt is incomplete');
    invariant(preparation.closureManifestSha256 === digest(path.join(closureSource, 'CLOSURE_MANIFEST.json')), 'Resume preferred-source input changed');
    invariant(preparation.publicManifestSha256 === digest(path.join(stage, 'package.json')) && preparation.publicYarnLockSha256 === digest(path.join(stage, 'yarn.lock')), 'Resume public install inputs changed');
    for (const row of preparation.logs) invariant(digest(path.join(output, safeRelative(row.path))) === row.sha256, 'Resume install evidence changed');
    invariant(digest(path.join(root, 'packages/crypto/Cargo.lock')) === digest(path.join(stage, 'packages/crypto/Cargo.lock')), 'Resume Cargo source identity changed');
    ({ verified, cargo, originalInventorySha256, originalYarnLockSha256 } = preparation);
    lockHash = preparation.publicYarnLockSha256;
    for (const relative of ['scripts/package-messaging.mjs', 'scripts/package-messaging.test.mjs', 'docs/deployment/PUBLIC_PACKAGE.md', 'docs/deployment/PACKAGING.md', 'scripts/test-messaging-standalone.mjs']) copyInput(root, relative, stage);
    const oldManifest = json(path.join(stage, 'package.json')), newManifest = publicManifest();
    invariant(JSON.stringify({ ...oldManifest, scripts: null }) === JSON.stringify({ ...newManifest, scripts: null }), 'Public dependency/workspace manifest changed during resume; use a new preparation');
    if (JSON.stringify(oldManifest) !== JSON.stringify(newManifest)) {
      const previous = preparation.publicManifestSha256;
      writeJson(path.join(stage, 'package.json'), newManifest);
      preparation.publicManifestSha256 = digest(path.join(stage, 'package.json'));
      preparation.scriptOnlyManifestUpdate = { previousSha256: previous, dependencyFieldsUnchanged: true };
      writeJson(preparationPath, preparation);
    }
    writeJson(path.join(output, 'RESUME_RECEIPT.json'), { kind: 'endtoend-pre-archive-preparation-reuse', checkedAt: new Date().toISOString(), preparationSha256: digest(preparationPath), explanation: 'Resume only the already completed source/vendor verification and two successful installs after a pre-archive notice-alias failure; no prior artifact is overwritten.', immutableArtifactsExisted: false });
  } else {
  verified = verifyClosure(closureSource, closureManifest);
  invariant(verified.passed, `Preferred-source packet failed: ${JSON.stringify(verified.issues)}`);
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(stage);
  for (const file of closureManifest.files) copyOne(path.join(closureSource, file.path), path.join(stage, file.path));
  copyOne(path.join(closureSource, 'CLOSURE_MANIFEST.json'), path.join(stage, 'docs/release/scope/STEP_1_3_INPUT_MANIFEST.json'));
  copyOne(path.join(closureSource, 'docs/release/inventory/EXPANDED_INVENTORY.json'), path.join(stage, 'docs/release/scope/STEP_1_3_INPUT_EXPANDED_INVENTORY.json'));
  copyOne(path.join(closureSource, 'yarn.lock'), path.join(stage, 'docs/release/scope/STEP_1_3_INPUT_YARN.lock'));
  originalInventorySha256 = digest(path.join(stage, 'docs/release/inventory/EXPANDED_INVENTORY.json')); originalYarnLockSha256 = digest(path.join(closureSource, 'yarn.lock'));
  for (const relative of publicSourceInputs) copyInput(root, relative, stage);
  for (const name of fs.readdirSync(path.join(root, 'scripts')).filter(name => /^(?:messaging-|test-messaging-)/.test(name) && /\.mjs$/.test(name))) copyInput(root, `scripts/${name}`, stage);
  cargo = cargoSource(root, suppliedCargo, stage);
  const manifest = publicManifest(); writeJson(path.join(stage, 'package.json'), manifest);
  copyOne(path.join(root, 'yarn.lock'), path.join(stage, 'yarn.lock'));
  invariant(command(process.execPath, [yarnCli, '--version'], stage).trim() === '1.22.22', 'Yarn 1.22.22 is required');
  // Reuse the existing lock's exact resolutions, pruning only in the isolated stage.
  yarn(['install', '--ignore-scripts', '--non-interactive', '--no-progress', '--offline'], 'install-isolated');
  lockHash = digest(path.join(stage, 'yarn.lock'));
  yarn(['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive', '--no-progress', '--offline'], 'install-frozen');
  invariant(lockHash === digest(path.join(stage, 'yarn.lock')), 'Frozen installation changed public lock');
  writeJson(preparationPath, { kind: 'endtoend-messaging-completed-preparation', passed: true, completedAt: new Date().toISOString(), verified, cargo, originalInventorySha256, originalYarnLockSha256, closureManifestSha256: digest(path.join(closureSource, 'CLOSURE_MANIFEST.json')), publicManifestSha256: digest(path.join(stage, 'package.json')), publicYarnLockSha256: lockHash, logs: ['install-isolated.log', 'install-frozen.log'].map(file => ({ path: file, sha256: digest(path.join(output, file)) })) });
  }
  const installed = installedPackages(stage), notices = createNotices(stage, cargo.cargo, installed);
  writeJson(path.join(stage, 'DEPENDENCIES.json'), { kind: 'endtoend-public-messaging-dependencies', releaseVersion: version, cargo: cargo.cargo, npm: notices.npm, pglite: notices.pglite, workspaceLicenses: notices.workspaceLicenses, preferredSourcePacketManifestSha256: digest(path.join(closureSource, 'CLOSURE_MANIFEST.json')), publicYarnLockSha256: lockHash, preservedThirdPartyTerms: true });
  let cryptoEvidence = { attempted: false, freshRustBuildForExpandedRelease: false };
  const commands = [];
  let priorChecks;
  if (reusePassedChecks) {
    invariant(resume && build && !buildCrypto, 'Passed checks can only be reused for an explicit pre-archive resume with unchanged engine sources');
    priorChecks = json(path.join(output, 'PASSED_CHECKS.json'));
    invariant(priorChecks.passed === true && priorChecks.engineSourceSha256 === engineSourceIdentity(stage), 'Previously tested messaging sources changed; run the public suites again');
    for (const row of priorChecks.logs) invariant(digest(path.join(output, safeRelative(row.path))) === row.sha256, 'Cached public check evidence changed');
    for (const row of priorChecks.browserArtifacts) invariant(digest(path.join(stage, safeRelative(row.path))) === row.sha256, 'Previously built browser artifact changed');
  }
  if (build) {
    if (buildCrypto) {
      command(process.execPath, ['scripts/release-build-crypto.mjs', stage], stage, path.join(output, 'build-crypto.log'));
      cryptoEvidence = { ...json(path.join(stage, '.build/crypto-build-proof.json')), freshRustBuildForExpandedRelease: true };
    } else {
      cryptoEvidence = verifyCryptoReuse(stage, path.resolve(reuseCrypto), json(path.resolve(cryptoProof)));
      for (const file of cryptoEvidence.outputs) copyOne(path.join(reuseCrypto, file.path), path.join(stage, file.path));
    }
    if (priorChecks) {
      command(process.execPath, ['--test', 'scripts/package-messaging.test.mjs'], stage, path.join(output, 'test-package.log'));
      commands.push(...priorChecks.commands.filter(row => row.label !== 'test-package').map(row => ({ ...row, reusedForIdenticalEngineSources: true })), { label: 'test-package', passed: true });
    } else {
    for (const [args, label] of [
      [['--test', 'packages/crypto/test/roundtrip.mjs'], 'test-crypto'],
      [['--test', 'scripts/package-messaging.test.mjs'], 'test-package'],
    ]) { command(process.execPath, args, stage, path.join(output, label + '.log')); commands.push({ label, passed: true }); }
    for (const [args, label] of [
      [['workspace', '@e2ee/protocol', 'build'], 'build-protocol'],
      [['workspace', '@e2ee/client', 'build'], 'build-client'],
      [['workspace', '@e2ee/agent-browser', 'build'], 'build-agent-browser'],
      [['workspace', '@e2ee/messaging-reference', 'build'], 'build-reference'],
      ...['api', 'agent', 'client', 'headless'].map(name => [['workspace', `@e2ee/${name}`, 'test'], `test-${name}`]),
    ]) { yarn(args, label); commands.push({ label, passed: true }); }
    command(process.execPath, ['--import', 'tsx', 'packages/headless/src/bin.ts', '--help'], stage, path.join(output, 'headless-help.log'));
    }
  }
  await derivePublicInventory(stage, installed, { built: build, originalInventorySha256, originalYarnLockSha256 });
  for (const [args, label] of [
    [['scripts/hacl-source-closure.mjs', '--audit', '--cargo-dir', 'dependencies/cargo'], 'audit-hacl'],
    [['scripts/release-mpl-check.mjs'], 'audit-mpl'],
    [['scripts/release-mpl-pg-uuidv7-check.mjs'], 'audit-mpl-pg-uuidv7'],
    [['scripts/release-expanded-inventory.mjs', '--audit'], 'audit-expanded-inventory'],
  ]) command(process.execPath, args, stage, path.join(output, label + '.log'));
  copyOne(path.join(stage, 'docs/deployment/PUBLIC_PACKAGE.md'), path.join(stage, 'README.md'));
  const checkpoint = { kind: sourcePreparation ? 'endtoend-messaging-step-7-source-preparation' : 'endtoend-messaging-step-4-build-evidence', version, checkedAt: new Date().toISOString(), installedInIsolatedPublicWorkspace: true, installLifecycleScripts: false, publicYarnLockSha256: lockHash, sourceClosure: { filesVerified: verified.filesChecked, manifestSha256: digest(path.join(closureSource, 'CLOSURE_MANIFEST.json')) }, cargoSourceFilesVerified: cargo.checkedSourceFiles, crypto: cryptoEvidence, commands, reusedPassedChecks: priorChecks ? { originalCompletedAt: priorChecks.completedAt, engineSourceSha256: priorChecks.engineSourceSha256, evidenceLogs: priorChecks.logs } : null, runnableBuildPassed: build, step7Complete: false, published: false, legalCertification: false };
  writeJson(path.join(stage, 'docs/release/PUBLIC_BUILD_EVIDENCE.json'), checkpoint);
  const sourceManifest = { kind: 'endtoend-complete-messaging-source-checkpoint', version, files: publicFiles(stage).filter(file => file.path !== 'SOURCE_MANIFEST.json'), publicWorkspaces: workspaces, preferredSource: 'Complete locally supplied upstream archives plus selected inspection files and exact provenance. Upstream distribution fixtures remain archival and are not used as EndToEnd build outputs.', excluded: ['independently built apps/web and apps/desk-client consumers', 'installed node_modules at every depth', 'prebuilt EndToEnd browser/WASM artifacts', 'compiler target directories', '.env/local configuration', 'user vault/database/message data', 'repository history'], published: false, legalCertification: false };
  writeJson(path.join(stage, 'SOURCE_MANIFEST.json'), sourceManifest);
  const sourceArtifact = archive(output, `endtoend-messaging-${version}-source.tar.gz`, stage, [...sourceManifest.files, 'SOURCE_MANIFEST.json']);
  sourceArtifact.manifestFilename = 'SOURCE_MANIFEST.json'; sourceArtifact.manifestSha256 = digest(path.join(stage, 'SOURCE_MANIFEST.json'));
  copyOne(path.join(stage, 'SOURCE_MANIFEST.json'), path.join(output, 'SOURCE_MANIFEST.json'));
  const runtimeArtifacts = [];
  if (build) {
    const runtime = path.join(output, 'runtime'); fs.mkdirSync(runtime);
    const runtimeInputs = ['LICENSE', 'LICENSING.md', 'README.md', 'yarn.lock', 'DEPENDENCIES.json', 'docs/release/NOTICE.md', 'docs/deployment', 'docs/release/third-party', 'docs/release/inventory/npm-notices', 'docs/release/inventory/pglite-notices', 'dependencies/cargo-notices', 'dependencies/npm-notices', 'dependencies/upstream-notices', 'scripts/serve-messaging.mjs', 'scripts/serve-endtoend.mjs', 'scripts/source-disclosure.mjs', 'scripts/messaging-state.mjs', 'scripts/messaging-storage.mjs', ...workspaces.flatMap(workspace => [`${workspace}/package.json`, ...(workspace === 'apps/agent-browser' || workspace === 'apps/messaging-reference' ? [`${workspace}/dist`] : [`${workspace}/src`])]), 'packages/protocol/LICENSE', 'packages/client/LICENSE', 'packages/protocol/dist', 'packages/client/dist', 'packages/crypto/pkg-node', 'packages/crypto/pkg-web'];
    for (const relative of runtimeInputs) copyInput(stage, relative, runtime, { source: false });
    for (const workspace of ['packages/agent', 'packages/headless']) copyInput(stage, `${workspace}/README.md`, runtime, { source: false });
    const runtimeManifest = publicManifest(); runtimeManifest.name = 'endtoend-messaging-runtime'; runtimeManifest.scripts = Object.fromEntries(Object.entries(runtimeManifest.scripts).filter(([name]) => name === 'start' || name === 'agent' || name.startsWith('headless:')));
    writeJson(path.join(runtime, 'package.json'), runtimeManifest);
    const runtimeFiles = publicFiles(runtime, { source: false });
    const runtimeInventory = { kind: 'endtoend-complete-messaging-runtime-checkpoint', version, matchingSourceSha256: sourceArtifact.sha256, matchingSourceManifestSha256: sourceArtifact.manifestSha256, install: 'yarn install --frozen-lockfile --ignore-scripts --non-interactive', files: runtimeFiles };
    writeJson(path.join(output, 'RUNTIME_MANIFEST.json'), runtimeInventory);
    const artifact = archive(output, `endtoend-messaging-${version}-runtime.tar.gz`, runtime, runtimeFiles);
    runtimeArtifacts.push({ ...artifact, kind: 'persistent-relay-agent-adapters-browser-reference-runtime', manifestFilename: 'RUNTIME_MANIFEST.json', manifestSha256: digest(path.join(output, 'RUNTIME_MANIFEST.json')), matchingSourceSha256: sourceArtifact.sha256 });
  }
  const index = { kind: 'endtoend-messaging-local-checkpoint-index', version, protocolVersion: 1, source: { ...sourceArtifact, url: `/source/${sourceArtifact.filename}`, files: sourceManifest.files.length }, runtimeArtifacts, sourceOnlyBuild: { attempted: buildCrypto, passed: buildCrypto && build }, checkpoint, componentLicenses: { messagingImplementation: 'AGPL-3.0-only', protocolClient: 'MIT', thirdParty: 'Original terms retained in notices and source; see DEPENDENCIES.json' }, completeStandaloneBuild: build, step7Complete: false, publicationReady: false, published: false, legalCertification: false };
  writeJson(path.join(output, 'RELEASE_INDEX.json'), index);
  writeJson(path.join(output, 'BUILD_EVIDENCE.json'), checkpoint);
  writeText(path.join(output, 'SHA256SUMS.txt'), [sourceArtifact, ...runtimeArtifacts].map(item => `${item.sha256}  ${item.filename}`).join('\n') + '\n');
  return { output, source: stage, runtime: build ? path.join(output, 'runtime') : null, index: path.join(output, 'RELEASE_INDEX.json'), sourceArtifact, runtimeArtifacts, passed: true, step7Complete: false, published: false };
}
/** Archive before building, then supply a genuinely fresh extraction to the caller. */
export async function prepareMessagingSource(options) {
  invariant(!options.build && !options.buildCrypto && !options.reuseCrypto && !options.cryptoProof && !options.resume && !options.reusePassedChecks, 'Source preparation forbids builds, prebuilt reuse and resumed evidence');
  const result = await packageMessaging({ ...options, build: false, sourcePreparation: true });
  const freshExtraction = path.join(result.output, 'fresh-extraction');
  fs.mkdirSync(freshExtraction);
  command('tar', ['-xzf', path.join(result.output, result.sourceArtifact.filename), '-C', freshExtraction], result.output);
  const manifest = json(path.join(freshExtraction, 'SOURCE_MANIFEST.json'));
  const verification = verifyPackage(freshExtraction, manifest);
  invariant(verification.passed, `Fresh source extraction failed: ${JSON.stringify(verification.errors)}`);
  for (const name of ['node_modules', '.build', 'packages/crypto/pkg-node', 'packages/crypto/pkg-web', 'apps/agent-browser/dist', 'apps/messaging-reference/dist', 'apps/web', 'apps/desk-client']) invariant(!fs.existsSync(path.join(freshExtraction, name)), `Fresh extraction contains an unavailable/private/prebuilt input: ${name}`);
  const receipt = { kind: 'endtoend-step-7-archive-before-build', preparedAt: new Date().toISOString(), passed: true, sourceArtifact: result.sourceArtifact, sourceManifestSha256: digest(path.join(freshExtraction, 'SOURCE_MANIFEST.json')), freshExtraction, extractionVerification: verification, productBuildAttempted: false, prebuiltProductOutputs: false, privateConsumersIncluded: false, step7Complete: false, published: false };
  writeJson(path.join(result.output, 'SOURCE_PREPARATION.json'), receipt);
  return { ...result, freshExtraction, preparationReceipt: path.join(result.output, 'SOURCE_PREPARATION.json') };
}
/** Validate the actual build against the immutable archive, including build freshness. */
export function verifyFreshMessagingBuild({ preparation, buildRoot }) {
  preparation = path.resolve(preparation); buildRoot = path.resolve(buildRoot);
  const receipt = json(path.join(preparation, 'SOURCE_PREPARATION.json'));
  invariant(receipt.kind === 'endtoend-step-7-archive-before-build' && receipt.passed === true && receipt.productBuildAttempted === false && receipt.prebuiltProductOutputs === false, 'A completed archive-before-build preparation is required');
  invariant(path.resolve(receipt.freshExtraction) === buildRoot, 'Use the receipted fresh extraction for the complete source build');
  const sourceArchive = path.join(preparation, safeRelative(receipt.sourceArtifact.filename));
  invariant(digest(sourceArchive) === receipt.sourceArtifact.sha256, 'Prepared source archive changed');
  invariant(digest(path.join(buildRoot, 'SOURCE_MANIFEST.json')) === receipt.sourceManifestSha256, 'Prepared source manifest changed');
  const sourceManifest = json(path.join(buildRoot, 'SOURCE_MANIFEST.json'));
  const sourceVerification = verifyPackage(buildRoot, sourceManifest);
  invariant(sourceVerification.passed, `Fresh build source differs from archive: ${JSON.stringify(sourceVerification.errors)}`);
  const proof = json(path.join(buildRoot, '.build/crypto-build-proof.json'));
  const start = json(path.join(buildRoot, '.build/crypto-build-start.json'));
  invariant(proof.kind === 'endtoend-agent-crypto-source-build' && proof.success === true && proof.prebuiltFallback === false && start.prebuiltFallback === false, 'Fresh extracted-source crypto build is required; fallback/reuse is forbidden');
  const preparedAt = Date.parse(receipt.preparedAt), startedAt = Date.parse(start.startedAt), completedAt = Date.parse(proof.completedAt);
  invariant(Number.isFinite(preparedAt) && Number.isFinite(startedAt) && Number.isFinite(completedAt) && startedAt >= preparedAt && completedAt >= startedAt, 'Crypto proof predates the fresh extraction');
  verifyCryptoReuse(buildRoot, buildRoot, proof); // Identity check only: no artifact is reused/copied.
  return { passed: true, receipt, sourceArchive, sourceManifest, sourceVerification, crypto: { ...proof, sourceBuildStartedAt: start.startedAt, freshRustBuildForExpandedRelease: true, buildRoot, reusedPrebuiltArtifact: false } };
}
/** Package only the runtime built from the receipted extraction. The offered source bytes stay frozen. */
export async function finalizeMessagingBuild({ preparation, buildRoot, output, acceptanceEvidence, evidenceFiles = [] }) {
  preparation = path.resolve(preparation); buildRoot = path.resolve(buildRoot); output = path.resolve(output);
  checkNewOutput(buildRoot, output);
  const verified = verifyFreshMessagingBuild({ preparation, buildRoot });
  const acceptance = typeof acceptanceEvidence === 'string' ? json(path.resolve(acceptanceEvidence)) : acceptanceEvidence;
  invariant(acceptance?.passed === true && Array.isArray(acceptance.checks) && acceptance.checks.length > 0 && acceptance.checks.every(row => row.passed === true), 'Current passing acceptance evidence with explicit checks is required');
  const browserBundles = await inspectPublicBrowserBuild(buildRoot);
  const runtime = path.join(output, 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const sourceArtifact = { ...verified.receipt.sourceArtifact };
  copyOne(verified.sourceArchive, path.join(output, sourceArtifact.filename));
  copyOne(path.join(buildRoot, 'SOURCE_MANIFEST.json'), path.join(output, 'SOURCE_MANIFEST.json'));
  const runtimeInputs = ['LICENSE', 'LICENSING.md', 'README.md', 'yarn.lock', 'DEPENDENCIES.json', 'docs/release/NOTICE.md', 'docs/deployment', 'docs/release/third-party', 'docs/release/inventory/npm-notices', 'docs/release/inventory/pglite-notices', 'dependencies/cargo-notices', 'dependencies/npm-notices', 'dependencies/upstream-notices', 'scripts/serve-messaging.mjs', 'scripts/serve-endtoend.mjs', 'scripts/source-disclosure.mjs', 'scripts/messaging-state.mjs', 'scripts/messaging-storage.mjs', ...workspaces.flatMap(workspace => [`${workspace}/package.json`, ...(workspace === 'apps/agent-browser' || workspace === 'apps/messaging-reference' ? [`${workspace}/dist`] : [`${workspace}/src`])]), 'packages/protocol/LICENSE', 'packages/client/LICENSE', 'packages/protocol/dist', 'packages/client/dist', 'packages/crypto/pkg-node', 'packages/crypto/pkg-web'];
  for (const relative of runtimeInputs) copyInput(buildRoot, relative, runtime, { source: false });
  for (const workspace of ['packages/agent', 'packages/headless']) copyInput(buildRoot, `${workspace}/README.md`, runtime, { source: false });
  const runtimeManifest = json(path.join(buildRoot, 'package.json'));
  runtimeManifest.name = 'endtoend-messaging-runtime';
  runtimeManifest.scripts = Object.fromEntries(Object.entries(runtimeManifest.scripts).filter(([name]) => name === 'start' || name === 'agent' || name.startsWith('headless:')));
  writeJson(path.join(runtime, 'package.json'), runtimeManifest);
  const runtimeFiles = publicFiles(runtime, { source: false });
  const runtimeInventory = { kind: 'endtoend-complete-messaging-runtime-fresh-source-build', version, matchingSourceSha256: sourceArtifact.sha256, matchingSourceManifestSha256: sourceArtifact.manifestSha256, install: 'yarn install --frozen-lockfile --ignore-scripts --non-interactive', files: runtimeFiles };
  writeJson(path.join(output, 'RUNTIME_MANIFEST.json'), runtimeInventory);
  const artifact = archive(output, `endtoend-messaging-${version}-runtime.tar.gz`, runtime, runtimeFiles);
  const runtimeArtifact = { ...artifact, kind: 'persistent-relay-agent-adapters-browser-reference-runtime', manifestFilename: 'RUNTIME_MANIFEST.json', manifestSha256: digest(path.join(output, 'RUNTIME_MANIFEST.json')), matchingSourceSha256: sourceArtifact.sha256 };
  const evidence = evidenceFiles.map((file, index) => {
    const absolute = path.resolve(file), relative = `evidence/${String(index + 1).padStart(3, '0')}-${path.basename(absolute)}`;
    copyOne(absolute, path.join(output, relative));
    return { path: relative, bytes: fs.statSync(absolute).size, sha256: digest(absolute) };
  });
  writeJson(path.join(output, 'ACCEPTANCE_EVIDENCE.json'), acceptance);
  writeJson(path.join(output, 'BROWSER_BUNDLES.json'), browserBundles);
  const checkpoint = { kind: 'endtoend-messaging-step-7-fresh-build-evidence', version, checkedAt: new Date().toISOString(), archivePreparedBeforeBuild: true, sourceArchiveSha256: sourceArtifact.sha256, sourceManifestSha256: sourceArtifact.manifestSha256, sourceVerification: verified.sourceVerification, preparationReceiptSha256: digest(path.join(preparation, 'SOURCE_PREPARATION.json')), crypto: verified.crypto, browserBundleEvidenceSha256: digest(path.join(output, 'BROWSER_BUNDLES.json')), acceptanceEvidenceSha256: digest(path.join(output, 'ACCEPTANCE_EVIDENCE.json')), evidence, runnableBuildPassed: true, step7Complete: false, published: false, legalCertification: false };
  const index = { kind: 'endtoend-messaging-local-checkpoint-index', version, protocolVersion: 1, source: { ...sourceArtifact, url: `/source/${sourceArtifact.filename}`, files: verified.sourceManifest.files.length }, runtimeArtifacts: [runtimeArtifact], sourceOnlyBuild: { attempted: true, passed: true }, checkpoint, componentLicenses: { messagingImplementation: 'AGPL-3.0-only', protocolClient: 'MIT', thirdParty: 'Original terms retained in notices and source; see DEPENDENCIES.json' }, completeStandaloneBuild: true, step7Complete: false, publicationReady: false, published: false, legalCertification: false };
  writeJson(path.join(output, 'RELEASE_INDEX.json'), index);
  writeJson(path.join(output, 'BUILD_EVIDENCE.json'), checkpoint);
  writeText(path.join(output, 'SHA256SUMS.txt'), [sourceArtifact, runtimeArtifact].map(item => `${item.sha256}  ${item.filename}`).join('\n') + '\n');
  return { passed: true, output, sourceArtifact, runtimeArtifacts: [runtimeArtifact], runtime, index: path.join(output, 'RELEASE_INDEX.json'), step7Complete: false, published: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), get = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  if (args.includes('--finalize-from')) {
    invariant(get('--out') && get('--preparation') && get('--acceptance-evidence'), 'Use --finalize-from <fresh-extraction> --preparation <prepared-output> --out <new-final-output> --acceptance-evidence <current-checks.json> [--evidence-file <log-or-receipt> ...]');
    const evidenceFiles = args.flatMap((argument, index) => argument === '--evidence-file' ? [args[index + 1]] : []);
    console.log(JSON.stringify(await finalizeMessagingBuild({ preparation: get('--preparation'), buildRoot: get('--finalize-from'), output: get('--out'), acceptanceEvidence: get('--acceptance-evidence'), evidenceFiles }), null, 2));
  } else {
  invariant(get('--out') && get('--closure-source') && get('--cargo-source'), 'Use --out <new-directory> --closure-source <verified-packet-source> --cargo-source <vendored-source-root> [--build --reuse-crypto <runtime-root> --crypto-proof <proof.json> | --build --build-crypto]');
  const packageOptions = { root: get('--root') ?? repository, output: get('--out'), closureSource: get('--closure-source'), cargoSource: get('--cargo-source'), yarnCli: get('--yarn-cli'), reuseCrypto: get('--reuse-crypto'), cryptoProof: get('--crypto-proof'), build: args.includes('--build'), buildCrypto: args.includes('--build-crypto'), resume: args.includes('--resume'), reusePassedChecks: args.includes('--reuse-passed-checks') };
  const result = await (args.includes('--prepare-source') ? prepareMessagingSource(packageOptions) : packageMessaging(packageOptions));
  console.log(JSON.stringify(result, null, 2));
  }
}
