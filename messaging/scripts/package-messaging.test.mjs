// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { publicFiles, publicManifest, publicSourceInputs, verifyCryptoReuse, verifyPackage, materializeSupplementalNotice, createNotices, lockMetadata, prepareMessagingSource, verifyFreshMessagingBuild } from './package-messaging.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-package-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('messaging-package-'));
  const write = (name, text = 'source\n') => { const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  try { callback(directory, write); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
test('public workspace contains the real server, contracts, adapters and reference app without a private consumer', () => {
  const manifest = publicManifest();
  for (const workspace of ['apps/api', 'packages/contract', 'packages/headless', 'apps/messaging-reference', 'apps/agent-browser']) assert.ok(manifest.workspaces.includes(workspace));
  assert.ok(!manifest.workspaces.includes('apps/web'));
  assert.ok(!manifest.workspaces.includes('apps/desk-client'));
  assert.match(manifest.scripts['build:crypto'], /release-build-crypto/);
  assert.match(manifest.scripts.start, /serve-messaging/);
  for (const file of ['package-messaging.test.mjs', 'messaging-state.test.mjs', 'config.test.ts']) assert.ok(manifest.scripts.test.includes(file));
  assert.ok(!Object.values(manifest.scripts).some(command => /@e2ee\/(?:web|desk-client)/.test(command)));
});
test('source inputs preserve current public integration docs without expanded inspection trees or consumer source', () => {
  for (const name of ['docs/architecture', 'docs/release/FRONTEND_BOUNDARY_ASSESSMENT.json', 'docs/release/STEP_6_COMPLETION.md', 'scripts/release-audit.mjs']) assert.ok(publicSourceInputs.includes(name));
  for (const name of ['docs/release', 'docs/release/inventory', 'dependencies/preferred-source', 'apps/web', 'apps/desk-client']) assert.ok(!publicSourceInputs.includes(name));
});
test('archive-before-build preparation rejects build and reuse options before touching inputs', async () => {
  for (const options of [{ build: true }, { buildCrypto: true }, { reuseCrypto: 'prior-runtime' }, { cryptoProof: 'old-proof' }, { resume: true }, { reusePassedChecks: true }]) await assert.rejects(prepareMessagingSource(options), /forbids builds/);
});
test('derived public lock counts exclude historical private-workspace entries and classify scoped packages correctly', () => {
  const lock = '# yarn lockfile v1\n\n"@scope/a@^1":\n  version "1.0.0"\n  resolved "https://example.invalid/a.tgz"\n\nb@^2:\n  version "2.0.0"\n  resolved "https://example.invalid/b.tgz"\n';
  const metadata = lockMetadata(lock, [{ name: '@scope/a', version: '1.0.0' }]);
  assert.equal(metadata.lockedEntries, 2);
  assert.equal(metadata.lockedNotInstalled.length, 1);
  assert.deepEqual(metadata.lockedNotInstalled[0].selectors, ['b@^2']);
});
test('source inventory excludes installed/generated product outputs at every depth while preserving upstream source dist directories', () => fixture((directory, write) => {
  for (const name of ['apps/api/src/db.ts', 'apps/messaging-reference/src/main.ts', 'dependencies/cargo/example/dist/preferred.rs', 'dependencies/preferred-source/upstream.tar.gz']) write(name);
  for (const name of ['apps/api/node_modules/tool/index.js', 'packages/agent/node_modules/.bin/tsx', 'packages/crypto/pkg-web/out.wasm', 'packages/protocol/dist/index.js', 'packages/client/dist/index.d.ts', 'apps/messaging-reference/dist/index.html', 'apps/agent-browser/dist/index.html', '.build/output.wasm']) write(name);
  assert.deepEqual(publicFiles(directory).map(file => file.path), ['apps/api/src/db.ts', 'apps/messaging-reference/src/main.ts', 'dependencies/cargo/example/dist/preferred.rs', 'dependencies/preferred-source/upstream.tar.gz']);
}));
test('source inventory refuses accidentally allowlisted local credentials or user state', () => fixture((directory, write) => {
  write('apps/api/.env', 'not-a-real-secret');
  assert.throws(() => publicFiles(directory), /User state or local configuration/);
}));
test('frozen supplemental npm notice paths retain exactly the already supplied assessed bytes', () => fixture((directory, write) => {
  const text = 'Original upstream license and copyright\n';
  const source = 'docs/release/inventory/npm-notices/esbuild@1/0-LICENSE.md';
  const entry = { path: 'dependencies/npm-notices/esbuild/LICENSE.md', sha256: hash(Buffer.from(text)) };
  write(source, text);
  materializeSupplementalNotice(directory, entry, [{ path: source, sha256: entry.sha256 }]);
  assert.equal(fs.readFileSync(path.join(directory, entry.path), 'utf8'), text);
  write(entry.path, 'changed notice');
  assert.throws(() => materializeSupplementalNotice(directory, entry, [{ path: source, sha256: entry.sha256 }]), /alias hash differs/);
}));
test('browser aggregate preserves both first-party SDK MIT grants as well as dependency notices', () => fixture((directory, write) => {
  write('docs/release/inventory/EXPANDED_INVENTORY.json', JSON.stringify({ npm: { packages: [] }, pglite: { components: [] } }));
  write('docs/release/third-party/DEPENDENCY_LICENSE_SOURCES.json', JSON.stringify({ cargo: {}, npm: {} }));
  const client = 'MIT License\nCopyright transport author\nPermission is hereby granted to use this software.\n';
  const protocol = 'MIT License\nCopyright protocol author\nPermission is hereby granted to use this software.\n';
  write('packages/client/LICENSE', client); write('packages/protocol/LICENSE', protocol);
  const result = createNotices(directory, [], []);
  assert.deepEqual(result.workspaceLicenses.map(row => row.name), ['@e2ee/client', '@e2ee/protocol']);
  for (const workspace of ['agent-browser', 'messaging-reference']) {
    const text = fs.readFileSync(path.join(directory, `apps/${workspace}/public/THIRD_PARTY_NOTICES.txt`), 'utf8');
    assert.ok(text.includes(client) && text.includes(protocol));
    assert.ok(text.includes('@e2ee/client') && text.includes('@e2ee/protocol'));
  }
}));
function cryptoFixture(directory, write) {
  const inputs = ['packages/crypto/Cargo.toml', 'packages/crypto/Cargo.lock', 'packages/crypto/.cargo/config.toml', 'packages/crypto/src/lib.rs', 'packages/crypto/src/node.ts', 'packages/crypto/src/browser.ts'];
  for (const name of inputs) write(name);
  const outputs = ['node', 'web'].flatMap(target => Array.from({ length: 5 }, (_, index) => `packages/crypto/pkg-${target}/fixture-${index}.js`));
  for (const name of outputs) write('runtime/' + name, 'compiled\n');
  return { success: true, prebuiltFallback: false, inputs: inputs.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(directory, name))) })), outputs: outputs.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(directory, 'runtime', name))) })) };
}
test('explicit crypto reuse binds every current input and all ten outputs', () => fixture((directory, write) => {
  const proof = cryptoFixture(directory, write);
  assert.equal(verifyCryptoReuse(directory, path.join(directory, 'runtime'), proof).sourceIdentityVerified, true);
  write('packages/crypto/src/lib.rs', 'changed source\n');
  assert.throws(() => verifyCryptoReuse(directory, path.join(directory, 'runtime'), proof), /source input differs/);
}));
test('crypto reuse rejects incomplete source proofs and tampered artifacts', () => fixture((directory, write) => {
  const proof = cryptoFixture(directory, write);
  assert.throws(() => verifyCryptoReuse(directory, path.join(directory, 'runtime'), { ...proof, inputs: proof.inputs.slice(1) }), /every current source input/);
  write('runtime/' + proof.outputs[0].path, 'changed artifact');
  assert.throws(() => verifyCryptoReuse(directory, path.join(directory, 'runtime'), proof), /output differs/);
}));
test('extracted package verification rejects byte changes and unexpected files', () => fixture((directory, write) => {
  write('apps/api/src/db.ts');
  const manifest = { files: publicFiles(directory) };
  assert.equal(verifyPackage(directory, manifest).passed, true);
  write('apps/api/src/extra.ts');
  assert.match(verifyPackage(directory, manifest).errors.join('\n'), /Unmanifested file/);
  write('apps/api/src/db.ts', 'changed');
  assert.match(verifyPackage(directory, manifest).errors.join('\n'), /hash mismatch/);
}));
function freshBuildFixture(directory, write) {
  const preparation = path.join(directory, 'prepared'), buildRoot = path.join(preparation, 'fresh-extraction');
  const put = (name, text = 'source\n') => write(`prepared/fresh-extraction/${name}`, text);
  const inputs = ['packages/crypto/Cargo.toml', 'packages/crypto/Cargo.lock', 'packages/crypto/.cargo/config.toml', 'packages/crypto/src/lib.rs', 'packages/crypto/src/node.ts', 'packages/crypto/src/browser.ts'];
  for (const name of inputs) put(name);
  const manifest = { files: publicFiles(buildRoot) };
  put('SOURCE_MANIFEST.json', JSON.stringify(manifest));
  write('prepared/source.tar.gz', 'immutable-archive-fixture');
  const outputs = ['node', 'web'].flatMap(target => Array.from({ length: 5 }, (_, index) => `packages/crypto/pkg-${target}/fixture-${index}.js`));
  for (const name of outputs) put(name, 'compiled\n');
  const proof = { kind: 'endtoend-agent-crypto-source-build', success: true, prebuiltFallback: false, completedAt: '2026-10-26T12:02:00.000Z', inputs: inputs.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(buildRoot, name))) })), outputs: outputs.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(buildRoot, name))) })) };
  put('.build/crypto-build-proof.json', JSON.stringify(proof));
  put('.build/crypto-build-start.json', JSON.stringify({ startedAt: '2026-10-26T12:01:00.000Z', prebuiltFallback: false }));
  const receipt = { kind: 'endtoend-step-7-archive-before-build', passed: true, productBuildAttempted: false, prebuiltProductOutputs: false, preparedAt: '2026-10-26T12:00:00.000Z', freshExtraction: buildRoot, sourceManifestSha256: hash(fs.readFileSync(path.join(buildRoot, 'SOURCE_MANIFEST.json'))), sourceArtifact: { filename: 'source.tar.gz', sha256: hash(fs.readFileSync(path.join(preparation, 'source.tar.gz'))) } };
  write('prepared/SOURCE_PREPARATION.json', JSON.stringify(receipt));
  return { preparation, buildRoot, put, proof, receipt };
}
test('finalization accepts only the unchanged offered source with a subsequent fresh crypto build', () => fixture((directory, write) => {
  const options = freshBuildFixture(directory, write);
  const result = verifyFreshMessagingBuild(options);
  assert.equal(result.passed, true);
  assert.equal(result.crypto.freshRustBuildForExpandedRelease, true);
  assert.equal(result.crypto.reusedPrebuiltArtifact, false);
  options.put('packages/crypto/src/lib.rs', 'changed source\n');
  assert.throws(() => verifyFreshMessagingBuild(options), /source differs from archive/);
}));
test('finalization rejects old build proofs, fallback artifacts, and modified archive bytes', () => fixture((directory, write) => {
  const options = freshBuildFixture(directory, write);
  options.put('.build/crypto-build-start.json', JSON.stringify({ startedAt: '2026-10-25T12:01:00.000Z', prebuiltFallback: false }));
  assert.throws(() => verifyFreshMessagingBuild(options), /predates the fresh extraction/);
  options.put('.build/crypto-build-start.json', JSON.stringify({ startedAt: '2026-10-26T12:01:00.000Z', prebuiltFallback: true }));
  assert.throws(() => verifyFreshMessagingBuild(options), /fallback\/reuse is forbidden/);
  write('prepared/source.tar.gz', 'modified archive');
  assert.throws(() => verifyFreshMessagingBuild(options), /source archive changed/);
}));
