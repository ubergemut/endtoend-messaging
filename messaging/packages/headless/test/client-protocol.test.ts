import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageChannel } from 'node:worker_threads'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  AgentClient, AgentError, HttpAgentTransport, MessagePortTransport, LEGACY_OPERATIONS,
  isAgentRequest, isAgentResponse, bytesToBase64, base64ToBytes, type AgentRequest,
} from '@e2ee/client'
import { operations, readInput, findOperation } from '../src/catalog.ts'

test('the wire contract preserves the 21 published adapters and rejects malformed envelopes', () => {
  assert.deepEqual(operations.map(operation => operation.name), [...LEGACY_OPERATIONS])
  const request = { version: 1, requestId: 'request', operation: 'status', input: {} }
  assert.equal(isAgentRequest(request), true)
  assert.equal(isAgentRequest({ ...request, version: 2 }), false)
  assert.equal(isAgentRequest({ ...request, input: [] }), false)
  assert.equal(isAgentRequest({ ...request, operation: '../private' }), false)
  assert.equal(isAgentResponse({ version: 1, requestId: 'request', ok: false, error: { code: 'locked', message: 'Unlock' } }), true)
  assert.equal(isAgentResponse({ version: 1, requestId: 'request', ok: true }), false)
  assert.throws(() => readInput(findOperation('send'), { handle: 'alice', body: 'hello', expiresInSeconds: 'NaN' }), /integer/)
})

test('client preserves explicit durable operation IDs and rejects mismatched replies', async () => {
  const requests: AgentRequest[] = []
  const client = new AgentClient({ async request(request) {
    requests.push(request)
    return { version: 1, requestId: request.requestId, ok: true, result: { id: 'message' } }
  } })
  await client.send({ handle: 'alice', body: 'hello' }, 'durable-send')
  await client.send({ handle: 'alice', body: 'hello' }, 'durable-send')
  assert.equal(requests[0].operationId, 'durable-send')
  assert.equal(requests[1].operationId, 'durable-send')
  assert.notEqual(requests[0].requestId, requests[1].requestId)
  const wrong = new AgentClient({ async request() { return { version: 1, requestId: 'another-request', ok: true, result: {} } } })
  await assert.rejects(wrong.status(), (error: unknown) => error instanceof AgentError && error.code === 'protocol')
  const locked = new AgentClient({ async request(request) { return { version: 1, requestId: request.requestId, ok: false, error: { code: 'locked', message: 'Unlock first' } } } })
  await assert.rejects(locked.status(), (error: unknown) => error instanceof AgentError && error.code === 'locked')
})

test('HTTP transport requires loopback and capability and never follows redirects or includes cookies', async () => {
  assert.throws(() => new HttpAgentTransport('http://example.com', 'capability'), /loopback/)
  assert.throws(() => new HttpAgentTransport('http://127.0.0.1:1234', ''), /capability/)
  let called = false
  const transport = new HttpAgentTransport('http://127.0.0.1:1234', 'scoped-secret', (async (url, init) => {
    called = true
    assert.equal(url, 'http://127.0.0.1:1234/v1/command')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.credentials, 'omit')
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer scoped-secret')
    const request = JSON.parse(String(init?.body))
    return Response.json({ version: 1, requestId: request.requestId, ok: true, result: { unlocked: false } })
  }) as typeof fetch)
  const status = await new AgentClient(transport).status()
  assert.equal(status.unlocked, false)
  assert.equal(called, true)
})

test('MessagePort transport correlates concurrent replies and fails pending calls on close', async () => {
  const { port1, port2 } = new MessageChannel()
  const transport = new MessagePortTransport(port1 as unknown as MessagePort, 1000)
  const client = new AgentClient(transport)
  const received: AgentRequest[] = []
  port2.on('message', request => {
    received.push(request)
    if (received.length === 2) {
      for (const pending of [...received].reverse()) port2.postMessage({ version: 1, requestId: pending.requestId, ok: true, result: pending.operation })
    }
  })
  assert.deepEqual(await Promise.all([client.call('first'), client.call('second')]), ['first', 'second'])
  const pending = client.call('third')
  const rejection = assert.rejects(pending, (error: unknown) => error instanceof AgentError && error.code === 'closed')
  await client.close()
  await rejection
  port2.close()
})

test('MessagePort timeout ends the request without inventing another send operation', async () => {
  const { port1, port2 } = new MessageChannel()
  const client = new AgentClient(new MessagePortTransport(port1 as unknown as MessagePort, 15))
  await assert.rejects(client.send({ handle: 'alice', body: 'hello' }, 'keep-for-retry'), (error: unknown) => error instanceof AgentError && error.code === 'timeout')
  await client.close()
  port2.close()
  const bytes = new Uint8Array([0, 1, 127, 128, 255])
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes)
})

test('consumer runtime source contains no protected package imports or crypto artifacts', async () => {
  for (const relative of ['../src/', '../../client/src/', '../../protocol/src/']) {
    const directory = new URL(relative, import.meta.url)
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.ts')) continue
      const source = await readFile(new URL(name, directory), 'utf8')
      assert.doesNotMatch(source, /(?:from\s*|import\s*\()["'](?:@e2ee\/(?:crypto|session|agent)|[^"']*vendor\/session)/, fileURLToPath(new URL(name, directory)))
    }
  }
})
