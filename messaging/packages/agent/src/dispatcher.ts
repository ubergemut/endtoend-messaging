import { HeadlessError, type Session, type SignalPort } from '@e2ee/session'
import type { AgentRequest, AgentResponse } from '@e2ee/protocol'
import {isAgentRequest, OPERATIONS} from '@e2ee/protocol'
import {licenseInfo,type SourceInfo} from './sourceInfo.ts'

export type AgentContext = {
  session(): Session | null
  status?(): unknown
  signal: SignalPort
  unlock?(input: Record<string, unknown>): Promise<unknown>
  attach?(input: Record<string, unknown>): Promise<unknown>
  requestUnlock?(): Promise<unknown>
  setStay?(stay:string): Promise<unknown>
  confirm?(operation: 'trustIdentity' | 'markVerified', input: Record<string, unknown>): Promise<unknown>
  lock(): void
  disconnect?(): void
  close?(): Promise<void>
  sourceInfo?:SourceInfo
}

export type IdentityApproval =
  | { operation: 'trustIdentity'; peerId: string; identityKey: string }
  | { operation: 'markVerified'; handle: string; safetyNumber: string }

function text(input: Record<string, unknown>, name: string, optional = false): string | undefined {
  const value = input[name]
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.length > (name==='base64'?36*1024*1024:8*1024*1024)) throw new HeadlessError(`Invalid ${name}`, 'invalid')
  return value
}
function list(input: Record<string, unknown>, name: string): string[] {
  const value = input[name]
  if (!Array.isArray(value) || value.length > 10000 || value.some(item => typeof item !== 'string' || item.length > 512)) throw new HeadlessError(`Invalid ${name}`, 'invalid')
  return value
}
function timer(input: Record<string, unknown>) {
  if (input.expiresInSeconds === undefined) return undefined
  if (!Number.isSafeInteger(input.expiresInSeconds) || Number(input.expiresInSeconds) <= 0) throw new HeadlessError('Invalid disappearing timer', 'invalid')
  return Number(input.expiresInSeconds)
}
function base64(bytes: Uint8Array) {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) result += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(result)
}
function bytes(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new HeadlessError('Invalid attachment base64', 'invalid')
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

/** Explicit data projections. Never return a Session, Vault, attachment key or ratchet store. */
export function views(session: Session) {
  const vault = session.record
  if (!vault) throw new HeadlessError('Agent is locked', 'locked')
  return {
    accountId: vault.accountId, handle: vault.handle,
    messages: vault.messages.filter(message=>!message.expiresAt||Date.parse(message.expiresAt)>Date.now()).map(message => ({ id:message.id,peerId:message.peerId,groupId:message.groupId,body:message.body,fromMe:message.fromMe,
      senderId:message.senderId,senderHandle:message.senderHandle,expiresAt:message.expiresAt,at:message.at,replyTo:message.replyTo,quote:message.quote,
      status:message.status,system:message.system,envelopeCiphertext:message.envelopeCiphertext,mediaCiphertext:message.mediaCiphertext,
      attachments: (message.attachments ?? []).map(({ mediaId, name, mime }) => ({ mediaId, name, mime })),
    })),
    friends: session.friendRecords.map(friend => ({ ...friend,
      verified: !!friend.identityKey && vault.peers[friend.id]?.verifiedIdentityKey === friend.identityKey,
    })),
    groups: session.groupRecords.map(group => ({ id: group.id, name: vault.groups[group.id]?.name ?? 'Group', memberIds: group.memberIds,
      memberHandles: group.memberIds.map(id => session.friendRecords.find(friend => friend.id === id)?.handle ?? id) })),
    seen: [...vault.seen], peers: Object.fromEntries(Object.entries(vault.peers).map(([id, peer]) => [id,
      { identityKey: peer.identityKey, verifiedIdentityKey: peer.verifiedIdentityKey ?? null }])),
    pendingTrust: vault.pendingTrust, revision: vault.revision,
  }
}

export function createDispatcher(context: AgentContext) {
  let queue: Promise<unknown> = Promise.resolve()
  let generation = 0
  async function run(request: AgentRequest): Promise<unknown> {
    const input = request.input
    const session = context.session()
    switch (request.operation) {
      case 'license': return licenseInfo(context.sourceInfo)
      case 'capabilities': return {version:1,protocolVersion:1,operations:[...OPERATIONS],events:[],cancellation:'local-only',operationIds:'send-idempotency',attachments:'base64'}
      case 'status': return context.status?.() ?? session?.status() ?? { unlocked: false }
      case 'attach':
        if (!context.attach) throw new HeadlessError('Attach is unavailable in this agent', 'invalid')
        return context.attach(input)
      case 'requestUnlock': return context.requestUnlock ? context.requestUnlock() : context.status?.() ?? session?.status()
      case 'setStay': {
        const stay=text(input,'stay')!
        if(!['tab','day','week','month','forever'].includes(stay))throw new HeadlessError('Invalid remembered-unlock duration','invalid')
        return context.setStay?context.setStay(stay):{stay}
      }
      case 'unlock':
        if (context.unlock) return context.unlock(input)
        if (!session) throw new HeadlessError('Agent is unavailable', 'locked')
        if (input.replaceKeys !== undefined && typeof input.replaceKeys !== 'boolean') throw new HeadlessError('Invalid replaceKeys', 'invalid')
        return session.unlock({ handle: text(input,'handle')!, password: text(input,'password')!, replaceKeys: input.replaceKeys as boolean | undefined })
      case 'cryptoDiagnostic': {
        const a = JSON.parse(context.signal.generate_account('diagnostic-alice'))
        const b = JSON.parse(context.signal.generate_account('diagnostic-bob'))
        const established = context.signal.establish_session(JSON.stringify(a.store),'diagnostic-alice','diagnostic-bob',JSON.stringify(b.bundle))
        const encrypted = JSON.parse(context.signal.encrypt_message(established,'diagnostic-alice','diagnostic-bob','agent diagnostic'))
        const decrypted = JSON.parse(context.signal.decrypt_message(JSON.stringify(b.store),'diagnostic-bob','diagnostic-alice',encrypted.ciphertext))
        if (decrypted.plaintext !== 'agent diagnostic') throw new Error('Cryptographic self-check failed')
        const stranger=JSON.parse(context.signal.generate_account('diagnostic-stranger'))
        let refused=false
        try { context.signal.decrypt_message(JSON.stringify(stranger.store),'diagnostic-stranger','diagnostic-alice',encrypted.ciphertext) } catch {refused=true}
        if(!refused)throw new Error('Stranger decrypted diagnostic message')
        return { ok: true, message: 'PASS browser PQXDH round trip', description: 'PQXDH round trip and stranger refusal passed' }
      }
    }
    if (!session?.status().unlocked) throw new HeadlessError('Unlock the messaging agent first', 'locked')
    const filter = { handle: text(input,'handle',true), groupId: text(input,'groupId',true) }
    const send = { ...filter, body: text(input,'body',true) ?? '', replyTo: text(input,'replyTo',true),
      expiresInSeconds: timer(input), operationId: request.operationId ?? request.requestId }
    switch (request.operation) {
      case 'views': await session.dropExpired();return views(session)
      case 'sync': return session.sync()
      case 'friends': case 'friendsList': return session.friendsList()
      case 'requests': return session.requests()
      case 'requestFriend': return session.requestFriend(text(input,'handle')!, text(input,'note',true))
      case 'respondRequest': {
        const action = text(input,'action')
        if (action !== 'accept' && action !== 'decline' && action !== 'cancel') throw new HeadlessError('Invalid request action','invalid')
        return session.respondRequest(text(input,'id')!, action)
      }
      case 'block': return session.block(text(input,'handle')!)
      case 'unfriend': return session.unfriend(text(input,'handle')!)
      case 'chats': return session.chats()
      case 'messages': return session.messages(filter)
      case 'focus': return session.focus(filter)
      case 'markSeen': return session.markSeen(list(input,'ids'))
      case 'dropExpired': return session.dropExpired()
      case 'send': return session.send({ ...send, handle: text(input,'handle')! })
      case 'sendGroup': return session.sendGroup({ ...send, groupId: text(input,'groupId')! })
      case 'sendFile': return session.sendFile({ ...send, name: text(input,'name')!, mime: text(input,'mime')!, base64: text(input,'base64')! })
      case 'sendAttachments': {
        if (!Array.isArray(input.files)) throw new HeadlessError('Invalid attachment list','invalid')
        const files = input.files.map(value => {
          if (!value || typeof value !== 'object') throw new HeadlessError('Invalid attachment','invalid')
          const file = value as Record<string,unknown>
          return { name: text(file,'name')!, mime: text(file,'mime')!, bytes: bytes(text(file,'base64')!) }
        })
        return session.sendAttachments({ ...send, files })
      }
      case 'pendingSends': return session.pendingSends()
      case 'retryPending': return session.retryPending()
      case 'attachment': return { base64: base64(await session.attachment(text(input,'mediaId')!)) }
      case 'createGroup': return session.createGroup(text(input,'name')!, list(input,'handles'))
      case 'groups': case 'groupsList': return session.groupsList()
      case 'addMember': return session.addMember(text(input,'groupId')!, text(input,'accountId')!)
      case 'removeMember': return session.removeMember(text(input,'groupId')!, text(input,'memberId')!)
      case 'leaveGroup': return session.leaveGroup(text(input,'groupId')!)
      case 'safetyNumber': return session.safetyNumber(text(input,'handle')!)
      case 'trustIdentity': return context.confirm ? context.confirm('trustIdentity',input) : session.trustIdentity(text(input,'handle',true))
      case 'markVerified': return context.confirm ? context.confirm('markVerified',input) : session.markVerified(text(input,'handle')!)
      default: throw new HeadlessError('Unknown agent operation','invalid')
    }
  }
  return {
    async dispatch(raw: unknown): Promise<AgentResponse> {
      const request = raw as AgentRequest
      const requestId = typeof request?.requestId === 'string' ? request.requestId : ''
      try {
        if (!isAgentRequest(request)) throw new HeadlessError('Invalid protocol request','invalid')
        if (request.operation === 'lock' || request.operation === 'close' || request.operation === 'disconnect') {
          generation += 1
          if (request.operation === 'disconnect' && context.disconnect) context.disconnect()
          else context.lock()
          if (request.operation === 'close') await context.close?.()
          return { version:1, requestId, ok:true, result:{ unlocked:false } }
        }
        if(request.operation==='attach') {
          // A new attachment is an authority boundary, including while a prior command awaits I/O.
          generation+=1
          if(context.disconnect)context.disconnect();else context.lock()
        }
        const captured = generation
        const work = queue.then(async () => {
          if (captured !== generation) throw new HeadlessError('Caller was revoked','locked')
          const result = await run(request)
          if (captured !== generation) throw new HeadlessError('Caller was revoked','locked')
          return result
        })
        queue = work.then(() => undefined, () => undefined)
        return { version:1, requestId, ok:true, result:await work }
      } catch (error) {
        return { version:1, requestId, ok:false, error:{ code:error instanceof HeadlessError ? error.code : 'internal',
          message:error instanceof Error ? error.message : 'Agent command failed' } }
      }
    },
    revoke(forget = true) { generation += 1; if (!forget && context.disconnect) context.disconnect(); else context.lock() },
    async trusted(operation: 'trustIdentity' | 'markVerified', input: Record<string,unknown>, approval: IdentityApproval) {
      const captured=generation
      const work=queue.then(async()=>{
        if(captured!==generation)throw new HeadlessError('Caller was revoked','locked')
        const session=context.session()
        if(!session?.status().unlocked)throw new HeadlessError('Agent is locked','locked')
        if(approval.operation!==operation)throw new HeadlessError('Identity approval does not match the requested decision','invalid')
        if(approval.operation==='trustIdentity'){
          const pending=session.record?.pendingTrust
          if(!pending||pending.peerId!==approval.peerId||pending.identityKey!==approval.identityKey)throw new HeadlessError('The identity waiting for trust changed. Review and approve it again.','untrusted')
        }else{
          if(text(input,'handle')!==approval.handle||(await session.safetyNumber(approval.handle)).safetyNumber!==approval.safetyNumber)throw new HeadlessError('The safety number changed. Compare and approve it again.','untrusted')
          if(captured!==generation||context.session()!==session||!session.status().unlocked)throw new HeadlessError('Caller was revoked','locked')
        }
        return operation==='trustIdentity'?session.trustIdentity(text(input,'handle',true)):session.markVerified(text(input,'handle')!)
      })
      queue=work.then(()=>undefined,()=>undefined)
      return work
    },
  }
}
