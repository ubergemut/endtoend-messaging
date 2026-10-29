import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

// This script never copies existing WASM. Run it in an isolated source directory.
const sourceRoot = resolve(process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url))))
const pin = JSON.parse(readFileSync(join(sourceRoot, 'docs/release/TOOLCHAIN.json'), 'utf8'))
const cryptoRoot = join(sourceRoot, 'packages/crypto')
for (const folder of ['pkg-node', 'pkg-web']) {
  if (existsSync(join(cryptoRoot, folder))) throw new Error(`${folder} already exists: use a clean source directory; prebuilt fallback is forbidden`)
}
const toolHome = process.env.ENDTOEND_TOOLCHAIN_ROOT ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'e2ee-toolchain') : '')
const wasmPack = process.env.ENDTOEND_WASM_PACK ?? (toolHome && process.platform === 'win32' ? join(toolHome, 'wasm-pack/wasm-pack-v0.15.0-x86_64-pc-windows-msvc/wasm-pack.exe') : 'wasm-pack')
const inheritedPath = Object.entries(process.env).find(([name]) => name.toLowerCase() === 'path')?.[1] ?? ''
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path')), PATH: [join(homedir(), '.cargo/bin'), toolHome && join(toolHome, 'mingw/mingw64/bin'), toolHome && join(toolHome, 'protoc/bin'), inheritedPath].filter(Boolean).join(delimiter), CARGO_TARGET_DIR: join(sourceRoot, '.build/rust-target'), CARGO_BUILD_JOBS: '1', CARGO_ENCODED_RUSTFLAGS: ['--cfg', 'getrandom_backend="wasm_js"', `--remap-path-prefix=${sourceRoot}=/source`, `--remap-path-prefix=${sourceRoot.replaceAll('\\', '/')}=/source`].join('\x1f'), SOURCE_DATE_EPOCH: String(Date.parse('2026-10-23T00:00:00Z') / 1000) }
if (toolHome && existsSync(join(toolHome, 'protoc/bin/protoc.exe'))) env.PROTOC = join(toolHome, 'protoc/bin/protoc.exe')
function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, { cwd: cryptoRoot, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${capture ? result.stderr : ''}`)
  return capture ? result.stdout.trim() : ''
}
const versions = { rustc: run('rustc', ['--version', '--verbose'], { capture: true }), cargo: run('cargo', ['--version'], { capture: true }), wasmPack: run(wasmPack, ['--version'], { capture: true }), protoc: run(env.PROTOC ?? 'protoc', ['--version'], { capture: true }), node: process.version }
if (process.platform === 'win32') versions.cCompiler = run('gcc', ['--version'], { capture: true }).split(/\r?\n/)[0]
for (const [name, expected] of Object.entries(pin.required)) {
  if (!versions[name]?.includes(expected)) throw new Error(`Toolchain mismatch for ${name}: expected ${expected}; got ${versions[name]}`)
}
mkdirSync(join(sourceRoot, '.build'), { recursive: true })
writeFileSync(join(sourceRoot, '.build/crypto-build-start.json'), JSON.stringify({ startedAt: new Date().toISOString(), versions, command: 'wasm-pack build --target TARGET --out-dir pkg-TARGET --release -- --locked --offline', prebuiltFallback: false }, null, 2) + '\n')
for (const [target, output] of [['nodejs', 'pkg-node'], ['web', 'pkg-web']]) run(wasmPack, ['build', '--target', target, '--out-dir', output, '--release', '--', '--locked', '--offline'])
const outputs = []
for (const folder of ['pkg-node', 'pkg-web']) for (const name of readdirSync(join(cryptoRoot, folder)).sort()) {
  const path = join(cryptoRoot, folder, name)
  if (/\.(js|wasm|ts|json)$/.test(name)) outputs.push({ path: `packages/crypto/${folder}/${name}`, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })
}
const inputs = ['Cargo.toml', 'Cargo.lock', '.cargo/config.toml', ...readdirSync(join(cryptoRoot, 'src')).filter((name) => /\.(?:rs|ts)$/.test(name)).sort().map((name) => `src/${name}`)].map((path) => ({ path: `packages/crypto/${path}`, sha256: createHash('sha256').update(readFileSync(join(cryptoRoot, path))).digest('hex') }))
const proof = { kind: 'endtoend-agent-crypto-source-build', completedAt: new Date().toISOString(), success: true, versions, prebuiltFallback: false, cargoBuildJobs: Number(env.CARGO_BUILD_JOBS), reproduciblePathPrefix: '/source', sourceDateEpoch: env.SOURCE_DATE_EPOCH, inputs, outputs }
writeFileSync(join(sourceRoot, '.build/crypto-build-proof.json'), JSON.stringify(proof, null, 2) + '\n')
console.log(JSON.stringify(proof, null, 2))
