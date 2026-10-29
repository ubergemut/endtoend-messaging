/** MIT standalone SDK build; compiles only the MIT protocol and client packages. */
import { spawnSync } from 'node:child_process'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('.', import.meta.url))
const compiler = require.resolve('typescript/bin/tsc')
for (const directory of [path.resolve(root, '../protocol'), root]) {
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], { cwd: directory, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
for (const name of await readdir(path.join(root, 'dist'))) {
  if (!/\.(?:js|d\.ts)$/.test(name)) continue
  const filename = path.join(root, 'dist', name)
  const source = await readFile(filename, 'utf8')
  await writeFile(filename, source.replaceAll("'@e2ee/protocol'", "'@e2ee/protocol/standalone'").replaceAll('"@e2ee/protocol"', '"@e2ee/protocol/standalone"'))
}
