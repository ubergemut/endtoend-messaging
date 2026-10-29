import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../../../apps/api/src/server.ts'
import { createDeviceSecret, isSealedRecord, openSealedVault, waitForCommit } from '@e2ee/session'
import { HeadlessError } from '../src/types.ts'
import { openHeadless } from '../src/client.ts'
import { readDurableFile, writeDurableFile } from '../src/durableFile.ts'
import { testAgentOptions } from './agent-options.ts'

test('a torn headless write keeps the last committed vault', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-torn-'))
  const file = path.join(dir, 'vault.json')
  try {
    await writeDurableFile(file, '{"generation":1}')
    await assert.rejects(writeDurableFile(file, '{"generation":2}', 'after-temp'))
    assert.equal(await readDurableFile(file), '{"generation":1}')
    await writeFile(`${file}.${process.pid}.tmp`, '{"torn":true}')
    assert.equal(await readDurableFile(file), '{"generation":1}')

    await assert.rejects(writeDurableFile(file, '{"generation":3}', 'after-backup'))
    assert.equal(JSON.parse((await readDurableFile(file)) || '{}').generation, 1)
    assert.equal(await readDurableFile(path.join(dir, 'missing.json')), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an aborted indexeddb transaction rejects', async () => {
  const transaction = {
    oncomplete: null as ((event: Event) => void) | null,
    onabort: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    error: { message: 'aborted' },
  }
  const pending = waitForCommit(transaction)
  transaction.onabort?.(new Event('abort'))
  await assert.rejects(pending, /aborted/)
})

test('a vault seals on open, and the wrong device key does not publish a new bundle', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-seal-'))
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  const secret = createDeviceSecret()
  const stamp = Date.now().toString(36)
  const marker = `local plaintext ${stamp} cedar-lantern`
  const clients: ReturnType<typeof openHeadless>[] = []
  const open = (options: Parameters<typeof openHeadless>[0]) => {
    const client = openHeadless(options)
    clients.push(client)
    return client
  }
  try {
    const fresh = path.join(dir, 'fresh.json')
    const created = open({ ...testAgentOptions, relay: relay.baseUrl, vaultPath: fresh, deviceKey: secret })
    await created.unlock({ handle: `seal${stamp}`, password: 'test-only-password' })
    await created.close()
    const first = await readFile(fresh, 'utf8')
    const record = JSON.parse(first) as unknown
    assert.equal(isSealedRecord(record), true)
    assert.equal(first.includes('test-only-password'), false)
    if (!isSealedRecord(record)) return
    const opened = await openSealedVault(secret, record)
    const plain = opened.vault as { messages: { id: string; body: string }[] }
    plain.messages.push({ id: 'migrated', body: marker })
    await writeFile(fresh, JSON.stringify(plain))
    const migrated = open({ ...testAgentOptions, relay: relay.baseUrl, vaultPath: fresh, deviceKey: secret })
    await migrated.unlock({ handle: `seal${stamp}`, password: 'test-only-password' })
    await migrated.close()
    const sealedAgain = await readFile(fresh, 'utf8')
    assert.equal(isSealedRecord(JSON.parse(sealedAgain)), true)
    assert.equal(sealedAgain.includes(marker), false)

    const wrong = open({ ...testAgentOptions, relay: relay.baseUrl, vaultPath: fresh, deviceKey: createDeviceSecret() })
    await assert.rejects(
      () => wrong.unlock({ handle: `seal${stamp}`, password: 'test-only-password' }),
      (error: unknown) => error instanceof HeadlessError && error.code === 'device-key'
    )
    await wrong.close()
    assert.equal(await readFile(fresh, 'utf8'), sealedAgain)

    await writeFile(fresh, '{')
    const corrupt = open({ ...testAgentOptions, relay: relay.baseUrl, vaultPath: fresh, deviceKey: secret })
    await assert.rejects(
      () => corrupt.unlock({ handle: `seal${stamp}`, password: 'test-only-password' }),
      (error: unknown) => error instanceof HeadlessError && error.code === 'vault'
    )
    await corrupt.close()
  } finally {
    await Promise.all(clients.map(client => client.close()))
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})
