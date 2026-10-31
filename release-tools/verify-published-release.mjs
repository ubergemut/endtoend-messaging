// SPDX-License-Identifier: AGPL-3.0-only
// Modified October 31, 2026: explicitly pinned 0.2.1 core release verification.
// Anonymous static-download verification. This does not verify a deployed messaging service or UI.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value)
const loopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
const safeUrl = url => url.origin + url.pathname // Signed CDN queries must never enter receipts/logs.
const limits = {catalog: 1024 * 1024, manifest: 16 * 1024 * 1024, file: 512 * 1024 * 1024, total: 1024 * 1024 * 1024, redirects: 8}
const grants = {'messaging-core': 'AGPL-3.0-only', 'endtoend-web': 'AGPL-3.0-only', 'desk-client': 'MIT', 'mit-sdk': 'MIT'}

function basePrefix(value) {
  check(typeof value === 'string' && !/[?#\x00-\x20\x7f\\]/.test(value) && !/%(?:2f|5c|2e|00|0[ad])/i.test(value), 'Base URL must have no query, fragment, encoded traversal, whitespace or backslash')
  const url = new URL(value)
  check(!url.username && !url.password && !url.search && !url.hash, 'Base URL must have no credentials, query or fragment')
  check(url.protocol === 'https:' || url.protocol === 'http:' && loopback(url), 'Release downloads require HTTPS; HTTP is allowed only for loopback fixtures')
  check(url.pathname.endsWith('/') && !value.split('/').some(part => part === '.' || part === '..'), 'Base URL must be a directory prefix ending in / without traversal')
  return url
}

export function validateReleaseRedirect(value, current, initial) {
  let target
  try { target = new URL(value, current) } catch { throw new Error('Release redirect contains an invalid URL') }
  check(!target.username && !target.password && !target.hash && !value.includes('#') && !/[\x00-\x20\x7f\\]/.test(value), 'Release redirect contains credentials, fragment or unsafe characters')
  check(target.protocol === 'https:' || initial.protocol === 'http:' && loopback(initial) && target.protocol === 'http:' && loopback(target), 'Release redirect must remain HTTPS (or a loopback fixture)')
  // GitHub release assets redirect to HTTPS CDN URLs carrying short-lived signed queries.
  // Initial URLs never take a query. Opaque redirect queries are used only for the request.
  check(!target.search || target.protocol === 'https:', 'HTTP fixture redirects may not carry query credentials')
  return target
}

async function regularJson(filename, maximum) {
  const absolute = path.resolve(filename), parsed = path.parse(absolute)
  let current = parsed.root
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    check(!(await fs.lstat(current)).isSymbolicLink(), 'Local release metadata must not use symlink paths')
  }
  const stat = await fs.lstat(absolute)
  check(stat.isFile() && stat.size <= maximum, 'Local release metadata must be a bounded regular file')
  const bytes = await fs.readFile(absolute)
  check(bytes.length === stat.size, 'Local release metadata changed while reading')
  return {bytes, value: JSON.parse(bytes.toString('utf8'))}
}

async function inspectLocalCatalog(catalogPath,expectedReleaseVersion) {
  check(['0.2.0','0.2.1'].includes(expectedReleaseVersion),'Unsupported explicitly selected release')
  const local = await regularJson(catalogPath, limits.catalog)
  const catalog = local.value
  check(catalog.schemaVersion === 1 && catalog.version === expectedReleaseVersion && Array.isArray(catalog.components) && catalog.components.length === 4, 'Expected the explicitly selected four-component catalog')
  const files = new Map()
  const retain = (row, manifest = false) => {
    check(row && token(row.filename) && digest(row.sha256) && (manifest && row.bytes === null || Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= limits.file), 'Invalid approved artifact identity')
    const previous = files.get(row.filename)
    check(!previous || previous.sha256 === row.sha256 && (previous.bytes === null || row.bytes === null || previous.bytes === row.bytes), 'Conflicting shared artifact identity')
    files.set(row.filename, {filename: row.filename, bytes: row.bytes ?? previous?.bytes ?? null, sha256: row.sha256, manifest: manifest || previous?.manifest === true, maxBytes: manifest || previous?.manifest ? limits.manifest : limits.file})
  }
  const seen = new Set()
  for (const component of catalog.components) {
    check(Object.hasOwn(grants, component.id) && !seen.has(component.id) && component.license === grants[component.id] && component.version === (component.id==='messaging-core'?expectedReleaseVersion:component.id === 'mit-sdk' ? '0.2.1' : '0.2.0'), 'Unexpected component, grant or version in approved catalog')
    seen.add(component.id)
    check(Array.isArray(component.artifacts) && component.artifacts.length > 0 && component.artifacts.length <= 64 && Array.isArray(component.notices) && component.notices.length > 0 && component.notices.length <= 256, 'Component artifacts and notices are required')
    check(component.notices.some(row => /licen[cs]e|copying/i.test(row.filename ?? '')), 'Component license download is required')
    retain(component.source)
    check(token(component.source.manifestFilename) && digest(component.source.manifestSha256), 'Source manifest identity is invalid')
    retain({filename: component.source.manifestFilename, bytes: null, sha256: component.source.manifestSha256}, true)
    for (const row of [...component.artifacts, ...component.notices]) retain(row)
    if (component.id === 'mit-sdk') {
      check(component.source.manifestFilename === 'SDK_MANIFEST.json', 'SDK source manifest name differs')
      check(component.artifacts.some(row => row.filename === component.source.filename && row.sha256 === component.source.sha256 && row.bytes === component.source.bytes), 'SDK source/ESM artifact is not disclosed')
      continue
    }
    check(component.source.manifestFilename === (component.id === 'messaging-core' ? 'SOURCE_MANIFEST.json' : 'CONSUMER_SOURCE_MANIFEST.json'), 'Source manifest name differs for ' + component.id)
    const name = component.id === 'messaging-core' ? 'RUNTIME_MANIFEST.json' : 'CONSUMER_RUNTIME_MANIFEST.json'
    const runtimeRow = component.artifacts.find(row => row.filename === name)
    check(runtimeRow, 'A disclosed runtime manifest is required for ' + component.id)
    retain(runtimeRow, true)
  }
  check(seen.size === 4, 'A required release component is absent')
  check(files.size <= 512 && [...files.values()].reduce((total, row) => total + (row.bytes ?? row.maxBytes), 0) <= limits.total, 'Release download total exceeds the verification limit')
  return {catalog, catalogBytes: local.bytes, files: [...files.values()]}
}

function inspectRemoteManifests(catalog, manifests) {
  const bindings = []
  for (const component of catalog.components) {
    const source = manifests.get(component.source.manifestFilename)
    check(source && Array.isArray(source.files) && source.files.length > 0 && source.files.length <= 100000, 'Verified remote source manifest has no bounded file inventory')
    const seen = new Set()
    for (const row of source.files) {
      check(row && typeof row.path === 'string' && !path.isAbsolute(row.path) && !/[\\:\x00-\x1f\x7f]/.test(row.path) && !row.path.split('/').some(part => !part || part === '.' || part === '..') && !seen.has(row.path) && digest(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'Verified remote source manifest has unsafe or invalid records')
      seen.add(row.path)
    }
    if (component.id === 'mit-sdk') {
      check(source.sdkVersion === '0.2.1' && source.protocolVersion === 1 && source.license === 'MIT', 'SDK manifest version/grant differs')
      continue
    }
    const filename = component.id === 'messaging-core' ? 'RUNTIME_MANIFEST.json' : 'CONSUMER_RUNTIME_MANIFEST.json', runtime = manifests.get(filename)
    check(source.version === component.version && runtime?.version === component.version && runtime.matchingSourceSha256 === component.source.sha256 && runtime.matchingSourceManifestSha256 === component.source.manifestSha256 && Array.isArray(runtime.files) && runtime.files.length > 0, 'Runtime manifest/source binding differs for ' + component.id)
    bindings.push({componentId: component.id, sourceSha256: component.source.sha256, sourceManifestSha256: component.source.manifestSha256, runtimeManifestSha256: component.artifacts.find(row => row.filename === filename).sha256})
  }
  return bindings
}

async function anonymousRequest(initial, method, expected, timeoutMs) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let current = initial, response
  const redirects = []
  try {
    for (;;) {
      try {
        response = await fetch(current, {method, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', headers: {'accept-encoding': 'identity'}, signal: controller.signal})
      } catch (error) { throw new Error(`Anonymous ${method} request failed (${error.name === 'AbortError' ? 'timeout' : 'network error'})`) }
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      await response.body?.cancel()
      check(location && redirects.length < limits.redirects, 'Release redirect is missing a target or exceeds the redirect limit')
      current = validateReleaseRedirect(location, current, initial)
      redirects.push({status: response.status, url: safeUrl(current)})
    }
    check(response.status === 200, `Anonymous ${method} returned HTTP ${response.status}`)
    const encoding = response.headers.get('content-encoding')
    check(!encoding || encoding.toLowerCase() === 'identity', 'Release response applied an unexpected content encoding')
    const length = response.headers.get('content-length')
    check(length === null || /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) <= (expected.maxBytes ?? limits.file) && (expected.bytes === null || Number(length) === expected.bytes), `Anonymous ${method} content length differs from approved bytes`)
    const info = {method, status: response.status, url: safeUrl(current), redirects, contentLength: length === null ? null : Number(length)}
    if (method === 'HEAD') return info
    const hasher = createHash('sha256'), chunks = []
    let bytes = 0
    try {
      if (response.body) for await (const chunk of response.body) {
        bytes += chunk.byteLength
        check((expected.bytes === null || bytes <= expected.bytes) && bytes <= (expected.maxBytes ?? limits.file), 'Anonymous GET exceeds the approved file size')
        hasher.update(chunk)
        if (expected.manifest) chunks.push(chunk)
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Anonymous GET timed out while streaming')
      if (error.message === 'Anonymous GET exceeds the approved file size') throw error
      throw new Error('Anonymous GET failed while streaming')
    }
    const actualSha256 = hasher.digest('hex')
    check((expected.bytes === null || bytes === expected.bytes) && actualSha256 === expected.sha256, 'Anonymous GET checksum or byte count differs from the approved file')
    return {...info, bytes, sha256: actualSha256, ...(expected.manifest ? {payload: Buffer.concat(chunks, bytes)} : {})}
  } finally {
    clearTimeout(timer)
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
  }
}

/** Verify static published files only. No authentication, service probing or external mutation. */
export async function verifyPublishedRelease({catalogPath, baseUrl, timeoutMs = 300000, expectedCatalogSha256,expectedReleaseVersion='0.2.0', onProgress} = {}) {
  const receipt = {kind: 'endtoend-published-static-release-verification', schemaVersion: 1, checkedAt: new Date().toISOString(), passed: false, mode: 'static-artifact-downloads', anonymous: true, authenticationHeadersUsed: false, credentials: 'omit', serviceOrUiVerified: false, publicationPerformed: false, requests: [], files: [], issues: []}
  try {
    const prefix = basePrefix(baseUrl)
    check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 600000, 'Request timeout must be between 1 and 600000 milliseconds')
    receipt.baseUrl = prefix.href
    const local = await inspectLocalCatalog(catalogPath,expectedReleaseVersion)
    receipt.releaseVersion = local.catalog.version
    receipt.expectedCatalogSha256 = sha(local.catalogBytes)
    check(expectedCatalogSha256 === undefined || digest(expectedCatalogSha256) && expectedCatalogSha256 === receipt.expectedCatalogSha256, 'Local catalog hash differs from the expected approved identity')
    receipt.componentNotices = local.catalog.components.map(row => ({componentId: row.id, license: row.license, noticeFiles: row.notices.map(item => item.filename)}))
    // Metadata goes first; large archives are streamed once after their remote binding is checked.
    const expected = [{filename: 'source-disclosure.json', bytes: local.catalogBytes.length, sha256: receipt.expectedCatalogSha256}, ...local.files.filter(row => row.manifest), ...local.files.filter(row => !row.manifest)]
    const manifests = new Map()
    for (const row of expected) {
      receipt.currentFile = row.filename
      const url = new URL(encodeURIComponent(row.filename), prefix)
      const head = await anonymousRequest(url, 'HEAD', row, timeoutMs)
      receipt.requests.push({filename: row.filename, ...head})
      const get = await anonymousRequest(url, 'GET', row.bytes === null && head.contentLength !== null ? {...row, bytes: head.contentLength} : row, timeoutMs)
      const {payload, ...getInfo} = get
      receipt.requests.push({filename: row.filename, ...getInfo})
      receipt.files.push({filename: row.filename, expectedBytes: row.bytes, bytes: get.bytes, sha256: get.sha256, headAccessible: true, getVerified: true})
      if (payload) {
        manifests.set(row.filename, JSON.parse(payload.toString('utf8')))
        if (manifests.size === 5) receipt.sourceBindings = inspectRemoteManifests(local.catalog, manifests)
      }
      onProgress?.({filename: row.filename, bytes: get.bytes})
    }
    check(receipt.sourceBindings, 'All five source/runtime manifests must be verified')
    delete receipt.currentFile
    receipt.distinctCatalogFiles = local.files.length
    receipt.verifiedFilesIncludingCatalog = receipt.files.length
    receipt.verifiedDownloadBytes = receipt.files.reduce((total, row) => total + row.bytes, 0)
    receipt.passed = true
    receipt.limitations = ['This verifies the listed anonymous static downloads and their exact bytes. It does not verify a running messaging service, authentication/proxy routing, visible UI notices or future retained versions.', 'Corresponding-source completeness and the licensing conclusion remain bound to the approved assessment; this check does not rebuild or independently assess the software.']
  } catch (error) { receipt.issues.push(error.message) }
  return receipt
}

function argumentsFor(argv) {
  const result = {}, known = new Set(['--catalog', '--base-url', '--out', '--timeout-ms', '--expected-catalog-sha256','--expected-release-version'])
  for (let at = 0; at < argv.length; at += 2) {
    const name = argv[at], value = argv[at + 1]
    check(known.has(name) && !Object.hasOwn(result, name) && typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'Use each supported flag once with a value: --catalog --base-url [--out] [--timeout-ms]')
    result[name] = value
  }
  check(result['--catalog'] && result['--base-url'], 'Both --catalog and --base-url are required')
  return result
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = argumentsFor(process.argv.slice(2))
    // Claim an explicitly requested new receipt before network work; never overwrite evidence.
    const output = args['--out'] ? await fs.open(path.resolve(args['--out']), 'wx') : null
    try {
      const receipt = await verifyPublishedRelease({catalogPath: args['--catalog'], baseUrl: args['--base-url'],expectedReleaseVersion:args['--expected-release-version'], ...(args['--timeout-ms'] ? {timeoutMs: Number(args['--timeout-ms'])} : {}), ...(args['--expected-catalog-sha256'] ? {expectedCatalogSha256: args['--expected-catalog-sha256']} : {}), onProgress: row => process.stderr.write(`Verified ${row.filename} (${row.bytes} bytes)\n`)})
      const bytes = JSON.stringify(receipt, null, 2) + '\n'
      if (output) await output.writeFile(bytes)
      process.stdout.write(bytes)
      if (!receipt.passed) process.exitCode = 1
    } finally { await output?.close() }
  } catch (error) {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  }
}
