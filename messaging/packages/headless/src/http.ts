import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { HeadlessClient } from './client.ts'
import { operations, readInput } from './catalog.ts'
import { HeadlessError } from './types.ts'
import { checkLocalRequest, localGate, localHost, readLocalBody } from './localAccess.ts'
import {adapterDisclosure,serveAdapterMetadata,type DisclosureOptions} from './sourceInfo.ts'

export type HttpOptions = DisclosureOptions & {
  port?: number
  host?: string
  gate?: string
}

export async function startHttp(client: HeadlessClient, options: HttpOptions = {}) {
  const host = localHost(options.host)
  const gate = localGate(options.gate)
  const {disclosure,metadata}=await adapterDisclosure(options)
  const server = createServer(async (req, res) => {
    try {
      if(disclosure?.serve(req,res)||serveAdapterMetadata(req,res,metadata))return
      const address = server.address()
      if (!checkLocalRequest(req, res, gate, typeof address === 'object' && address ? address.port : 0)) return
      await handle(client, req, res)
    } catch (reason) {
      const error = reason as HeadlessError
      const status = error.code === 'locked' ? 401 : error.code === 'invalid' || error.code === 'replace-keys' || error.code === 'device-key' || error.code === 'vault' ? 400 : error.code === 'untrusted' ? 409 : 500
      send(res, status, { error: error.message || 'Server error', code: error.code ?? 'relay' })
    }
  })
  return new Promise<{ url: string; gate: string; capability: string; close: () => Promise<void> }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      resolve({
        url: `http://${host}:${port}`,
        gate,
        capability: gate,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

async function handle(client: HeadlessClient, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'GET' && url.pathname === '/operations') {
    send(res, 200, operations.map((operation) => ({ name: operation.name, summary: operation.summary, method: operation.http.method, path: operation.http.path, fields: operation.fields })))
    return
  }
  const operation = operations.find((item) => item.http.method === req.method && item.http.path === url.pathname)
  if (!operation) {
    send(res, 404, { error: 'Not found' })
    return
  }
  const raw: Record<string, unknown> = {}
  for (const [key, value] of url.searchParams) raw[key] = value
  if (req.method === 'POST') Object.assign(raw, await readLocalBody(req))
  const result = await operation.run(client, readInput(operation, raw))
  send(res, 200, result)
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
