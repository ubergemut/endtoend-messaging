// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { WebSocket } from 'ws'
import { PGlite } from '@electric-sql/pglite'
import { startServer, type HostIdentityConfig } from '../src/server.ts'
import { SCHEMA, openDatabase } from '../src/db.ts'
import { prepareHostIdentity, type HostAssertion } from '../src/hostIdentity.ts'

const fixtures = [
  { issuer: 'password-membership-app', ...generateKeyPairSync('ed25519') },
  { issuer: 'magic-link-workspace-app', ...generateKeyPairSync('ed25519') },
]
const config: HostIdentityConfig = { audience: 'synthetic-messaging-deployment', sessionTtlSeconds: 60,
  issuers: fixtures.map(item => ({ issuer: item.issuer, keys: [{ keyId: 'first', publicKey: item.publicKey.export({ format: 'pem', type: 'spki' }).toString() }] })) }
function signed(subject: string, changes: Record<string, unknown> = {}, fixture = fixtures[0]): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ version: 1, keyId: 'first', issuer: fixture.issuer, subject,
    audience: config.audience, issuedAt: now, expiresAt: now + 60, nonce: randomBytes(24).toString('base64url'), purpose: 'session', ...changes }))
  return `${payload.toString('base64url')}.${sign(null, payload, fixture.privateKey).toString('base64url')}`
}
async function call(base: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() as any }
}
async function exchange(base: string, subject: string, changes: Record<string, unknown> = {}, fixture = fixtures[0]) {
  const result = await call(base, '/messaging/v1/session/exchange', { assertion: signed(subject, changes, fixture) })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body as { token: string; account: { id: string; handle: string; displayName: string }; expiresAt: string }
}
async function socket(base: string, token: string) {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`)
  await once(ws, 'open')
  return ws
}
async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'endtoend-host-identity-'))
  try { await run(root) }
  finally {
    assert(resolve(root).startsWith(join(resolve(tmpdir()), 'endtoend-host-identity-')))
    await rm(root, { recursive: true, force: true })
  }
}

test('invalid host configuration fails before opening persistent storage', () => temporary(async root => {
  const dataDir = join(root, 'must-not-exist')
  await assert.rejects(startServer({ dataDir, hostIdentity: { ...config, audience: '' } }), /Invalid host identity/)
  await assert.rejects(stat(dataDir), { code: 'ENOENT' })
  for (const audience of ['   ', 'project\nname', 'x'.repeat(257)]) assert.throws(() => prepareHostIdentity({ ...config, audience }), /Invalid host identity/)
  const opaqueAudience = '项目 messaging project a'
  assert.equal(prepareHostIdentity({ ...config, audience: opaqueAudience })?.audience, opaqueAudience)
  assert.throws(() => prepareHostIdentity({ ...config, issuers: [config.issuers[0], config.issuers[0]] }), /duplicate/)
  assert.throws(() => prepareHostIdentity({ ...config, assertionMaxAgeSeconds: 121 }), /maximum age/)
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
  assert.throws(() => prepareHostIdentity({ ...config, issuers: [{ issuer: 'rsa', keys: [{ keyId: 'rsa', publicKey: rsa }] }] }), /Ed25519/)
}))

describe('public host identity contract', { concurrency: 1 }, () => {
  let server: Awaited<ReturnType<typeof startServer>>
  before(async () => { server = await startServer({ hostIdentity: config }) })
  after(async () => { await server.close() })

  test('different login-model issuers provision isolated stable identities with scoped public bootstrap', async () => {
    const metadata = await call(server.baseUrl, '/messaging/v1/metadata')
    assert.equal(metadata.body.audience, config.audience)
    assert.equal(metadata.body.endpoints.bootstrap, '/messaging/v1/session')
    const passwordAccount = await exchange(server.baseUrl, 'user-42', { displayName: 'Password user' })
    const relogin = await exchange(server.baseUrl, 'user-42')
    const magicLinkAccount = await exchange(server.baseUrl, 'user-42', { displayName: 'Magic link user' }, fixtures[1])
    const otherSubject = await exchange(server.baseUrl, 'user-43')
    assert.equal(relogin.account.id, passwordAccount.account.id)
    assert.notEqual(magicLinkAccount.account.id, passwordAccount.account.id)
    assert.notEqual(otherSubject.account.id, passwordAccount.account.id)
    assert.match(passwordAccount.account.handle, /^h_[a-f0-9]{28}$/)
    const bootstrap = await call(server.baseUrl, '/messaging/v1/session', undefined, passwordAccount.token)
    assert.deepEqual(bootstrap.body, { version: 1, protocolVersion: 1, audience: config.audience, account: passwordAccount.account, enrolled: false, identityKey: null, expiresAt: passwordAccount.expiresAt })
    assert.equal((await call(server.baseUrl, '/api/bootstrap', undefined, passwordAccount.token)).body.audience, config.audience)
    assert.equal((await call(server.baseUrl, '/api/auth/login', { handle: passwordAccount.account.handle, password: 'anything' })).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, passwordAccount.account.id)).status, 401)
  })

  test('a signed handle cannot claim an existing account or remap a prior host identity', async () => {
    const original = await call(server.baseUrl, '/api/auth/register', { handle: 'existing_owner', password: 'synthetic-password' })
    assert.equal(original.status, 200)
    assert.equal((await call(server.baseUrl, '/api/bootstrap', undefined, original.body.token)).body.audience, 'endtoend-relay')
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, original.body.token)).status, 401, 'public versioned bootstrap requires a finite scoped credential')
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: signed('host-claim', { handle: 'existing_owner' }) })).status, 409)
    const created = await exchange(server.baseUrl, 'host-named', { handle: 'host_named' })
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: signed('host-named', { handle: 'existing_owner' }) })).status, 409)
    assert.equal((await exchange(server.baseUrl, 'host-named')).account.id, created.account.id)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: signed('host-named', { accountId: original.body.account.id }) })).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { subject: 'host-named', token: original.body.token })).status, 400)
  })

  test('tampering, unknown keys, wrong audience, expired and overlong assertions fail closed', async () => {
    const now = Math.floor(Date.now() / 1000)
    for (const changes of [
      { audience: 'other-project' }, { issuer: 'untrusted-host' }, { keyId: 'unknown' },
      { issuedAt: now - 200, expiresAt: now - 1 }, { issuedAt: now + 30, expiresAt: now + 60 },
      { expiresAt: now + 121 }, { nonce: 'short' }, { nonce: 12345678901234567 }, { purpose: 'revoke' },
    ]) assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: signed('bad-claims', changes) })).status, 401, JSON.stringify(changes))
    const valid = signed('tampered')
    const [payload, signature] = valid.split('.')
    const tampered = `${Buffer.from(Buffer.from(payload, 'base64url').toString().replace('tampered', 'another')).toString('base64url')}.${signature}`
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: tampered })).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: valid + '=' })).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: 'x'.repeat(17000) })).status, 413)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: signed('unknown-signer', {}, { ...fixtures[0], privateKey: fixtures[1].privateKey }) })).status, 401)
  })

  test('concurrent replay consumes one assertion atomically and no extra identity or session', async () => {
    const assertion = signed('concurrent-user')
    const results = await Promise.all(Array.from({ length: 8 }, () => call(server.baseUrl, '/messaging/v1/session/exchange', { assertion })))
    assert.equal(results.filter(result => result.status === 200).length, 1)
    assert.equal(results.filter(result => result.status === 409).length, 7)
    const accountId = results.find(result => result.status === 200)!.body.account.id
    assert.equal((await server.db.query<{ count: number }>('SELECT count(*)::integer AS count FROM sessions WHERE account_id = $1', [accountId]))[0].count, 1)
  })

  test('host credentials still require accepted contacts and group membership', async () => {
    const alice = await exchange(server.baseUrl, 'permissions-a')
    const bob = await exchange(server.baseUrl, 'permissions-b')
    const eve = await exchange(server.baseUrl, 'permissions-e')
    const envelope = { recipientAccountId: bob.account.id, ciphertext: 'synthetic-encrypted-envelope', queueTag: 'before-friendship' }
    assert.equal((await call(server.baseUrl, '/api/envelopes', envelope, alice.token)).status, 403)
    assert.equal((await call(server.baseUrl, '/api/groups', { memberIds: [bob.account.id], metadataCiphertext: 'synthetic-encrypted-metadata' }, alice.token)).status, 403)
    assert.equal((await call(server.baseUrl, '/api/friends/requests', { handle: bob.account.handle }, alice.token)).status, 200)
    const incoming = (await call(server.baseUrl, '/api/friends/requests', undefined, bob.token)).body.requests[0]
    assert.equal((await call(server.baseUrl, `/api/friends/requests/${incoming.id}/accept`, {}, eve.token)).status, 404)
    assert.equal((await call(server.baseUrl, `/api/friends/requests/${incoming.id}/accept`, {}, bob.token)).status, 200)
    assert.equal((await call(server.baseUrl, '/api/envelopes', { ...envelope, queueTag: 'after-friendship' }, alice.token)).status, 200)
    const group = await call(server.baseUrl, '/api/groups', { memberIds: [bob.account.id], metadataCiphertext: 'synthetic-encrypted-metadata' }, alice.token)
    assert.equal(group.status, 200)
    assert.equal((await call(server.baseUrl, '/api/envelopes', { ...envelope, queueTag: 'nonmember', groupId: group.body.id, groupEpoch: 1 }, eve.token)).status, 403)
    assert.equal((await call(server.baseUrl, '/api/friends/block', { handle: alice.account.handle }, bob.token)).status, 200)
    assert.equal((await call(server.baseUrl, '/api/envelopes', { ...envelope, queueTag: 'blocked' }, alice.token)).status, 403)
  })

  test('client logout and signed host revocation invalidate the intended sessions and close notifications', async () => {
    const first = await exchange(server.baseUrl, 'logout-user')
    const second = await exchange(server.baseUrl, 'logout-user')
    const unrelated = await exchange(server.baseUrl, 'logout-other')
    const ws = await socket(server.baseUrl, first.token)
    const closed = once(ws, 'close')
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/revoke', {}, first.token)).status, 200)
    await closed
    assert.equal((await call(server.baseUrl, '/api/friends', undefined, first.token)).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, second.token)).status, 200)
    const ws2 = await socket(server.baseUrl, second.token)
    const hostClosed = once(ws2, 'close')
    const unusedBeforeLogout = signed('logout-user')
    const assertion = signed('logout-user', { purpose: 'revoke' })
    assert.equal((await call(server.baseUrl, '/messaging/v1/host/revoke', { assertion })).status, 200)
    await hostClosed
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, second.token)).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/host/revoke', { assertion })).status, 409)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: unusedBeforeLogout })).status, 401)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, unrelated.token)).status, 200)
    const cutoffs = await server.db.query<{ revoked_before: string | number }>('SELECT revoked_before FROM host_identity_revocations WHERE issuer = $1 AND subject = $2', [fixtures[0].issuer, 'logout-user'])
    const freshAfter = (Number(cutoffs[0].revoked_before) + 1) * 1000
    await new Promise(resolve => setTimeout(resolve, Math.max(1, freshAfter - Date.now() + 5)))
    assert.equal((await exchange(server.baseUrl, 'logout-user')).account.id, first.account.id, 'fresh host login after cutoff must preserve the same messaging identity')
  })

  test('expired scoped credentials lose API and websocket access', async () => {
    const credential = await exchange(server.baseUrl, 'expires-user')
    await server.db.query('UPDATE sessions SET expires_at = now() + interval \'0.3 seconds\' WHERE token_hash = $1', [createHash('sha256').update(credential.token).digest('base64url')])
    const ws = await socket(server.baseUrl, credential.token)
    await once(ws, 'close')
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, credential.token)).status, 401)
    assert.equal((await call(server.baseUrl, '/api/friends', undefined, credential.token)).status, 401)
  })
})

test('public mapping, assertion replay protection and scoped session persist through relay restart', () => temporary(async root => {
  const dataDir = join(root, 'relay')
  let server = await startServer({ dataDir, hostIdentity: config })
  const assertion = signed('durable-host-user')
  const unusedBeforeLogout = signed('durable-revoked-user')
  try {
    const credential = await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion })
    assert.equal(credential.status, 200)
    assert.equal((await call(server.baseUrl, '/messaging/v1/host/revoke', { assertion: signed('durable-revoked-user', { purpose: 'revoke' }) })).status, 200)
    await server.close()
    server = await startServer({ dataDir, hostIdentity: config })
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion })).status, 409)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session/exchange', { assertion: unusedBeforeLogout })).status, 401)
    assert.equal((await exchange(server.baseUrl, 'durable-host-user')).account.id, credential.body.account.id)
    assert.equal((await call(server.baseUrl, '/messaging/v1/session', undefined, credential.body.token)).status, 200)
  } finally { await server.close() }
}))

test('migration2 preserves exact applied migration1 and existing legacy accounts/sessions', () => temporary(async root => {
  const dataDir = join(root, 'relay')
  const prior = new PGlite(dataDir)
  const checksum = createHash('sha256').update(SCHEMA).digest('hex')
  try {
    await prior.waitReady
    await prior.exec(SCHEMA)
    await prior.exec(`CREATE TABLE messaging_schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
    await prior.query('INSERT INTO messaging_schema_migrations (version, name, checksum) VALUES (1, $1, $2)', ['adopt-existing-relay-schema', checksum])
    await prior.query(`INSERT INTO accounts (id,handle,display_name,password_hash) VALUES ('legacy-user','legacy_user','Legacy user','synthetic-preserved-hash')`)
    await prior.query(`INSERT INTO sessions (token_hash,account_id) VALUES ('legacy-token-hash','legacy-user')`)
  } finally { await prior.close() }
  const current = await openDatabase(undefined, dataDir)
  try {
    assert.deepEqual(await current.query('SELECT version, name, checksum FROM messaging_schema_migrations WHERE version=1'), [{ version: 1, name: 'adopt-existing-relay-schema', checksum }])
    assert.deepEqual(await current.query('SELECT password_hash FROM accounts'), [{ password_hash: 'synthetic-preserved-hash' }])
    assert.deepEqual(await current.query('SELECT token_hash, scope, audience, expires_at FROM sessions'), [{ token_hash: 'legacy-token-hash', scope: null, audience: null, expires_at: null }])
    assert.equal((await current.query<{ count: number }>('SELECT count(*)::integer AS count FROM messaging_schema_migrations'))[0].count, 2)
  } finally { await current.close() }
}))
