import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { becomeFriends, call, listen, register, type Actor, type Started } from './helpers.ts'

describe('media', { concurrency: 1 }, () => {
  let server: Started
  let ada: Actor
  let bea: Actor
  let cleo: Actor
  let eve: Actor

  before(async () => {
    server = await listen()
    ada = await register(server.baseUrl, 'ada')
    bea = await register(server.baseUrl, 'bea')
    cleo = await register(server.baseUrl, 'cleo')
    eve = await register(server.baseUrl, 'eve')
  })

  after(async () => {
    await server.close()
  })

  test('a file is ciphertext for the recipient, and the wrong account cannot read it', async () => {
    const marker = 'plain-photo-bytes'
    const early = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: bea.token,
      body: { ciphertext: marker, recipientAccountId: ada.account.id },
    })
    assert.equal(early.status, 403)

    await becomeFriends(server.baseUrl, bea, ada)
    const neither = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: bea.token,
      body: { ciphertext: 'sealed' },
    })
    assert.equal(neither.status, 400)
    const uploaded = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: bea.token,
      body: { ciphertext: 'sealed-photo', recipientAccountId: ada.account.id },
    })
    assert.equal(uploaded.status, 200)

    const columns = await server.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'media'`
    )
    const names = columns.map((column) => column.column_name)
    assert.equal(names.includes('sender'), false)
    assert.equal(names.includes('filename'), false)
    assert.equal(names.includes('mime'), false)
    const stored = await server.db.query<{ ciphertext: string }>('SELECT ciphertext FROM media')
    assert.equal(stored.some((row) => row.ciphertext.includes(marker)), false)

    const fetched = await call(server.baseUrl, `/api/media/${uploaded.body.id}`, { token: ada.token })
    assert.equal(fetched.status, 200)
    assert.equal(fetched.body.ciphertext, 'sealed-photo')
    const stranger = await call(server.baseUrl, `/api/media/${uploaded.body.id}`, { token: eve.token })
    assert.equal(stranger.status, 403)

    const expired = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: bea.token,
      body: {
        ciphertext: 'sealed-photo',
        recipientAccountId: ada.account.id,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    })
    assert.equal(expired.status, 200)
    const gone = await call(server.baseUrl, `/api/media/${expired.body.id}`, { token: ada.token })
    assert.equal(gone.status, 404)
  })

  test('group media follows membership, and an oversized blob is refused', async () => {
    await becomeFriends(server.baseUrl, ada, cleo)
    const created = await call(server.baseUrl, '/api/groups', {
      method: 'POST',
      token: ada.token,
      body: { memberIds: [cleo.account.id], metadataCiphertext: 'opaque-group' },
    })
    assert.equal(created.status, 200)
    const both = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: ada.token,
      body: { ciphertext: 'sealed', recipientAccountId: cleo.account.id, groupId: created.body.id },
    })
    assert.equal(both.status, 400)
    const uploaded = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: ada.token,
      body: { ciphertext: 'group-sealed', groupId: created.body.id },
    })
    assert.equal(uploaded.status, 200)
    const readable = await call(server.baseUrl, `/api/media/${uploaded.body.id}`, { token: cleo.token })
    assert.equal(readable.status, 200)

    const left = await call(server.baseUrl, `/api/groups/${created.body.id}/members/${cleo.account.id}`, {
      method: 'DELETE',
      token: cleo.token,
    })
    assert.equal(left.status, 200)
    const after = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: cleo.token,
      body: { ciphertext: 'group-sealed', groupId: created.body.id },
    })
    assert.equal(after.status, 403)
    const hidden = await call(server.baseUrl, `/api/media/${uploaded.body.id}`, { token: cleo.token })
    assert.equal(hidden.status, 403)

    const oversized = await call(server.baseUrl, '/api/media', {
      method: 'POST',
      token: ada.token,
      body: { ciphertext: 'x'.repeat(36_000_001), recipientAccountId: cleo.account.id },
    })
    assert.equal(oversized.status, 413)
  })
})