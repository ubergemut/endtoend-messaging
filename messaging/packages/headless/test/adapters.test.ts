import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import test from 'node:test'
import { openHeadless } from '../src/client.ts'
import { operations } from '../src/catalog.ts'
import { startHttp } from '../src/http.ts'
import { handleMcp } from '../src/mcp.ts'
import { executeGraph, startGraphql } from '../src/graphql.ts'
import { testAgentOptions } from './agent-options.ts'

test('direct, HTTP, MCP, and GraphQL expose the same operations', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-headless-'))
  const client = openHeadless({ ...testAgentOptions, relay: 'http://127.0.0.1:9', vaultPath: path.join(dir, 'vault.json') })
  const http = await startHttp(client)
  const graph = await startGraphql(client)
  let gated: Awaited<ReturnType<typeof startHttp>> | undefined
  try {
    const status = await client.status()
    assert.equal(status.unlocked, false)

    const listed = await handleMcp(client, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const tools = (listed as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)
    assert.deepEqual(tools, operations.map((operation) => operation.name))

    const called = await handleMcp(client, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'status', arguments: {} },
    })
    const text = (called as { result: { content: { text: string }[] } }).result.content[0].text
    assert.equal(JSON.parse(text).unlocked, false)

    const queried = await executeGraph(client, '{ status }')
    assert.equal((queried.data?.status as { unlocked: boolean }).unlocked, false)

    const health = await fetch(`${http.url}/health`)
    assert.equal(health.status, 200)
    const deniedDefault = await fetch(`${http.url}/status`)
    assert.equal(deniedDefault.status, 401)
    const deniedGraph = await fetch(graph.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ status }' }) })
    assert.equal(deniedGraph.status, 401)
    assert.ok((await deniedGraph.json()).errors[0].message)
    const authorization = { authorization: `Bearer ${http.capability}` }
    const overHttp = await fetch(`${http.url}/status`, { headers: authorization })
    assert.equal((await overHttp.json()).unlocked, false)
    const locked = await fetch(`${http.url}/messages`, { headers: authorization })
    assert.equal(locked.status, 401)

    const overGraph = await fetch(graph.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${graph.capability}` },
      body: JSON.stringify({ query: '{ chats }' }),
    })
    const graphBody = await overGraph.json()
    assert.match(graphBody.errors[0].message, /unlock/i)

    gated = await startHttp(client, { gate: 'gate-token' })
    const denied = await fetch(`${gated.url}/status`)
    assert.equal(denied.status, 401)
    const allowed = await fetch(`${gated.url}/status`, { headers: { authorization: 'Bearer gate-token' } })
    assert.equal(allowed.status, 200)
    const browser = await fetch(`${gated.url}/status`, { headers: { authorization: 'Bearer gate-token', origin: 'https://untrusted.example' } })
    assert.equal(browser.status, 403)
    const rebindingStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${gated!.url}/status`, { headers: { authorization: 'Bearer gate-token', host: 'foreign.example' } }, response => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      request.on('error', reject)
      request.end()
    })
    assert.equal(rebindingStatus, 403)
    await gated.close()
    gated = undefined
  } finally {
    await gated?.close()
    await http.close()
    await graph.close()
    await client.close()
    await rm(dir, { recursive: true, force: true })
  }
})
