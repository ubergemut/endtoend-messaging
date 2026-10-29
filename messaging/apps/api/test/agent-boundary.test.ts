import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signal } from '@e2ee/crypto/node'
import { call, listen, register, becomeFriends, password } from './helpers.ts'

test('agent bootstrap verifies the bearer account and logout revokes the session', async () => {
  const server = await listen()
  try {
    const alice = await register(server.baseUrl, 'bootstrap_alice')
    const bob = await register(server.baseUrl, 'bootstrap_bob')
    assert.equal((await call(server.baseUrl, '/api/bootstrap')).status, 401)
    const bootstrap = await call(server.baseUrl, `/api/bootstrap?accountId=${bob.account.id}`, { token: alice.token })
    assert.equal(bootstrap.status, 200)
    assert.equal(bootstrap.body.account.id, alice.account.id)
    assert.equal(bootstrap.body.identityKey, alice.bundle.identityKey)
    assert.equal(bootstrap.body.enrolled, true)
    assert.equal(bootstrap.body.protocolVersion, 1)
    const other = await call(server.baseUrl, '/api/auth/login', { method: 'POST', body: { handle: alice.account.handle, password } })
    assert.equal((await call(server.baseUrl, '/api/auth/logout', { method: 'POST', token: alice.token, body: {} })).status, 200)
    assert.equal((await call(server.baseUrl, '/api/bootstrap', { token: alice.token })).status, 401)
    assert.equal((await call(server.baseUrl, '/api/bootstrap', { token: other.body.token })).status, 200)
  } finally { await server.close() }
})

test('repeated key publication preserves the device and consumed prekeys', async () => {
  const server = await listen()
  try {
    const created = await call(server.baseUrl, '/api/auth/register', { method: 'POST', body: { handle: 'publication_retry', password } })
    const generated = JSON.parse(signal.generate_account(created.body.account.id))
    const upload = () => call(server.baseUrl, '/api/keys/bundle', { method: 'PUT', token: created.body.token, body: generated.bundle })
    assert.equal((await upload()).status, 200)
    const before = await server.db.query<{ id: string }>('SELECT id FROM devices WHERE account_id = $1', [created.body.account.id])
    await server.db.query('UPDATE one_time_prekeys SET used_at = now() WHERE device_id = $1', [before[0].id])
    assert.equal((await upload()).status, 200)
    const after = await server.db.query<{ id: string }>('SELECT id FROM devices WHERE account_id = $1', [created.body.account.id])
    assert.equal(after[0].id, before[0].id)
    const unused = await server.db.query('SELECT 1 FROM one_time_prekeys WHERE device_id = $1 AND used_at IS NULL', [after[0].id])
    assert.equal(unused.length, 0)
  } finally { await server.close() }
})

test('attachment retry retains its ID and rejects changed content or another recipient context', async () => {
  const server = await listen()
  try {
    const alice = await register(server.baseUrl, 'media_retry_alice')
    const bob = await register(server.baseUrl, 'media_retry_bob')
    await becomeFriends(server.baseUrl, alice, bob)
    const id = crypto.randomUUID()
    const input = { id, ciphertext: 'sealed-exact-bytes', recipientAccountId: bob.account.id }
    const upload = (token: string, body: unknown) => call(server.baseUrl, '/api/media', { method: 'POST', token, body })
    assert.equal((await upload(alice.token, input)).body.id, id)
    assert.equal((await upload(alice.token, input)).body.id, id)
    assert.equal((await upload(alice.token, { ...input, ciphertext: 'changed' })).status, 409)
    assert.equal((await upload(bob.token, { ...input, recipientAccountId: alice.account.id })).status, 409)
    const saved = await server.db.query('SELECT id FROM media WHERE id = $1', [id])
    assert.equal(saved.length, 1)
  } finally { await server.close() }
})

test('delivery deduplication survives recipient acknowledgement and rejects changed retries', async () => {
  const server = await listen()
  try {
    const alice = await register(server.baseUrl, 'ack_retry_alice')
    const bob = await register(server.baseUrl, 'ack_retry_bob')
    await becomeFriends(server.baseUrl, alice, bob)
    const input = { recipientAccountId: bob.account.id, ciphertext: 'retained-ciphertext', queueTag: crypto.randomUUID() }
    const send = (body: unknown) => call(server.baseUrl, '/api/envelopes', { method: 'POST', token: alice.token, body })
    const first = await send(input)
    assert.equal(first.status, 200)
    await call(server.baseUrl, '/api/envelopes/ack', { method: 'POST', token: bob.token, body: { ids: [first.body.id] } })
    const retried = await send(input)
    assert.equal(retried.status, 200)
    assert.equal(retried.body.id, first.body.id)
    assert.deepEqual((await call(server.baseUrl, '/api/envelopes', { token: bob.token })).body.envelopes, [])
    assert.equal((await send({ ...input, ciphertext: 'changed' })).status, 409)
  } finally { await server.close() }
})

test('group epochs advance across remove/rejoin and stale new sends cannot enter the queue', async () => {
  const server = await listen()
  try {
    const alice = await register(server.baseUrl, 'epoch_alice')
    const bob = await register(server.baseUrl, 'epoch_bob')
    await becomeFriends(server.baseUrl, alice, bob)
    const created = await call(server.baseUrl, '/api/groups', { method: 'POST', token: alice.token, body: { memberIds: [bob.account.id], metadataCiphertext: 'opaque' } })
    const groupId = created.body.id
    const input = { recipientAccountId: bob.account.id, ciphertext: 'group-ciphertext', queueTag: crypto.randomUUID(), groupId, groupEpoch: 1 }
    const first = await call(server.baseUrl, '/api/envelopes', { method: 'POST', token: alice.token, body: input })
    assert.equal(first.status, 200)
    const removed = await call(server.baseUrl, `/api/groups/${groupId}/members/${bob.account.id}`, { method: 'DELETE', token: alice.token })
    assert.equal(removed.body.epoch, 2)
    assert.deepEqual((await call(server.baseUrl, '/api/envelopes', { token: bob.token })).body.envelopes, [])
    const added = await call(server.baseUrl, `/api/groups/${groupId}/members`, { method: 'POST', token: alice.token, body: { accountId: bob.account.id } })
    assert.equal(added.body.epoch, 3)
    assert.equal((await call(server.baseUrl, '/api/envelopes', { method: 'POST', token: alice.token, body: { ...input, queueTag: crypto.randomUUID() } })).status, 409)
    const resolvedRetry = await call(server.baseUrl, '/api/envelopes', { method: 'POST', token: alice.token, body: input })
    assert.equal(resolvedRetry.body.id, first.body.id)
  } finally { await server.close() }
})
