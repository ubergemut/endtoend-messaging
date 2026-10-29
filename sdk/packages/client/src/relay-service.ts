/** MIT transport for public host identity exchange. No signing keys, cookies, encryption or agent implementation. */
import {
  AgentError, MESSAGING_PATHS, isRecord, type Account, type AttachInput, type MessagingMetadata,
  type MessagingGrant, type MessagingBootstrap, type Stay,
} from '@e2ee/protocol'
import type { RequestOptions } from './index.js'

export type RelayServiceOptions = {
  audience: string; fetcher?: typeof fetch; timeoutMs?: number; maxResponseBytes?: number
}

/** The configured origin and audience are trusted configuration, never values supplied by a grant. */
export class RelayService {
  readonly baseUrl: string
  readonly audience: string
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly lifetime = new AbortController()
  private closed = false
  constructor(baseUrl: string, options: RelayServiceOptions) {
    const url = new URL(baseUrl)
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new AgentError('Messaging service must be a bare HTTPS origin (HTTP is allowed on loopback)', 'invalid')
    if (typeof options.audience !== 'string' || !options.audience.trim() || options.audience.length > 256
      || /[\u0000-\u001f\u007f]/.test(options.audience)) throw new AgentError('A messaging audience of 1–256 characters without control characters is required', 'invalid')
    this.baseUrl = url.origin
    this.audience = options.audience
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || !Number.isSafeInteger(this.maxResponseBytes)
      || this.maxResponseBytes < 1 || this.maxResponseBytes > 64 * 1024 * 1024) throw new AgentError('Invalid messaging response limits', 'invalid')
  }
  async metadata(options?: RequestOptions): Promise<MessagingMetadata> {
    const value = await this.request(MESSAGING_PATHS.metadata, 'GET', undefined, undefined, options)
    this.versioned(value)
    const endpoints = value.endpoints
    if (!isRecord(endpoints) || !(['exchange', 'bootstrap', 'revoke', 'hostRevoke'] as const)
      .every(key => endpoints[key] === MESSAGING_PATHS[key])) throw new AgentError('Messaging metadata has unsupported endpoints', 'protocol')
    return value as unknown as MessagingMetadata
  }
  async exchange(assertion: string, options?: RequestOptions): Promise<MessagingGrant> {
    assertionValue(assertion)
    const value = await this.request(MESSAGING_PATHS.exchange, 'POST', { assertion }, undefined, options)
    this.versioned(value)
    if (!account(value.account) || !token(value.token) || !future(value.expiresAt) || value.bootstrapPath !== MESSAGING_PATHS.bootstrap)
      throw new AgentError('Invalid messaging grant', 'protocol')
    return value as unknown as MessagingGrant
  }
  async session(messagingToken: string, options?: RequestOptions): Promise<MessagingBootstrap> {
    const value = await this.request(MESSAGING_PATHS.bootstrap, 'GET', undefined, messagingToken, options)
    this.versioned(value)
    if (!account(value.account) || typeof value.enrolled !== 'boolean' || !(value.identityKey === null || typeof value.identityKey === 'string')
      || !future(value.expiresAt)) throw new AgentError('Invalid messaging bootstrap', 'protocol')
    return value as unknown as MessagingBootstrap
  }
  async revoke(messagingToken: string, options?: RequestOptions): Promise<{ ok: true }> {
    const value = await this.request(MESSAGING_PATHS.revoke, 'POST', {}, messagingToken, options)
    if (!isRecord(value) || value.ok !== true) throw new AgentError('Invalid messaging revocation response', 'protocol')
    return { ok: true }
  }
  async hostRevoke(assertion: string, options?: RequestOptions): Promise<{ ok: true }> {
    assertionValue(assertion)
    const value = await this.request(MESSAGING_PATHS.hostRevoke, 'POST', { assertion }, undefined, options)
    if (!isRecord(value) || value.ok !== true) throw new AgentError('Invalid host revocation response', 'protocol')
    return { ok: true }
  }
  attachInput(grant: MessagingGrant, stay?: Stay): AttachInput {
    this.versioned(grant)
    if (!account(grant.account) || !token(grant.token) || !future(grant.expiresAt) || grant.bootstrapPath !== MESSAGING_PATHS.bootstrap)
      throw new AgentError('Invalid messaging grant', 'protocol')
    return { relay: this.baseUrl, token: grant.token, expectedAccountId: grant.account.id,
      authorization: { audience: this.audience, bootstrapPath: MESSAGING_PATHS.bootstrap }, ...(stay ? { stay } : {}) }
  }
  close() { this.closed = true; this.lifetime.abort() }
  private versioned(value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value) || value.version !== 1 || value.protocolVersion !== 1 || value.audience !== this.audience)
      throw new AgentError('Messaging protocol or audience does not match configured service', 'protocol')
  }
  private async request(path: string, method: string, body?: unknown, messagingToken?: string, options: RequestOptions = {}): Promise<unknown> {
    if (this.closed) throw new AgentError('Messaging service client is closed', 'closed')
    if (messagingToken !== undefined && !token(messagingToken)) throw new AgentError('An explicit messaging token is required', 'unauthorized')
    const timed = AbortSignal.timeout(this.timeoutMs)
    const signal = AbortSignal.any([timed, this.lifetime.signal, ...(options.signal ? [options.signal] : [])])
    try {
      signal.throwIfAborted()
      const response = await this.fetcher.call(globalThis, new URL(path, this.baseUrl), {
        method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(messagingToken === undefined ? {} : { authorization: `Bearer ${messagingToken}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new AgentError('Messaging redirects are refused', 'protocol')
      const value = await bounded(response, this.maxResponseBytes)
      signal.throwIfAborted()
      if (!response.ok) throw new AgentError(`Messaging request failed (${response.status})`, response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : 'relay')
      return value
    } catch (error) {
      if (signal.aborted) throw new AgentError('Messaging request cancelled or timed out; exchange/revocation may have completed', this.closed ? 'closed' : timed.aborted ? 'timeout' : 'cancelled')
      throw error
    }
  }
}
function account(value: unknown): value is Account {
  return isRecord(value) && typeof value.id === 'string' && !!value.id && typeof value.handle === 'string' && !!value.handle && typeof value.displayName === 'string'
}
function token(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 16 * 1024 && !/[\s\u0000-\u001f\u007f]/.test(value) }
function future(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now() }
function assertionValue(value: string) {
  if (typeof value !== 'string' || value.length > 16 * 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new AgentError('Expected a compact host assertion', 'invalid')
}
async function bounded(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw new AgentError('Messaging response has no JSON body', 'protocol')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > limit) throw new AgentError('Messaging response exceeds configured limit', 'protocol')
      chunks.push(next.value)
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error }
  finally { reader.releaseLock() }
  const joined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) }
  catch { throw new AgentError('Messaging response is not valid UTF-8 JSON', 'protocol') }
}
