import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../', import.meta.url))

test('built MIT SDK runs as plain JavaScript and typechecks with only its protocol dependency', { timeout: 30_000 }, async () => {
  const built = spawnSync(process.execPath, ['packages/client/build.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(built.status, 0, built.stdout + built.stderr)
  const directory = await mkdtemp(path.join(tmpdir(), 'endtoend-mit-sdk-'))
  try {
    for (const name of ['client', 'protocol']) {
      const packageDir = path.join(directory, 'node_modules', '@e2ee', name)
      await mkdir(packageDir, { recursive: true })
      await cp(path.join(root, 'packages', name, 'dist'), path.join(packageDir, 'dist'), { recursive: true })
      const manifest = JSON.parse(await readFile(path.join(root, 'packages', name, 'package.json'), 'utf8'))
      await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: manifest.name, type: 'module', license: manifest.license, exports: { './standalone': manifest.exports['./standalone'] } }))
      for (const file of ['index.js', 'index.d.ts']) {
        const source = await readFile(path.join(packageDir, 'dist', file), 'utf8')
        assert.doesNotMatch(source, /@e2ee\/(?:agent|session|crypto|contract)|apps\//)
      }
    }
    await writeFile(path.join(directory, 'fixture.mjs'), "import {AgentClient,RelayService} from '@e2ee/client/standalone'; import {OPERATIONS} from '@e2ee/protocol/standalone'; if(typeof AgentClient!=='function'||typeof RelayService!=='function'||!OPERATIONS.includes('send'))throw Error('SDK unavailable');")
    const run = spawnSync(process.execPath, ['fixture.mjs'], { cwd: directory, encoding: 'utf8', windowsHide: true })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    await writeFile(path.join(directory, 'fixture.mts'), `import {AgentClient,type OperationInput,type OperationOutput} from '@e2ee/client/standalone';
      const input:OperationInput<'send'>={handle:'bob',body:'message'};
      declare const client:AgentClient;
      const result:Promise<OperationOutput<'send'>>=client.command('send',input,{operationId:'stable'});
      // @ts-expect-error invalid action is rejected by the public declarations
      client.command('respondRequest',{id:'r',action:'delete'});
      // @ts-expect-error message bodies must be strings
      client.command('send',{handle:'bob',body:42});
      // @ts-expect-error unknown typed operation requires the deliberate generic call compatibility escape
      client.command('notAnOperation',{});
      void result;`)
    const checked = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'fixture.mts'], { cwd: directory, encoding: 'utf8', windowsHide: true })
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir(), 'endtoend-mit-sdk-'))) throw new Error('Unexpected SDK test directory')
    await rm(directory, { recursive: true, force: true })
  }
})
