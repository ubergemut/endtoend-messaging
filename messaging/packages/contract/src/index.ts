export type Account = {
  id: string
  handle: string
  displayName: string
}

export type PublicPreKey = {
  id: number
  publicKey: string
}

export type SignedPublicPreKey = PublicPreKey & {
  signature: string
}

/** Public prekey bundle. No private key material. */
export type PublicBundle = {
  registrationId: number
  identityKey: string
  signedPreKey: SignedPublicPreKey
  kyberPreKey: SignedPublicPreKey
  oneTimePreKey?: PublicPreKey | null
  oneTimePreKeys?: PublicPreKey[]
  accessKey: string
}

export type FriendRequest = {
  id: string
  fromAccountId: string
  toAccountId: string
  fromHandle: string
  toHandle: string
  noteCiphertext: string | null
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  direction: 'incoming' | 'outgoing'
}

export type Envelope = {
  id: string
  groupId: string | null
  ciphertext: string
  expiresAt: string | null
  createdAt: string
}

export type GroupRecord = {
  id: string
  metadataCiphertext: string
  memberIds: string[]
}

export function isHandle(value: string): boolean {
  return /^[a-z0-9_]{3,32}$/.test(value)
}
