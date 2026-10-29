import assert from 'node:assert/strict'
import test from 'node:test'
import { RelayService, MESSAGING_PATHS } from '../src/index.ts'
const audience = 'example-messaging'
const identity = { id: 'account-123', handle: 'alice', displayName: 'Alice' }
const expiry = () => new Date(Date.now() + 60_000).toISOString()
const metadata = () => ({ version: 1, protocolVersion: 1, audience, endpoints: {
  exchange: MESSAGING_PATHS.exchange, bootstrap: MESSAGING_PATHS.bootstrap, revoke: MESSAGING_PATHS.revoke, hostRevoke: MESSAGING_PATHS.hostRevoke,
} })
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected

test('service discovery, exchange, bootstrap and revocation use only configured origin and explicit tokens', async () => {
  const calls: string[] = []
  const service = new RelayService('https://messaging.example', { audience, fetcher: (async (url, options) => {
    const path = new URL(String(url)).pathname
    assert.equal(new URL(String(url)).origin, 'https://messaging.example')
    assert.equal(options!.credentials, 'omit')
    assert.equal(options!.redirect, 'error')
    assert.equal(options!.cache, 'no-store')
    const headers = options!.headers as Record<string, string>
    if (path === MESSAGING_PATHS.bootstrap || path === MESSAGING_PATHS.revoke) assert.equal(headers.authorization, 'Bearer messaging-token')
    else assert.equal(headers.authorization, undefined)
    calls.push(path)
    let body: unknown = { ok: true }
    if (path === MESSAGING_PATHS.metadata) body = metadata()
    if (path === MESSAGING_PATHS.exchange) {
      assert.deepEqual(JSON.parse(String(options!.body)), { assertion: 'payload.signature' })
      body = { version: 1, protocolVersion: 1, audience, account: identity, token: 'messaging-token', expiresAt: expiry(), bootstrapPath: MESSAGING_PATHS.bootstrap }
    }
    if (path === MESSAGING_PATHS.bootstrap) body = { version: 1, protocolVersion: 1, audience, account: identity, enrolled: true, identityKey: 'public-identity', expiresAt: expiry() }
    return Response.json(body)
  }) as typeof fetch })
  assert.equal((await service.metadata()).audience, audience)
  const grant = await service.exchange('payload.signature')
  assert.deepEqual(service.attachInput(grant, 'tab'), { relay: 'https://messaging.example', token: 'messaging-token', expectedAccountId: identity.id,
    authorization: { audience, bootstrapPath: MESSAGING_PATHS.bootstrap }, stay: 'tab' })
  assert.equal((await service.session(grant.token)).account.id, identity.id)
  assert.deepEqual(await service.revoke(grant.token), { ok: true })
  assert.deepEqual(await service.hostRevoke('payload.signature'), { ok: true })
  assert.equal(calls.length, 5)
  service.close()
  await assert.rejects(service.metadata(), code('closed'))
})

test('service rejects unsafe configuration, endpoint substitution and wrong audience', async () => {
  for (const url of ['http://messaging.example', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=secret'])
    assert.throws(() => new RelayService(url, { audience }))
  assert.throws(() => new RelayService('https://example.com', { audience: '' }))
  for (const reply of [{ ...metadata(), audience: 'other' }, { ...metadata(), protocolVersion: 2 }, { ...metadata(), endpoints: { ...metadata().endpoints, exchange: 'https://another.example/' } }]) {
    const service = new RelayService('http://127.0.0.1:12345', { audience, fetcher: (async () => Response.json(reply)) as typeof fetch })
    await assert.rejects(service.metadata(), code('protocol'))
  }
})

test('audience bounds match the relay and agent while preserving opaque Unicode and whitespace', () => {
  for (const value of ['x'.repeat(201), 'x'.repeat(256), 'messaging-\u03b1-\u6771\u4eac', ' exact audience ']) {
    const service = new RelayService('https://messaging.example', { audience: value })
    assert.equal(service.audience, value)
    service.close()
  }
  for (const value of ['', '   ', 'x'.repeat(257), 'audience\n', 'audience\u0000', 'audience\u007f'])
    assert.throws(() => new RelayService('https://messaging.example', { audience: value }))
})

test('service bounds responses and rejects malformed credentials or expired grants before attach', async () => {
  const service = new RelayService('https://messaging.example', { audience, maxResponseBytes: 64,
    fetcher: (async () => Response.json({ unexpected: 'x'.repeat(100) })) as typeof fetch })
  await assert.rejects(service.metadata(), code('protocol'))
  await assert.rejects(service.session('token\ncredential'), code('unauthorized'))
  await assert.rejects(service.exchange('not a compact assertion'), code('invalid'))
  assert.throws(() => service.attachInput({ version: 1, protocolVersion: 1, audience, account: identity, token: 'token',
    expiresAt: new Date(0).toISOString(), bootstrapPath: MESSAGING_PATHS.bootstrap }))
})

test('service cancellation and close abort the current request without returning stale bootstrap', async () => {
  let received: AbortSignal | undefined
  const service = new RelayService('https://messaging.example', { audience, fetcher: (async (_url, options) => {
    received = options!.signal!
    return new Promise<Response>((_resolve, reject) => received!.addEventListener('abort', () => reject(received!.reason), { once: true }))
  }) as typeof fetch })
  const cancel = new AbortController()
  const pending = assert.rejects(service.session('explicit-token', { signal: cancel.signal }), code('cancelled'))
  cancel.abort()
  await pending
  assert.equal(received?.aborted, true)
  const closing = assert.rejects(service.metadata(), code('closed'))
  service.close()
  await closing
})
