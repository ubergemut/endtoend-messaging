import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { isAgentRequest } from '../src/index.ts'

test('the independent reference CLI sends JSON from stdin and retains its explicit operation ID', async () => {
  let calls = 0
  const server = createServer(async (request, response) => {
    calls += 1
    assert.equal(request.url, '/v1/command')
    assert.equal(request.headers.authorization, 'Bearer fixture-capability')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const command = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(isAgentRequest(command), true)
    assert.equal(command.operation, 'send')
    assert.equal(command.input.body, 'Reference CLI message')
    assert.equal(command.operationId, 'retained-cli-send')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ version: 1, requestId: command.requestId, ok: true, result: { id: 'same-message' } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('CLI fixture did not bind')
  const url = `http://127.0.0.1:${address.port}`
  async function run(args: string[], capability: string, input = '') {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../examples/reference-client.ts', import.meta.url)), ...args], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ENDTOEND_AGENT_URL: url, ENDTOEND_AGENT_CAPABILITY: capability },
    })
    let output = '', diagnostic = ''
    child.stdout!.on('data', bytes => { output += String(bytes) })
    child.stderr!.on('data', bytes => { diagnostic += String(bytes) })
    child.stdin!.end(input)
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    return { code, output, diagnostic }
  }
  try {
    const sent = await run(['send', '--input-file', '-', '--operation-id', 'retained-cli-send'], 'fixture-capability', JSON.stringify({ handle: 'alice', body: 'Reference CLI message' }))
    assert.equal(sent.code, 0)
    assert.deepEqual(JSON.parse(sent.output), { id: 'same-message' })
    assert.deepEqual(JSON.parse(sent.diagnostic), { operationId: 'retained-cli-send' })
    const denied = await run(['status'], '')
    assert.equal(denied.code, 1)
    assert.equal(JSON.parse(denied.diagnostic).error.code, 'unauthorized')
    assert.equal(calls, 1)
  } finally {
    server.closeIdleConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
