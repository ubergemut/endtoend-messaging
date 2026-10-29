import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, type Vault } from '@e2ee/session'
import { signal } from '@e2ee/crypto/node'
import { createDispatcher } from '../src/dispatcher.ts'
import { startReferenceRelay } from './reference-relay.ts'

function memory(relay: string) {
  let disk: Vault | null = null
  const blobs = new Map<string, Uint8Array>()
  const ports: ConstructorParameters<typeof Session>[0] = { relay, label: 'review fixture', signal,
    loadVault: async () => disk ? structuredClone(disk) : null,
    saveVault: async vault => { disk = structuredClone(vault) },
    loadBlob: async id => blobs.get(id) ?? null,
    saveBlob: async (id, bytes) => { blobs.set(id, new Uint8Array(bytes)) },
  }
  return Object.assign(new Session(ports), { reopen: () => new Session(ports) })
}

async function connect(alice: Session, bob: Session, prefix: string) {
  await alice.unlock({ handle: `${prefix}_alice`, password: 'fixture-password' })
  await bob.unlock({ handle: `${prefix}_bob`, password: 'fixture-password' })
  await alice.requestFriend(`${prefix}_bob`)
  await bob.respondRequest((await bob.requests())[0].id, 'accept')
  await alice.sync()
}

test('protocol file sends preserve the requested reply and disappearing timer', { timeout: 30000 }, async () => {
  const relay = await startReferenceRelay(), alice = memory(relay.baseUrl), bob = memory(relay.baseUrl)
  try {
    await connect(alice, bob, 'review_file')
    const parent = await alice.send({ handle: 'review_file_bob', body: 'parent message' })
    const dispatcher = createDispatcher({ signal, session: () => alice, lock() { alice.lock() } })
    const result = await dispatcher.dispatch({ version: 1, requestId: crypto.randomUUID(), operation: 'sendFile', operationId: crypto.randomUUID(), input: {
      handle: 'review_file_bob', body: 'timed reply', name: 'fixture.bin', mime: 'application/octet-stream',
      base64: 'AQID', replyTo: parent.id, expiresInSeconds: 3600,
    } })
    assert.equal(result.ok, true, JSON.stringify(result))
    if (!result.ok) return
    const id = (result.result as { id: string }).id
    const stored = alice.record!.messages.find(message => message.id === id)!
    assert.equal(stored.replyTo, parent.id)
    assert.equal(stored.quote, 'parent message')
    assert.ok(stored.expiresAt && Date.parse(stored.expiresAt) > Date.now())
    assert.ok(stored.expiresAt && Date.parse(stored.expiresAt) <= Date.now() + 3600_000)
    await bob.sync()
    const incoming = bob.record!.messages.find(message => message.id === id)!
    assert.equal(incoming.replyTo, parent.id)
    assert.equal(incoming.expiresAt, stored.expiresAt)
  } finally { alice.lock(); bob.lock(); await relay.close() }
})

test('a failed group setup fanout retains the incoming acknowledgement across restart', { timeout: 30000 }, async () => {
  const relay = await startReferenceRelay(), alice = memory(relay.baseUrl), bob = memory(relay.baseUrl)
  const original = globalThis.fetch
  let reopened: Session | undefined
  try {
    await connect(alice, bob, 'review_setup')
    const group = await alice.createGroup('review setup durability', ['review_setup_bob'])
    let failed = false
    globalThis.fetch = async (input, init) => {
      if (!failed && String(input).endsWith('/api/envelopes') && init?.method === 'POST'
        && new Headers(init.headers).get('authorization') === `Bearer ${bob.token}`) {
        failed = true
        throw new Error('interrupted setup fanout')
      }
      return original(input, init)
    }
    await bob.sync()
    assert.equal(failed, true)
    assert.ok(bob.record!.groups[group.id], 'received setup was durably committed before fanout failed')
    globalThis.fetch = original
    // Retrying must acknowledge the already committed setup without decrypting its ratchet twice.
    bob.lock()
    reopened = bob.reopen()
    await reopened.unlock({ handle: 'review_setup_bob', password: 'fixture-password' })
    await alice.sync()
    await reopened.sync()
    const inbox = await original(relay.baseUrl + '/api/envelopes', { headers: { authorization: `Bearer ${reopened.token}` } })
    assert.equal((await inbox.json() as { envelopes: unknown[] }).envelopes.length, 0, 'committed incoming setup must not remain queued forever')
  } finally { globalThis.fetch = original; alice.lock(); bob.lock(); reopened?.lock(); await relay.close() }
})
