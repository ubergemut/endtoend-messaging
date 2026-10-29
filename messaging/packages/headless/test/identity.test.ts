import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../../../apps/api/src/server.ts'
import { signal } from '../../../packages/crypto/src/node.ts'
import { Session, type Vault } from '../../../packages/session/src/session.ts'

function memoryPorts(relay: string, label: string, disk: { current: Vault | null }) {
  return new Session({
    relay,
    label,
    signal,
    loadVault: async () => (disk.current ? structuredClone(disk.current) : null),
    saveVault: async (vault) => {
      disk.current = structuredClone(vault)
    },
    loadBlob: async () => null,
    saveBlob: async () => {},
  })
}

test('a replacement identity stays unverified until a separate verification', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-identity-'))
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  const stamp = Date.now().toString(36)
  const aliceDisk = { current: null as Vault | null }
  const bobDisk = { current: null as Vault | null }
  const alice = memoryPorts(relay.baseUrl, 'alice', aliceDisk)
  const bob = memoryPorts(relay.baseUrl, 'bob', bobDisk)
  try {
    await alice.unlock({ handle: `ia${stamp}`, password: 'test-only-password' })
    await bob.unlock({ handle: `ib${stamp}`, password: 'test-only-password' })
    await alice.requestFriend(bob.record!.handle)
    const incoming = await bob.requests()
    await bob.respondRequest(incoming[0].id, 'accept')
    await alice.sync()
    await alice.send({ handle: bob.record!.handle, body: `hello ${stamp}` })
    await bob.sync()
    await alice.markVerified(bob.record!.handle)
    assert.equal((await alice.safetyNumber(bob.record!.handle)).verified, true)

    const replaced = memoryPorts(relay.baseUrl, 'bob-replaced', { current: null })
    await replaced.unlock({ handle: `ib${stamp}`, password: 'test-only-password', replaceKeys: true })
    await alice.sync()
    assert.equal((await alice.safetyNumber(`ib${stamp}`)).verified, false)
    await assert.rejects(() => alice.send({ handle: `ib${stamp}`, body: `again ${stamp}` }), /trust/i)
    assert.equal(alice.status().pendingTrustHandle, `ib${stamp}`)

    await alice.trustIdentity()
    assert.equal((await alice.safetyNumber(`ib${stamp}`)).verified, false)
    const afterTrust = `after trust ${stamp}`
    await alice.send({ handle: `ib${stamp}`, body: afterTrust })
    await assert.rejects(() => bob.sync(), /device was replaced/i)
    const delivered = await replaced.sync()
    assert.equal(delivered.messages.some((message) => message.body === afterTrust), true)
    const reloaded = memoryPorts(relay.baseUrl, 'alice-reloaded', aliceDisk)
    await reloaded.unlock({ handle: `ia${stamp}`, password: 'test-only-password' })
    assert.equal((await reloaded.safetyNumber(`ib${stamp}`)).verified, false)
    await reloaded.markVerified(`ib${stamp}`)
    assert.equal((await reloaded.safetyNumber(`ib${stamp}`)).verified, true)
    const again = memoryPorts(relay.baseUrl, 'alice-again', aliceDisk)
    await again.unlock({ handle: `ia${stamp}`, password: 'test-only-password' })
    assert.equal((await again.safetyNumber(`ib${stamp}`)).verified, true)
  } finally {
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})
