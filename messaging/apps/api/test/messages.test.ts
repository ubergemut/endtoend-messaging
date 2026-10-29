import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { signal } from '@e2ee/crypto/node'
import { becomeFriends, call, enqueue, listen, openSession, register, type Actor, type Started } from './helpers.ts'

describe('sealed messages', { concurrency: 1 }, () => {
  let server: Started
  let ada: Actor
  let bea: Actor
  let eve: Actor

  before(async () => {
    server = await listen()
    ada = await register(server.baseUrl, 'ada')
    bea = await register(server.baseUrl, 'bea')
    eve = await register(server.baseUrl, 'eve')
  })

  after(async () => {
    await server.close()
  })

  test('a stranger cannot read or forge a sealed send, and a reply stays inside the ciphertext', async () => {
    const early = await enqueue(server.baseUrl, bea, ada.account.id, 'not-a-session-yet')
    assert.equal(early.status, 403)
    await becomeFriends(server.baseUrl, bea, ada)
    const session = await openSession(server.baseUrl, bea, ada)
    const secret = 'hello from the sealed session'
    const parentId = 'parent-message-id'
    const encrypted = JSON.parse(
      signal.encrypt_message(
        session.store,
        bea.account.id,
        ada.account.id,
        JSON.stringify({ kind: 'text', body: secret, replyTo: parentId })
      )
    )
    const queued = await enqueue(server.baseUrl, null, ada.account.id, encrypted.ciphertext, { accessKey: session.accessKey })
    assert.equal(queued.status, 200)

    const stranger = await enqueue(server.baseUrl, eve, ada.account.id, encrypted.ciphertext, { accessKey: 'wrong-key' })
    assert.equal(stranger.status, 403)
    const missingKey = await enqueue(server.baseUrl, null, ada.account.id, encrypted.ciphertext)
    assert.equal(missingKey.status, 403)

    const columns = await server.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'envelopes'`
    )
    const names = columns.map((column) => column.column_name)
    assert.equal(names.some((name) => name.includes('sender')), false)
    assert.equal(names.includes('reply_to'), false)
    assert.equal(names.some((name) => name.includes('thread')), false)
    const stored = await server.db.query<{ ciphertext: string }>('SELECT ciphertext FROM envelopes')
    assert.equal(stored.some((row) => row.ciphertext.includes(secret) || row.ciphertext.includes(parentId)), false)
    assert.throws(() => signal.decrypt_message(eve.store, eve.account.id, bea.account.id, encrypted.ciphertext))

    const inbox = await call(server.baseUrl, '/api/envelopes', { token: ada.token })
    const opened = JSON.parse(
      signal.decrypt_message(ada.store, ada.account.id, bea.account.id, inbox.body.envelopes[0].ciphertext)
    )
    const payload = JSON.parse(opened.plaintext)
    assert.equal(payload.body, secret)
    assert.equal(payload.replyTo, parentId)

    const stolen = await call(server.baseUrl, '/api/envelopes/ack', {
      method: 'POST',
      token: eve.token,
      body: { ids: [inbox.body.envelopes[0].id] },
    })
    assert.equal(stolen.status, 200)
    const stillThere = await call(server.baseUrl, '/api/envelopes', { token: ada.token })
    assert.equal(stillThere.body.envelopes.length, 1)
    const acked = await call(server.baseUrl, '/api/envelopes/ack', {
      method: 'POST',
      token: ada.token,
      body: { ids: [stillThere.body.envelopes[0].id] },
    })
    assert.equal(acked.status, 200)

    const live = await enqueue(server.baseUrl, null, ada.account.id, encrypted.ciphertext, { accessKey: session.accessKey })
    assert.equal(live.status, 200)
    const expired = await enqueue(server.baseUrl, null, ada.account.id, encrypted.ciphertext, {
      accessKey: session.accessKey,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    assert.equal(expired.status, 200)
    const remaining = await call(server.baseUrl, '/api/envelopes', { token: ada.token })
    assert.equal(remaining.body.envelopes.length, 1)
    assert.equal(remaining.body.envelopes[0].id, live.body.id)
  })
})
