import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentClient, AgentError, type AgentTransport } from '@e2ee/client/standalone'
import { MESSAGING_PATHS, type AgentViews } from '@e2ee/protocol/standalone'
import { BrowserSession, readAttachment } from '../src/browserSession.ts'
import { acquireHostGrant, parseAgentConfig } from '../src/runtimeConfig.ts'
import { fileTooLarge } from '../src/media.ts'
import { Api } from '../src/api.ts'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function harness() {
  const state = { unlocked: true, fail: false, closed: false, views: undefined as undefined | Promise<AgentViews>, work: undefined as undefined | Promise<unknown> }
  const view = { messages: [{ id: 'private-message', body: 'plaintext' }], friends: [{ id: 'friend' }], groups: [{ id: 'group' }], seen: [], peers: {}, pendingTrust: null, revision: 1 } as unknown as AgentViews
  const transport: AgentTransport = {
    async request(request) {
      if (state.fail) return { version: 1, requestId: request.requestId, ok: false, error: { code: 'revoked', message: 'Synthetic revocation' } }
      const result = request.operation === 'status' ? { unlocked: state.unlocked }
        : request.operation === 'views' ? await (state.views ?? view)
        : request.operation === 'pendingSends' ? [{ operationId: 'pending', body: 'draft' }]
        : request.operation === 'lock' ? { unlocked: false }
        : await (state.work ?? Promise.resolve([]))
      return { version: 1, requestId: request.requestId, ok: true, result }
    },
    close() { state.closed = true },
  }
  const client = new AgentClient(transport)
  const session = new BrowserSession(client, { closed: false, focus() {} } as Window)
  return { session, state, view }
}

test('a locked status clears all presentation and rejects the just-completed plaintext result', async () => {
  const { session, state } = harness()
  await session.refreshView()
  assert.equal(session.view?.messages[0].body, 'plaintext')
  let invalidated = 0
  session.onInvalidated = () => { invalidated += 1 }
  await assert.rejects(session.perform(async () => { state.unlocked = false; return 'late-private-data' }), /Unlock/)
  assert.equal(session.view, null)
  assert.deepEqual([session.friendRecords, session.groupRecords, session.pendingRecords], [[], [], []])
  assert(invalidated > 0)
  await session.close()
})

test('a slow view cannot repopulate after another request observes locking', async () => {
  const { session, state, view } = harness()
  await session.refreshView()
  const waiting = deferred<AgentViews>()
  state.views = waiting.promise
  const refresh = session.refreshView()
  await new Promise(resolve => setImmediate(resolve))
  state.unlocked = false
  assert.equal((await session.status()).unlocked, false)
  waiting.resolve(view)
  await assert.rejects(refresh, /changed/)
  assert.equal(session.view, null)
  assert.deepEqual(session.pendingRecords, [])
  await session.close()
})

test('revocation clears cached data and terminates the local SDK capability', async () => {
  const { session, state } = harness()
  await session.refreshView()
  state.fail = true
  await assert.rejects(session.requests(), /revocation/)
  assert.equal(session.view, null)
  assert.deepEqual(session.groupRecords, [])
  assert.equal(state.closed, true)
  await assert.rejects(session.client.status(), error => (error as { code?: string }).code === 'revoked')
})

test('membership refusal preserves the account, messages and durable pending queue', async () => {
  const { session, state } = harness()
  await session.refreshView()
  let invalidated = false
  session.onInvalidated = () => { invalidated = true }
  await assert.rejects(session.perform(async () => { throw new AgentError('Membership changed', 'forbidden') }), /Membership changed/)
  assert.equal((await session.status()).unlocked, true)
  assert.equal(state.closed, false)
  assert.equal(invalidated, false)
  assert.equal(session.view?.messages[0].body, 'plaintext')
  assert.equal(session.pendingRecords[0].operationId, 'pending')
  await session.close()
})

test('upload network failure refreshes durable pending work without clearing presentation', async () => {
  const { session } = harness()
  await session.refreshView()
  let invalidated = false
  session.onInvalidated = () => { invalidated = true }
  await assert.rejects(session.perform(async () => { throw new Error('Synthetic media upload failed') }), /media upload failed/)
  assert.equal(invalidated, false)
  assert.equal(session.view?.messages[0].body, 'plaintext')
  assert.equal(session.pendingRecords[0].body, 'draft')
  await session.close()
})

test('attachment work cannot return after logout closes its presentation session', async () => {
  const { session, state } = harness()
  await session.refreshView()
  const waiting = deferred<unknown>()
  state.work = waiting.promise
  const attachment = readAttachment('synthetic-media')
  await session.close()
  waiting.resolve({ base64: 'cHJpdmF0ZQ==' })
  await assert.rejects(attachment, /cancelled|changed|closed/)
  assert.equal(await readAttachment('synthetic-media'), null)
})

test('runtime origins and host grant paths reject credential redirection and normalized paths', () => {
  const base = { agentUrl: 'https://agent.test', relayUrl: 'https://relay.test' }
  assert.deepEqual(parseAgentConfig(base, 'https://product.test'), base)
  for (const bad of ['http://remote.test', 'https://user:password@agent.test', 'https://agent.test/path', 'https://agent.test/?secret=x', 'https://agent.test/#x']) {
    assert.throws(() => parseAgentConfig({ ...base, agentUrl: bad }, 'https://product.test'))
    assert.throws(() => parseAgentConfig({ ...base, relayUrl: bad }, 'https://product.test'))
  }
  assert.throws(() => parseAgentConfig({ ...base, agentUrl: 'https://product.test' }, 'https://product.test'), /separate/)
  for (const grantPath of ['//evil.test/grant', 'https://evil.test/grant', '/grant?next=evil', '/grant#fragment', '/a/../grant', '/a/%2e%2e/grant', '/a\\grant', '/grant%2fmore']) {
    assert.throws(() => parseAgentConfig({ ...base, host: { audience: 'host-a', grantPath } }, 'https://product.test'), /same-origin path/)
  }
  assert.deepEqual(parseAgentConfig({ ...base, host: { audience: 'host-a', grantPath: '/api/messaging/grant' } }, 'https://product.test').host,
    { audience: 'host-a', grantPath: '/api/messaging/grant' })
  assert.deepEqual(parseAgentConfig({ ...base, audience: 'host-a', grantPath: '/api/messaging/grant', nativeAuth: false }, 'https://product.test').host,
    { audience: 'host-a', grantPath: '/api/messaging/grant' })
  assert.throws(() => parseAgentConfig({ ...base, nativeAuth: false }, 'https://product.test'), /host grant/)
  assert.throws(() => parseAgentConfig({ ...base, audience: 'host-a', grantPath: '/grant', host: { audience: 'host-b', grantPath: '/other' } }, 'https://product.test'), /Ambiguous/)
})

test('host cookies remain on the host request; relay metadata/bootstrap omit credentials', async () => {
  const original = globalThis.fetch
  const requests: { url: string; init?: RequestInit }[] = []
  const grant = { version: 1, protocolVersion: 1, audience: 'host-a', token: 'synthetic-token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    account: { id: 'account', handle: 'handle', displayName: 'Display' }, bootstrapPath: MESSAGING_PATHS.bootstrap }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    return Response.json(url === '/api/messaging/grant' ? grant : url.endsWith('/metadata')
      ? { version: 1, protocolVersion: 1, audience: 'host-a', endpoints: MESSAGING_PATHS }
      : { ...grant, enrolled: true, identityKey: 'public-key' })
  }
  try {
    const received = await acquireHostGrant({ agentUrl: 'https://agent.test', relayUrl: 'https://relay.test', host: { audience: 'host-a', grantPath: '/api/messaging/grant' } })
    assert.equal(received.account.id, 'account')
    assert.equal(requests.length, 3)
    for (const request of requests) {
      assert.equal(request.init?.redirect, 'error')
      assert.equal(request.init?.credentials, request.url.startsWith('https://relay.test/') ? 'omit' : 'same-origin')
      assert(!String(request.init?.body).includes('password'))
    }
    assert.equal(new Headers(requests[2].init?.headers).get('authorization'), 'Bearer synthetic-token')
    assert.equal(new Headers(requests[1].init?.headers).get('authorization'), null)
  } finally { globalThis.fetch = original }
})

test('host audience mismatch is refused before using its grant token', async () => {
  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return Response.json(requests === 1 ? { version: 1, protocolVersion: 1, audience: 'host-a', endpoints: MESSAGING_PATHS }
      : { version: 1, protocolVersion: 1, audience: 'other-host', token: 'synthetic-token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        account: { id: 'account', handle: 'handle', displayName: 'Display' }, bootstrapPath: MESSAGING_PATHS.bootstrap })
  }
  try {
    await assert.rejects(acquireHostGrant({ agentUrl: 'https://agent.test', relayUrl: 'https://relay.test', host: { audience: 'host-a', grantPath: '/grant' } }), /audience/)
    assert.equal(requests, 2)
  } finally { globalThis.fetch = original }
})

test('the preserved presentation file limit permits exactly 25 MiB', () => {
  assert.equal(fileTooLarge(25 * 1024 * 1024), false)
  assert.equal(fileTooLarge(25 * 1024 * 1024 + 1), true)
})

test('native logout retains its captured token while UI credentials are cleared', async () => {
  const originalFetch = globalThis.fetch
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://product.test' } })
  const requests: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    return Response.json(url === '/agent-config.json' ? { agentUrl: 'https://agent.test', relayUrl: 'https://relay.test' } : { ok: true })
  }
  try {
    const api = new Api('synthetic-native-token')
    const logout = api.request('/api/auth/logout', { method: 'POST', body: '{}' })
    api.setToken(null)
    await logout
    assert.equal(requests[1].url, 'https://relay.test/api/auth/logout')
    assert.equal(requests[1].init?.credentials, 'omit')
    assert.equal(new Headers(requests[1].init?.headers).get('authorization'), 'Bearer synthetic-native-token')
  } finally {
    globalThis.fetch = originalFetch
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
    else Reflect.deleteProperty(globalThis, 'location')
  }
})
