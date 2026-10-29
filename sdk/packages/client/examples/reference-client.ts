#!/usr/bin/env -S node --import tsx
/** MIT. A small independent protocol client; no agent, session or cryptographic implementation imports. */
import { readFile } from 'node:fs/promises'
import { AgentClient, AgentError, HttpAgentTransport } from '../src/index.ts'

const args = process.argv.slice(2)
const operation = args.shift()
if (!operation || operation === '--help' || operation === 'help') {
  process.stdout.write(`EndToEnd reference protocol client

Environment:
  ENDTOEND_AGENT_URL          Independent local agent URL
  ENDTOEND_AGENT_CAPABILITY   Local capability from the runner

Usage:
  node --import tsx packages/client/examples/reference-client.ts status
  node --import tsx packages/client/examples/reference-client.ts <operation> [--input-file <JSON file or ->] [--operation-id <retained ID>]

Commands and results use protocol v1. Input defaults to {}. Use - to read JSON from stdin.
For send operations, a generated or supplied durable operation ID is printed to stderr before sending.
Retain that ID and the same input when retrying an uncertain delivery. Results go to stdout.
Unlock secrets belong in the trusted browser agent or an authorized local automation session.
`)
} else {
  let client: AgentClient | undefined
  try {
    let inputFile: string | undefined
    let operationId: string | undefined
    while (args.length) {
      const flag = args.shift()
      const value = args.shift()
      if (!value) throw new AgentError(`Missing value for ${flag}`, 'invalid')
      if (flag === '--input-file') inputFile = value
      else if (flag === '--operation-id') operationId = value
      else throw new AgentError(`Unknown option ${flag}`, 'invalid')
    }
    let input: Record<string, unknown> = {}
    if (inputFile) {
      let raw: string
      if (inputFile === '-') {
        const chunks: Buffer[] = []
        let length = 0
        for await (const bytes of process.stdin) {
          length += bytes.length
          if (length > 40 * 1024 * 1024) throw new AgentError('Input exceeds 40 MiB', 'invalid')
          chunks.push(Buffer.from(bytes))
        }
        raw = Buffer.concat(chunks).toString('utf8')
      } else raw = await readFile(inputFile, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AgentError('Input must be a JSON object', 'invalid')
      input = parsed as Record<string, unknown>
    }
    const url = process.env.ENDTOEND_AGENT_URL
    const capability = process.env.ENDTOEND_AGENT_CAPABILITY
    if (!url || !capability) throw new AgentError('Set ENDTOEND_AGENT_URL and ENDTOEND_AGENT_CAPABILITY from the independent runner', 'unauthorized')
    client = new AgentClient(new HttpAgentTransport(url, capability))
    if (['send', 'sendGroup', 'sendFile', 'sendAttachments'].includes(operation)) {
      operationId ??= crypto.randomUUID()
      process.stderr.write(`${JSON.stringify({ operationId })}\n`)
    }
    const result = await client.call(operation, input, operationId)
    await new Promise<void>((resolve, reject) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, error => error ? reject(error) : resolve()))
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error instanceof AgentError ? error.code : 'invalid', message: error instanceof Error ? error.message : 'Reference client failed' } })}\n`)
    process.exitCode = 1
  } finally { await client?.close() }
}
