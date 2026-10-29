import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../../../apps/api/src/server.ts'
import { signal } from '../../../packages/crypto/src/node.ts'
import { Session, type Vault } from '../../../packages/session/src/session.ts'

function memorySession(relay: string, label: string, disk: { current: Vault | null }, failSave: { current: boolean }) {
  return new Session({
    relay,
    label,
    signal,
    loadVault: async () => (disk.current ? structuredClone(disk.current) : null),
    saveVault: async (vault) => {
      if (failSave.current) throw new Error('save failed')
      disk.current = structuredClone(vault)
    },
    loadBlob: async () => null,
    saveBlob: async () => {},
  })
}

test('a failed delivery retries the saved ciphertext and a failed ack does not duplicate plaintext', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-durable-'))
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  const stamp = Date.now().toString(36)
  const aliceDisk = { current: null as Vault | null }
  const bobDisk = { current: null as Vault | null }
  const aliceFail = { current: false }
  const bobFail = { current: false }
  const alice = memorySession(relay.baseUrl, 'alice', aliceDisk, aliceFail)
  const bob = memorySession(relay.baseUrl, 'bob', bobDisk, bobFail)
  const original = globalThis.fetch
  try {
    await alice.unlock({ handle: `da${stamp}`, password: 'test-only-password' })
    await bob.unlock({ handle: `db${stamp}`, password: 'test-only-password' })
    await alice.requestFriend(bob.record!.handle)
    const incoming = await bob.requests()
    await bob.respondRequest(incoming[0].id, 'accept')
    await alice.sync()

    const body = `durable ${stamp} the wick stays`
    let captured = ''
    let failPost = true
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (failPost && init?.method === 'POST' && url.includes('/api/envelopes') && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body) as { ciphertext?: string }
        if (parsed.ciphertext) captured = parsed.ciphertext
        throw new Error('post failed')
      }
      return original(input, init)
    }
    await assert.rejects(() => alice.send({ handle: bob.record!.handle, body }))
    assert.equal(aliceDisk.current?.messages.some((message) => message.body === body), true)
    assert.equal(aliceDisk.current?.outbox.length, 1)
    assert.equal(aliceDisk.current?.outbox[0].ciphertext, captured)

    failPost = false
    let retries = 0
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/api/envelopes') && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body) as { ciphertext?: string }
        if (parsed.ciphertext === captured) retries += 1
      }
      return original(input, init)
    }
    const resumed = memorySession(relay.baseUrl, 'alice-resumed', aliceDisk, aliceFail)
    await resumed.unlock({ handle: `da${stamp}`, password: 'test-only-password' })
    assert.equal(retries, 1)
    assert.equal(aliceDisk.current?.outbox.length, 0)

    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/api/envelopes/ack')) throw new Error('ack failed')
      return original(input, init)
    }
    await assert.rejects(() => bob.sync())
    assert.equal(bobDisk.current?.messages.filter((message) => message.body === body).length, 1)
    assert.ok(bobDisk.current?.pendingAcks.length)

    globalThis.fetch = original
    const bobAgain = memorySession(relay.baseUrl, 'bob-again', bobDisk, bobFail)
    await bobAgain.unlock({ handle: `db${stamp}`, password: 'test-only-password' })
    assert.equal(bobDisk.current?.pendingAcks.length, 0)
    assert.equal(bobDisk.current?.messages.filter((message) => message.body === body).length, 1)
  } finally {
    globalThis.fetch = original
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a save that fails before commit drops the send, and a save that fails after accept retries the same ciphertext', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-commit-'))
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  const stamp = Date.now().toString(36)
  const aliceDisk = { current: null as Vault | null }
  const bobDisk = { current: null as Vault | null }
  const gate = { allow: Number.POSITIVE_INFINITY }
  const alice = new Session({
    relay: relay.baseUrl,
    label: 'alice-gate',
    signal,
    loadVault: async () => (aliceDisk.current ? structuredClone(aliceDisk.current) : null),
    saveVault: async (vault) => {
      if (gate.allow <= 0) throw new Error('save failed')
      gate.allow -= 1
      aliceDisk.current = structuredClone(vault)
    },
    loadBlob: async () => null,
    saveBlob: async () => {},
  })
  const bob = memorySession(relay.baseUrl, 'bob-gate', bobDisk, { current: false })
  const original = globalThis.fetch
  try {
    await alice.unlock({ handle: `ca${stamp}`, password: 'test-only-password' })
    await bob.unlock({ handle: `cb${stamp}`, password: 'test-only-password' })
    await alice.requestFriend(bob.record!.handle)
    const incoming = await bob.requests()
    await bob.respondRequest(incoming[0].id, 'accept')
    await alice.sync()
    const before = aliceDisk.current?.messages.length ?? 0
    gate.allow = 0
    await assert.rejects(() => alice.send({ handle: bob.record!.handle, body: `uncommitted ${stamp}` }))
    assert.equal(aliceDisk.current?.messages.length, before)

    gate.allow = 100
    const accepted = new Session({
      relay: relay.baseUrl,
      label: 'alice-accepted',
      signal,
      loadVault: async () => (aliceDisk.current ? structuredClone(aliceDisk.current) : null),
      saveVault: async (vault) => {
        if (gate.allow <= 0) throw new Error('save failed')
        gate.allow -= 1
        aliceDisk.current = structuredClone(vault)
      },
      loadBlob: async () => null,
      saveBlob: async () => {},
    })
    await accepted.unlock({ handle: `ca${stamp}`, password: 'test-only-password' })
    // Commit intent, then ciphertext+ratchet; fail the acknowledgement cleanup after relay acceptance.
    gate.allow = 2
    let captured = ''
    let posts = 0
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/api/envelopes') && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body) as { ciphertext?: string }
        if (parsed.ciphertext) {
          captured = parsed.ciphertext
          posts += 1
        }
      }
      return original(input, init)
    }
    const body = `accepted ${stamp} same ciphertext`
    await assert.rejects(() => accepted.send({ handle: bob.record!.handle, body }))
    assert.equal(aliceDisk.current?.outbox.length, 1)
    assert.equal(aliceDisk.current?.outbox[0].ciphertext, captured)
    assert.equal(posts, 1)

    gate.allow = 100
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/api/envelopes') && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body) as { ciphertext?: string }
        if (parsed.ciphertext === captured) posts += 1
      }
      const response = await original(input, init)
      if ((init?.method ?? 'GET') === 'GET' && url.includes('/api/envelopes')) {
        const copy = response.clone()
        const payload = (await copy.json()) as { envelopes?: unknown[] }
        if (payload.envelopes?.length) {
          return new Response(JSON.stringify({ ...payload, envelopes: [...payload.envelopes, ...payload.envelopes] }), {
            status: response.status,
            headers: { 'content-type': 'application/json' },
          })
        }
      }
      return response
    }
    const resumed = new Session({
      relay: relay.baseUrl,
      label: 'alice-resumed-gate',
      signal,
      loadVault: async () => (aliceDisk.current ? structuredClone(aliceDisk.current) : null),
      saveVault: async (vault) => {
        aliceDisk.current = structuredClone(vault)
      },
      loadBlob: async () => null,
      saveBlob: async () => {},
    })
    await resumed.unlock({ handle: `ca${stamp}`, password: 'test-only-password' })
    assert.equal(posts, 2)
    assert.equal(aliceDisk.current?.outbox.length, 0)
    const arrived = await bob.sync()
    assert.equal(arrived.messages.filter((message) => message.body === body).length, 1)
    assert.equal(bobDisk.current?.messages.filter((message) => message.body === body).length, 1)
  } finally {
    globalThis.fetch = original
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a partial group fan-out retries only the saved ciphertext', { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-fanout-'))
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  const stamp = Date.now().toString(36)
  const aliceDisk = { current: null as Vault | null }
  const bobDisk = { current: null as Vault | null }
  const carolDisk = { current: null as Vault | null }
  const alice = memorySession(relay.baseUrl, 'fan-alice', aliceDisk, { current: false })
  const bob = memorySession(relay.baseUrl, 'fan-bob', bobDisk, { current: false })
  const carol = memorySession(relay.baseUrl, 'fan-carol', carolDisk, { current: false })
  const original = globalThis.fetch
  try {
    await alice.unlock({ handle: `fa${stamp}`, password: 'test-only-password' })
    await bob.unlock({ handle: `fb${stamp}`, password: 'test-only-password' })
    await carol.unlock({ handle: `fc${stamp}`, password: 'test-only-password' })
    await alice.requestFriend(bob.record!.handle)
    await bob.respondRequest((await bob.requests())[0].id, 'accept')
    await alice.sync()
    await alice.requestFriend(carol.record!.handle)
    await carol.respondRequest((await carol.requests())[0].id, 'accept')
    await alice.sync()
    const group = await alice.createGroup('fanout', [bob.record!.handle, carol.record!.handle])
    for (let round = 0; round < 3; round += 1) {
      await alice.sync()
      await bob.sync()
      await carol.sync()
    }
    let posts = 0
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/api/envelopes') && !url.includes('/ack')) {
        posts += 1
        if (posts === 2) throw new Error('second fanout failed')
      }
      return original(input, init)
    }
    const body = `fanout ${stamp} one ciphertext`
    await assert.rejects(() => alice.sendGroup({ groupId: group.id, body }))
    assert.equal(aliceDisk.current?.outbox.length, 1)
    assert.equal(aliceDisk.current?.messages.filter((message) => message.body === body).length, 1)
    globalThis.fetch = original
    const resumed = memorySession(relay.baseUrl, 'fan-alice-again', aliceDisk, { current: false })
    await resumed.unlock({ handle: `fa${stamp}`, password: 'test-only-password' })
    assert.equal(aliceDisk.current?.outbox.length, 0)
    await bob.sync()
    await carol.sync()
    assert.equal(bobDisk.current?.messages.filter((message) => message.body === body).length, 1)
    assert.equal(carolDisk.current?.messages.filter((message) => message.body === body).length, 1)
  } finally {
    globalThis.fetch = original
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})
