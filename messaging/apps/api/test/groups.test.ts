import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { signal } from '@e2ee/crypto/node'
import { becomeFriends, call, enqueue, listen, register, type Actor, type Started } from './helpers.ts'

describe('groups', { concurrency: 1 }, () => {
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
    await becomeFriends(server.baseUrl, ada, bea)
    await becomeFriends(server.baseUrl, ada, cleo)
  })

  after(async () => {
    await server.close()
  })

  test('only a member can add a friend, and a removed member cannot send or decrypt the next message', async () => {
    const stranger = await call(server.baseUrl, '/api/groups', {
      method: 'POST',
      token: ada.token,
      body: { memberIds: [eve.account.id], metadataCiphertext: 'opaque' },
    })
    assert.equal(stranger.status, 403)

    const name = 'oak-picnic'
    const distributionId = crypto.randomUUID()
    const created = JSON.parse(signal.create_sender_key(ada.store, ada.account.id, distributionId))
    const metadata = JSON.parse(
      signal.group_encrypt_message(JSON.stringify(created.store), ada.account.id, distributionId, JSON.stringify({ name }))
    )
    assert.equal(metadata.ciphertext.includes(name), false)
    const createdGroup = await call(server.baseUrl, '/api/groups', {
      method: 'POST',
      token: ada.token,
      body: { memberIds: [bea.account.id], metadataCiphertext: metadata.ciphertext },
    })
    assert.equal(createdGroup.status, 200)
    const groupId = createdGroup.body.id as string
    assert.deepEqual(createdGroup.body.memberIds.sort(), [ada.account.id, bea.account.id].sort())

    const outsider = await call(server.baseUrl, `/api/groups/${groupId}/members`, {
      method: 'POST',
      token: cleo.token,
      body: { accountId: eve.account.id },
    })
    assert.equal(outsider.status, 403)
    const notFriend = await call(server.baseUrl, `/api/groups/${groupId}/members`, {
      method: 'POST',
      token: ada.token,
      body: { accountId: eve.account.id },
    })
    assert.equal(notFriend.status, 403)
    const added = await call(server.baseUrl, `/api/groups/${groupId}/members`, {
      method: 'POST',
      token: ada.token,
      body: { accountId: cleo.account.id },
    })
    assert.equal(added.status, 200)
    assert.equal(added.body.memberIds.includes(cleo.account.id), true)

    const secret = 'group secret'
    const first = JSON.parse(
      signal.group_encrypt_message(JSON.stringify(metadata.store), ada.account.id, distributionId, secret)
    )
    let beaStore = signal.process_sender_key(bea.store, ada.account.id, created.distribution)
    assert.equal(JSON.parse(signal.group_decrypt_message(beaStore, ada.account.id, first.ciphertext)).plaintext, secret)
    const sent = await enqueue(server.baseUrl, ada, bea.account.id, first.ciphertext, { groupId })
    assert.equal(sent.status, 200)

    const removed = await call(server.baseUrl, `/api/groups/${groupId}/members/${bea.account.id}`, {
      method: 'DELETE',
      token: ada.token,
    })
    assert.equal(removed.status, 200)
    const beaGroups = await call(server.baseUrl, '/api/groups', { token: bea.token })
    assert.equal(beaGroups.body.groups.some((group: { id: string }) => group.id === groupId), false)
    const rejected = await enqueue(server.baseUrl, bea, ada.account.id, first.ciphertext, { groupId })
    assert.equal(rejected.status, 403)

    const nextId = crypto.randomUUID()
    const rotated = JSON.parse(signal.create_sender_key(JSON.stringify(first.store), ada.account.id, nextId))
    const second = JSON.parse(
      signal.group_encrypt_message(JSON.stringify(rotated.store), ada.account.id, nextId, 'after remove')
    )
    assert.throws(() => signal.group_decrypt_message(beaStore, ada.account.id, second.ciphertext))
    assert.equal(JSON.parse(signal.group_decrypt_message(beaStore, ada.account.id, first.ciphertext)).plaintext, secret)
    const cleoStore = signal.process_sender_key(cleo.store, ada.account.id, rotated.distribution)
    assert.equal(JSON.parse(signal.group_decrypt_message(cleoStore, ada.account.id, second.ciphertext)).plaintext, 'after remove')
  })

  test('leaving drops the group, the send, and the next sender key', async () => {
    const distributionId = crypto.randomUUID()
    const created = JSON.parse(signal.create_sender_key(ada.store, ada.account.id, distributionId))
    const metadata = JSON.parse(
      signal.group_encrypt_message(JSON.stringify(created.store), ada.account.id, distributionId, JSON.stringify({ name: 'walk' }))
    )
    const createdGroup = await call(server.baseUrl, '/api/groups', {
      method: 'POST',
      token: ada.token,
      body: { memberIds: [bea.account.id], metadataCiphertext: metadata.ciphertext },
    })
    assert.equal(createdGroup.status, 200)
    const groupId = createdGroup.body.id as string
    const earlier = JSON.parse(
      signal.group_encrypt_message(JSON.stringify(metadata.store), ada.account.id, distributionId, 'before leave')
    )
    const beaStore = signal.process_sender_key(bea.store, ada.account.id, created.distribution)
    assert.equal(JSON.parse(signal.group_decrypt_message(beaStore, ada.account.id, earlier.ciphertext)).plaintext, 'before leave')

    const left = await call(server.baseUrl, `/api/groups/${groupId}/members/${bea.account.id}`, {
      method: 'DELETE',
      token: bea.token,
    })
    assert.equal(left.status, 200)
    const listed = await call(server.baseUrl, '/api/groups', { token: bea.token })
    assert.equal(listed.body.groups.some((group: { id: string }) => group.id === groupId), false)
    const rejected = await enqueue(server.baseUrl, bea, ada.account.id, earlier.ciphertext, { groupId })
    assert.equal(rejected.status, 403)

    const nextId = crypto.randomUUID()
    const rotated = JSON.parse(signal.create_sender_key(JSON.stringify(earlier.store), ada.account.id, nextId))
    const later = JSON.parse(signal.group_encrypt_message(JSON.stringify(rotated.store), ada.account.id, nextId, 'after leave'))
    assert.throws(() => signal.group_decrypt_message(beaStore, ada.account.id, later.ciphertext))
    assert.equal(JSON.parse(signal.group_decrypt_message(beaStore, ada.account.id, earlier.ciphertext)).plaintext, 'before leave')
  })
})
