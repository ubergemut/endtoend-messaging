import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../../../apps/api/src/server.ts'
import { signal } from '../../../packages/crypto/src/node.ts'
import { Session, type Vault } from '../../../packages/session/src/session.ts'

function openMemory(relay: string, label: string) {
  let disk: Vault | null = null
  const session = new Session({
    relay,
    label,
    signal,
    loadVault: async () => (disk ? structuredClone(disk) : null),
    saveVault: async (vault) => {
      disk = structuredClone(vault)
    },
    loadBlob: async () => null,
    saveBlob: async () => {},
  })
  return { session, read: () => disk }
}

async function friends(left: Session, right: Session) {
  await left.requestFriend(right.record!.handle)
  const incoming = await right.requests()
  await right.respondRequest(incoming.find((request) => request.direction === 'incoming')!.id, 'accept')
  await left.sync()
}

test('removed and departed members cannot read later sender keys', { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-groups-'))
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  const stamp = Date.now().toString(36)
  const names = [`ga${stamp}`, `gb${stamp}`, `gc${stamp}`] as const
  const opened = names.map((name) => openMemory(relay.baseUrl, name))
  const [alice, bob, carol] = opened.map((item) => item.session)
  try {
    for (let index = 0; index < opened.length; index += 1) {
      await opened[index].session.unlock({ handle: names[index], password: 'test-only-password' })
    }
    await friends(alice, bob)
    await friends(alice, carol)
    await friends(bob, carol)
    const group = await alice.createGroup('test group', [bob.record!.handle, carol.record!.handle])
    for (let round = 0; round < 4; round += 1) {
      for (const client of [alice, bob, carol]) await client.sync()
    }
    const settledPosts = await countPosts(async () => {
      for (const client of [alice, bob, carol]) await client.sync()
    })
    assert.equal(settledPosts, 0)

    const removedStore = carol.record!.store
    const bobKeyBefore = bob.record!.groups[group.id].distributionId
    await alice.removeMember(group.id, carol.record!.accountId)
    await bob.sync()
    assert.notEqual(bob.record!.groups[group.id].distributionId, bobKeyBefore)
    const removedBody = `after removing Carol ${stamp}`
    const removedCiphertext = await captureGroupPost(group.id, () => bob.sendGroup({ groupId: group.id, body: removedBody }))
    assert.throws(() => signal.group_decrypt_message(removedStore, bob.record!.accountId, removedCiphertext))
    await alice.sync()
    const aliceRead = await alice.messages({ groupId: group.id })
    assert.equal(aliceRead.some((message) => message.body === removedBody), true)

    const leaveNames = [`la${stamp}`, `lb${stamp}`, `lc${stamp}`] as const
    const leaveOpened = leaveNames.map((name) => openMemory(relay.baseUrl, name))
    const [lea, leb, lec] = leaveOpened.map((item) => item.session)
    for (let index = 0; index < leaveOpened.length; index += 1) {
      await leaveOpened[index].session.unlock({ handle: leaveNames[index], password: 'test-only-password' })
    }
    await friends(lea, leb)
    await friends(lea, lec)
    await friends(leb, lec)
    const left = await lea.createGroup('leave group', [leb.record!.handle, lec.record!.handle])
    for (let round = 0; round < 4; round += 1) {
      for (const client of [lea, leb, lec]) await client.sync()
    }
    const leaverStore = lec.record!.store
    await lec.leaveGroup(left.id)
    await lea.sync()
    await leb.sync()
    const leaveBody = `after leave ${stamp}`
    const leaveCiphertext = await captureGroupPost(left.id, () => leb.sendGroup({ groupId: left.id, body: leaveBody }))
    assert.throws(() => signal.group_decrypt_message(leaverStore, leb.record!.accountId, leaveCiphertext))

    const offNames = [`oa${stamp}`, `ob${stamp}`, `oc${stamp}`] as const
    const offOpened = offNames.map((name) => openMemory(relay.baseUrl, name))
    const [oa, ob, oc] = offOpened.map((item) => item.session)
    for (let index = 0; index < offOpened.length; index += 1) {
      await offOpened[index].session.unlock({ handle: offNames[index], password: 'test-only-password' })
    }
    await friends(oa, ob)
    await friends(oa, oc)
    await friends(ob, oc)
    const parked = await oa.createGroup('offline group', [ob.record!.handle, oc.record!.handle])
    for (let round = 0; round < 4; round += 1) {
      for (const client of [oa, ob, oc]) await client.sync()
    }
    const parkedStore = oc.record!.store
    await oa.removeMember(parked.id, oc.record!.accountId)
    await ob.sync()
    const offlineBody = `after offline sync ${stamp}`
    const offlineCiphertext = await captureGroupPost(parked.id, () => ob.sendGroup({ groupId: parked.id, body: offlineBody }))
    assert.throws(() => signal.group_decrypt_message(parkedStore, ob.record!.accountId, offlineCiphertext))
  } finally {
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})

async function countPosts(work: () => Promise<void>) {
  const original = globalThis.fetch
  let posts = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (init?.method === 'POST' && url.includes('/api/envelopes')) posts += 1
    return original(input, init)
  }
  try {
    await work()
  } finally {
    globalThis.fetch = original
  }
  return posts
}

async function captureGroupPost(groupId: string, work: () => Promise<unknown>) {
  const original = globalThis.fetch
  let captured = ''
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST' && typeof init.body === 'string') {
      const body = JSON.parse(init.body) as { groupId?: string; ciphertext?: string }
      if (body.groupId === groupId && body.ciphertext) captured = body.ciphertext
    }
    return original(input, init)
  }
  try {
    await work()
  } finally {
    globalThis.fetch = original
  }
  assert.ok(captured)
  return captured
}
