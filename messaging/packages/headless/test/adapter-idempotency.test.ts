import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentClient, HttpAgentTransport } from '@e2ee/client'
import { createDeviceSecret } from '@e2ee/session'
import { startLocalAgent } from '../../agent/src/local.ts'
import { startReferenceRelay } from '../../agent/test/reference-relay.ts'
import { openHeadless } from '../src/client.ts'
import { startHttp } from '../src/http.ts'
import { startGraphql } from '../src/graphql.ts'
import { handleMcp } from '../src/mcp.ts'

test('HTTP, GraphQL and MCP retain caller operation IDs when retrying direct, group and file sends', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'adapter-idempotency-'))
  const relay = await startReferenceRelay()
  const first = await startLocalAgent({ relay: relay.baseUrl, vaultPath: path.join(dir, 'a.json'), deviceKey: createDeviceSecret() })
  const second = await startLocalAgent({ relay: relay.baseUrl, vaultPath: path.join(dir, 'b.json'), deviceKey: createDeviceSecret() })
  const alice = openHeadless({ relay: relay.baseUrl, vaultPath: path.join(dir, 'a.json'), agentUrl: first.url, agentCapability: first.capability })
  const bob = new AgentClient(new HttpAgentTransport(second.url, second.capability))
  const http = await startHttp(alice), graph = await startGraphql(alice)
  const post = async (endpoint: string, input: Record<string, unknown>) => {
    const response = await fetch(http.url + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${http.capability}` }, body: JSON.stringify(input) })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result as { id: string }
  }
  const mutation = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetch(graph.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${graph.capability}` }, body: JSON.stringify({ query, variables }) })
    assert.equal(response.status, 200)
    return response.json() as Promise<{ data?: Record<string, { id: string }>; errors?: { message: string }[] }>
  }
  try {
    await alice.unlock({ handle: 'adapter_alice', password: 'fixture-password' })
    await bob.unlock({ handle: 'adapter_bob', password: 'fixture-password' })
    await alice.requestFriend('adapter_bob')
    await bob.respondRequest((await bob.requests())[0].id, 'accept')
    await alice.sync()

    const directId = crypto.randomUUID(), direct = { handle: 'adapter_bob', body: 'one direct intent', operationId: directId }
    const sent = await post('/messages', direct)
    assert.equal(sent.id, directId)
    assert.equal((await post('/messages', direct)).id, directId)
    const sendQuery = 'mutation($id: String!, $body: String!) { send(handle: "adapter_bob", body: $body, operationId: $id) }'
    const repeated = await mutation(sendQuery, { id: directId, body: direct.body })
    assert.equal(repeated.errors, undefined)
    assert.equal(repeated.data?.send.id, directId)
    const conflicting = await mutation(sendQuery, { id: directId, body: 'different content' })
    assert.match(conflicting.errors?.[0].message ?? '', /different content/)

    const group = await alice.createGroup('adapter group', ['adapter_bob'])
    for (let round = 0; round < 2; round++) { await bob.sync(); await alice.sync() }
    const groupId = crypto.randomUUID(), groupInput = { groupId: group.id, body: 'one group intent', operationId: groupId }
    assert.equal((await post('/groups/messages', groupInput)).id, groupId)
    const repeatedGroup = await mutation('mutation($group: String!, $id: String!) { sendGroup(groupId: $group, body: "one group intent", operationId: $id) }', { group: group.id, id: groupId })
    assert.equal(repeatedGroup.errors, undefined)
    assert.equal(repeatedGroup.data?.sendGroup.id, groupId)

    const fileId = crypto.randomUUID(), file = { handle: 'adapter_bob', name: 'intent.bin', mime: 'application/octet-stream', base64: 'AP8BAg==', body: 'one file intent', operationId: fileId }
    assert.equal((await post('/files', file)).id, fileId)
    const repeatedFile = await mutation('mutation($id: String!) { sendFile(handle: "adapter_bob", name: "intent.bin", mime: "application/octet-stream", base64: "AP8BAg==", body: "one file intent", operationId: $id) }', { id: fileId })
    assert.equal(repeatedFile.errors, undefined)
    assert.equal(repeatedFile.data?.sendFile.id, fileId)
    const mcp = await handleMcp(alice, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sendFile', arguments: file } }) as { result: { content: { text: string }[] } }
    assert.equal(JSON.parse(mcp.result.content[0].text).id, fileId)

    await bob.sync()
    const messages = await bob.messages()
    for (const id of [directId, groupId, fileId]) assert.equal(messages.filter(message => message.id === id).length, 1)
    const attachment = (await bob.views()).messages.find(message => message.id === fileId)!.attachments![0]
    assert.deepEqual(await bob.attachment(attachment.mediaId), new Uint8Array([0, 255, 1, 2]))
  } finally {
    await http.close(); await graph.close(); await alice.close(); await bob.close()
    await first.close(); await second.close(); await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})
