import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { isGeneratedSourcePath } from './release-files.mjs'

const root = resolve(process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url))))
if (process.argv.includes('--publish')) throw new Error('Publication is not implemented or authorized by this local audit')
const reviewAt = process.argv.indexOf('--review')
const reviewPath = reviewAt >= 0 ? resolve(process.argv[reviewAt + 1] ?? '') : join(root, 'docs/release/REVIEW_DECISIONS.json')
const review = JSON.parse(readFileSync(reviewPath, 'utf8'))
const issues = []
const packages = [['packages/crypto', 'AGPL-3.0-only'], ['packages/session', 'AGPL-3.0-only'], ['packages/agent', 'AGPL-3.0-only'], ['apps/agent-browser', 'AGPL-3.0-only'], ['packages/protocol', 'MIT'], ['packages/client', 'MIT']]
for (const [path, license] of packages) {
  const manifest = join(root, path, 'package.json')
  if (!existsSync(manifest)) { issues.push(`Missing ${path}/package.json`); continue }
  const value = JSON.parse(readFileSync(manifest, 'utf8'))
  if (value.license !== license) issues.push(`${path} license must remain ${license}`)
  if (license === 'MIT' && !existsSync(join(root, path, 'LICENSE'))) issues.push(`MIT license text missing in ${path}`)
}
if (!existsSync(join(root, 'LICENSE')) || !readFileSync(join(root, 'LICENSE'), 'utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE')) issues.push('Full AGPL LICENSE is missing')
function files(path) {
  if (!existsSync(path)) return []
  return readdirSync(path).flatMap((name) => {
    const item = join(path, name), stat = lstatSync(item)
    if (stat.isSymbolicLink()) { issues.push(`Symlink is not allowed in audited source: ${relative(root, item)}`); return [] }
    return stat.isDirectory() ? files(item) : [item]
  })
}
for (const folder of ['packages/protocol/src', 'packages/client/src']) for (const path of files(join(root, folder)).filter((path) => /\.[cm]?[jt]sx?$/.test(path))) {
  const source = readFileSync(path, 'utf8')
  if (/from\s+['"][^'"]*(?:@e2ee\/(?:crypto|session|agent)|\/crypto\/|\/session\/|\/agent\/)|import\s*\(\s*['"][^'"]*(?:@e2ee\/(?:crypto|session|agent))/.test(source)) issues.push(`Protected implementation import in MIT source ${relative(root, path)}`)
  if (/\b(?:storeJson|SignalExports|SessionPorts)\b/.test(source)) issues.push(`Raw cryptographic implementation type in MIT source ${relative(root, path)}`)
}
const sourceManifestPath = join(root, 'SOURCE_MANIFEST.json')
const actualManifestSha256 = existsSync(sourceManifestPath) ? createHash('sha256').update(readFileSync(sourceManifestPath)).digest('hex') : null
let sourceManifestIntegrity = null
if (actualManifestSha256) {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  const manifestIssues = []
  const seen = new Set()
  const inspectedPaths = new Map()
  for (const entry of manifest.files ?? []) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.split('/').some((part) => !part || part === '.' || part === '..') || resolve(root, entry.path) === root || !resolve(root, entry.path).startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) { manifestIssues.push(`Unsafe manifest path: ${entry.path}`); continue }
    if (seen.has(entry.path)) { manifestIssues.push(`Repeated manifest path: ${entry.path}`); continue }
    seen.add(entry.path)
    if (isGeneratedSourcePath(entry.path)) { manifestIssues.push(`Installed/generated files must not be source inputs: ${entry.path}`); continue }
    const path = join(root, entry.path)
    let safe = true
    for (let parent = root, parts = entry.path.split('/'), at = 0; at < parts.length; at++) {
      parent = join(parent, parts[at])
      let stat = inspectedPaths.get(parent)
      if (!stat) { if (!existsSync(parent)) { manifestIssues.push(`Missing manifest path: ${entry.path}`); safe = false; break }; stat = lstatSync(parent); inspectedPaths.set(parent, stat) }
      if (stat.isSymbolicLink()) { manifestIssues.push(`Symlinked manifest path: ${entry.path}`); safe = false; break }
    }
    if (!safe) continue
    const stat = inspectedPaths.get(path)
    if (!stat.isFile() || stat.size !== entry.bytes || createHash('sha256').update(readFileSync(path)).digest('hex') !== entry.sha256) manifestIssues.push(`Manifest content mismatch: ${entry.path}`)
  }
  if (!seen.size) manifestIssues.push('Source manifest has no file entries')
  sourceManifestIntegrity = { passed: manifestIssues.length === 0, manifestSha256: actualManifestSha256, filesChecked: seen.size, issues: manifestIssues }
  issues.push(...manifestIssues)
  const dependencyPath=join(root,'DEPENDENCIES.json'),noticePath=join(root,'dependencies/cargo-notices/INDEX.json')
  if(!existsSync(dependencyPath)||!existsSync(noticePath))issues.push('Dependency inventory and notice coverage index are required source inputs')
  else{
    const dependencies=JSON.parse(readFileSync(dependencyPath,'utf8')),coverage=JSON.parse(readFileSync(noticePath,'utf8'))
    const rows=new Map((manifest.files??[]).map(entry=>[entry.path,entry]))
    for(const [kind,key] of [['cargo','directory'],['npm','name']]){
      const expected=(dependencies[kind]??[]).map(entry=>entry[key]).sort(),actual=(coverage[kind]??[]).map(entry=>entry[key]).sort()
      if(JSON.stringify(expected)!==JSON.stringify(actual))issues.push(`${kind} notice coverage differs from the dependency inventory`)
      for(const dependency of coverage[kind]??[]){
        if(!dependency.notices?.length)issues.push(`Missing ${kind} license/notice text: ${dependency[key]}`)
        for(const notice of dependency.notices??[])if(!rows.has(notice.path)||rows.get(notice.path).sha256!==notice.sha256)issues.push(`Notice is missing or differs from source manifest: ${notice.path}`)
      }
    }
  }
}
const gates = { ownershipEvidenceComplete: review.ownershipEvidenceComplete === true, qualifiedBoundaryReviewFavorable: review.qualifiedBoundaryReview === 'favorable' && typeof review.reviewerReference === 'string' && review.reviewerReference.length > 0, exactManifestReviewed: actualManifestSha256 !== null && actualManifestSha256 === review.reviewedSourceManifestSha256, ownerApprovedExactPublicationManifest: review.ownerApprovedExactPublicationManifest === true, publicationAuthorized: review.publicationAuthorized === true }
const result = { kind: 'endtoend-agent-source-audit', engineeringPassed: issues.length === 0, issues, sourceManifestIntegrity, reviewGates: gates, publicationReady: issues.length === 0 && Object.values(gates).every(Boolean), reviewDecision: review.qualifiedBoundaryReview, legalCertification: false }
console.log(JSON.stringify(result, null, 2))
if (issues.length) process.exitCode = 1
