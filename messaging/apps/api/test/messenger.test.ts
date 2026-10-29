import assert from 'node:assert/strict'
import test from 'node:test'
import { signal } from '@e2ee/crypto/node'
import { startServer } from '../src/server.ts'

type Started = Awaited<ReturnType<typeof startServer>>

async function register(baseUrl: string, handle: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'correct-horse', displayName: handle }),
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  const generated = JSON.parse(signal.generate_account(body.account.id))
  const upload = await fetch(`${baseUrl}/api/keys/bundle`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${body.token}`,
    },
    body: JSON.stringify(generated.bundle),
  })
  assert.equal(upload.status, 200)
  return {
    token: body.token as string,
    account: body.account as { id: string; handle: string },
    store: JSON.stringify(generated.store),
    bundle: generated.bundle,
  }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

test('friend gate, sealed envelopes, and disappearing ciphertext', async () => {
  const server: Started = await startServer()
  try {
    const alice = await register(server.baseUrl, 'alice')
    const bob = await register(server.baseUrl, 'bob')
    const eve = await register(server.baseUrl, 'eve')

    const denied = await fetch(`${server.baseUrl}/api/keys/${bob.account.id}`, {
      headers: auth(alice.token),
    })
    assert.equal(denied.status, 403)

    const found = await fetch(`${server.baseUrl}/api/accounts/search?handle=alice`, {
      headers: auth(bob.token),
    })
    const search = await found.json()
    const note = 'meet me by the oak tree'
    const sealed = signal.seal_note(search.account.identityKey, note)
    const requested = await fetch(`${server.baseUrl}/api/friends/requests`, {
      method: 'POST',
      headers: auth(bob.token),
      body: JSON.stringify({ handle: 'alice', noteCiphertext: sealed }),
    })
    assert.equal(requested.status, 200)

    const notes = await server.db.query<{ note_ciphertext: string }>(
      'SELECT note_ciphertext FROM friend_requests'
    )
    assert.equal(notes[0].note_ciphertext.includes(note), false)
    assert.equal(signal.open_note(alice.store, notes[0].note_ciphertext), note)

    const early = await fetch(`${server.baseUrl}/api/envelopes`, {
      method: 'POST',
      headers: auth(bob.token),
      body: JSON.stringify({
        recipientAccountId: alice.account.id,
        ciphertext: 'not-a-session-yet',
        queueTag: crypto.randomUUID(),
      }),
    })
    assert.equal(early.status, 403)

    const earlyMedia = await fetch(`${server.baseUrl}/api/media`, {
      method: 'POST',
      headers: auth(bob.token),
      body: JSON.stringify({ ciphertext: 'sealed-file', recipientAccountId: alice.account.id }),
    })
    assert.equal(earlyMedia.status, 403)

    const incoming = await fetch(`${server.baseUrl}/api/friends/requests`, { headers: auth(alice.token) })
    const requests = await incoming.json()
    const accept = await fetch(`${server.baseUrl}/api/friends/requests/${requests.requests[0].id}/accept`, {
      method: 'POST',
      headers: auth(alice.token),
    })
    assert.equal(accept.status, 200)

    const bundleResponse = await fetch(`${server.baseUrl}/api/keys/${alice.account.id}`, {
      headers: auth(bob.token),
    })
    assert.equal(bundleResponse.status, 200)
    const { bundle } = await bundleResponse.json()
    const bobStore = signal.establish_session(bob.store, bob.account.id, alice.account.id, JSON.stringify(bundle))
    const secret = 'hello from the sealed session'
    const encrypted = JSON.parse(signal.encrypt_message(bobStore, bob.account.id, alice.account.id, secret))
    const queued = await fetch(`${server.baseUrl}/api/envelopes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipientAccountId: alice.account.id,
        ciphertext: encrypted.ciphertext,
        accessKey: bundle.accessKey,
        queueTag: crypto.randomUUID(),
      }),
    })
    assert.equal(queued.status, 200)

    const stranger = await fetch(`${server.baseUrl}/api/envelopes`, {
      method: 'POST',
      headers: auth(eve.token),
      body: JSON.stringify({
        recipientAccountId: alice.account.id,
        ciphertext: encrypted.ciphertext,
        accessKey: 'wrong-key',
        queueTag: crypto.randomUUID(),
      }),
    })
    assert.equal(stranger.status, 403)

    const columns = await server.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'envelopes'`
    )
    assert.equal(columns.some((column) => column.column_name.includes('sender')), false)
    const stored = await server.db.query<{ ciphertext: string }>('SELECT ciphertext FROM envelopes')
    assert.equal(stored.some((row) => row.ciphertext.includes(secret)), false)
    assert.throws(() => signal.decrypt_message(eve.store, eve.account.id, bob.account.id, encrypted.ciphertext))

    const inbox = await fetch(`${server.baseUrl}/api/envelopes`, { headers: auth(alice.token) })
    const messages = await inbox.json()
    const opened = JSON.parse(
      signal.decrypt_message(alice.store, alice.account.id, bob.account.id, messages.envelopes[0].ciphertext)
    )
    assert.equal(opened.plaintext, secret)

    const expiring = await fetch(`${server.baseUrl}/api/envelopes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipientAccountId: alice.account.id,
        ciphertext: encrypted.ciphertext,
        accessKey: bundle.accessKey,
        queueTag: crypto.randomUUID(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    })
    assert.equal(expiring.status, 200)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const after = await fetch(`${server.baseUrl}/api/envelopes`, { headers: auth(alice.token) })
    const remaining = await after.json()
    assert.equal(remaining.envelopes.length, 1)

    const marker = 'plain-photo-bytes'
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealedFile = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(marker)
    )
    const ciphertext = Buffer.from(sealedFile).toString('base64')
    const uploaded = await fetch(`${server.baseUrl}/api/media`, {
      method: 'POST',
      headers: auth(bob.token),
      body: JSON.stringify({ ciphertext, recipientAccountId: alice.account.id }),
    })
    assert.equal(uploaded.status, 200)
    const uploadedBody = await uploaded.json()
    const mediaColumns = await server.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'media'`
    )
    const names = mediaColumns.map((column) => column.column_name)
    assert.equal(names.includes('sender'), false)
    assert.equal(names.includes('filename'), false)
    assert.equal(names.includes('mime'), false)
    const storedMedia = await server.db.query<{ ciphertext: string }>('SELECT ciphertext FROM media')
    assert.equal(storedMedia.some((row) => row.ciphertext.includes(marker)), false)
    const fetched = await fetch(`${server.baseUrl}/api/media/${uploadedBody.id}`, { headers: auth(alice.token) })
    assert.equal(fetched.status, 200)
    const blocked = await fetch(`${server.baseUrl}/api/media/${uploadedBody.id}`, { headers: auth(eve.token) })
    assert.equal(blocked.status, 403)
    const expiringMedia = await fetch(`${server.baseUrl}/api/media`, {
      method: 'POST',
      headers: auth(bob.token),
      body: JSON.stringify({
        ciphertext,
        recipientAccountId: alice.account.id,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    })
    assert.equal(expiringMedia.status, 200)
    const expiredBody = await expiringMedia.json()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const gone = await fetch(`${server.baseUrl}/api/media/${expiredBody.id}`, { headers: auth(alice.token) })
    assert.equal(gone.status, 404)
  } finally {
    await server.close()
  }
})
