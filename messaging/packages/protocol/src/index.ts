/** Wire-only contracts. This package deliberately has no implementation dependencies. */
export const PROTOCOL_VERSION = 1 as const
export const VERSION = PROTOCOL_VERSION
export const SDK_VERSION = '0.2.1' as const

export type AgentRequest = {
  version: 1
  requestId: string
  operation: string
  input: Record<string, unknown>
  operationId?: string
}
export type AgentResponse<T = unknown> =
  | { version: 1; requestId: string; ok: true; result: T }
  | { version: 1; requestId: string; ok: false; error: { code: string; message: string } }
export const AGENT_EVENTS = ['views', 'status', 'locked', 'revoked', 'disconnected'] as const
export type AgentEventName = typeof AGENT_EVENTS[number]
export type AgentEvent = { version: 1; event: AgentEventName; revision: number; accountId?: string | null; reason?: string }
export function isAgentEvent(value: unknown): value is AgentEvent {
  return isRecord(value) && value.version === 1 && AGENT_EVENTS.includes(value.event as AgentEventName)
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
    && (value.accountId === undefined || value.accountId === null || typeof value.accountId === 'string')
    && (value.reason === undefined || typeof value.reason === 'string')
}

/** Known v1 codes; consumers must retain an unknown-code fallback for additive releases. */
export const ERROR_CODES = ['invalid', 'unauthorized', 'forbidden', 'locked', 'untrusted', 'replace-keys',
  'vault', 'device-key', 'relay', 'internal', 'protocol', 'timeout', 'cancelled', 'closed', 'revoked'] as const
export type AgentErrorCode = typeof ERROR_CODES[number]

export class AgentError extends Error {
  constructor(message: string, readonly code: string = 'invalid') {
    super(message)
    this.name = 'AgentError'
  }
}
/** Compatibility name for adapters; this error contains no session implementation. */
export { AgentError as HeadlessError }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function isAgentRequest(value: unknown): value is AgentRequest {
  if (!isRecord(value)) return false
  return value.version === 1 && validId(value.requestId) && typeof value.operation === 'string'
    && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(value.operation) && isRecord(value.input)
    && (value.operationId === undefined || validId(value.operationId))
}
export function isAgentResponse(value: unknown): value is AgentResponse {
  if (!isRecord(value) || value.version !== 1 || !validId(value.requestId)) return false
  if (value.ok === true) return Object.hasOwn(value, 'result')
  return value.ok === false && isRecord(value.error)
    && typeof value.error.code === 'string' && typeof value.error.message === 'string'
}
export function validateRequest(value: unknown): AgentRequest {
  if (!isAgentRequest(value)) throw new AgentError('Invalid protocol v1 request', 'invalid')
  return value
}
export const validateAgentRequest = validateRequest
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value)
}

export type Account = { id: string; handle: string; displayName: string }
export type FriendView = Account & { identityKey: string | null; verified: boolean }
/** List command returns verification state; full views additionally contain the public identity. */
export type FriendSummary = Omit<FriendView, 'identityKey'>
export type Friend = FriendView
export type FriendRequestView = {
  id: string; direction: 'incoming' | 'outgoing'; handle: string; status: string; note: string | null
}
/** Read handles and presentation metadata only; encryption keys/nonces never cross the interface. */
export type AttachmentView = { mediaId: string; mime: string; name: string }
export type Attachment = AttachmentView
export type MessageView = {
  id: string; peerId: string | null; groupId: string | null; body: string; fromMe: boolean
  senderId?: string | null; senderHandle?: string | null; expiresAt: string | null; at: string
  replyTo?: string | null; quote?: string | null; status?: 'sent' | 'delivered'; system?: boolean
  envelopeCiphertext?: string | null; mediaCiphertext?: string | null; attachments?: AttachmentView[]
}
export type GroupView = { id: string; name: string; memberIds: string[]; memberHandles: string[] }
export type PublicPeer = { identityKey?: string; verifiedIdentityKey?: string | null }
export type AgentViews = {
  accountId?: string; handle?: string
  messages: MessageView[]; friends: FriendView[]; groups: GroupView[]; seen: string[]
  peers: Record<string, PublicPeer>; pendingTrust: { peerId: string; identityKey: string } | null; revision: number
}
export type PublicMessage = {
  id: string; peerId: string | null; handle: string | null; groupId: string | null; groupName: string | null
  body: string; fromMe: boolean; replyTo: string | null; quote: string | null; at: string
  unseen: boolean; status: string | null; system: boolean; attachmentNames: string[]; serverCiphertext: string | null
}
export type ChatSummary = {
  peerId: string | null; groupId: string | null; handle: string | null; title: string; preview: string; at: string; unseen: number
}
export type Status = {
  unlocked: boolean; handle: string | null; accountId: string | null; relay: string; vaultPath: string; pendingTrustHandle: string | null
}
export type SyncResult = { messages: PublicMessage[]; pendingTrustHandle: string | null }
export type FocusResult = { message: PublicMessage | null; threadId: string | null }
export type ConversationFilter = { handle?: string; groupId?: string }
export type SendInput = { handle: string; body: string; replyTo?: string; expiresInSeconds?: number }
export type GroupSendInput = { groupId: string; body: string; replyTo?: string; expiresInSeconds?: number }
export type FileInput = ConversationFilter & { name: string; mime: string; base64: string; body?: string; replyTo?: string; expiresInSeconds?: number }
export type AttachmentsInput = ConversationFilter & {
  body?: string; replyTo?: string; expiresInSeconds?: number; files: { name: string; mime: string; base64: string }[]
}
export type AgentReady = { type: 'agent-ready'; version: 1; url: string; capability: string }
export type AttachInput = {
  relay: string; token: string; expectedAccountId: string; stay?: 'tab' | 'day' | 'week' | 'month' | 'forever'
  authorization?: { audience: string; bootstrapPath: '/messaging/v1/session' }
}
export type IdentityDecisionResult = { ok?: true; pending?: true }
export type PendingSendView = {
  operationId: string; handle: string | null; groupId: string | null; body: string; replyTo: string | null; attachmentNames: string[]
  state: 'pending' | 'blocked'; reason: 'membership-changed' | null
}

export const LEGACY_OPERATIONS = [
  'status', 'unlock', 'sync', 'friends', 'requests', 'requestFriend', 'respondRequest', 'block', 'unfriend',
  'chats', 'messages', 'focus', 'markSeen', 'send', 'sendGroup', 'sendFile', 'createGroup', 'groups',
  'safetyNumber', 'trustIdentity', 'markVerified',
] as const

export type Stay = NonNullable<AttachInput['stay']>
export type LicenseInfo = { license: 'AGPL-3.0-only'; clientLicense: 'MIT'; version: string; sourceUrl: string | null }
export type AgentCapabilities = {
  version: 1; protocolVersion: 1; operations: OperationName[]; events: AgentEventName[]
  cancellation: 'local-only'; operationIds: 'send-idempotency'; attachments: 'base64'
  transport?: 'message-port' | 'http' | 'local'
}
type Command<I, O> = { input: I; output: O }
type Empty = Record<string, never>
/** The complete v1 dispatcher surface, including all 21 original operation names. */
export interface OperationMap {
  license: Command<Empty, LicenseInfo>
  capabilities: Command<Empty, AgentCapabilities>
  status: Command<Empty, Status>
  views: Command<Empty, AgentViews>
  attach: Command<AttachInput, Status>
  requestUnlock: Command<Empty, Status & { pending?: boolean }>
  setStay: Command<{ stay: Stay }, { stay: Stay }>
  unlock: Command<{ handle: string; password: string; replaceKeys?: boolean }, Status>
  cryptoDiagnostic: Command<Empty, { ok: boolean; message: string; description?: string }>
  sync: Command<Empty, SyncResult>
  friends: Command<Empty, FriendSummary[]>
  friendsList: Command<Empty, FriendSummary[]>
  requests: Command<Empty, FriendRequestView[]>
  requestFriend: Command<{ handle: string; note?: string }, FriendRequestView[]>
  respondRequest: Command<{ id: string; action: 'accept' | 'decline' | 'cancel' }, FriendRequestView[]>
  block: Command<{ handle: string }, { ok: true }>
  unfriend: Command<{ handle: string }, { ok: true }>
  chats: Command<Empty, ChatSummary[]>
  messages: Command<ConversationFilter, PublicMessage[]>
  focus: Command<ConversationFilter, FocusResult>
  markSeen: Command<{ ids: string[] }, { seen: number }>
  dropExpired: Command<Empty, string[]>
  send: Command<SendInput, PublicMessage>
  sendGroup: Command<GroupSendInput, PublicMessage>
  sendFile: Command<FileInput, PublicMessage>
  sendAttachments: Command<AttachmentsInput, PublicMessage>
  pendingSends: Command<Empty, PendingSendView[]>
  retryPending: Command<Empty, PublicMessage[]>
  attachment: Command<{ mediaId: string }, { base64: string }>
  createGroup: Command<{ name: string; handles: string[] }, { id: string; name: string; memberIds: string[] }>
  groups: Command<Empty, GroupView[]>
  groupsList: Command<Empty, GroupView[]>
  addMember: Command<{ groupId: string; accountId: string }, { memberIds: string[] }>
  removeMember: Command<{ groupId: string; memberId: string }, { ok: true }>
  leaveGroup: Command<{ groupId: string }, { ok: true }>
  safetyNumber: Command<{ handle: string }, { handle: string; safetyNumber: string; verified: boolean }>
  trustIdentity: Command<{ handle?: string }, IdentityDecisionResult>
  markVerified: Command<{ handle: string }, IdentityDecisionResult>
  lock: Command<Empty, { unlocked: false }>
  close: Command<Empty, { unlocked: false }>
  disconnect: Command<Empty, { unlocked: false }>
}
export type OperationName = keyof OperationMap
export type OperationInput<K extends OperationName> = OperationMap[K]['input']
export type OperationOutput<K extends OperationName> = OperationMap[K]['output']
export const OPERATIONS = ['license', 'capabilities', 'status', 'views', 'attach', 'requestUnlock', 'setStay', 'unlock',
  'cryptoDiagnostic', 'sync', 'friends', 'friendsList', 'requests', 'requestFriend', 'respondRequest', 'block', 'unfriend',
  'chats', 'messages', 'focus', 'markSeen', 'dropExpired', 'send', 'sendGroup', 'sendFile', 'sendAttachments', 'pendingSends',
  'retryPending', 'attachment', 'createGroup', 'groups', 'groupsList', 'addMember', 'removeMember', 'leaveGroup',
  'safetyNumber', 'trustIdentity', 'markVerified', 'lock', 'close', 'disconnect'] as const satisfies readonly OperationName[]

export const MESSAGING_PATHS = {
  metadata: '/messaging/v1/metadata', exchange: '/messaging/v1/session/exchange', bootstrap: '/messaging/v1/session',
  revoke: '/messaging/v1/session/revoke', hostRevoke: '/messaging/v1/host/revoke',
} as const
export type MessagingMetadata = {
  version: 1; protocolVersion: 1; audience: string
  endpoints: Pick<typeof MESSAGING_PATHS, 'exchange' | 'bootstrap' | 'revoke' | 'hostRevoke'>
}
/** Compact assertion = base64url(exact UTF-8 JSON payload).base64url(Ed25519 signature of those bytes). */
export type HostAssertionClaims = {
  version: 1; keyId: string; issuer: string; subject: string; audience: string
  issuedAt: number; expiresAt: number; nonce: string; purpose: 'session' | 'revoke'; handle?: string; displayName?: string
}
export type MessagingGrant = {
  version: 1; protocolVersion: 1; audience: string; token: string; expiresAt: string; account: Account
  bootstrapPath: typeof MESSAGING_PATHS.bootstrap
}
export type MessagingBootstrap = {
  version: 1; protocolVersion: 1; audience: string; account: Account; enrolled: boolean
  identityKey: string | null; expiresAt: string
}
