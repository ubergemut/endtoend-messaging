const FILE_LIMIT = 25 * 1024 * 1024

export function fileTooLarge(size: number) {
  return size > FILE_LIMIT
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export async function sealBytes(bytes: Uint8Array) {
  if (fileTooLarge(bytes.byteLength)) throw new Error('Files must be 25MB or smaller')
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, copyBytes(bytes))
  const rawKey = await crypto.subtle.exportKey('raw', key)
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    key: bytesToBase64(new Uint8Array(rawKey)),
    nonce: bytesToBase64(nonce),
  }
}

export async function openBytes(ciphertext: string, key: string, nonce: string) {
  const rawKey = base64ToBytes(key)
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copyBytes(base64ToBytes(nonce)) }, cryptoKey, copyBytes(base64ToBytes(ciphertext)))
  return new Uint8Array(plain)
}
