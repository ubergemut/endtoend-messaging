export type Account = { id: string; handle: string; displayName: string }

export type Friend = Account & { identityKey: string | null }

export type FriendRequestView = {
  id: string
  direction: 'incoming' | 'outgoing'
  handle: string
  status: string
  note: string | null
}

export type Envelope = {
  id: string
  groupId: string | null
  ciphertext: string
  expiresAt: string | null
  groupEpoch?: number | null
}

export type GroupRecord = {
  id: string
  metadataCiphertext: string
  memberIds: string[]
  epoch?: number
}

export type PublicBundle = {
  registrationId: number
  identityKey: string
  signedPreKey: { id: number; publicKey: string; signature: string }
  kyberPreKey: { id: number; publicKey: string; signature: string }
  oneTimePreKey?: { id: number; publicKey: string } | null
  oneTimePreKeys?: { id: number; publicKey: string }[]
  accessKey: string
}

export type Attachment = {
  mediaId: string
  mime: string
  name: string
  key: string
  nonce: string
}

export type StoredMessage = {
  id: string
  peerId: string | null
  groupId: string | null
  body: string
  fromMe: boolean
  senderId?: string | null
  senderHandle?: string | null
  expiresAt: string | null
  at: string
  replyTo?: string | null
  quote?: string | null
  status?: 'sent' | 'delivered'
  system?: boolean
  envelopeCiphertext?: string | null
  mediaCiphertext?: string | null
  attachments?: Attachment[]
}

export type VaultGroup = {
  name: string
  distributionId: string
  memberIds: string[]
  epoch: number
  senderEpoch: number
}

export type OutboxItem = {
  messageId?: string
  queueTag: string
  recipientId: string
  ciphertext: string
  groupId: string | null
  expiresAt: string | null
  groupEpoch?: number
}

/** Durable user intent. All fields are sealed by the platform vault adapter. */
export type SendAttempt = {
  id: string
  inputHash: string
  handle?: string
  groupId?: string
  body: string
  replyTo?: string
  expiresInSeconds?: number
  expiresAt?: string | null
  attachments: Attachment[]
  uploads: { id: string; ciphertext: string }[]
  completed: boolean
  expired?: boolean
  blockedReason?: 'membership-changed'
}

export type Vault = {
  accountId: string
  handle: string
  store: string
  accessKey: string
  peers: Record<string, { identityKey?: string; accessKey?: string; verifiedIdentityKey?: string | null }>
  messages: StoredMessage[]
  groups: Record<string, VaultGroup>
  queueTags: Record<string, string[]>
  seen: string[]
  pendingTrust: { peerId: string; identityKey: string } | null
  outbox: OutboxItem[]
  pendingAcks: string[]
  revision: number
  pendingPublication?: PublicBundle | null
  sendAttempts?: SendAttempt[]
  blockedOutbox?: OutboxItem[]
}

export type PublicMessage = {
  id: string
  peerId: string | null
  handle: string | null
  groupId: string | null
  groupName: string | null
  body: string
  fromMe: boolean
  replyTo: string | null
  quote: string | null
  at: string
  unseen: boolean
  status: string | null
  system: boolean
  attachmentNames: string[]
  serverCiphertext: string | null
}

export type ChatSummary = {
  peerId: string | null
  groupId: string | null
  handle: string | null
  title: string
  preview: string
  at: string
  unseen: number
}

export type Status = {
  unlocked: boolean
  handle: string | null
  accountId: string | null
  relay: string
  vaultPath: string
  pendingTrustHandle: string | null
}

export type SyncResult = {
  messages: PublicMessage[]
  pendingTrustHandle: string | null
}

export type FocusResult = {
  message: PublicMessage | null
  threadId: string | null
}

export class HeadlessError extends Error {
  constructor(
    message: string,
    readonly code: 'locked' | 'replace-keys' | 'untrusted' | 'invalid' | 'relay' | 'device-key' | 'vault'
  ) {
    super(message)
    this.name = 'HeadlessError'
  }
}
