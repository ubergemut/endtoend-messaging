import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HeadlessError } from './types.ts'

export function localHost(host = '127.0.0.1') {
  if (host !== '127.0.0.1') throw new HeadlessError('Adapters must bind to 127.0.0.1', 'invalid')
  return host
}
export function localGate(gate?: string) {
  if (gate !== undefined && !gate.trim()) throw new HeadlessError('The adapter capability cannot be empty', 'invalid')
  return gate ?? randomBytes(32).toString('base64url')
}
export function checkLocalRequest(req: IncomingMessage, res: ServerResponse, gate: string, port: number, graphql = false) {
  const deny = (status: number, message: string, code: string) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(graphql ? { errors: [{ message, extensions: { code } }] } : { error: message, code }))
  }
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` || req.headers.origin !== undefined) {
    deny(403, 'Browser origins and unexpected hosts cannot access this local adapter', 'unauthorized')
    return false
  }
  if (req.method === 'GET' && req.url === '/health') return true
  if (req.headers.authorization !== `Bearer ${gate}`) {
    deny(401, 'Missing adapter capability', 'locked')
    return false
  }
  return true
}
export async function readLocalBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const bytes of req) {
    const chunk = Buffer.from(bytes)
    length += chunk.length
    if (length > 40 * 1024 * 1024) throw new HeadlessError('Request body exceeds 40 MiB', 'invalid')
    chunks.push(chunk)
  }
  if (!length) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object')
    return parsed as Record<string, unknown>
  } catch (reason) { throw new HeadlessError((reason as Error).message, 'invalid') }
}
