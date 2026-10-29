import {
  AgentError, isAgentRequest, isAgentResponse, type AgentRequest, type AgentResponse, type AgentViews,
  type AttachmentsInput, type ChatSummary, type ConversationFilter, type FileInput, type FocusResult,
  type FriendRequestView, type FriendView, type GroupSendInput, type GroupView, type PublicMessage,
  type SendInput, type Status, type SyncResult, type AttachInput, type IdentityDecisionResult, type PendingSendView,
  isAgentEvent, type AgentEvent, type OperationName, type OperationInput, type OperationOutput, type AgentCapabilities,
  type LicenseInfo, type Stay,
  type FriendSummary,
} from '@e2ee/protocol'
export * from '@e2ee/protocol'
export { RelayService, type RelayServiceOptions } from './relay-service.js'

export type RequestOptions = { signal?: AbortSignal }
export type EventListener = (event: AgentEvent) => void

export interface AgentTransport {
  request(request: AgentRequest, options?: RequestOptions): Promise<AgentResponse>
  subscribe?(listener: EventListener): () => void
  close?(): void | Promise<void>
}

/** Authenticated loopback transport. Browser applications use the separate-origin MessagePort transport. */
export class HttpAgentTransport implements AgentTransport {
  private readonly url: string
  private closed = false
  private readonly pending = new Set<AbortController>()
  constructor(baseUrl: string, private readonly capability: string, private readonly fetcher: typeof fetch = fetch) {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new AgentError('The local agent URL must be an HTTP loopback address', 'invalid')
    }
    if (!capability || capability.length > 16 * 1024 || /[\s\u0000-\u001f\u007f]/.test(capability)) throw new AgentError('A valid local agent capability is required', 'unauthorized')
    this.url = new URL('/v1/command', parsed).href
  }
  async request(request: AgentRequest, options: RequestOptions = {}): Promise<AgentResponse> {
    if (this.closed) throw new AgentError('Agent connection is closed', 'closed')
    const controller = new AbortController()
    const timed = AbortSignal.timeout(120_000)
    const signal = AbortSignal.any([controller.signal, timed, ...(options.signal ? [options.signal] : [])])
    if (signal.aborted) throw new AgentError('Agent request was cancelled; delivery may be uncertain', 'cancelled')
    this.pending.add(controller)
    try {
    const response = await this.fetcher.call(globalThis, this.url, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.capability}` },
      body: JSON.stringify(request),
      signal,
    })
    const result: unknown = await boundedJson(response)
    if (!isAgentResponse(result)) throw new AgentError(`Invalid agent response (${response.status})`, response.status === 401 ? 'unauthorized' : 'protocol')
    if (signal.aborted) throw signal.reason
    return result
    } catch (error) {
      if (signal.aborted) throw new AgentError(this.closed ? 'Agent connection is closed' : 'Agent request was cancelled or timed out; retain its operation ID', this.closed ? 'closed' : timed.aborted ? 'timeout' : 'cancelled')
      throw error
    } finally { this.pending.delete(controller) }
  }
  close() {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending) pending.abort()
    this.pending.clear()
  }
}

/** A port is usable only after the caller completes the agent's origin/source/nonce handshake. */
export class MessagePortTransport implements AgentTransport {
  private closed = false
  private readonly usedIds = new Set<string>()
  private readonly listeners = new Set<EventListener>()
  private readonly pending = new Map<string, { resolve: (response: AgentResponse) => void; reject: (error: Error) => void; cleanup: () => void }>()
  private readonly onMessage = (event: MessageEvent) => {
    if (this.closed) return
    if (isAgentEvent(event.data)) {
      for (const listener of [...this.listeners]) { try { listener(event.data) } catch { /* One consumer cannot prevent revocation. */ } }
      if (event.data.event === 'revoked' || event.data.event === 'disconnected') this.close('revoked')
      return
    }
    if (!isAgentResponse(event.data)) return
    const pending = this.pending.get(event.data.requestId)
    if (!pending) return
    pending.cleanup()
    this.pending.delete(event.data.requestId)
    pending.resolve(event.data)
  }
  constructor(private readonly port: MessagePort, private readonly timeoutMs = 120_000) {
    port.addEventListener('message', this.onMessage)
    port.addEventListener('messageerror', this.onError)
    port.start()
  }
  private readonly onError = () => { this.close() }
  subscribe(listener: EventListener) {
    if (this.closed) throw new AgentError('Agent connection is closed', 'closed')
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  request(request: AgentRequest, options: RequestOptions = {}): Promise<AgentResponse> {
    if (this.closed) return Promise.reject(new AgentError('Agent connection is closed', 'closed'))
    if (!isAgentRequest(request)) return Promise.reject(new AgentError('Invalid protocol request', 'invalid'))
    if (this.usedIds.has(request.requestId)) return Promise.reject(new AgentError('A request ID must never be reused on a port', 'invalid'))
    if (options.signal?.aborted) return Promise.reject(new AgentError('Agent request was cancelled', 'cancelled'))
    this.usedIds.add(request.requestId)
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(request.requestId)
        cleanup()
        reject(new AgentError('Agent request was cancelled; retain the operation ID before retrying', 'cancelled'))
      }
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        cleanup()
        reject(new AgentError('Agent response timed out; retain the operation ID before retrying', 'timeout'))
      }, this.timeoutMs)
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
      this.pending.set(request.requestId, { resolve, reject, cleanup })
      options.signal?.addEventListener('abort', abort, { once: true })
      try { this.port.postMessage(request) } catch (error) {
        cleanup()
        this.pending.delete(request.requestId)
        reject(error)
      }
    })
  }
  close(code = 'closed') {
    if (this.closed) return
    this.closed = true
    this.port.removeEventListener('message', this.onMessage)
    this.port.removeEventListener('messageerror', this.onError)
    this.port.close()
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(new AgentError('Agent connection is closed', code))
    }
    this.pending.clear()
    this.listeners.clear()
    this.usedIds.clear()
  }
}

export class AgentClient {
  private closed = false
  private closureCode: 'closed' | 'revoked' = 'closed'
  private readonly lifecycle = new AbortController()
  constructor(private readonly transport: AgentTransport) {}
  async call<T = unknown>(operation: string, input: Record<string, unknown> = {}, operationId?: string, options: RequestOptions = {}): Promise<T> {
    if (this.closed) throw new AgentError('Agent client is closed', this.closureCode)
    if (options.signal?.aborted) throw new AgentError('Agent request was cancelled', 'cancelled')
    const request: AgentRequest = { version: 1, requestId: crypto.randomUUID(), operation, input, ...(operationId !== undefined ? { operationId } : {}) }
    if (!isAgentRequest(request)) throw new AgentError('Invalid protocol v1 command', 'invalid')
    const signal = AbortSignal.any([this.lifecycle.signal, ...(options.signal ? [options.signal] : [])])
    const response = await withAbort(this.transport.request(request, { signal }), signal, () => this.closed ? this.closureCode : 'cancelled')
    if (signal.aborted) throw new AgentError('Agent request was cancelled or closed', this.closed ? this.closureCode : 'cancelled')
    if (!isAgentResponse(response) || response.requestId !== request.requestId) throw new AgentError('Agent response does not match this request', 'protocol')
    if (response.ok === false) throw new AgentError(response.error.message, response.error.code)
    return response.result as T
  }
  command<K extends OperationName>(operation: K, input: OperationInput<K>, options: RequestOptions & { operationId?: string } = {}): Promise<OperationOutput<K>> {
    return this.call(operation, input, options.operationId, options)
  }
  subscribe(listener: EventListener) {
    if (this.closed) throw new AgentError('Agent client is closed', 'closed')
    if (!this.transport.subscribe) throw new AgentError('This transport does not provide events; use explicit sync', 'invalid')
    return this.transport.subscribe(listener)
  }
  capabilities(options?: RequestOptions) { return this.call<AgentCapabilities>('capabilities', {}, undefined, options) }
  license(options?: RequestOptions) { return this.call<LicenseInfo>('license', {}, undefined, options) }
  setStay(stay: Stay, options?: RequestOptions) { return this.call<{ stay: Stay }>('setStay', { stay }, undefined, options) }
  disconnect(options?: RequestOptions) { return this.call<{ unlocked: false }>('disconnect', {}, undefined, options) }
  status(options?: RequestOptions) { return this.call<Status>('status', {}, undefined, options) }
  views(options?: RequestOptions) { return this.call<AgentViews>('views', {}, undefined, options) }
  attach(input: AttachInput, options?: RequestOptions) { return this.call<Status>('attach', input, undefined, options) }
  requestUnlock(options?: RequestOptions) { return this.call<Status & { pending?: boolean }>('requestUnlock', {}, undefined, options) }
  cryptoDiagnostic(options?: RequestOptions) { return this.call<{ ok: boolean; message: string; description?: string }>('cryptoDiagnostic', {}, undefined, options) }
  pendingSends(options?: RequestOptions) { return this.call<PendingSendView[]>('pendingSends', {}, undefined, options) }
  retryPending(options?: RequestOptions) { return this.call<PublicMessage[]>('retryPending', {}, undefined, options) }
  unlock(input: { handle: string; password: string; replaceKeys?: boolean }, options?: RequestOptions) { return this.call<Status>('unlock', input, undefined, options) }
  sync(options?: RequestOptions) { return this.call<SyncResult>('sync', {}, undefined, options) }
  friendsList(options?: RequestOptions) { return this.call<FriendSummary[]>('friends', {}, undefined, options) }
  requests(options?: RequestOptions) { return this.call<FriendRequestView[]>('requests', {}, undefined, options) }
  requestFriend(handle: string, note?: string, options?: RequestOptions) { return this.call<FriendRequestView[]>('requestFriend', { handle, note }, undefined, options) }
  respondRequest(id: string, action: 'accept' | 'decline' | 'cancel', options?: RequestOptions) { return this.call<FriendRequestView[]>('respondRequest', { id, action }, undefined, options) }
  block(handle: string, options?: RequestOptions) { return this.call<{ ok: true }>('block', { handle }, undefined, options) }
  unfriend(handle: string, options?: RequestOptions) { return this.call<{ ok: true }>('unfriend', { handle }, undefined, options) }
  chats(options?: RequestOptions) { return this.call<ChatSummary[]>('chats', {}, undefined, options) }
  messages(filter: ConversationFilter = {}, options?: RequestOptions) { return this.call<PublicMessage[]>('messages', filter, undefined, options) }
  focus(filter: ConversationFilter, options?: RequestOptions) { return this.call<FocusResult>('focus', filter, undefined, options) }
  markSeen(ids: string[], options?: RequestOptions) { return this.call<{ seen: number }>('markSeen', { ids }, undefined, options) }
  send(input: SendInput, operationId: string = crypto.randomUUID(), options?: RequestOptions) { return this.call<PublicMessage>('send', input, operationId, options) }
  sendGroup(input: GroupSendInput, operationId: string = crypto.randomUUID(), options?: RequestOptions) { return this.call<PublicMessage>('sendGroup', input, operationId, options) }
  sendFile(input: FileInput, operationId: string = crypto.randomUUID(), options?: RequestOptions) { return this.call<PublicMessage>('sendFile', input, operationId, options) }
  sendAttachments(input: AttachmentsInput, operationId: string = crypto.randomUUID(), options?: RequestOptions) { return this.call<PublicMessage>('sendAttachments', input, operationId, options) }
  createGroup(name: string, handles: string[], options?: RequestOptions) { return this.call<{ id: string; name: string; memberIds: string[] }>('createGroup', { name, handles }, undefined, options) }
  groupsList(options?: RequestOptions) { return this.call<GroupView[]>('groups', {}, undefined, options) }
  addMember(groupId: string, accountId: string, options?: RequestOptions) { return this.call<{ memberIds: string[] }>('addMember', { groupId, accountId }, undefined, options) }
  removeMember(groupId: string, memberId: string, options?: RequestOptions) { return this.call<{ ok: true }>('removeMember', { groupId, memberId }, undefined, options) }
  leaveGroup(groupId: string, options?: RequestOptions) { return this.call<{ ok: true }>('leaveGroup', { groupId }, undefined, options) }
  safetyNumber(handle: string, options?: RequestOptions) { return this.call<{ handle: string; safetyNumber: string; verified: boolean }>('safetyNumber', { handle }, undefined, options) }
  trustIdentity(handle?: string, options?: RequestOptions) { return this.call<IdentityDecisionResult>('trustIdentity', { handle }, undefined, options) }
  markVerified(handle: string, options?: RequestOptions) { return this.call<IdentityDecisionResult>('markVerified', { handle }, undefined, options) }
  dropExpired(options?: RequestOptions) { return this.call<string[]>('dropExpired', {}, undefined, options) }
  async attachment(mediaId: string, options?: RequestOptions): Promise<Uint8Array> {
    const result = await this.call<{ base64: string }>('attachment', { mediaId }, undefined, options)
    return base64ToBytes(result.base64)
  }
  lock(options?: RequestOptions) { return this.call<{ unlocked: false }>('lock', {}, undefined, options) }
  /** Revoke this local client capability. Server token revocation is RelayService.revoke(). */
  async revoke() { await this.terminate('revoked') }
  async close() { await this.terminate('closed') }
  private async terminate(code: 'closed' | 'revoked') {
    if (this.closed) return
    this.closureCode = code
    this.closed = true
    this.lifecycle.abort()
    await this.transport.close?.()
  }
}

/** Encoding only; these helpers perform no encryption and carry no private state. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > 64 * 1024 * 1024) throw new AgentError('Agent response exceeds 64 MiB', 'protocol')
      chunks.push(next.value)
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
}

function withAbort<T>(work: Promise<T>, signal: AbortSignal, code: () => string): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new AgentError('Agent request was cancelled or closed; delivery may be uncertain', code())) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    work.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value) }, error => { signal.removeEventListener('abort', abort); if (!signal.aborted) reject(error) })
  })
}
