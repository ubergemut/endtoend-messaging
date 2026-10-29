import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpAgentTransport, RelayService, MESSAGING_PATHS, type AgentRequest } from '../src/index.ts'

test('default and injected Fetch receive globalThis for both HTTP transports', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  const receiverSensitiveFetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    assert.equal(this, globalThis, 'A native browser Fetch requires its Window receiver')
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'error')
    const pathname = new URL(String(input)).pathname
    calls.push(pathname)
    if (pathname === MESSAGING_PATHS.metadata) return Response.json({ version: 1, protocolVersion: 1, audience: 'receiver-fixture', endpoints: {
      exchange: MESSAGING_PATHS.exchange, bootstrap: MESSAGING_PATHS.bootstrap, revoke: MESSAGING_PATHS.revoke, hostRevoke: MESSAGING_PATHS.hostRevoke,
    } })
    const request = JSON.parse(String(init?.body)) as AgentRequest
    return Response.json({ version: 1, requestId: request.requestId, ok: true, result: { unlocked: false } })
  } as typeof fetch
  globalThis.fetch = receiverSensitiveFetch
  try {
    for (const fetcher of [undefined, receiverSensitiveFetch]) {
      const service = new RelayService('http://127.0.0.1:12345', { audience: 'receiver-fixture', ...(fetcher ? { fetcher } : {}) })
      assert.equal((await service.metadata()).audience, 'receiver-fixture')
      service.close()
      const transport = new HttpAgentTransport('http://127.0.0.1:12345', 'explicit-capability', fetcher)
      const response = await transport.request({ version: 1, requestId: crypto.randomUUID(), operation: 'status', input: {} })
      assert.equal(response.ok, true)
      transport.close()
    }
    assert.deepEqual(calls, [MESSAGING_PATHS.metadata, '/v1/command', MESSAGING_PATHS.metadata, '/v1/command'])
  } finally { globalThis.fetch = originalFetch }
})
