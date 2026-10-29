import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import test from 'node:test'
import { startServer } from '../../../apps/api/src/server.ts'
import { createDeviceSecret, isSealedRecord } from '@e2ee/session'
import { openHeadless } from '../src/client.ts'
import type { PublicMessage } from '../src/types.ts'
import { testAgentOptions } from './agent-options.ts'

test('two headless devices exchange plaintext the relay cannot read', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'endtoend-headless-live-'))
  const posted: string[] = []
  const relay = await startServer({ dataDir: path.join(dir, 'db') })
  // Observe requests at the relay boundary, independently of the parent/agent process boundary.
  const spy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString('utf8')
      if (request.method === 'POST') posted.push(body)
      const upstream = await fetch(`${relay.baseUrl}${request.url}`, {
        method: request.method,
        headers: { ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), 'content-type': 'application/json' },
        ...(body ? { body } : {}),
      })
      response.writeHead(upstream.status, { 'content-type': 'application/json' })
      response.end(await upstream.text())
    } catch { response.writeHead(500).end() }
  })
  await new Promise<void>(resolve => spy.listen(0, '127.0.0.1', resolve))
  const address = spy.address()
  if (!address || typeof address === 'string') throw new Error('Relay spy failed to bind')
  const relayUrl = `http://127.0.0.1:${address.port}`
  const stamp = Date.now().toString(36)
  const note = `note ${stamp} meet by the cedar`
  const fromA = `from ${stamp} the lantern is lit`
  const fromB = `from ${stamp} the gate is open`
  const alicePath = path.join(dir, 'alice.json')
  const alice = openHeadless({ ...testAgentOptions, relay: relayUrl, vaultPath: alicePath, deviceKey: createDeviceSecret() })
  const bob = openHeadless({ ...testAgentOptions, relay: relayUrl, vaultPath: path.join(dir, 'bob.json'), deviceKey: createDeviceSecret() })
  try {
    await alice.unlock({ handle: `ha${stamp}`, password: 'correct-horse' })
    await bob.unlock({ handle: `hb${stamp}`, password: 'correct-horse' })
    await alice.requestFriend(`hb${stamp}`, note)
    const incoming = await bob.requests()
    assert.equal(incoming[0]?.note, note)
    await bob.respondRequest(incoming[0].id, 'accept')
    await alice.sync()

    const sent = await alice.send({ handle: `hb${stamp}`, body: fromA })
    assert.ok(sent.serverCiphertext)
    assert.equal(sent.serverCiphertext!.includes(fromA), false)

    const arrived = await bob.sync()
    assert.equal(arrived.messages[0]?.body, fromA)
    const reply = await bob.send({ handle: `ha${stamp}`, body: fromB, replyTo: sent.id })
    assert.equal(reply.replyTo, sent.id)
    assert.equal(reply.serverCiphertext!.includes(fromB), false)

    const back = await alice.sync()
    const threaded = back.messages.find((message) => message.body === fromB) as PublicMessage
    assert.equal(threaded.replyTo, sent.id)
    const focus = await alice.focus({ handle: `hb${stamp}` })
    assert.equal(focus.threadId, sent.id)
    assert.equal(focus.message?.id, threaded.id)
    const chats = await alice.chats()
    assert.equal(chats[0]?.unseen, 1)
    await alice.markSeen([threaded.id])
    const after = await alice.chats()
    assert.equal(after[0]?.unseen, 0)

    const relayText = posted.join('\n')
    assert.equal(relayText.includes(note), false)
    assert.equal(relayText.includes(fromA), false)
    assert.equal(relayText.includes(fromB), false)
    assert.ok(posted.length >= 2)
    const stored = JSON.parse(await readFile(alicePath, 'utf8')) as unknown
    assert.equal(isSealedRecord(stored), true)
    assert.equal(JSON.stringify(stored).includes(fromA), false)
    assert.equal(JSON.stringify(stored).includes(fromB), false)
  } finally {
    await alice.close()
    await bob.close()
    await new Promise<void>((resolve, reject) => spy.close(error => error ? reject(error) : resolve()))
    await relay.close()
    await rm(dir, { recursive: true, force: true })
  }
})
