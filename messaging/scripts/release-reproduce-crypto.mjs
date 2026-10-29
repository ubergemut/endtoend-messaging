import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const source = resolve(process.argv[2] ?? '')
const target = resolve(process.argv[3] ?? '')
if (process.argv.length < 4 || existsSync(target)) throw new Error('Use <built-source-directory> <new-isolated-directory>; target must not exist')
const expected = JSON.parse(readFileSync(join(source, '.build/crypto-build-proof.json'), 'utf8'))
if (!expected.success || expected.prebuiltFallback !== false || expected.reproduciblePathPrefix !== '/source') throw new Error('Expected a successful source build with deterministic path mapping')
mkdirSync(target, { recursive: true })
const paths = ['packages/crypto/Cargo.toml', 'packages/crypto/Cargo.lock', 'packages/crypto/package.json', 'packages/crypto/src', 'packages/crypto/.cargo', 'dependencies/cargo', 'docs/release/TOOLCHAIN.json', 'scripts/release-build-crypto.mjs']
for (const path of paths) { mkdirSync(dirname(join(target, path)), { recursive: true }); cpSync(join(source, path), join(target, path), { recursive: true, dereference: false, errorOnExist: true }) }
const run = spawnSync(process.execPath, [join(target, 'scripts/release-build-crypto.mjs'), target], { cwd: target, stdio: 'inherit', windowsHide: true })
if (run.error) throw run.error
if (run.status !== 0) throw new Error('Relocated source build failed')
const actual = JSON.parse(readFileSync(join(target, '.build/crypto-build-proof.json'), 'utf8'))
const comparisons = expected.outputs.map((file) => ({ path: file.path, expectedSha256: file.sha256, actualSha256: actual.outputs.find((value) => value.path === file.path)?.sha256 ?? null }))
const passed = comparisons.every((file) => file.expectedSha256 === file.actualSha256)
const proof = { kind: 'endtoend-agent-relocated-crypto-reproducibility', passed, checkedAt: new Date().toISOString(), prebuiltFallback: false, exactOutputComparison: comparisons, toolchain: actual.versions, sourceInputHashesMatch: JSON.stringify(expected.inputs) === JSON.stringify(actual.inputs) }
writeFileSync(join(source, '.build/reproducibility-proof.json'), JSON.stringify(proof, null, 2) + '\n')
writeFileSync(join(target, '.build/reproducibility-proof.json'), JSON.stringify(proof, null, 2) + '\n')
console.log(JSON.stringify(proof, null, 2))
if (!passed || !proof.sourceInputHashesMatch) process.exitCode = 1
