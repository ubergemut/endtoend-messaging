import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { signal } from '@e2ee/crypto/node'
import { becomeFriends, call, enqueue, listen, register, type Actor, type Started } from './helpers.ts'

describe('friend graph', { concurrency: 1 }, () => {
  let server: Started
  let ada: Actor
  let bea: Actor
  let cleo: Actor

  before(async () => {
    server = await listen()
    ada = await register(server.baseUrl, 'ada')
    bea = await register(server.baseUrl, 'bea')
    cleo = await register(server.baseUrl, 'cleo')
  })

  after(async () => {
    await server.close()
  })

  test('search finds a handle and misses an unknown one', async () => {
    const found = await call(server.baseUrl, '/api/accounts/search?handle=Bea', { token: ada.token })
    assert.equal(found.status, 200)
    assert.equal(found.body.account.id, bea.account.id)
    const missing = await call(server.baseUrl, '/api/accounts/search?handle=nobody', { token: ada.token })
    assert.equal(missing.status, 200)
    assert.equal(missing.body.account, null)
  })

  test('you cannot request yourself or an unknown handle', async () => {
    const self = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: ada.token,
      body: { handle: 'ada' },
    })
    assert.equal(self.status, 400)
    const unknown = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: ada.token,
      body: { handle: 'nobody' },
    })
    assert.equal(unknown.status, 404)
  })

  test('a request note is sealed, and decline or cancel never opens prekeys', async () => {
    const note = 'meet by the north gate'
    const sealed = signal.seal_note(bea.bundle.identityKey, note)
    const requested = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: ada.token,
      body: { handle: 'bea', noteCiphertext: sealed },
    })
    assert.equal(requested.status, 200)
    const stored = await server.db.query<{ note_ciphertext: string }>('SELECT note_ciphertext FROM friend_requests')
    assert.equal(stored.some((row) => row.note_ciphertext.includes(note)), false)
    assert.equal(signal.open_note(bea.store, sealed), note)
    assert.throws(() => signal.open_note(cleo.store, sealed))

    const incoming = await call(server.baseUrl, '/api/friends/requests', { token: bea.token })
    const request = incoming.body.requests.find(
      (item: { direction: string; fromHandle: string }) => item.direction === 'incoming' && item.fromHandle === 'ada'
    )
    const declined = await call(server.baseUrl, `/api/friends/requests/${request.id}/decline`, {
      method: 'POST',
      token: bea.token,
      body: {},
    })
    assert.equal(declined.status, 200)
    const keys = await call(server.baseUrl, `/api/keys/${bea.account.id}`, { token: ada.token })
    assert.equal(keys.status, 403)

    const cancelled = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: ada.token,
      body: { handle: 'cleo' },
    })
    assert.equal(cancelled.status, 200)
    const outgoing = await call(server.baseUrl, '/api/friends/requests', { token: ada.token })
    const pending = outgoing.body.requests.find(
      (item: { direction: string; toHandle: string }) => item.direction === 'outgoing' && item.toHandle === 'cleo'
    )
    const dropped = await call(server.baseUrl, `/api/friends/requests/${pending.id}/cancel`, {
      method: 'POST',
      token: ada.token,
      body: {},
    })
    assert.equal(dropped.status, 200)
    const stillClosed = await call(server.baseUrl, `/api/keys/${cleo.account.id}`, { token: ada.token })
    assert.equal(stillClosed.status, 403)
  })

  test('accept opens the graph, and a second request conflicts', async () => {
    await becomeFriends(server.baseUrl, ada, bea)
    const friends = await call(server.baseUrl, '/api/friends', { token: ada.token })
    assert.equal(friends.body.friends.some((friend: { handle: string }) => friend.handle === 'bea'), true)
    const again = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: ada.token,
      body: { handle: 'bea' },
    })
    assert.equal(again.status, 409)
    const prekeys = await call(server.baseUrl, `/api/keys/${bea.account.id}`, { token: ada.token })
    assert.equal(prekeys.status, 200)
  })

  test('a block in either direction rejects the request, the prekeys, and the send', async () => {
    const nell = await register(server.baseUrl, 'nell')
    const otto = await register(server.baseUrl, 'otto')
    const blockedRequest = await call(server.baseUrl, '/api/friends/block', {
      method: 'POST',
      token: nell.token,
      body: { handle: 'otto' },
    })
    assert.equal(blockedRequest.status, 200)
    const asking = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: otto.token,
      body: { handle: 'nell' },
    })
    assert.equal(asking.status, 403)
    const reverse = await call(server.baseUrl, '/api/friends/requests', {
      method: 'POST',
      token: nell.token,
      body: { handle: 'otto' },
    })
    assert.equal(reverse.status, 403)

    await becomeFriends(server.baseUrl, ada, cleo)
    const bundle = await call(server.baseUrl, `/api/keys/${cleo.account.id}`, { token: ada.token })
    const accessKey = bundle.body.bundle.accessKey as string
    const blocked = await call(server.baseUrl, '/api/friends/block', {
      method: 'POST',
      token: cleo.token,
      body: { handle: 'ada' },
    })
    assert.equal(blocked.status, 200)
    const prekeys = await call(server.baseUrl, `/api/keys/${cleo.account.id}`, { token: ada.token })
    assert.equal(prekeys.status, 403)
    const sent = await enqueue(server.baseUrl, ada, cleo.account.id, 'still-sealed', { accessKey })
    assert.equal(sent.status, 403)
    const back = await enqueue(server.baseUrl, cleo, ada.account.id, 'also-sealed', { accessKey: ada.bundle.accessKey })
    assert.equal(back.status, 403)
  })

  test('unfriend deletes the queued blob and the next send fails', async () => {
    const gem = await register(server.baseUrl, 'gem')
    const hal = await register(server.baseUrl, 'hal')
    await becomeFriends(server.baseUrl, gem, hal)
    const tag = crypto.randomUUID()
    const queued = await enqueue(server.baseUrl, gem, hal.account.id, 'queued-ciphertext', { queueTag: tag })
    assert.equal(queued.status, 200)
    const removed = await call(server.baseUrl, `/api/friends/${hal.account.id}/remove`, {
      method: 'POST',
      token: gem.token,
      body: { queueTags: [tag] },
    })
    assert.equal(removed.status, 200)
    const left = await server.db.query<{ id: string }>('SELECT id FROM envelopes WHERE queue_tag = $1', [tag])
    assert.equal(left.length, 0)
    const friends = await call(server.baseUrl, '/api/friends', { token: gem.token })
    assert.equal(friends.body.friends.some((friend: { id: string }) => friend.id === hal.account.id), false)
    const again = await enqueue(server.baseUrl, gem, hal.account.id, 'after-unfriend')
    assert.equal(again.status, 403)
  })
})
