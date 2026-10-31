// Modified October 31, 2026: retain direct ciphertext when current consent changes. AGPL-3.0-only.
import { base64ToBytes, bytesToBase64, openBytes, sealBytes } from './bytes.ts'
import { Relay } from './relay.ts'
import { authorizationBinding, validateBootstrap, LEGACY_AUTHORIZATION, type AuthorizationBinding, type AuthorizedBootstrap } from './authorization.ts'
import type { SignalPort } from './signal.ts'
import {
  HeadlessError,
  type Attachment,
  type ChatSummary,
  type Envelope,
  type FocusResult,
  type Friend,
  type FriendRequestView,
  type GroupRecord,
  type PublicBundle,
  type PublicMessage,
  type Status,
  type OutboxItem,
  type StoredMessage,
  type SyncResult,
  type Vault,
  type SendAttempt,
} from './types.ts'

type Payload = {
  kind?: string
  id?: string
  body?: string
  senderId?: string
  senderHandle?: string
  replyTo?: string
  quote?: string
  messageId?: string
  groupId?: string
  distributionId?: string
  distribution?: string
  name?: string
  epoch?: number
  attachments?: Attachment[]
}

export type SessionPorts = {
  relay: string
  label: string
  signal: SignalPort
  loadVault: () => Promise<Vault | null>
  saveVault: (vault: Vault, expectedRevision?: number) => Promise<void>
  loadBlob: (mediaId: string) => Promise<Uint8Array | null>
  saveBlob: (mediaId: string, bytes: Uint8Array) => Promise<void>
  deleteBlob?: (mediaId: string) => Promise<void>
}

export class Session {
  private readonly relay: Relay
  private readonly crypto: SignalPort
  private vault: Vault | null = null
  private seenRevision = 0
  private friends: Friend[] = []
  private groups: GroupRecord[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private generation = 0
  private authorization = { ...LEGACY_AUTHORIZATION }
  private authorizationExpiresAt: string | null = null

  constructor(private readonly ports: SessionPorts) {
    this.relay = new Relay(ports.relay.replace(/\/$/, ''), () => this.lock())
    this.crypto = ports.signal
  }

  get record(): Vault | null {
    return this.vault
  }

  get friendRecords(): Friend[] {
    return this.friends
  }

  get groupRecords(): GroupRecord[] {
    return this.groups
  }

  get token(): string | null {
    return this.relay.token
  }

  status(): Status {
    this.expireAuthorization()
    const pending = this.vault?.pendingTrust
    const pendingFriend = pending ? this.friends.find((friend) => friend.id === pending.peerId) : undefined
    return {
      unlocked: Boolean(this.vault),
      handle: this.vault?.handle ?? null,
      accountId: this.vault?.accountId ?? null,
      relay: this.relay.baseUrl,
      vaultPath: this.ports.label,
      pendingTrustHandle: pendingFriend?.handle ?? (pending ? pending.peerId : null),
    }
  }

  lock() {
    this.generation += 1
    this.relay.revoke()
    this.vault = null
    this.friends = []
    this.groups = []
    this.seenRevision = 0
    this.authorization = { ...LEGACY_AUTHORIZATION }
    this.authorizationExpiresAt = null
  }

  async attachment(mediaId: string) {
    const current = this.requireVault()
    if (!current.messages.some(message => live(message) && message.attachments?.some(file => file.mediaId === mediaId))) {
      throw new HeadlessError('Attachment does not belong to an active message', 'invalid')
    }
    const bytes = await this.ports.loadBlob(mediaId)
    if (!bytes) throw new HeadlessError('Attachment is not downloaded', 'vault')
    return bytes
  }

  publicIdentity() {
    return this.crypto.local_identity(this.requireVault().store)
  }

  async checkIdentity() {
    const current=this.requireVault()
    const generation=this.generation
    const verified=await this.verifyAuthorization(current.accountId)
    this.assertGeneration(generation)
    if(verified.identityKey!==this.crypto.local_identity(current.store)) {
      this.lock()
      throw new HeadlessError('This messaging device was replaced. Its local history is retained.','replace-keys')
    }
  }

  async attach(token: string, account: { id: string; handle: string }, options: { authorization?: AuthorizationBinding; replaceKeys?: boolean } = {}) {
    const binding=authorizationBinding(options.authorization)
    if(typeof token!=='string'||!token||token.length>8192)throw new HeadlessError('Invalid relay authorization','invalid')
    // Reattaching cancels old in-flight work before adopting a new authorization.
    this.lock()
    const generation=this.generation
    this.authorization=binding
    this.relay.token = token
    const verified=await this.verifyAuthorization(account.id)
    this.assertGeneration(generation)
    const existing = await this.readVault()
    this.assertGeneration(generation)
    this.noteRevision(existing)
    if (existing?.accountId === account.id && existing.store) {
      if(verified.identityKey!==this.crypto.local_identity(existing.store)) {
        // An interrupted initial publication is retryable only for its exact saved bundle.
        if(verified.enrolled||!existing.pendingPublication)throw new HeadlessError('This messaging device was replaced. Its local history is retained.','replace-keys')
      }
      this.vault = existing
    }
    else if (!existing?.store) {
      if(verified.enrolled&&!options.replaceKeys)throw new HeadlessError('This account already has a messaging device. Explicit replacement is required.','replace-keys')
      this.vault = await this.publishNewKeys(account.id, verified.account.handle)
    }
    else throw new HeadlessError('This vault already holds keys for a different account', 'replace-keys')
    await this.flushPublication()
    await this.refreshGraph()
    await this.sync()
    return this.status()
  }

  async unlock(input: { handle: string; password: string; replaceKeys?: boolean }) {
    this.lock()
    const generation=this.generation
    const handle = input.handle.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
      throw new HeadlessError('Handle must be 3-32 letters, numbers, or underscores', 'invalid')
    }
    if (input.password.length < 5) throw new HeadlessError('Password must be at least 5 characters', 'invalid')
    const lookup = await this.relay.request<{ exists: boolean }>(`/api/auth/handle?handle=${encodeURIComponent(handle)}`)
    const existing = await this.readVault()
    this.assertGeneration(generation)
    this.noteRevision(existing)
    if (lookup.exists) {
      const session = await this.relay.request<{ token: string; account: { id: string; handle: string } }>('/api/auth/login', {
        method: 'POST',
        body: { handle, password: input.password },
      })
      this.relay.token = session.token
      if (existing?.accountId === session.account.id && existing.store) {
        this.vault = existing
      } else if (input.replaceKeys) {
        this.vault = await this.publishNewKeys(session.account.id, session.account.handle)
      } else if (existing && existing.accountId !== session.account.id) {
        throw new HeadlessError(
          `Vault at ${this.ports.label} belongs to ${existing.handle}. Use a different vault for ${handle}.`,
          'replace-keys'
        )
      } else {
        throw new HeadlessError(
          `${handle} already has a key bundle. Pass replaceKeys: true only if this process should become the one device and the old device should stop working.`,
          'replace-keys'
        )
      }
    } else {
      if (existing && !input.replaceKeys) {
        throw new HeadlessError(`Vault at ${this.ports.label} already belongs to ${existing.handle}. Choose a new vault.`, 'replace-keys')
      }
      const session = await this.relay.request<{ token: string; account: { id: string; handle: string } }>('/api/auth/register', {
        method: 'POST',
        body: { handle, password: input.password, displayName: handle },
      })
      this.relay.token = session.token
      this.vault = await this.publishNewKeys(session.account.id, session.account.handle)
    }
    await this.flushPublication()
    await this.refreshGraph()
    await this.sync()
    return this.status()
  }

  async friendsList() {
    this.requireVault()
    await this.refreshGraph()
    return this.friends.map((friend) => ({
      id: friend.id,
      handle: friend.handle,
      displayName: friend.displayName,
      verified: identityVerified(this.vault?.peers[friend.id], friend.identityKey),
    }))
  }

  async requests(): Promise<FriendRequestView[]> {
    const current = this.requireVault()
    const body = await this.relay.request<{
      requests: { id: string; direction: 'incoming' | 'outgoing'; fromHandle: string; toHandle: string; status: string; noteCiphertext: string | null }[]
    }>('/api/friends/requests')
    return body.requests.map((request) => ({
      id: request.id,
      direction: request.direction,
      handle: request.direction === 'incoming' ? request.fromHandle : request.toHandle,
      status: request.status,
      note: request.noteCiphertext && request.direction === 'incoming' ? this.openNote(current, request.noteCiphertext) : null,
    }))
  }

  async requestFriend(handle: string, note?: string) {
    this.requireVault()
    const found = await this.relay.request<{ account: { id: string; identityKey: string | null } | null }>(
      `/api/accounts/search?handle=${encodeURIComponent(handle.trim().toLowerCase())}`
    )
    if (!found.account?.identityKey) throw new HeadlessError('That handle has no published identity key yet', 'invalid')
    const noteCiphertext = note ? this.crypto.seal_note(found.account.identityKey, note) : undefined
    await this.relay.request('/api/friends/requests', {
      method: 'POST',
      body: { handle: handle.trim().toLowerCase(), noteCiphertext },
    })
    return this.requests()
  }

  async respondRequest(id: string, action: 'accept' | 'decline' | 'cancel') {
    this.requireVault()
    await this.relay.request(`/api/friends/requests/${id}/${action}`, { method: 'POST', body: {} })
    await this.refreshGraph()
    return this.requests()
  }

  async block(handle: string) {
    this.requireVault()
    await this.relay.request('/api/friends/block', { method: 'POST', body: { handle: handle.trim().toLowerCase() } })
    await this.refreshGraph()
    return { ok: true }
  }

  async unfriend(handle: string) {
    const current = this.requireVault()
    const friend = this.friendByHandle(handle)
    const store = this.crypto.rotate_access_key(current.store)
    const parsed = JSON.parse(store) as { access_key: string }
    await this.relay.request('/api/keys/access', { method: 'PUT', body: { accessKey: parsed.access_key } })
    await this.relay.request(`/api/friends/${friend.id}/remove`, {
      method: 'POST',
      body: { queueTags: current.queueTags[friend.id] ?? [] },
    })
    const wiped = this.crypto.wipe_session(store, friend.id)
    this.vault = rememberStore({ ...current, queueTags: { ...current.queueTags, [friend.id]: [] } }, wiped)
    await this.save()
    await this.refreshGraph()
    return { ok: true }
  }

  async chats(): Promise<ChatSummary[]> {
    const current = this.requireVault()
    const rows: ChatSummary[] = [
      ...this.friends.map((friend) => {
        const last = [...current.messages].reverse().find((message) => message.peerId === friend.id && !message.groupId)
        return {
          peerId: friend.id,
          groupId: null,
          handle: friend.handle,
          title: friend.handle,
          preview: last ? previewText(last) : 'No messages yet',
          at: last?.at ?? '',
          unseen: current.messages.filter((message) => message.peerId === friend.id && !message.groupId && isUnseen(message, current)).length,
        }
      }),
      ...this.groups.map((group) => {
        const local = current.groups[group.id]
        const last = [...current.messages].reverse().find((message) => message.groupId === group.id)
        return {
          peerId: null,
          groupId: group.id,
          handle: null,
          title: local?.name ?? 'Group',
          preview: last ? previewText(last) : 'No messages yet',
          at: last?.at ?? '',
          unseen: current.messages.filter((message) => message.groupId === group.id && isUnseen(message, current)).length,
        }
      }),
    ]
    return rows.sort((left, right) => (right.at || '').localeCompare(left.at || ''))
  }

  async messages(filter: { handle?: string; groupId?: string } = {}): Promise<PublicMessage[]> {
    const current = this.requireVault()
    return current.messages.filter((message) => this.matches(message, filter)).filter(live).map((message) => this.publish(message))
  }

  async focus(filter: { handle?: string; groupId?: string }): Promise<FocusResult> {
    const incoming = (await this.messages(filter)).filter((message) => message.unseen && !message.system)
    const message = incoming[incoming.length - 1] ?? null
    return { message, threadId: message?.replyTo ?? null }
  }

  async markSeen(ids: string[]) {
    return this.exclusive(async () => {
      const current = this.requireVault()
      const seen = new Set(current.seen)
      for (const id of ids) seen.add(id)
      this.vault = { ...current, seen: [...seen] }
      await this.save()
      return { seen: ids.length }
    })
  }

  async dropExpired() {
    return this.exclusive(async () => {
      const current = this.requireVault()
      const now = Date.now()
      const expired = current.messages.filter((message) => message.expiresAt && Date.parse(message.expiresAt) <= now)
      const expiredAttempts=(current.sendAttempts??[]).filter(item=>!item.expired&&item.expiresAt&&Date.parse(item.expiresAt)<=now)
      if (!expired.length&&!expiredAttempts.length) return [] as string[]
      const expiredIds=new Set([...expired.map(message=>message.id),...expiredAttempts.map(item=>item.id)])
      this.vault = {
        ...current,
        messages: current.messages.filter((message) => !message.expiresAt || Date.parse(message.expiresAt) > now),
        outbox:current.outbox.filter(item=>!item.messageId||!expiredIds.has(item.messageId)),
        blockedOutbox:(current.blockedOutbox??[]).filter(item=>!item.messageId||!expiredIds.has(item.messageId)),
        sendAttempts:(current.sendAttempts??[]).map(item=>expiredIds.has(item.id)?{...item,body:'',attachments:[],uploads:[],completed:true,expired:true}:item),
      }
      await this.save()
      const mediaIds=[...new Set([...expired.flatMap(message=>(message.attachments??[]).map(file=>file.mediaId)),...expiredAttempts.flatMap(item=>item.attachments.map(file=>file.mediaId))])]
      for(const mediaId of mediaIds)await this.ports.deleteBlob?.(mediaId)
      return mediaIds
    })
  }

  async sync(): Promise<SyncResult> {
    return this.exclusive(() => this.pull())
  }

  async send(input: { handle: string; body: string; replyTo?: string; expiresInSeconds?: number; operationId?: string }) {
    return this.sendDurably(input)
  }

  async sendGroup(input: { groupId: string; body: string; replyTo?: string; expiresInSeconds?: number; operationId?: string }) {
    return this.sendDurably(input)
  }

  async sendFile(input: { handle?: string; groupId?: string; name: string; mime: string; base64: string; body?: string; replyTo?: string; expiresInSeconds?: number; operationId?: string }) {
    return this.sendAttachments({
      handle: input.handle,
      groupId: input.groupId,
      body: input.body,
      replyTo: input.replyTo,
      expiresInSeconds: input.expiresInSeconds,
      operationId: input.operationId,
      files: [{ name: input.name, mime: input.mime, bytes: base64ToBytes(input.base64) }],
    })
  }

  async sendAttachments(input: {
    handle?: string
    groupId?: string
    body?: string
    replyTo?: string
    expiresInSeconds?: number
    operationId?: string
    files: { name: string; mime: string; bytes: Uint8Array }[]
  }) {
    return this.sendDurably(input)
  }

  pendingSends() {
    return (this.requireVault().sendAttempts ?? []).filter(item => !item.completed).map(item => ({
      operationId: item.id, handle: item.handle ?? null, groupId: item.groupId ?? null,
      body: item.body, replyTo: item.replyTo ?? null, attachmentNames: item.attachments.map(file => file.name),
      state:item.blockedReason?'blocked':'pending',reason:item.blockedReason??null,
    }))
  }

  async retryPending() {
    return this.exclusive(async () => {
      await this.checkIdentity()
      await this.refreshGraph()
      await this.flushOutbox(this.requireVault())
      const results: PublicMessage[] = []
      for (const attempt of this.requireVault().sendAttempts ?? []) {
        if (!attempt.completed&&!attempt.blockedReason) results.push(await this.deliverAttempt(attempt))
      }
      return results
    })
  }

  private async sendDurably(input: {
    handle?: string; groupId?: string; body?: string; replyTo?: string; expiresInSeconds?: number;
    operationId?: string; files?: { name: string; mime: string; bytes: Uint8Array }[]
  }) {
    return this.exclusive(async () => {
      await this.checkIdentity()
      const id = input.operationId ?? crypto.randomUUID()
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new HeadlessError('Invalid operation ID', 'invalid')
      if (!!input.handle === !!input.groupId) throw new HeadlessError('Choose one conversation', 'invalid')
      const files = input.files ?? []
      if (!input.body?.trim() && !files.length) throw new HeadlessError('Message is empty', 'invalid')
      if (files.some(file => file.bytes.byteLength > 25 * 1024 * 1024)) throw new HeadlessError('Files are limited to 25 MiB each', 'invalid')
      if (input.expiresInSeconds !== undefined && (!Number.isSafeInteger(input.expiresInSeconds) || input.expiresInSeconds <= 0)) throw new HeadlessError('Invalid disappearing timer', 'invalid')
      const encoded = JSON.stringify([input.handle ?? null, input.groupId ?? null, input.body ?? '', input.replyTo ?? null, input.expiresInSeconds ?? null,
        files.map(file => [file.name, file.mime, bytesToBase64(file.bytes)])])
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded)))
      const inputHash = [...hash].map(value => value.toString(16).padStart(2, '0')).join('')
      const current = this.requireVault()
      let attempt = current.sendAttempts?.find(item => item.id === id)
      if (attempt && attempt.inputHash !== inputHash) throw new HeadlessError('Operation ID was already used for different content', 'invalid')
      if (!attempt) {
        attempt = { id, inputHash, handle: input.handle, groupId: input.groupId, body: input.body ?? '', replyTo: input.replyTo,
          expiresInSeconds: input.expiresInSeconds, expiresAt:input.expiresInSeconds?new Date(Date.now()+input.expiresInSeconds*1000).toISOString():null,
          attachments: [], uploads: [], completed: false }
        for (const file of files) {
          const sealed = await sealBytes(file.bytes)
          const mediaId = crypto.randomUUID()
          await this.ports.saveBlob(mediaId, file.bytes)
          attempt.attachments.push({ mediaId, name: file.name.slice(0,250), mime: file.mime || 'application/octet-stream', key: sealed.key, nonce: sealed.nonce })
          attempt.uploads.push({ id: mediaId, ciphertext: sealed.ciphertext })
        }
        this.vault = { ...current, sendAttempts: [...(current.sendAttempts ?? []), attempt] }
        await this.save()
      }
      return this.deliverAttempt(attempt)
    })
  }

  private async deliverAttempt(attempt: SendAttempt) {
    if(attempt.expired||(attempt.expiresAt&&Date.parse(attempt.expiresAt)<=Date.now()))throw new HeadlessError('This message expired; start a new intent to send again','invalid')
    if(attempt.blockedReason)throw new HeadlessError('Conversation membership changed. The original ciphertext is retained; review membership and start a new message.','invalid')
    let current = this.requireVault()
    const previous = current.messages.find(message => message.id === attempt.id)
    if (previous) {
      await this.flushOutbox(current)
    } else {
      for (const upload of attempt.uploads) {
        const result = await this.relay.request<{id:string}>('/api/media', { method: 'POST', body: {
          id: upload.id, ciphertext: upload.ciphertext,
          recipientAccountId: attempt.groupId ? null : this.friendByHandle(attempt.handle ?? '').id,
          groupId: attempt.groupId ?? null,
          expiresAt: attempt.expiresAt ?? null,
        } })
        if (result.id !== upload.id) {
          // Legacy relays may assign media IDs. Update the intent before encrypting a message.
          const originalId = upload.id
          const attachment = attempt.attachments.find(file => file.mediaId === originalId)!
          const bytes = await this.ports.loadBlob(originalId)
          if (bytes) await this.ports.saveBlob(result.id, bytes)
          attachment.mediaId = result.id
          upload.id = result.id
          this.vault = { ...this.requireVault(), sendAttempts: this.requireVault().sendAttempts!.map(item => item.id === attempt.id ? attempt : item) }
          await this.save()
        }
      }
      await this.sendPayload({ messageId: attempt.id, peerHandle: attempt.handle, groupId: attempt.groupId, body: attempt.body,
        replyTo: attempt.replyTo, expiresAt:attempt.expiresAt??null, expiresInSeconds: attempt.expiresInSeconds, attachments: attempt.attachments,
        mediaCiphertext: attempt.uploads[0]?.ciphertext ?? null })
    }
    current = this.requireVault()
    if(current.outbox.some(item=>item.messageId===attempt.id)&&attempt.groupId||current.sendAttempts?.find(item=>item.id===attempt.id)?.blockedReason){
      throw new HeadlessError('Conversation membership changed; the retained attempt cannot be delivered to the current conversation. Start a new message after reviewing membership.','invalid')
    }
    this.vault = { ...current, sendAttempts: current.sendAttempts!.map(item => item.id === attempt.id ? { ...item, completed: true } : item) }
    await this.save()
    return this.publish(this.requireVault().messages.find(message => message.id === attempt.id)!)
  }

  async createGroup(name: string, handles: string[]) {
    return this.exclusive(async () => {
      const current = this.requireVault()
      if (!name || handles.length === 0) throw new HeadlessError('A group needs a name and at least one friend', 'invalid')
      const memberIds = handles.map((handle) => this.friendByHandle(handle).id)
      const distributionId = crypto.randomUUID()
      const created = JSON.parse(this.crypto.create_sender_key(current.store, current.accountId, distributionId)) as {
        store: object
        distribution: string
      }
      let next = rememberStore(current, JSON.stringify(created.store))
      const metadata = JSON.parse(this.crypto.group_encrypt_message(next.store, next.accountId, distributionId, JSON.stringify({ name }))) as {
        store: object
        ciphertext: string
      }
      next = rememberStore(next, JSON.stringify(metadata.store))
      const group = await this.relay.request<{ id: string; memberIds: string[] }>('/api/groups', {
        method: 'POST',
        body: { memberIds, metadataCiphertext: metadata.ciphertext },
      })
      next = await this.fanOutSetup(next, group.id, name, distributionId, created.distribution, group.memberIds, 1)
      this.vault = next
      await this.save()
      await this.refreshGraph()
      return { id: group.id, name, memberIds: group.memberIds }
    })
  }

  async addMember(groupId: string, accountId: string) {
    return this.exclusive(async () => {
      const current = this.requireVault()
      const group = current.groups[groupId]
      if (!group) throw new HeadlessError('That group is not on this device', 'invalid')
      const body = await this.relay.request<{ memberIds: string[]; epoch?: number }>(`/api/groups/${groupId}/members`, {
        method: 'POST',
        body: { accountId },
      })
      const next = await this.publishSenderKey(current, groupId, group.name, body.memberIds, body.epoch ?? (group.epoch ?? 1) + 1)
      this.vault = next
      await this.save()
      await this.refreshGraph()
      return { memberIds: body.memberIds }
    })
  }

  async removeMember(groupId: string, memberId: string) {
    return this.exclusive(async () => {
      const current = this.requireVault()
      const group = current.groups[groupId]
      if (!group) throw new HeadlessError('That group is not on this device', 'invalid')
      const outcome = await this.relay.request<{epoch?:number}>(`/api/groups/${groupId}/members/${memberId}`, { method: 'DELETE' })
      const remaining = group.memberIds.filter((id) => id !== memberId)
      const next = await this.publishSenderKey(current, groupId, group.name, remaining, outcome.epoch ?? (group.epoch ?? 1) + 1)
      this.vault = next
      await this.save()
      await this.refreshGraph()
      return { ok: true }
    })
  }

  async leaveGroup(groupId: string) {
    return this.exclusive(async () => {
      const current = this.requireVault()
      const group = current.groups[groupId]
      if (!group) throw new HeadlessError('That group is not on this device', 'invalid')
      const payload = JSON.stringify({
        kind: 'leave',
        id: crypto.randomUUID(),
        senderId: current.accountId,
        senderHandle: current.handle,
        groupId,
        epoch: (group.epoch ?? 1) + 1,
      })
      const encrypted = JSON.parse(this.crypto.group_encrypt_message(current.store, current.accountId, group.distributionId, payload)) as {
        store: object
        ciphertext: string
      }
      let next = rememberStore(current, JSON.stringify(encrypted.store))
      for (const memberId of group.memberIds) {
        if (memberId === next.accountId) continue
        const friend = this.friends.find((item) => item.id === memberId)
        if (!friend) continue
        next = await this.ensureSession(next, friend)
        next = await this.postEnvelope(next, memberId, encrypted.ciphertext, groupId, null)
      }
      await this.relay.request(`/api/groups/${groupId}/members/${current.accountId}`, { method: 'DELETE' })
      const groupsLeft = { ...next.groups }
      delete groupsLeft[groupId]
      this.vault = { ...next, groups: groupsLeft }
      await this.save()
      await this.refreshGraph()
      return { ok: true }
    })
  }

  async groupsList() {
    this.requireVault()
    await this.refreshGraph()
    return this.groups.map((group) => ({
      id: group.id,
      name: this.vault?.groups[group.id]?.name ?? 'Group',
      memberHandles: group.memberIds.map((id) => this.friends.find((friend) => friend.id === id)?.handle ?? id),
    }))
  }

  async safetyNumber(handle: string) {
    this.requireVault()
    await this.refreshGraph()
    const current = this.requireVault()
    const friend = this.friendByHandle(handle)
    const identity = friend.identityKey || current.peers[friend.id]?.identityKey
    if (!identity) throw new HeadlessError('That friend has no identity key yet', 'invalid')
    return {
      handle: friend.handle,
      safetyNumber: groupedSafety(this.crypto.safety_number(current.store, current.accountId, friend.id, identity)),
      verified: identityVerified(current.peers[friend.id], identity),
    }
  }

  async trustIdentity(handle?: string) {
    const current = this.requireVault()
    const pending = current.pendingTrust
    if (!pending) throw new HeadlessError('No identity is waiting for trust', 'invalid')
    if (handle) {
      const friend = this.friendByHandle(handle)
      if (friend.id !== pending.peerId) throw new HeadlessError(`Trust is waiting for a different account than ${handle}`, 'invalid')
    }
    const trusted = this.crypto.trust_identity(current.store, pending.peerId, pending.identityKey)
    const store = this.crypto.wipe_session(trusted, pending.peerId)
    this.vault = {
      ...rememberStore(current, store),
      peers: {
        ...current.peers,
        [pending.peerId]: { ...current.peers[pending.peerId], identityKey: pending.identityKey, verifiedIdentityKey: null },
      },
      pendingTrust: null,
    }
    await this.save()
    await this.sync()
    return { ok: true }
  }

  async markVerified(handle: string) {
    const current = this.requireVault()
    const friend = this.friendByHandle(handle)
    this.vault = {
      ...current,
      peers: {
        ...current.peers,
        [friend.id]: {
          ...current.peers[friend.id],
          verifiedIdentityKey: friend.identityKey || current.peers[friend.id]?.identityKey || null,
        },
      },
    }
    await this.save()
    return { ok: true }
  }

  private async publishNewKeys(accountId: string, handle: string) {
    const generated = JSON.parse(this.crypto.generate_account(accountId)) as { store: object; bundle: PublicBundle }
    const vault: Vault = {
      accountId,
      handle,
      store: JSON.stringify(generated.store),
      accessKey: generated.bundle.accessKey,
      peers: {},
      messages: [],
      groups: {},
      queueTags: {},
      seen: [],
      pendingTrust: null,
      outbox: [],
      pendingAcks: [],
      revision: 0,
      pendingPublication: generated.bundle,
      sendAttempts: [],
    }
    this.vault = vault
    await this.save()
    await this.flushPublication()
    return this.requireVault()
  }

  private async flushPublication() {
    const current = this.requireVault()
    if (!current.pendingPublication) return
    await this.relay.request('/api/keys/bundle', { method: 'PUT', body: current.pendingPublication })
    this.vault = { ...this.requireVault(), pendingPublication: null }
    await this.save()
  }

  private async pull(): Promise<SyncResult> {
    const generation=this.generation
    await this.checkIdentity()
    let current = await this.flushAcks(this.requireVault())
    await this.refreshGraph()
    current = await this.flushOutbox(current)
    const before = new Set(current.messages.map((message) => message.id))
    await this.refreshGraph()
    current = await this.reconcileMembership(this.vault ?? current)
    const body = await this.relay.request<{ envelopes: Envelope[] }>('/api/envelopes')
    let next = this.vault ?? current
    const acked: string[] = []
    for (const envelope of body.envelopes) {
      if (next.pendingAcks.includes(envelope.id)) {
        acked.push(envelope.id)
        continue
      }
      const outcome = await this.acceptEnvelope(next, envelope)
      this.assertGeneration(generation)
      if (outcome.vault) {
        next = outcome.vault
        this.vault = next
      }
      if (outcome.ack) {
        next = { ...next, pendingAcks: [...new Set([...next.pendingAcks, envelope.id])] }
        this.vault = next
        await this.save()
        acked.push(envelope.id)
      }
    }
    if (acked.length) {
      await this.relay.request('/api/envelopes/ack', { method: 'POST', body: { ids: acked } })
      next = { ...(this.vault ?? next), pendingAcks: (this.vault ?? next).pendingAcks.filter((id) => !acked.includes(id)) }
      this.vault = next
    }
    await this.save()
    const messages = next.messages.filter((message) => !before.has(message.id)).map((message) => this.publish(message))
    return { messages, pendingTrustHandle: this.status().pendingTrustHandle }
  }

  private async storeAttachments(input: {
    handle?: string
    groupId?: string
    body?: string
    replyTo?: string
    expiresInSeconds?: number
    files: { name: string; mime: string; bytes: Uint8Array }[]
  }) {
    const current = this.requireVault()
    const expiresAt = input.expiresInSeconds ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() : null
    const attachments: Attachment[] = []
    let mediaCiphertext: string | null = null
    for (const file of input.files) {
      const sealed = await sealBytes(file.bytes)
      const uploaded = await this.relay.request<{ id: string }>('/api/media', {
        method: 'POST',
        body: {
          ciphertext: sealed.ciphertext,
          expiresAt,
          recipientAccountId: input.groupId ? null : this.friendByHandle(input.handle ?? '').id,
          groupId: input.groupId ?? null,
        },
      })
      await this.ports.saveBlob(uploaded.id, file.bytes)
      attachments.push({
        mediaId: uploaded.id,
        mime: file.mime || 'application/octet-stream',
        name: file.name,
        key: sealed.key,
        nonce: sealed.nonce,
      })
      mediaCiphertext ??= sealed.ciphertext.slice(0, 240)
    }
    return this.sendPayload({
      peerHandle: input.handle,
      groupId: input.groupId,
      body: input.body ?? '',
      replyTo: input.replyTo,
      expiresInSeconds: input.expiresInSeconds,
      attachments,
      mediaCiphertext,
      vault: current,
    })
  }

  private async sendPayload(input: {
    messageId?: string
    expiresAt?: string | null
    peerHandle?: string
    groupId?: string
    body: string
    replyTo?: string
    expiresInSeconds?: number
    attachments?: Attachment[]
    mediaCiphertext?: string | null
    vault?: Vault
  }) {
    await this.refreshGraph()
    let next = input.vault ?? this.requireVault()
    if (next.pendingTrust) {
      throw new HeadlessError(`Sending is blocked until you trust ${this.status().pendingTrustHandle}`, 'untrusted')
    }
    const text = input.body.trim()
    const attachments = input.attachments ?? []
    if (!text && attachments.length === 0) throw new HeadlessError('Message is empty', 'invalid')
    const messageId = input.messageId ?? crypto.randomUUID()
    const expiresAt = input.expiresAt!==undefined?input.expiresAt:input.expiresInSeconds ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString() : null
    const parent = input.replyTo ? next.messages.find((message) => message.id === input.replyTo) : undefined
    const payload: Payload = {
      kind: attachments.length ? 'media' : 'text',
      id: messageId,
      senderId: next.accountId,
      senderHandle: next.handle,
      body: text,
      replyTo: input.replyTo,
      quote: parent ? previewText(parent) : undefined,
      attachments: attachments.length ? attachments : undefined,
    }
    let envelopeCiphertext = ''
    let peerId: string | null = null
    let groupCiphertext = ''
    let groupMembers: string[] = []
    if (input.groupId) {
      next = await this.reconcileMembership(next)
      let group = next.groups[input.groupId]
      if (!group) throw new HeadlessError('That group is not on this device', 'invalid')
      if ((group.senderEpoch ?? 0) < (group.epoch ?? 1) || !hasOwnSenderKey(next.store, next.accountId, group.distributionId)) {
        next = await this.publishSenderKey(next, input.groupId, group.name, group.memberIds, group.epoch ?? 1)
        group = next.groups[input.groupId]
      }
      payload.epoch = group.epoch
      payload.groupId = input.groupId
      const encrypted = JSON.parse(this.crypto.group_encrypt_message(next.store, next.accountId, group.distributionId, JSON.stringify(payload))) as {
        store: object
        ciphertext: string
      }
      next = rememberStore(next, JSON.stringify(encrypted.store))
      envelopeCiphertext = encrypted.ciphertext
      groupCiphertext = encrypted.ciphertext
      groupMembers = group.memberIds
    } else if (input.peerHandle) {
      const friend = this.friendByHandle(input.peerHandle)
      peerId = friend.id
      next = await this.ensureSession(next, friend)
      let encrypted: { store: object; ciphertext: string }
      try {
        encrypted = JSON.parse(this.crypto.encrypt_message(next.store, next.accountId, friend.id, JSON.stringify(payload))) as {
          store: object
          ciphertext: string
        }
      } catch (reason) {
        if (!isUntrusted(reason)) throw reason
        next = rememberStore(next, this.crypto.wipe_session(next.store, friend.id))
        next = await this.ensureSession(next, friend)
        encrypted = JSON.parse(this.crypto.encrypt_message(next.store, next.accountId, friend.id, JSON.stringify(payload))) as {
          store: object
          ciphertext: string
        }
      }
      next = rememberStore(next, JSON.stringify(encrypted.store))
      envelopeCiphertext = encrypted.ciphertext
    } else {
      throw new HeadlessError('Send needs a handle or a groupId', 'invalid')
    }
    const stored: StoredMessage = {
      id: messageId,
      peerId: input.groupId ? null : peerId,
      groupId: input.groupId ?? null,
      body: text,
      fromMe: true,
      senderId: next.accountId,
      senderHandle: next.handle,
      replyTo: input.replyTo ?? null,
      quote: parent ? previewText(parent) : null,
      attachments,
      status: 'sent',
      envelopeCiphertext: envelopeCiphertext.slice(0, 240),
      mediaCiphertext: input.mediaCiphertext?.slice(0, 240) ?? null,
      expiresAt,
      at: new Date().toISOString(),
    }
    next = appendMessage(next, stored)
    if (input.groupId) {
      const tags: string[] = []
      for (const memberId of groupMembers) {
        if (memberId === next.accountId) continue
        const friend = this.friends.find((item) => item.id === memberId)
        if (!friend) continue
        next = await this.ensureSession(next, friend)
        const stamped = this.stampQueue(next, memberId, groupCiphertext, input.groupId, expiresAt, messageId)
        next = stamped.next
        tags.push(stamped.item.queueTag)
      }
      await this.commitVault(next)
      next = await this.drainTags(tags)
    } else if (peerId) {
      next = await this.postEnvelope(next, peerId, envelopeCiphertext, null, expiresAt, messageId)
    }
    this.vault = next
    await this.save()
    return this.publish(stored)
  }

  private async acceptEnvelope(current: Vault, envelope: Envelope): Promise<{ vault?: Vault; ack: boolean }> {
    const generation=this.generation
    if (envelope.groupId) {
      const remote = this.groups.find((group) => group.id === envelope.groupId)
      if (!remote || !remote.memberIds.includes(current.accountId)) return { ack: true }
      if(envelope.groupEpoch!=null&&remote.epoch!=null&&envelope.groupEpoch!==remote.epoch)return {ack:true}
      const members = remote.memberIds
      for (const memberId of members) {
        if (memberId === current.accountId) continue
        try {
          const opened = JSON.parse(this.crypto.group_decrypt_message(current.store, memberId, envelope.ciphertext)) as {
            store: object
            plaintext: string
          }
          const payload = JSON.parse(opened.plaintext) as Payload
          let next = { ...rememberStore(current, JSON.stringify(opened.store)), pendingAcks: [...new Set([...current.pendingAcks, envelope.id])] }
          const groupId = envelope.groupId
          if (payload.groupId !== groupId || (payload.senderId && payload.senderId !== memberId) ||
            (payload.epoch !== undefined && (!Number.isSafeInteger(payload.epoch) || payload.epoch < 1))) return { ack:true, vault:next }
          if(remote.epoch!=null&&payload.epoch!==remote.epoch)return {ack:true,vault:next}
          const local = next.groups[groupId]
          if (payload.kind === 'leave') {
            const epoch = payload.epoch ?? (local?.epoch ?? 1) + 1
            const senderId = memberId
            if (local && (local.senderEpoch ?? 0) < epoch) {
              const remoteIds = this.groups.find((group) => group.id === groupId)?.memberIds ?? local.memberIds
              const memberIds = remoteIds.filter((id) => id !== senderId)
              next = await this.publishSenderKey(next, groupId, local.name, memberIds, epoch)
            }
            return { ack: true, vault: next }
          }
          const localEpoch = next.groups[groupId]?.epoch ?? 1
          if ((typeof payload.epoch === 'number' && payload.epoch < localEpoch) || (payload.epoch == null && localEpoch > 1)) {
            return { ack: true, vault: next }
          }
          const sender = this.friends.find((friend) => friend.id === memberId)
          await this.keepAttachments(payload)
          next = appendMessage(next, {
            id: payload.id || envelope.id,
            peerId: null,
            groupId: envelope.groupId,
            body: payload.body ?? '',
            fromMe: false,
            senderId: memberId,
            senderHandle: sender?.handle ?? memberId,
            replyTo: payload.replyTo,
            quote: payload.quote,
            attachments: payload.attachments,
            envelopeCiphertext: envelope.ciphertext.slice(0, 240),
            expiresAt: envelope.expiresAt,
            at: new Date().toISOString(),
          })
          if (sender && payload.id) next = await this.sendReceipt(next, sender, payload.id)
          return { ack: true, vault: next }
        } catch {
          this.assertGeneration(generation)
          if (this.vault?.pendingAcks.includes(envelope.id)) return { ack: true, vault: this.vault }
          // Try the next member's sender key.
        }
      }
      return { ack: false }
    }
    for (const friend of this.friends) {
      try {
        const opened = JSON.parse(this.crypto.decrypt_message(current.store, current.accountId, friend.id, envelope.ciphertext)) as {
          store: object
          plaintext: string
        }
        const payload = JSON.parse(opened.plaintext) as Payload
        let next = { ...rememberStore(current, JSON.stringify(opened.store)), pendingAcks: [...new Set([...current.pendingAcks, envelope.id])] }
        if (payload.kind === 'receipt' && payload.messageId) {
          return {
            ack: true,
            vault: {
              ...next,
              messages: next.messages.map((message) => (message.id === payload.messageId ? { ...message, status: 'delivered' } : message)),
            },
          }
        }
        if (payload.kind === 'group-setup' && payload.groupId && payload.distribution && payload.distributionId) {
          const groupBody = await this.relay.request<{ groups: GroupRecord[] }>('/api/groups')
          this.groups = groupBody.groups
          const memberIds = groupBody.groups.find((group) => group.id === payload.groupId)?.memberIds ?? []
          if(!memberIds.includes(current.accountId)||!memberIds.includes(friend.id))return {ack:true,vault:next}
          const name = payload.name ?? next.groups[payload.groupId]?.name ?? 'Group'
          const incomingEpoch = payload.epoch ?? 1
          const local = next.groups[payload.groupId]
          if(!Number.isSafeInteger(incomingEpoch)||incomingEpoch<1||incomingEpoch<(local?.epoch??1))return {ack:true,vault:next}
          const remoteEpoch=groupBody.groups.find(group=>group.id===payload.groupId)?.epoch
          if(remoteEpoch!=null&&remoteEpoch!==incomingEpoch)return {ack:true,vault:next}
          next = rememberStore(next, this.crypto.process_sender_key(next.store, friend.id, payload.distribution))
          const senderEpoch = local?.senderEpoch ?? 0
          next = {
            ...next,
            groups: {
              ...next.groups,
              [payload.groupId]: {
                name,
                distributionId: local?.distributionId ?? '',
                memberIds,
                epoch: Math.max(local?.epoch ?? 1, incomingEpoch),
                senderEpoch,
              },
            },
          }
          const ownId = next.groups[payload.groupId].distributionId
          const currentKey = Boolean(ownId) && hasOwnSenderKey(next.store, next.accountId, ownId)
          if (senderEpoch < incomingEpoch || !currentKey) {
            next = await this.publishSenderKey(next, payload.groupId, name, memberIds, incomingEpoch)
          }
          return { ack: true, vault: next }
        }
        await this.keepAttachments(payload)
        next = appendMessage(next, {
          id: payload.id || envelope.id,
          peerId: friend.id,
          groupId: null,
          body: payload.body ?? '',
          fromMe: false,
          senderId: friend.id,
          senderHandle: friend.handle,
          replyTo: payload.replyTo,
          quote: payload.quote,
          attachments: payload.attachments,
          envelopeCiphertext: envelope.ciphertext.slice(0, 240),
          expiresAt: envelope.expiresAt,
          at: new Date().toISOString(),
        })
        if (payload.id) next = await this.sendReceipt(next, friend, payload.id)
        return { ack: true, vault: next }
      } catch (reason) {
        this.assertGeneration(generation)
        if (this.vault?.pendingAcks.includes(envelope.id)) return { ack: true, vault: this.vault }
        if (!isUntrusted(reason)) continue
        let presented = ''
        try {
          presented = this.crypto.prekey_identity(envelope.ciphertext)
        } catch {
          continue
        }
        if (!presented || presented !== friend.identityKey) continue
        if (current.peers[friend.id]?.identityKey === presented) continue
        return { ack: false, vault: { ...current, pendingTrust: { peerId: friend.id, identityKey: presented } } }
      }
    }
    return { ack: false }
  }

  private async ensureSession(current: Vault, friend: Friend) {
    const known = hasSession(current.store, friend.id)
    const previousIdentity = current.peers[friend.id]?.identityKey
    if (known && previousIdentity && friend.identityKey && previousIdentity !== friend.identityKey) {
      this.vault = {
        ...current,
        peers: {
          ...current.peers,
          [friend.id]: {
            ...current.peers[friend.id],
            identityKey: friend.identityKey,
            verifiedIdentityKey: current.peers[friend.id]?.verifiedIdentityKey ?? null,
          },
        },
        pendingTrust: { peerId: friend.id, identityKey: friend.identityKey },
      }
      await this.save()
      throw new HeadlessError(`Identity for ${friend.handle} changed. Call trustIdentity before sending.`, 'untrusted')
    }
    if (known && current.peers[friend.id]?.accessKey) return current
    const { bundle } = await this.relay.request<{ bundle: PublicBundle }>(`/api/keys/${friend.id}`)
    const peers = {
      ...current.peers,
      [friend.id]: {
        identityKey: bundle.identityKey,
        accessKey: bundle.accessKey,
        verifiedIdentityKey: current.peers[friend.id]?.verifiedIdentityKey ?? null,
      },
    }
    if (known) return { ...current, peers }
    try {
      const store = this.crypto.establish_session(current.store, current.accountId, friend.id, JSON.stringify(bundle))
      return { ...rememberStore(current, store), peers }
    } catch (reason) {
      if (isUntrusted(reason)) {
        this.vault = { ...current, peers, pendingTrust: { peerId: friend.id, identityKey: bundle.identityKey } }
        throw new HeadlessError(`Identity for ${friend.handle} changed. Call trustIdentity before sending.`, 'untrusted')
      }
      throw reason
    }
  }

  private stampQueue(current: Vault, recipientId: string, ciphertext: string, groupId: string | null, expiresAt: string | null, messageId?:string) {
    const queueTag = crypto.randomUUID()
    const tags = current.queueTags[recipientId] ?? []
    const item: OutboxItem = { queueTag, recipientId, ciphertext, groupId, expiresAt, messageId,
      ...(groupId?{groupEpoch:current.groups[groupId]?.epoch??1}:{}) }
    const next: Vault = {
      ...current,
      outbox: [...current.outbox, item],
      queueTags: { ...current.queueTags, [recipientId]: [...tags, queueTag] },
    }
    return { next, item }
  }

  private async commitVault(next: Vault) {
    this.vault = next
    await this.save()
    return this.requireVault()
  }

  private async drainTags(tags: string[]) {
    let next = this.requireVault()
    for (const tag of tags) {
      const item = next.outbox.find((pending) => pending.queueTag === tag)
      if (!item) continue
      await this.deliver(next, item.queueTag, item.recipientId, item.ciphertext, item.groupId, item.expiresAt)
      this.vault = { ...this.requireVault(), outbox: this.requireVault().outbox.filter((pending) => pending.queueTag !== tag) }
      await this.save()
      next = this.requireVault()
    }
    return next
  }

  private async postEnvelope(current: Vault, recipientId: string, ciphertext: string, groupId: string | null, expiresAt: string | null,messageId?:string) {
    const stamped = this.stampQueue(current, recipientId, ciphertext, groupId, expiresAt,messageId)
    await this.commitVault(stamped.next)
    await this.drainTags([stamped.item.queueTag])
    return this.requireVault()
  }

  private async deliver(current: Vault, queueTag: string, recipientId: string, ciphertext: string, groupId: string | null, expiresAt: string | null) {
    await this.relay.request('/api/envelopes', {
      method: 'POST',
      body: {
        recipientAccountId: recipientId,
        ciphertext,
        accessKey: current.peers[recipientId]?.accessKey,
        groupId,
        ...(groupId?{groupEpoch:current.outbox.find(item=>item.queueTag===queueTag)?.groupEpoch??current.groups[groupId]?.epoch??1}:{}),
        expiresAt,
        queueTag,
      },
    })
  }

  private async sendReceipt(current: Vault, friend: Friend, messageId: string) {
    const generation=this.generation
    try {
      let next = await this.ensureSession(current, friend)
      const encrypted = JSON.parse(this.crypto.encrypt_message(next.store, next.accountId, friend.id, JSON.stringify({ kind: 'receipt', messageId }))) as {
        store: object
        ciphertext: string
      }
      next = rememberStore(next, JSON.stringify(encrypted.store))
      return await this.postEnvelope(next, friend.id, encrypted.ciphertext, null, null)
    } catch {
      this.assertGeneration(generation)
      return this.vault ?? current
    }
  }

  private async fanOutSetup(current: Vault, groupId: string, name: string, distributionId: string, distribution: string, memberIds: string[], epoch: number) {
    let next = current
    const tags: string[] = []
    for (const memberId of memberIds) {
      if (memberId === next.accountId) continue
      const friend = this.friends.find((item) => item.id === memberId)
      if (!friend) continue
      next = await this.ensureSession(next, friend)
      const setup = JSON.stringify({ kind: 'group-setup', groupId, distributionId, distribution, name, epoch })
      const encrypted = JSON.parse(this.crypto.encrypt_message(next.store, next.accountId, memberId, setup)) as {
        store: object
        ciphertext: string
      }
      next = rememberStore(next, JSON.stringify(encrypted.store))
      const stamped = this.stampQueue(next, memberId, encrypted.ciphertext, null, null)
      next = stamped.next
      tags.push(stamped.item.queueTag)
    }
    next = { ...next, groups: { ...next.groups, [groupId]: { name, distributionId, memberIds, epoch, senderEpoch: epoch } } }
    await this.commitVault(next)
    return this.drainTags(tags)
  }

  private async publishSenderKey(current: Vault, groupId: string, name: string, memberIds: string[], epoch: number) {
    const distributionId = crypto.randomUUID()
    const created = JSON.parse(this.crypto.create_sender_key(current.store, current.accountId, distributionId)) as {
      store: object
      distribution: string
    }
    return this.fanOutSetup(rememberStore(current, JSON.stringify(created.store)), groupId, name, distributionId, created.distribution, memberIds, epoch)
  }

  private async keepAttachments(payload: Payload) {
    const generation=this.generation
    for (const attachment of payload.attachments ?? []) {
      try {
        const body = await this.relay.request<{ ciphertext: string }>(`/api/media/${attachment.mediaId}`)
        const bytes = await openBytes(body.ciphertext, attachment.key, attachment.nonce)
        await this.ports.saveBlob(attachment.mediaId, bytes)
      } catch {
        this.assertGeneration(generation)
        // The message still carries the file name.
      }
    }
  }

  private async refreshGraph() {
    const generation=this.generation
    const friendBody = await this.relay.request<{ friends: Friend[] }>('/api/friends')
    const groupBody = await this.relay.request<{ groups: GroupRecord[] }>('/api/groups')
    this.assertGeneration(generation)
    this.friends = friendBody.friends
    this.groups = groupBody.groups
  }

  private publish(message: StoredMessage): PublicMessage {
    const current = this.vault
    const friend = this.friends.find((item) => item.id === message.peerId)
    return {
      id: message.id,
      peerId: message.peerId,
      handle: message.groupId ? message.senderHandle ?? null : friend?.handle ?? message.senderHandle ?? null,
      groupId: message.groupId,
      groupName: message.groupId ? current?.groups[message.groupId]?.name ?? null : null,
      body: message.body,
      fromMe: message.fromMe,
      replyTo: message.replyTo ?? null,
      quote: message.quote ?? null,
      at: message.at,
      unseen: current ? isUnseen(message, current) : !message.fromMe,
      status: message.status ?? null,
      system: Boolean(message.system),
      attachmentNames: (message.attachments ?? []).map((attachment) => attachment.name),
      serverCiphertext: message.envelopeCiphertext ?? null,
    }
  }

  private matches(message: StoredMessage, filter: { handle?: string; groupId?: string }) {
    if (filter.groupId) return message.groupId === filter.groupId
    if (filter.handle) {
      const friend = this.friends.find((item) => item.handle === filter.handle!.trim().toLowerCase())
      return Boolean(friend && message.peerId === friend.id && !message.groupId)
    }
    return true
  }

  private friendByHandle(handle: string) {
    const found = this.friends.find((friend) => friend.handle === handle.trim().toLowerCase())
    if (!found) throw new HeadlessError(`No friend named ${handle}`, 'invalid')
    return found
  }

  private openNote(current: Vault, ciphertext: string) {
    try {
      return this.crypto.open_note(current.store, ciphertext)
    } catch {
      return null
    }
  }

  private requireVault() {
    this.expireAuthorization()
    if (!this.vault) throw new HeadlessError('Call unlock before using the session', 'locked')
    return this.vault
  }

  private async readVault() {
    const vault = await this.ports.loadVault()
    if (!vault) return null
    vault.messages ??= []
    if (vault.seen == null) vault.seen = vault.messages.map((message) => message.id)
    vault.pendingTrust ??= null
    vault.peers ??= {}
    vault.groups ??= {}
    vault.queueTags ??= {}
    vault.messages ??= []
    vault.outbox ??= []
    vault.pendingAcks ??= []
    vault.sendAttempts ??= []
    vault.blockedOutbox ??= []
    vault.revision ??= 0
    for (const peer of Object.values(vault.peers)) {
      const legacy = peer as { verified?: boolean; identityKey?: string; verifiedIdentityKey?: string | null }
      if (legacy.verified && legacy.identityKey && !legacy.verifiedIdentityKey) legacy.verifiedIdentityKey = legacy.identityKey
      delete legacy.verified
    }
    for (const group of Object.values(vault.groups)) {
      group.epoch ??= 1
      group.senderEpoch ??= group.distributionId ? group.epoch : 0
    }
    return vault
  }

  private async save() {
    const generation=this.generation
    if (!this.vault) return
    const disk = await this.ports.loadVault()
    this.assertGeneration(generation)
    const diskRevision = disk && disk.accountId === this.vault.accountId ? disk.revision ?? 0 : 0
    if (diskRevision > this.seenRevision) {
      throw new HeadlessError('This vault was saved by a newer writer', 'invalid')
    }
    const expectedRevision = Math.max(this.seenRevision, diskRevision)
    const next = { ...this.vault, revision: expectedRevision + 1 }
    try {
      await this.ports.saveVault(next, expectedRevision)
      this.assertGeneration(generation)
      if (!this.vault) throw new HeadlessError('Session was locked during commit', 'locked')
      this.seenRevision = next.revision
      this.vault = next
    } catch (error) {
      // Reopen committed state, including the durable outbox if only the response was lost.
      if (this.vault) {
        const recovered=await this.ports.loadVault()
        if(generation===this.generation&&this.vault){this.vault = recovered;this.seenRevision = this.vault?.revision ?? 0}
      }
      throw error
    }
  }

  private noteRevision(vault: Vault | null) {
    if (vault) this.seenRevision = Math.max(this.seenRevision, vault.revision ?? 0)
  }

  private async flushAcks(current: Vault) {
    if (!current.pendingAcks.length) return current
    await this.relay.request('/api/envelopes/ack', { method: 'POST', body: { ids: current.pendingAcks } })
    this.vault = { ...current, pendingAcks: [] }
    await this.save()
    return this.requireVault()
  }

  private async flushOutbox(current: Vault) {
    let next = current
    for (const item of [...current.outbox]) {
      const remote=item.groupId?this.groups.find(group=>group.id===item.groupId):undefined
      const changed=item.groupId
        ?!remote||!remote.memberIds.includes(item.recipientId)||(remote.epoch!=null&&item.groupEpoch!==remote.epoch)
        :!this.friends.some(friend=>friend.id===item.recipientId)
      if(changed){
          const latest=this.requireVault()
          this.vault={...latest,outbox:latest.outbox.filter(pending=>pending.queueTag!==item.queueTag),
            blockedOutbox:[...(latest.blockedOutbox??[]),item],
            sendAttempts:(latest.sendAttempts??[]).map(attempt=>attempt.id===item.messageId?{...attempt,blockedReason:'membership-changed' as const}:attempt)}
          await this.save();next=this.requireVault();continue
      }
      await this.deliver(next, item.queueTag, item.recipientId, item.ciphertext, item.groupId, item.expiresAt)
      const latest=this.requireVault()
      this.vault = { ...latest, outbox: latest.outbox.filter((pending) => pending.queueTag !== item.queueTag) }
      await this.save()
      next = this.requireVault()
    }
    return next
  }

  private async reconcileMembership(current: Vault) {
    let next = current
    for (const remote of this.groups) {
      const local = next.groups[remote.id]
      if (!local) continue
      const epoch = remote.epoch ?? local.epoch ?? 1
      const ownEpoch = local.senderEpoch ?? 0
      const ownKey = Boolean(local.distributionId) && hasOwnSenderKey(next.store, next.accountId, local.distributionId)
      if (!sameMembers(local.memberIds, remote.memberIds) || epoch > (local.epoch??1)) {
        next = await this.publishSenderKey(next, remote.id, local.name, remote.memberIds, remote.epoch ?? epoch + 1)
        continue
      }
      if (!ownKey || ownEpoch < epoch) {
        next = await this.publishSenderKey(next, remote.id, local.name, remote.memberIds, epoch)
      }
    }
    this.vault = next
    return next
  }

  private exclusive<T>(work: () => Promise<T>) {
    const generation=this.generation
    const guarded=async()=>{this.assertGeneration(generation);const result=await work();this.assertGeneration(generation);return result}
    const run = this.chain.then(guarded, guarded)
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
  private assertGeneration(generation:number){if(generation!==this.generation)throw new HeadlessError('Session was locked during this operation','locked')}

  private expireAuthorization() {
    if(this.authorizationExpiresAt&&Date.parse(this.authorizationExpiresAt)<=Date.now())this.lock()
  }

  private async verifyAuthorization(expectedAccountId: string) {
    const generation=this.generation
    const binding=this.authorization
    const response=await this.relay.request<AuthorizedBootstrap>(binding.bootstrapPath)
    this.assertGeneration(generation)
    try {
      const verified=validateBootstrap(response,binding,expectedAccountId)
      this.authorizationExpiresAt=verified.expiresAt??null
      return verified
    } catch(error) {
      this.lock()
      throw error
    }
  }
}

function rememberStore(current: Vault, store: string): Vault {
  const parsed = store.startsWith('{') ? (JSON.parse(store) as { access_key?: string }) : null
  return {
    ...current,
    store: store.startsWith('{') ? store : JSON.stringify(store),
    accessKey: parsed?.access_key ?? current.accessKey,
  }
}

function appendMessage(current: Vault, message: StoredMessage): Vault {
  if (current.messages.some((existing) => existing.id === message.id)) return current
  return { ...current, messages: [...current.messages, message] }
}

function hasSession(store: string, peerId: string) {
  const parsed = JSON.parse(store) as { sessions?: { name: string }[] }
  return parsed.sessions?.some((session) => session.name === peerId) ?? false
}

function sameMembers(left: string[], right: string[]) {
  return [...left].sort().join() === [...right].sort().join()
}

function isUntrusted(reason: unknown) {
  return /untrusted/i.test(String(reason))
}

function identityVerified(peer: { identityKey?: string; verifiedIdentityKey?: string | null } | undefined, shown: string | null | undefined) {
  return Boolean(shown && peer?.verifiedIdentityKey && peer.verifiedIdentityKey === shown)
}

function hasOwnSenderKey(store: string, accountId: string, distributionId: string) {
  const parsed = JSON.parse(store) as { sender_keys?: { sender: string; distribution_id: string }[] }
  return parsed.sender_keys?.some((entry) => entry.sender === accountId && entry.distribution_id === distributionId) ?? false
}

function isUnseen(message: StoredMessage, vault: Vault) {
  if (message.fromMe || message.system) return false
  return !vault.seen.includes(message.id)
}

function live(message: StoredMessage) {
  return !message.expiresAt || Date.parse(message.expiresAt) > Date.now()
}

function previewText(message: StoredMessage) {
  if (message.system) return message.body
  if (message.body) return message.body
  return message.attachments?.[0]?.name || 'File'
}

function groupedSafety(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.match(/.{1,5}/g)?.join(' ') ?? value
}
