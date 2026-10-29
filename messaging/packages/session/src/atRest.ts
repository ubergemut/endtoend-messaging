import { base64ToBytes, bytesToBase64 } from './bytes.ts'

export const LOCAL_VAULT_VERSION = 'e2ee-local-v1'

export type SealedRecord = {
  v: typeof LOCAL_VAULT_VERSION
  wrapNonce: string
  wrappedKey: string
  nonce: string
  ciphertext: string
}

export type SealedBlob = {
  v: typeof LOCAL_VAULT_VERSION
  nonce: string
  ciphertext: string
}

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export function createDeviceSecret() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
}

export function isSealedRecord(value: unknown): value is SealedRecord {
  return Boolean(value && typeof value === 'object' && (value as SealedRecord).v === LOCAL_VAULT_VERSION && (value as SealedRecord).wrappedKey)
}

export function isSealedBlob(value: unknown): value is SealedBlob {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as SealedBlob).v === LOCAL_VAULT_VERSION &&
      (value as SealedBlob).ciphertext &&
      !(value as SealedRecord).wrappedKey
  )
}

async function wrappingKey(secret: string) {
  const bytes = base64ToBytes(secret)
  if (bytes.byteLength !== 32) throw new Error('Device key is not valid')
  return crypto.subtle.importKey('raw', copyBytes(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function wrapDataKey(secret: string, key: CryptoKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await wrappingKey(secret), copyBytes(raw))
  return { wrapNonce: bytesToBase64(nonce), wrappedKey: bytesToBase64(new Uint8Array(wrapped)) }
}

async function unwrapDataKey(secret: string, record: SealedRecord) {
  const wrapping = await wrappingKey(secret)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: copyBytes(base64ToBytes(record.wrapNonce)) },
    wrapping,
    copyBytes(base64ToBytes(record.wrappedKey))
  )
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

export async function openSealedVault(secret: string, record: SealedRecord) {
  const key = await unwrapDataKey(secret, record)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: copyBytes(base64ToBytes(record.nonce)) },
    key,
    copyBytes(base64ToBytes(record.ciphertext))
  )
  return { vault: JSON.parse(new TextDecoder().decode(plain)) as unknown, key }
}

export async function sealVault(secret: string, vault: unknown, key: CryptoKey | null) {
  const dataKey = key ?? (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    dataKey,
    copyBytes(new TextEncoder().encode(JSON.stringify(vault)))
  )
  const wrapped = await wrapDataKey(secret, dataKey)
  const record: SealedRecord = {
    v: LOCAL_VAULT_VERSION,
    wrapNonce: wrapped.wrapNonce,
    wrappedKey: wrapped.wrappedKey,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
  return { record, key: dataKey }
}

export async function sealBlob(key: CryptoKey, bytes: Uint8Array): Promise<SealedBlob> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, copyBytes(bytes))
  return { v: LOCAL_VAULT_VERSION, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
}

export async function openBlob(key: CryptoKey, record: SealedBlob) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: copyBytes(base64ToBytes(record.nonce)) },
    key,
    copyBytes(base64ToBytes(record.ciphertext))
  )
  return new Uint8Array(plain)
}
