/** Integration of the MIT client with independent AGPL agent/relay test programs. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AgentClient, HttpAgentTransport, bytesToBase64 } from '../src/index.ts'
import { startReferenceRelay } from '../../agent/test/reference-relay.ts'

test('independent clients exchange direct messages and exact file bytes through the reference relay', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'endtoend-reference-client-'))
  const relay = await startReferenceRelay()
  const running: { client: AgentClient; child: ChildProcess }[] = []
  async function launch(name: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../agent/src/bin.ts', import.meta.url))], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
        ...process.env, ENDTOEND_RELAY: relay.baseUrl, ENDTOEND_VAULT: path.join(directory, `${name}.json`),
        ENDTOEND_DEVICE_KEY: randomBytes(32).toString('base64'), ENDTOEND_PARENT_PID: String(process.pid),
      },
    })
    const transport = await new Promise<HttpAgentTransport>((resolve, reject) => {
      let output = '', diagnostic = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('Reference agent startup timed out')) }, 30_000)
      child.stderr!.on('data', bytes => { diagnostic = (diagnostic + String(bytes)).slice(-2000) })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Reference agent exited (${code}): ${diagnostic}`)) })
      child.stdout!.on('data', bytes => {
        output += String(bytes)
        const newline = output.indexOf('\n')
        if (newline < 0) return
        clearTimeout(timer)
        try {
          const ready = JSON.parse(output.slice(0, newline))
          assert.equal(ready.version, 1)
          assert.equal(ready.type, 'agent-ready')
          resolve(new HttpAgentTransport(ready.url, ready.capability))
        } catch (error) { child.kill(); reject(error) }
      })
    })
    const client = new AgentClient(transport)
    running.push({ client, child })
    return client
  }
  try {
    const alice = await launch('alice'), bob = await launch('bob')
    await alice.unlock({ handle: 'reference_alice', password: 'reference-test-only' })
    await bob.unlock({ handle: 'reference_bob', password: 'reference-test-only' })
    await alice.requestFriend('reference_bob', 'reference encrypted note')
    const requests = await bob.requests()
    assert.equal(requests[0].note, 'reference encrypted note')
    await bob.respondRequest(requests[0].id, 'accept')
    await alice.sync()

    const sent = await alice.send({ handle: 'reference_bob', body: 'Independent reference message' }, 'reference-direct-1')
    const retried = await alice.send({ handle: 'reference_bob', body: 'Independent reference message' }, 'reference-direct-1')
    assert.equal(retried.id, sent.id)
    await assert.rejects(alice.send({ handle: 'reference_bob', body: 'Changed attempt' }, 'reference-direct-1'), /different content/)
    assert.ok(sent.serverCiphertext)
    assert.equal(sent.serverCiphertext.includes('Independent reference message'), false)
    const received = await bob.sync()
    assert.equal(received.messages.find(message => message.id === sent.id)?.body, 'Independent reference message')
    assert.equal((await bob.messages()).filter(message => message.id === sent.id).length, 1)

    const file = Uint8Array.from([0, 1, 2, 17, 128, 255, 10])
    const attached = await alice.sendFile({ handle: 'reference_bob', body: 'Independent file', name: 'exact.bin', mime: 'application/octet-stream', base64: bytesToBase64(file) }, 'reference-file-1')
    await bob.sync()
    const views = await bob.views()
    const message = views.messages.find(message => message.id === attached.id)!
    const descriptor = message.attachments![0]
    assert.equal(descriptor.name, 'exact.bin')
    assert.deepEqual(Object.keys(descriptor).sort(), ['mediaId', 'mime', 'name'])
    assert.deepEqual(await bob.attachment(descriptor.mediaId), file)
    assert.equal(JSON.stringify(views).includes('accessKey'), false)
    assert.equal(JSON.stringify(views).includes('pendingPublication'), false)
  } finally {
    for (const { client, child } of running) {
      await client.call('close').catch(() => undefined)
      await client.close()
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { child.kill(); resolve() }, 3000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
    }
    await relay.close()
    await rm(directory, { recursive: true, force: true })
  }
})
