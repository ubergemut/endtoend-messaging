// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {verifyPublishedRelease, validateReleaseRedirect} from './verify-published-release.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const executable = fileURLToPath(new URL('./verify-published-release.mjs', import.meta.url))

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'endtoend-published-release-'))
  const files = new Map(), requests = [], behavior = {mode: 'normal', filename: 'core-source.tar.gz'}
  const record = async (filename, value) => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
    await fs.writeFile(path.join(directory, filename), bytes)
    files.set(filename, bytes)
    return {filename, bytes: bytes.length, sha256: hash(bytes)}
  }
  const source = async (name, manifestFilename, sdk = false) => {
    const manifest = sdk ? {sdkVersion: '0.2.1', protocolVersion: 1, license: 'MIT', files: [{path: 'README.md', bytes: 7, sha256: hash('fixture')}]} : {version: '0.2.0', files: [{path: 'README.md', bytes: 7, sha256: hash('fixture')}]}
    const manifestRow = await record(manifestFilename, manifest)
    return {...await record(name + '-source.tar.gz', 'source ' + name), manifestFilename, manifestSha256: manifestRow.sha256}
  }
  const runtime = async (name, manifestFilename, sourceRow) => [await record(name + '-runtime.tar.gz', 'runtime ' + name), await record(manifestFilename, {version: '0.2.0', matchingSourceSha256: sourceRow.sha256, matchingSourceManifestSha256: sourceRow.manifestSha256, files: [{path: 'runtime.js', bytes: 7, sha256: hash('fixture')}]})]
  let server
  try {
    const core = await source('core', 'SOURCE_MANIFEST.json'), consumer = await source('consumers', 'CONSUMER_SOURCE_MANIFEST.json'), sdk = await source('sdk', 'SDK_MANIFEST.json', true)
    const coreArtifacts = await runtime('core', 'RUNTIME_MANIFEST.json', core), consumerArtifacts = await runtime('consumers', 'CONSUMER_RUNTIME_MANIFEST.json', consumer)
    const notices = async names => Promise.all(names.map(name => record(name, 'Original copyright, license and notice text: ' + name)))
    const catalog = {schemaVersion: 1, version: '0.2.0', components: [
      {id: 'messaging-core', version: '0.2.0', license: 'AGPL-3.0-only', source: core, artifacts: coreArtifacts, notices: await notices(['MESSAGING_LICENSE.txt', 'MESSAGING_NOTICES.txt', 'MESSAGING_MODIFICATIONS.txt'])},
      {id: 'endtoend-web', version: '0.2.0', license: 'AGPL-3.0-only', source: consumer, artifacts: consumerArtifacts, notices: await notices(['WEB_LICENSE.txt', 'WEB_NOTICES.txt'])},
      {id: 'desk-client', version: '0.2.0', license: 'MIT', source: consumer, artifacts: consumerArtifacts, notices: await notices(['DESK_LICENSE.txt', 'DESK_NOTICES.txt'])},
      {id: 'mit-sdk', version: '0.2.1', license: 'MIT', source: sdk, artifacts: [{filename: sdk.filename, bytes: sdk.bytes, sha256: sdk.sha256}], notices: await notices(['SDK_LICENSE.txt'])}
    ]}
    assert.equal(files.size, 18)
    await record('source-disclosure.json', catalog)
    server = http.createServer((request, response) => {
      requests.push({url: request.url, method: request.method, headers: request.headers})
      const name = new URL(request.url, 'http://127.0.0.1').pathname.split('/').at(-1)
      if (behavior.mode === 'redirect-loop') { response.writeHead(302, {location: request.url}).end(); return }
      if (name === behavior.filename && behavior.mode === 'unsafe-redirect') { response.writeHead(302, {location: 'http://example.invalid/asset'}).end(); return }
      if (name === behavior.filename && behavior.mode === 'query-redirect') { response.writeHead(302, {location: '/fixture/files/core-source.tar.gz?secret=must-not-be-recorded'}).end(); return }
      if (name === behavior.filename && behavior.mode === 'redirect' && !request.url.startsWith('/cdn/')) { response.writeHead(302, {location: '/cdn/' + name}).end(); return }
      if (name === behavior.filename && behavior.mode === 'missing') { response.writeHead(404).end(); return }
      if (name === behavior.filename && behavior.mode === 'head-denied' && request.method === 'HEAD') { response.writeHead(405).end(); return }
      if (name === behavior.filename && behavior.mode === 'timeout') return
      let bytes = files.get(name)
      if (!bytes) { response.writeHead(404).end(); return }
      if (name === behavior.filename && behavior.mode === 'altered') bytes = Buffer.from('x'.repeat(bytes.length))
      if (name === behavior.filename && behavior.mode === 'oversized') {
        response.writeHead(200)
        response.end(request.method === 'HEAD' ? undefined : Buffer.alloc(bytes.length + 1, 120))
        return
      }
      const length = name === behavior.filename && behavior.mode === 'wrong-head-length' && request.method === 'HEAD' ? bytes.length + 1 : bytes.length
      response.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': length})
      response.end(request.method === 'HEAD' ? undefined : bytes)
    })
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve)})
    const baseUrl = `http://127.0.0.1:${server.address().port}/fixture/files/`
    const catalogPath = path.join(directory, 'source-disclosure.json')
    const verify = (options = {}) => verifyPublishedRelease({catalogPath, baseUrl, timeoutMs: 1000, ...options})
    await run({directory, files, requests, behavior, baseUrl, catalogPath, catalog, record, verify})
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    if (!path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), 'endtoend-published-release-'))) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, {recursive: true, force: true})
  }
}

async function cli(args) {
  const child = spawn(process.execPath, [executable, ...args], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => {stdout += chunk})
  child.stderr.on('data', chunk => {stderr += chunk})
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve)})
  return {code, stdout, stderr}
}

test('anonymous HEAD and streamed GET verify the catalog plus all 18 exact static assets', () => fixture(async f => {
  const receipt = await f.verify()
  assert.equal(receipt.passed, true, receipt.issues.join())
  assert.equal(receipt.distinctCatalogFiles, 18)
  assert.equal(receipt.verifiedFilesIncludingCatalog, 19)
  assert.equal(receipt.requests.length, 38)
  assert.equal(receipt.sourceBindings.length, 3)
  assert.equal(receipt.componentNotices.length, 4)
  assert.equal(receipt.serviceOrUiVerified, false)
  assert.equal(receipt.publicationPerformed, false)
  assert.equal(f.requests.length, 38)
  for (const row of f.requests) {
    assert(['GET', 'HEAD'].includes(row.method))
    assert.equal(row.headers.authorization, undefined)
    assert.equal(row.headers.cookie, undefined)
    assert.equal(row.headers.referer, undefined)
    assert.equal(row.headers['accept-encoding'], 'identity')
    assert(!/[?#]/.test(row.url))
  }
}))

test('CI needs only its approved catalog locally and streams each remote archive once', () => fixture(async f => {
  for (const filename of f.files.keys()) if (filename !== 'source-disclosure.json') await fs.unlink(path.join(f.directory, filename))
  const receipt = await f.verify({expectedCatalogSha256: hash(f.files.get('source-disclosure.json'))})
  assert.equal(receipt.passed, true, receipt.issues.join())
  assert.equal(receipt.verifiedFilesIncludingCatalog, 19)
  for (const filename of [...f.files.keys()].filter(name => name.endsWith('.tar.gz'))) assert.equal(f.requests.filter(row => row.method === 'GET' && row.url.endsWith('/' + filename)).length, 1)
}))

test('a legitimate loopback redirect still verifies exact bytes and records sanitized locations', () => fixture(async f => {
  f.behavior.mode = 'redirect'
  const receipt = await f.verify()
  assert.equal(receipt.passed, true, receipt.issues.join())
  assert(receipt.requests.some(row => row.redirects.length === 1 && row.url.endsWith('/cdn/core-source.tar.gz')))
}))

test('CDN signed queries are permitted only on HTTPS redirects without entering stored URLs', () => {
  const initial = new URL('https://github.com/owner/repo/releases/download/tag/file.tar.gz')
  const target = validateReleaseRedirect('https://release-assets.githubusercontent.com/object?signature=opaque-value', initial, initial)
  assert.equal(target.search, '?signature=opaque-value')
  assert.throws(() => validateReleaseRedirect('http://127.0.0.1/file', initial, initial), /remain HTTPS/)
  assert.throws(() => validateReleaseRedirect('https://user:secret@example.com/file', initial, initial), /credentials/)
  assert.throws(() => validateReleaseRedirect('https://example.com/file#fragment', initial, initial), /fragment/)
})

test('missing, altered or stale remote assets cannot pass expected-byte verification', () => fixture(async f => {
  for (const mode of ['missing', 'altered']) {
    f.behavior.mode = mode
    const receipt = await f.verify()
    assert.equal(receipt.passed, false)
    assert.equal(receipt.currentFile, 'core-source.tar.gz')
    assert.match(receipt.issues.join(), mode === 'missing' ? /HTTP 404/ : /checksum/)
  }
  f.behavior.filename = 'source-disclosure.json'
  f.behavior.mode = 'altered'
  assert.match((await f.verify()).issues.join(), /checksum/)
}))

test('HEAD must be anonymously accessible and must not contradict the approved size', () => fixture(async f => {
  for (const mode of ['head-denied', 'wrong-head-length']) {
    f.behavior.mode = mode
    const receipt = await f.verify()
    assert.equal(receipt.passed, false)
    assert.match(receipt.issues.join(), mode === 'head-denied' ? /HEAD returned HTTP 405/ : /HEAD content length differs/)
  }
}))

test('chunked downloads cannot stream past the exact approved byte bound', () => fixture(async f => {
  f.behavior.mode = 'oversized'
  const receipt = await f.verify()
  assert.equal(receipt.passed, false)
  assert.match(receipt.issues.join(), /exceeds the approved file size/)
}))

test('redirect downgrade and HTTP query tokens fail without leaking query strings', () => fixture(async f => {
  f.behavior.mode = 'unsafe-redirect'
  assert.match((await f.verify()).issues.join(), /remain HTTPS/)
  f.behavior.mode = 'query-redirect'
  const receipt = await f.verify()
  assert.equal(receipt.passed, false)
  assert.match(receipt.issues.join(), /query credentials/)
  assert(!JSON.stringify(receipt).includes('must-not-be-recorded'))
}))

test('redirect loops and request timeouts remain bounded', () => fixture(async f => {
  f.behavior.mode = 'redirect-loop'
  assert.match((await f.verify()).issues.join(), /redirect limit/)
  f.behavior.mode = 'timeout'
  assert.match((await f.verify({timeoutMs: 25})).issues.join(), /timeout/)
}))

test('unsafe initial prefixes are rejected before making any requests', () => fixture(async f => {
  for (const baseUrl of ['http://example.com/release/', 'https://user:password@example.com/release/', 'https://example.com/release/?token=secret', 'https://example.com/release/#fragment', 'https://example.com/release', 'https://example.com/release/../other/', 'https://example.com/release/%2f/']) {
    assert.equal((await f.verify({baseUrl})).passed, false, baseUrl)
  }
  assert.equal(f.requests.length, 0)
}))

test('invalid catalog grants or downloaded source/runtime bindings cannot be advertised as verified', () => fixture(async f => {
  f.catalog.components[1].license = 'MIT'
  await f.record('source-disclosure.json', f.catalog)
  assert.match((await f.verify()).issues.join(), /grant or version/)
  assert.equal(f.requests.length, 0)
  f.catalog.components[1].license = 'AGPL-3.0-only'
  const name = 'RUNTIME_MANIFEST.json', manifest = JSON.parse(f.files.get(name))
  manifest.matchingSourceSha256 = hash('another source')
  const row = await f.record(name, manifest)
  Object.assign(f.catalog.components[0].artifacts.find(item => item.filename === name), row)
  await f.record('source-disclosure.json', f.catalog)
  assert.match((await f.verify()).issues.join(), /source binding differs/)
  assert(f.requests.length > 0)
  assert(f.requests.every(row => row.url.endsWith('.json')), 'Binding failure should stop before archive downloads')
}))

test('an explicitly pinned approved catalog hash prevents a changed checkout from redefining expectations', () => fixture(async f => {
  const receipt = await f.verify({expectedCatalogSha256: hash('another catalog')})
  assert.equal(receipt.passed, false)
  assert.match(receipt.issues.join(), /expected approved identity/)
  assert.equal(f.requests.length, 0)
}))

test('CLI writes only an explicit new receipt and refuses to overwrite retained evidence', () => fixture(async f => {
  const output = path.join(f.directory, 'receipt.json')
  const args = ['--catalog', f.catalogPath, '--base-url', f.baseUrl, '--out', output, '--timeout-ms', '1000']
  const result = await cli(args)
  assert.equal(result.code, 0, result.stderr)
  const bytes = await fs.readFile(output, 'utf8')
  assert.equal(JSON.parse(bytes).passed, true)
  assert.equal(result.stdout, bytes)
  const before = f.requests.length
  const repeated = await cli(args)
  assert.equal(repeated.code, 1)
  assert.match(repeated.stderr, /EEXIST/)
  assert.equal(f.requests.length, before)
  assert.equal(await fs.readFile(output, 'utf8'), bytes)
}))

test('CLI rejects ambiguous duplicate options and unexpected mutation flags', async () => {
  for (const args of [['--catalog', 'a', '--catalog', 'b', '--base-url', 'https://example.com/'], ['--publish', 'true'], ['--catalog']]) {
    const result = await cli(args)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /supported flag|required/)
  }
})
