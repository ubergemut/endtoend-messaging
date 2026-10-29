// SPDX-License-Identifier: MIT
// First-party interface packaging only. No messaging engine implementation is imported or copied.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SDK_PACKAGE_VERSION = '0.2.1'
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const digest = filename => hash(fs.readFileSync(filename))
const invariant = (value, message) => { if (!value) throw new Error(message) }
const portable = value => value.replaceAll('\\', '/')
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'))
const write = (filename, value) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, value) }
const writeJson = (filename, value) => write(filename, JSON.stringify(value, null, 2) + '\n')

export function safeSdkPath(name) {
  invariant(typeof name === 'string' && name && !path.isAbsolute(name) && !name.includes('\\') && !/[\r\n\0]/.test(name)
    && !name.split('/').some(part => !part || part === '.' || part === '..' || /^\.env(?:\.|$)/.test(part)), 'Unsafe SDK member path')
  invariant(!name.split('/').some(part => ['node_modules', '.git', 'vaults', 'data'].includes(part)), 'Installed packages or local state cannot enter SDK')
  invariant(/^(?:package\.json|yarn\.lock|LICENSE|README\.md|SDK_(?:MANIFEST|PROVENANCE)\.json|docs\/architecture\/(?:SDK_CONTRACT_V1|BROWSER_CONSUMER_V1)\.md|scripts\/package-sdk(?:\.test)?\.mjs|packages\/(?:protocol|client)\/(?:package\.json|LICENSE|README\.md|tsconfig\.build\.json|build\.mjs|(?:src|dist|test|examples)\/.+))$/.test(name), 'Non-SDK member refused')
  invariant(!/^packages\/client\/test\/reference\.test\.ts$/.test(name), 'AGPL interoperability fixture does not belong in independent SDK')
  return name
}

export function sdkFiles(root, prefix = '') {
  const result = []
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    if (name === 'node_modules') continue // Installed tools are deliberately external to the artifact.
    const relative = prefix ? `${prefix}/${name}` : name
    const filename = path.join(root, relative), stat = fs.lstatSync(filename)
    invariant(!stat.isSymbolicLink(), `SDK symlink refused: ${relative}`)
    if (stat.isDirectory()) {
      invariant(['packages', 'packages/protocol', 'packages/client', 'docs', 'docs/architecture', 'scripts'].includes(relative)
        || /^packages\/(?:protocol|client)\/(?:src|dist|test|examples)(?:\/[A-Za-z0-9_.-]+)*$/.test(relative), 'Unexpected SDK directory')
      result.push(...sdkFiles(root, relative))
    } else { safeSdkPath(relative); invariant(stat.isFile(), `Nonregular SDK member: ${relative}`); result.push({ path: relative, bytes: stat.size, sha256: digest(filename) }) }
  }
  return result
}

function copyFile(source, target) {
  const stat = fs.lstatSync(source)
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'SDK input must be a regular file')
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target)
}
function copyTree(root, relative, destination) {
  const filename = path.join(root, relative), stat = fs.lstatSync(filename)
  invariant(!stat.isSymbolicLink(), `SDK source symlink refused: ${relative}`)
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(filename).sort()) copyTree(root, `${relative}/${name}`, destination)
  } else {
    if (relative === 'packages/client/test/reference.test.ts') return
    safeSdkPath(relative); copyFile(filename, path.join(destination, relative))
  }
}

/** Retained lock records must preserve the original version, URL, integrity and dependency bodies. */
export function lockedBlocks(text) {
  const rows = []
  let current
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    if (!line || line.startsWith('#')) continue
    if (!line.startsWith(' ')) {
      invariant(line.endsWith(':'), 'Unsupported lock syntax')
      if (current) rows.push(current)
      const head = line.slice(0, -1), selectors = []
      let cursor = 0
      while (cursor < head.length) {
        if (head[cursor] === '"') {
          let end = cursor + 1
          while (end < head.length && (head[end] !== '"' || head[end - 1] === '\\')) end++
          invariant(end < head.length, 'Unclosed lock selector')
          selectors.push(JSON.parse(head.slice(cursor, end + 1))); cursor = end + 1
        } else {
          const end = head.indexOf(',', cursor)
          selectors.push(head.slice(cursor, end < 0 ? undefined : end).trim()); cursor = end < 0 ? head.length : end
        }
        if (cursor < head.length) { invariant(head[cursor] === ',', 'Unsupported lock selector separator'); cursor++; while (head[cursor] === ' ') cursor++ }
      }
      current = { selectors, body: [] }
    } else { invariant(current, 'Lock body before selector'); current.body.push(line) }
  }
  if (current) rows.push(current)
  return rows.map(row => ({ selectors: row.selectors, body: row.body.join('\n'), version: /^  version "([^"]+)"$/m.exec(row.body.join('\n'))?.[1] }))
}
export function verifyLockDerivation(original, selected) {
  const all = lockedBlocks(original), rows = lockedBlocks(selected)
  invariant(rows.length > 0, 'Empty SDK lock')
  for (const row of rows) for (const selector of row.selectors)
    invariant(all.some(prior => prior.selectors.includes(selector) && prior.body === row.body), `SDK lock changed a pre-existing resolution: ${selector}`)
  return { exactOriginalResolutions: true, lockedRecords: rows.length, selectedVersions: rows.map(row => ({ selectors: row.selectors, version: row.version })) }
}

export function verifySdk(root, manifest) {
  const actual = sdkFiles(root).filter(row => row.path !== 'SDK_MANIFEST.json')
  const expected = manifest.files ?? []
  invariant(expected.length > 0, 'Empty SDK file manifest')
  const seen = new Set()
  for (const row of expected) { safeSdkPath(row.path); invariant(!seen.has(row.path), 'Duplicate SDK manifest member'); seen.add(row.path) }
  invariant(actual.length === expected.length, 'SDK membership differs from exact manifest')
  for (const row of actual) {
    const prior = expected.find(item => item.path === row.path)
    invariant(prior && prior.bytes === row.bytes && prior.sha256 === row.sha256, `SDK bytes or membership changed: ${row.path}`)
  }
  return { passed: true, filesChecked: expected.length }
}

function run(command, args, cwd, log) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (log) write(log, `$ ${path.basename(command)} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  invariant(!result.error && result.status === 0, `${path.basename(command)} ${args.join(' ')} failed (${result.status}): ${result.error?.message ?? result.stdout?.slice(-1000)} ${result.stderr?.slice(-3000)}`)
  return result.stdout
}

function bareRuntimeFixture() {
  return `import assert from 'node:assert/strict';
import {AgentClient,RelayService,SDK_VERSION} from '@e2ee/client/standalone';
const client=new AgentClient({async request(request){assert.equal(request.operation,'status');return {version:1,requestId:request.requestId,ok:true,result:{unlocked:false,handle:null,accountId:null,relay:'fixture',vaultPath:'fixture',pendingTrustHandle:null}}}});
assert.equal((await client.command('status',{})).unlocked,false);await client.close();assert.equal(SDK_VERSION,${JSON.stringify(SDK_PACKAGE_VERSION)});
const service=new RelayService('https://fixture.example',{audience:'fixture',fetcher:async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(new URL(url).pathname,'/messaging/v1/metadata');return Response.json({version:1,protocolVersion:1,audience:'fixture',endpoints:{exchange:'/messaging/v1/session/exchange',bootstrap:'/messaging/v1/session',revoke:'/messaging/v1/session/revoke',hostRevoke:'/messaging/v1/host/revoke'}})}});
assert.equal((await service.metadata()).audience,'fixture');service.close();console.log('plain JavaScript SDK and RelayService passed');\n`
}

export async function packageSdk({ root = repository, output, yarnCli }) {
  root = path.resolve(root); output = path.resolve(output)
  const relative = path.relative(root, output)
  invariant(relative && (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)), 'SDK output must be outside source checkout')
  invariant(!fs.existsSync(output), 'SDK output exists; select a new evidence directory')
  invariant(yarnCli && fs.existsSync(yarnCli), 'Provide the Yarn 1.22.22 JavaScript entry with --yarn-cli')
  const stage = path.join(output, 'sdk'), extraction = path.join(output, 'verified-extraction')
  fs.mkdirSync(stage, { recursive: true })
  const commands = []
  const yarn = (args, location, label) => { run(process.execPath, [yarnCli, ...args], location, path.join(output, label + '.log')); commands.push({ command: `yarn ${args.join(' ')}`, location: portable(path.relative(output, location)), log: label + '.log', passed: true }) }
  invariant(run(process.execPath, [yarnCli, '--version'], stage).trim() === '1.22.22', 'Yarn 1.22.22 required')
  for (const name of ['protocol', 'client']) {
    const prefix = `packages/${name}`
    for (const file of ['package.json', 'LICENSE', 'README.md', 'tsconfig.build.json', 'src', 'test']) copyTree(root, `${prefix}/${file}`, stage)
    for (const file of ['build.mjs', 'examples']) if (fs.existsSync(path.join(root, prefix, file))) copyTree(root, `${prefix}/${file}`, stage)
    invariant(json(path.join(stage, prefix, 'package.json')).version === SDK_PACKAGE_VERSION, 'SDK workspace version mismatch')
    invariant(json(path.join(stage, prefix, 'package.json')).license === 'MIT', 'SDK workspace license mismatch')
  }
  copyFile(path.join(root, 'packages/protocol/LICENSE'), path.join(stage, 'LICENSE'))
  copyFile(path.join(root, 'docs/architecture/SDK_CONTRACT_V1.md'), path.join(stage, 'docs/architecture/SDK_CONTRACT_V1.md'))
  copyFile(path.join(root, 'docs/architecture/BROWSER_CONSUMER_V1.md'), path.join(stage, 'docs/architecture/BROWSER_CONSUMER_V1.md'))
  copyFile(path.join(root, 'scripts/package-sdk.mjs'), path.join(stage, 'scripts/package-sdk.mjs'))
  copyFile(path.join(root, 'scripts/package-sdk.test.mjs'), path.join(stage, 'scripts/package-sdk.test.mjs'))
  const metadata = { name: 'endtoend-independent-mit-sdk', version: SDK_PACKAGE_VERSION, private: true, license: 'MIT', type: 'module',
    packageManager: 'yarn@1.22.22', workspaces: ['packages/protocol', 'packages/client'],
    scripts: { build: 'yarn workspace @e2ee/client build', test: 'yarn workspace @e2ee/protocol test && yarn workspace @e2ee/client test && node --test scripts/package-sdk.test.mjs' } }
  writeJson(path.join(stage, 'package.json'), metadata)
  write(path.join(stage, 'README.md'), `# Independent EndToEnd MIT SDK ${SDK_PACKAGE_VERSION}\n\nThis source and built-ESM package contains only the first-party MIT protocol and transport client. Wire protocol stays v1. No AGPL messaging engine, cryptography library, private application, user state or installed tool is included. Original MIT grants remain in both workspaces and LICENSE.\n\nInstall declared tools with Yarn 1.22.22: \`yarn install --frozen-lockfile --ignore-scripts --non-interactive\`; build with \`yarn build\`; test with \`yarn test\`. The lock selects byte-identical existing release tool resolutions; installation runs no lifecycle scripts. TypeScript and tsx are development tools downloaded normally and are not bundled. The shipped ESM and declarations need only the MIT protocol/client packages at runtime.\n\nPlain JavaScript imports \`@e2ee/client/standalone\` and \`@e2ee/protocol/standalone\`; TypeScript source development retains the original package entries. See [contract](docs/architecture/SDK_CONTRACT_V1.md) and [browser consumer supplement](docs/architecture/BROWSER_CONSUMER_V1.md).\n\nThe full-repository interoperability test \`packages/client/test/reference.test.ts\` launches the separate AGPL agent/relay and is deliberately omitted here. Its omission does not remove SDK runtime source. Included tests cover transport lifecycle, HTTP security, public relay exchange, MIT CLI, contract validation, isolated built JavaScript and public declarations. Server deployment, encryption, device vaults and the frontend licensing assessment remain outside this SDK artifact.\n`)
  const originalLock = fs.readFileSync(path.join(root, 'yarn.lock'), 'utf8')
  write(path.join(stage, 'yarn.lock'), originalLock)
  yarn(['install', '--ignore-scripts', '--non-interactive', '--no-progress', '--offline'], stage, 'install-isolated')
  const lock = fs.readFileSync(path.join(stage, 'yarn.lock'), 'utf8'), lockProof = verifyLockDerivation(originalLock, lock), lockHash = hash(Buffer.from(lock))
  yarn(['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive', '--no-progress', '--offline'], stage, 'install-frozen')
  invariant(digest(path.join(stage, 'yarn.lock')) === lockHash, 'Frozen SDK install modified lock')
  yarn(['build'], stage, 'build-isolated')
  yarn(['test'], stage, 'test-isolated')
  for (const name of ['protocol', 'client']) for (const file of ['package.json', 'LICENSE', 'README.md', 'tsconfig.build.json'])
    invariant(digest(path.join(root, 'packages', name, file)) === digest(path.join(stage, 'packages', name, file)), 'Original SDK metadata or grant changed')
  writeJson(path.join(stage, 'SDK_PROVENANCE.json'), { kind: 'endtoend-first-party-mit-sdk-provenance', sdkVersion: SDK_PACKAGE_VERSION, protocolVersion: 1,
    firstPartyRightsConfirmedByOwner: true, statement: 'The owner confirmed control of first-party application rights in the ongoing EndToEnd licensing task. Protocol/client interface and transport code is licensed under the supplied MIT texts; no third-party messaging implementation is relicensed or included.',
    runtimeDependencies: { '@e2ee/client': ['@e2ee/protocol'], '@e2ee/protocol': [] }, installedToolsBundled: false,
    originalRootLockSha256: hash(Buffer.from(originalLock)), sdkLockSha256: lockHash, lockProof,
    omittedFixture: { path: 'packages/client/test/reference.test.ts', reason: 'Interoperability program starts the separately licensed AGPL engine; SDK runtime source is complete without it.' },
    licenses: ['protocol', 'client'].map(name => ({ path: `packages/${name}/LICENSE`, sha256: digest(path.join(stage, 'packages', name, 'LICENSE')) })),
    published: false })
  const files = sdkFiles(stage)
  const manifest = { kind: 'endtoend-independent-mit-sdk-source-and-esm', sdkVersion: SDK_PACKAGE_VERSION, protocolVersion: 1, license: 'MIT', files }
  writeJson(path.join(stage, 'SDK_MANIFEST.json'), manifest)
  verifySdk(stage, manifest)
  const members = [...files.map(row => row.path), 'SDK_MANIFEST.json'].sort()
  const memberList = path.join(output, 'archive-members.txt'); write(memberList, members.join('\n') + '\n')
  const archive = path.join(output, `endtoend-mit-sdk-${SDK_PACKAGE_VERSION}.tar.gz`)
  run('tar', ['-czf', archive, '-C', stage, '-T', memberList], output, path.join(output, 'archive-create.log'))
  const listed = run('tar', ['-tzf', archive], output).trim().split(/\r?\n/).filter(Boolean).map(name => name.replace(/^\.\//, '')).sort()
  invariant(JSON.stringify(listed) === JSON.stringify(members), 'SDK archive membership differs from exact manifest')
  fs.mkdirSync(extraction)
  run('tar', ['-xzf', archive, '-C', extraction], output, path.join(output, 'archive-extract.log'))
  const extractedProof = verifySdk(extraction, json(path.join(extraction, 'SDK_MANIFEST.json')))
  invariant(digest(path.join(extraction, 'SDK_MANIFEST.json')) === digest(path.join(stage, 'SDK_MANIFEST.json')), 'Extracted manifest differs')
  yarn(['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive', '--no-progress', '--offline'], extraction, 'extract-install-frozen')
  invariant(digest(path.join(extraction, 'yarn.lock')) === lockHash, 'Extracted frozen install modified lock')
  yarn(['build'], extraction, 'extract-build')
  yarn(['test'], extraction, 'extract-test')
  const runtimeFixture = path.join(output, 'sdk-runtime-fixture.mjs')
  write(runtimeFixture, bareRuntimeFixture())
  // The fixture lives outside the artifact. Place a temporary copy beside extracted package.json so Node resolves its two SDK workspaces.
  const checkFixture = path.join(extraction, 'sdk-runtime-fixture.mjs')
  copyFile(runtimeFixture, checkFixture)
  try { run(process.execPath, ['sdk-runtime-fixture.mjs'], extraction, path.join(output, 'extract-plain-js.log')) }
  finally { fs.unlinkSync(checkFixture) }
  const rebuiltProof = verifySdk(extraction, manifest)
  const receipt = { kind: 'endtoend-independent-mit-sdk-package-receipt', passed: true, completedAt: new Date().toISOString(), sdkVersion: SDK_PACKAGE_VERSION, protocolVersion: 1,
    archive: { filename: path.basename(archive), bytes: fs.statSync(archive).size, sha256: digest(archive), manifestSha256: digest(path.join(stage, 'SDK_MANIFEST.json')), files: members.length },
    stage: 'sdk', verifiedExtraction: 'verified-extraction', exactArchiveMembership: true, extractionBeforeInstall: extractedProof, extractionAfterIndependentRebuild: rebuiltProof,
    onlySdkWorkspaces: metadata.workspaces, runtimeThirdPartyLibrariesBundled: false, nodeModulesBundled: false, installLifecycleScripts: false,
    currentCheckoutWasNotInstalledOrModified: true, lockProof, commands,
    plainJavaScript: { passed: true, log: 'extract-plain-js.log' }, publicDeclarations: { passed: true, test: 'packages/client/test/standalone.test.ts' },
    published: false, step6FrontendBoundaryAssessmentComplete: false }
  writeJson(path.join(output, 'PACKAGE_RECEIPT.json'), receipt)
  writeJson(path.join(output, 'SDK_MANIFEST.json'), manifest)
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), get = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1] }
  try {
    invariant(get('--out'), 'Usage: node scripts/package-sdk.mjs --out NEW_DIRECTORY --yarn-cli /path/to/yarn.js [--root SOURCE]')
    const result = await packageSdk({ root: get('--root') ?? repository, output: get('--out'), yarnCli: get('--yarn-cli') })
    process.stdout.write(JSON.stringify({ passed: result.passed, archive: result.archive, verifiedExtraction: result.verifiedExtraction }) + '\n')
  } catch (error) { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1 }
}
