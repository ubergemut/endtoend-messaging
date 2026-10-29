import { openHeadless } from './client.ts'
import { findOperation, operations, readInput } from './catalog.ts'
import { startHttp } from './http.ts'
import { serveMcp } from './mcp.ts'
import { startGraphql } from './graphql.ts'
import { HeadlessError } from './types.ts'
import {adapterDisclosure} from './sourceInfo.ts'

const mode = process.argv[2] ?? 'help'
if(mode==='--license'||mode==='--source'){
  process.stdout.write(JSON.stringify((await adapterDisclosure({publicBaseRequired:true})).metadata,null,2)+'\n');process.exit(0)
}

if (mode === 'help' || mode === '--help') {
  process.stdout.write(`EndToEnd headless

  call <operation> [--field value]   Run one operation and exit
  http                               JSON HTTP on 127.0.0.1
  graphql                            GraphQL HTTP on 127.0.0.1
  mcp                                MCP server on stdin/stdout
  --license / --source               Public license/source/manifest/notice metadata; no vault required

Environment
  ENDTOEND_RELAY     Relay base URL, no trailing path
  ENDTOEND_VAULT     Path to this device's vault file
  ENDTOEND_HANDLE    Unlock handle for servers and call
  ENDTOEND_PASSWORD  Unlock password
  ENDTOEND_DEVICE_KEY  32-byte base64 device secret. Not the account password. Required to open the vault.
  ENDTOEND_AGENT_EXECUTABLE  Independent agent runner executable, or configure an existing agent below.
  ENDTOEND_AGENT_ARGUMENTS   Optional JSON array of runner arguments (development: Node --import tsx runner path).
  ENDTOEND_AGENT_URL         Existing authenticated loopback agent URL.
  ENDTOEND_AGENT_CAPABILITY  Capability for an existing loopback agent.
  ENDTOEND_PORT      Port for http or graphql (default 0 = ephemeral)
  ENDTOEND_GATE      HTTP/GraphQL capability. Generated when omitted; printed with the listening URL.
  ENDTOEND_RELEASE_MODE  Set to 1 for a release; missing/tampered source disclosure refuses startup.
  ENDTOEND_SOURCE_DISCLOSURE  Path to SOURCE_DISCLOSURE.json. Public downloads and /release.json need no capability.
  ENDTOEND_SOURCE_BASE_URL  Public HTTPS (or loopback test HTTP) origin serving this descriptor; required for release MCP/CLI notices.

License: AGPL-3.0-only. Independent transport SDK: MIT. Source and notices: --source.

Operations
${operations.map((operation) => `  ${operation.name}  ${operation.http.method} ${operation.http.path}`).join('\n')}
`)
  process.exit(0)
}

// Validate release disclosure before any optional unlock can open a vault.
await adapterDisclosure({publicBaseRequired:mode==='call'||mode==='mcp'})

const relay = process.env.ENDTOEND_RELAY
const vaultPath = process.env.ENDTOEND_VAULT
if (!relay || !vaultPath) {
  process.stderr.write('ENDTOEND_RELAY and ENDTOEND_VAULT are required\n')
  process.exit(1)
}

const client = openHeadless({ relay, vaultPath })
if (process.env.ENDTOEND_HANDLE && process.env.ENDTOEND_PASSWORD && mode !== 'call') {
  await client.unlock({ handle: process.env.ENDTOEND_HANDLE, password: process.env.ENDTOEND_PASSWORD })
}

if (mode === 'call') {
  try {
    if (process.env.ENDTOEND_HANDLE && process.env.ENDTOEND_PASSWORD) {
      await client.unlock({ handle: process.env.ENDTOEND_HANDLE, password: process.env.ENDTOEND_PASSWORD })
    }
    const name = process.argv[3]
    if (!name) throw new HeadlessError('Name the operation', 'invalid')
    const operation = findOperation(name)
    const result = await operation.run(client, readInput(operation, flags(process.argv.slice(4))))
    await new Promise<void>((resolve, reject) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, error => error ? reject(error) : resolve()))
    await client.close()
    process.exit(0)
  } catch (reason) {
    process.stderr.write(`${(reason as Error).message}\n`)
    await client.close()
    process.exit(1)
  }
}

const port = Number(process.env.ENDTOEND_PORT ?? 0)
const gate = process.env.ENDTOEND_GATE
if (mode === 'http') {
  const started = await startHttp(client, { port, gate })
  process.stdout.write(`${JSON.stringify({ url: started.url, capability: started.capability })}\n`)
  shutdown(() => started.close())
} else if (mode === 'graphql') {
  const started = await startGraphql(client, { port, gate })
  process.stdout.write(`${JSON.stringify({ url: started.url, capability: started.capability })}\n`)
  shutdown(() => started.close())
} else if (mode === 'mcp') {
  await serveMcp(client)
} else {
  process.stderr.write(`Unknown mode ${mode}. Run with help.\n`)
  await client.close()
  process.exit(1)
}

function flags(argv: string[]) {
  const raw: Record<string, unknown> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next == null || next.startsWith('--')) raw[key] = 'true'
    else {
      raw[key] = next
      index += 1
    }
  }
  return raw
}

function shutdown(close: () => Promise<void>) {
  const stop = () => {
    void close().then(() => client.close()).then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
