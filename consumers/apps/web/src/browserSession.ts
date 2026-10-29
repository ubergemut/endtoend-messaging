import { AgentClient, MessagePortTransport, bytesToBase64, type AgentViews, type AttachmentsInput, type SendInput, type GroupSendInput } from '@e2ee/client/standalone'
import type { MessagingGrant, Stay } from '@e2ee/protocol/standalone'
import { grantAttachInput, loadAgentConfig } from './runtimeConfig.ts'

export type DisplayState = Pick<AgentViews, 'messages' | 'seen' | 'peers' | 'pendingTrust' | 'revision'> & {
  groups: Record<string, AgentViews['groups'][number]>
}
let active: BrowserSession | null = null

/** Product-side presentation cache. It contains protocol DTOs, never a cryptographic vault. */
export class BrowserSession {
  private closed = false
  private generation = 0
  view: DisplayState | null = null
  friendRecords: AgentViews['friends'] = []
  groupRecords: AgentViews['groups'] = []
  pendingRecords: Awaited<ReturnType<AgentClient['pendingSends']>> = []
  onInvalidated?: () => void
  constructor(readonly client: AgentClient, readonly popup: Window) { active = this }
  private check(generation: number) {
    if (this.closed || generation !== this.generation) throw new Error('Agent connection changed; reconnect or unlock to continue.')
  }
  private failed(error: unknown) {
    this.clearPresentation()
    const code = (error as { code?: string })?.code
    if (['revoked', 'unauthorized', 'closed'].includes(code ?? '')) {
      this.closed = true
      if (active === this) active = null
      void this.client.revoke().catch(() => {})
    }
  }
  async refreshView() {
    const generation = this.generation
    this.check(generation)
    try {
      if (!(await this.status()).unlocked) throw new Error('Unlock the messaging agent to continue.')
      const [view, pending] = await Promise.all([this.client.views(), this.client.pendingSends()])
      this.check(generation)
      if (!(await this.status()).unlocked) throw new Error('Unlock the messaging agent to continue.')
      this.check(generation)
      this.friendRecords = view.friends
      this.groupRecords = view.groups
      this.pendingRecords = pending
      this.view = { messages: view.messages, seen: view.seen, peers: view.peers, pendingTrust: view.pendingTrust,
        revision: view.revision, groups: Object.fromEntries(view.groups.map(group => [group.id, group])) }
    } catch (error) { this.failed(error); throw error }
  }
  async perform<T>(work: () => Promise<T>) {
    const generation = this.generation
    this.check(generation)
    let result: T | undefined
    let failed = false
    let workError: unknown
    try { result = await work() } catch (error) {
      const code = (error as { code?: string })?.code
      if (['revoked', 'unauthorized', 'closed'].includes(code ?? '')) { this.failed(error); throw error }
      failed = true; workError = error
    }
    try {
      this.check(generation)
      if (!(await this.status()).unlocked) throw new Error('Unlock the messaging agent to continue.')
      this.check(generation)
      await this.refreshView()
      this.check(generation)
    } catch (error) { this.failed(error); throw error }
    // Ordinary request failures (including membership refusal or a failed upload) preserve the
    // current presentation and the refreshed durable pending queue. They do not revoke an account.
    if (failed) throw workError
    return result as T
  }
  async status() {
    const generation = this.generation
    this.check(generation)
    try {
      const result = await this.client.status()
      this.check(generation)
      if (!result.unlocked) this.clearPresentation()
      return result
    } catch (error) { this.failed(error); throw error }
  }
  sync() { return this.perform(() => this.client.sync()) }
  requests() { return this.perform(() => this.client.requests()) }
  requestFriend(handle: string, note?: string) { return this.perform(() => this.client.requestFriend(handle, note)) }
  respondRequest(id: string, action: 'accept' | 'decline' | 'cancel') { return this.perform(() => this.client.respondRequest(id, action)) }
  block(handle: string) { return this.perform(() => this.client.block(handle)) }
  unfriend(handle: string) { return this.perform(() => this.client.unfriend(handle)) }
  markSeen(ids: string[]) { return this.perform(() => this.client.markSeen(ids)) }
  send(input: SendInput, operationId?: string) { return this.perform(() => this.client.send(input, operationId)) }
  sendGroup(input: GroupSendInput, operationId?: string) { return this.perform(() => this.client.sendGroup(input, operationId)) }
  sendAttachments(input: Omit<AttachmentsInput, 'files'> & { files: { name: string; mime: string; bytes: Uint8Array }[] }, operationId?: string) {
    return this.perform(() => this.client.sendAttachments({ ...input, files: input.files.map(file => ({ name: file.name, mime: file.mime, base64: bytesToBase64(file.bytes) })) }, operationId))
  }
  createGroup(name: string, handles: string[]) { return this.perform(() => this.client.createGroup(name, handles)) }
  addMember(groupId: string, accountId: string) { return this.perform(() => this.client.addMember(groupId, accountId)) }
  removeMember(groupId: string, memberId: string) { return this.perform(() => this.client.removeMember(groupId, memberId)) }
  leaveGroup(groupId: string) { return this.perform(() => this.client.leaveGroup(groupId)) }
  safetyNumber(handle: string) { return this.perform(() => this.client.safetyNumber(handle)) }
  trustIdentity() { this.popup.focus(); return this.perform(() => this.client.trustIdentity()) }
  markVerified(handle: string) { this.popup.focus(); return this.perform(() => this.client.markVerified(handle)) }
  dropExpired() { return this.perform(() => this.client.dropExpired()) }
  retryPending() { return this.perform(() => this.client.retryPending()) }
  clearPresentation() { this.generation += 1; this.view = null; this.friendRecords = []; this.groupRecords = []; this.pendingRecords = []; this.onInvalidated?.() }
  async close({ forget = true }: { forget?: boolean } = {}) {
    if (this.closed) return
    this.closed = true; this.generation += 1
    if (active === this) active = null
    this.clearPresentation()
    try { if (!this.popup.closed) await this.client.call(forget ? 'lock' : 'disconnect') } finally { await this.client.close() }
  }
}

export async function connectBrowserAgent(token = '', accountId = '', stay: Stay = 'tab', cancellation?: AbortSignal, grant?: MessagingGrant): Promise<BrowserSession> {
  // Open synchronously while the click gesture is active; configuration is fetched afterwards.
  const popup = window.open('about:blank', '_blank', 'popup,width=540,height=720')
  if (!popup) throw new Error('Allow the EndToEnd agent window, then connect again.')
  let client: AgentClient | null = null
  const cancelled = () => {
    if (client) void client.call(cancellation?.reason === 'logout' ? 'lock' : 'disconnect').catch(() => {}).finally(() => { void client?.close(); popup.close() })
    else popup.close()
  }
  cancellation?.addEventListener('abort',cancelled,{once:true})
  try {
    cancellation?.throwIfAborted()
    const config = await loadAgentConfig(cancellation)
    const agentUrl = new URL(config.agentUrl)
    if (config.host && token && !grant) throw new Error('Obtain a host messaging grant before connecting.')
    const attach = grant ? await grantAttachInput(config, grant, stay, cancellation)
      : { relay: config.relayUrl, token, expectedAccountId: accountId, stay }
    const capability = crypto.randomUUID() + crypto.randomUUID()
    const nonce = crypto.randomUUID()
    agentUrl.hash = new URLSearchParams({ capability, callerOrigin: location.origin }).toString()
    const channel = new MessageChannel()
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => finish(new Error('Agent connection timed out. Reopen the agent and try again.')), 30_000)
      const closed = window.setInterval(() => { if (popup.closed) finish(new Error('Agent window was closed.')) }, 500)
      let sent = false
      function finish(error?: Error) {
        clearTimeout(timer); clearInterval(closed); window.removeEventListener('message', onReady)
        cancellation?.removeEventListener('abort', onAbort)
        channel.port1.removeEventListener('message', onConnected)
        if (error) { channel.port1.close(); channel.port2.close(); reject(error) } else resolve()
      }
      function onAbort() { finish(new Error('Agent connection cancelled.')) }
      function onReady(event: MessageEvent) {
        if (cancellation?.aborted) return
        if (sent || event.source !== popup || event.origin !== agentUrl.origin || event.data?.type !== 'endtoend-agent-ready' || event.data.version !== 1) return
        sent = true
        popup!.postMessage({ type: 'endtoend-agent-connect', version: 1, nonce, capability }, agentUrl.origin, [channel.port2])
      }
      function onConnected(event: MessageEvent) {
        if (sent && event.data?.type === 'endtoend-agent-connected' && event.data.version === 1 && event.data.nonce === nonce) finish()
      }
      window.addEventListener('message', onReady)
      channel.port1.addEventListener('message', onConnected); channel.port1.start()
      cancellation?.addEventListener('abort', onAbort, { once: true })
      if (cancellation?.aborted) { onAbort(); return }
      popup!.location.href = agentUrl.href
    })
    cancellation?.throwIfAborted()
    client = new AgentClient(new MessagePortTransport(channel.port1))
    if (token) {
      await client.attach(attach)
      cancellation?.throwIfAborted()
      await client.requestUnlock()
    }
    cancellation?.throwIfAborted()
    return new BrowserSession(client, popup)
  } catch (error) { if (client) await client.close(); popup.close(); throw error }
  finally { cancellation?.removeEventListener('abort',cancelled) }
}

export async function readAttachment(mediaId: string): Promise<Uint8Array | null> {
  const session = active
  if (!session) return null
  const bytes = await session.perform(() => session.client.attachment(mediaId))
  return active === session && session.view ? bytes : null
}
