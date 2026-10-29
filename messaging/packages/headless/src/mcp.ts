import readline from 'node:readline'
import type { HeadlessClient } from './client.ts'
import { operations, readInput } from './catalog.ts'
import { HeadlessError } from './types.ts'
import {adapterDisclosure} from './sourceInfo.ts'

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> }

const protocolVersion = '2024-11-05'

export async function handleMcp(client: HeadlessClient, message: Rpc, sourceMetadata?:Awaited<ReturnType<typeof adapterDisclosure>>['metadata']) {
  if (!message.method || message.id == null) return null
  try {
    if (message.method === 'initialize') {
      const metadata=sourceMetadata??(await adapterDisclosure({publicBaseRequired:true})).metadata
      return ok(message.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'endtoend', version: metadata.version },
        instructions:`EndToEnd messaging is AGPL-3.0-only; the independent transport SDK is MIT. Corresponding source: ${metadata.sourceUrl??'development build; no release source configured'}.`,
        _meta:{licenseInfo:metadata},
      })
    }
    if (message.method === 'ping') return ok(message.id, {})
    if (message.method === 'tools/list') {
      return ok(message.id, {
        tools: operations.map((operation) => ({
          name: operation.name,
          description: operation.summary,
          inputSchema: inputSchema(operation.fields),
        })),
      })
    }
    if (message.method === 'tools/call') {
      const params = message.params ?? {}
      const name = String(params.name ?? '')
      const operation = operations.find((item) => item.name === name)
      if (!operation) throw new HeadlessError(`Unknown tool ${name}`, 'invalid')
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const result = await operation.run(client, readInput(operation, args))
      return ok(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false })
    }
    return err(message.id, -32601, `Unknown method ${message.method}`)
  } catch (reason) {
    const error = reason as HeadlessError
    return err(message.id, -32000, error.message)
  }
}

export async function serveMcp(client: HeadlessClient) {
  const {metadata}=await adapterDisclosure({publicBaseRequired:true})
  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      if (trimmed.length > 40 * 1024 * 1024) throw new Error('MCP request exceeds 40 MiB')
      const message = JSON.parse(trimmed) as Rpc
      void handleMcp(client, message,metadata).then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
      })
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC request' } })}\n`)
    }
  })
  lines.on('close', () => { void client.close().then(() => process.exit(0)) })
}

function inputSchema(fields: { name: string; kind: string; required?: boolean; description: string }[]) {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const field of fields) {
    properties[field.name] = {
      type: field.kind === 'int' ? 'number' : field.kind === 'boolean' ? 'boolean' : field.kind === 'stringList' ? 'array' : 'string',
      description: field.description,
      ...(field.kind === 'stringList' ? { items: { type: 'string' } } : {}),
    }
    if (field.required) required.push(field.name)
  }
  return { type: 'object', properties, required }
}

function ok(id: number | string, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function err(id: number | string, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
