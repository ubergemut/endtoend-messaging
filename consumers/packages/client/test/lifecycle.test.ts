import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageChannel } from 'node:worker_threads'
import { AgentClient, MessagePortTransport, HttpAgentTransport, type AgentRequest } from '../src/index.ts'
const command = (id: string): AgentRequest => ({ version: 1, requestId: id, operation: 'status', input: {} })
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('port cancellation ignores late replies and forbids reused request IDs', async () => {
  const channel = new MessageChannel()
  const transport = new MessagePortTransport(channel.port1 as unknown as MessagePort, 1000)
  const aborted = new AbortController()
  try {
    const first = transport.request(command('first'), { signal: aborted.signal })
    const rejected = assert.rejects(first, code('cancelled'))
    aborted.abort()
    await rejected
    channel.port2.postMessage({ version: 1, requestId: 'first', ok: true, result: 'late' })
    await assert.rejects(transport.request(command('first')), code('invalid'))
    const second = transport.request(command('second'))
    channel.port2.postMessage({ version: 1, requestId: 'second', ok: true, result: 'current' })
    assert.deepEqual(await second, { version: 1, requestId: 'second', ok: true, result: 'current' })
  } finally { transport.close(); channel.port2.close() }
})

test('event unsubscription and revocation clear pending calls and close the port', async () => {
  const channel = new MessageChannel()
  const transport = new MessagePortTransport(channel.port1 as unknown as MessagePort)
  const events: string[] = []
  let firstEvent!: () => void
  const received = new Promise<void>(resolve => { firstEvent = resolve })
  const unsubscribe = transport.subscribe(event => { events.push(event.event); firstEvent() })
  channel.port2.postMessage({ version: 1, event: 'views', revision: 1 })
  await received
  unsubscribe()
  channel.port2.postMessage({ version: 1, event: 'views', revision: 2 })
  const pending = assert.rejects(transport.request(command('pending')), code('revoked'))
  channel.port2.postMessage({ version: 1, event: 'revoked', revision: 3 })
  await pending
  assert.deepEqual(events, ['views'])
  await assert.rejects(transport.request(command('after')), code('closed'))
  transport.close(); channel.port2.close()
})

test('client close and per-call cancellation reject even a transport that ignores aborts', async () => {
  const replies: ((value: any) => void)[] = []
  const client = new AgentClient({ request: () => new Promise(resolve => { replies.push(resolve) }) })
  const cancellation = new AbortController()
  const first = assert.rejects(client.command('status', {}, { signal: cancellation.signal }), code('cancelled'))
  cancellation.abort()
  await first
  const second = assert.rejects(client.call('status'), code('closed'))
  await client.close()
  await second
  for (const reply of replies) reply({ version: 1, requestId: 'late', ok: true, result: 'stale' })
  await tick()
  await assert.rejects(client.status(), code('closed'))
})

test('HTTP lifecycle omits cookies, refuses redirects and aborts on close', async () => {
  let signal: AbortSignal | undefined
  const fetcher = (async (_url: unknown, options: RequestInit) => {
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal((options.headers as Record<string, string>).authorization, 'Bearer explicit-capability')
    signal = options.signal!
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
  }) as typeof fetch
  const transport = new HttpAgentTransport('http://127.0.0.1:23456', 'explicit-capability', fetcher)
  const pending = assert.rejects(transport.request(command('http')), code('closed'))
  transport.close()
  await pending
  assert.equal(signal?.aborted, true)
  await assert.rejects(transport.request(command('after')), code('closed'))
  assert.throws(() => new HttpAgentTransport('https://example.com', 'capability'))
  assert.throws(() => new HttpAgentTransport('http://localhost/?token=secret', 'capability'))
})

test('typed calls retain stable operation IDs and reject mismatched responses', async () => {
  const client = new AgentClient({ async request(request) {
    assert.equal(request.operation, 'send')
    assert.equal(request.operationId, 'retained-intent')
    return { version: 1, requestId: 'another-request', ok: true, result: {} }
  } })
  await assert.rejects(client.send({ handle: 'bob', body: 'unchanged intent' }, 'retained-intent'), code('protocol'))
  await client.close()
})

test('local client revocation clears pending calls and blocks subsequent use', async () => {
  const client = new AgentClient({ request: () => new Promise(() => {}) })
  const pending = assert.rejects(client.status(), code('revoked'))
  await client.revoke()
  await pending
  await assert.rejects(client.sync(), code('revoked'))
  await client.close()
})
