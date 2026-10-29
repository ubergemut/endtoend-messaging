import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const signal = require('../pkg-node/e2ee_crypto.js') as SignalExports

export type SignalExports = {
  generate_account(accountId: string): string
  establish_session(storeJson: string, localAccountId: string, remoteAccountId: string, bundleJson: string): string
  encrypt_message(storeJson: string, localAccountId: string, remoteAccountId: string, plaintext: string): string
  decrypt_message(storeJson: string, localAccountId: string, remoteAccountId: string, ciphertextB64: string): string
  safety_number(storeJson: string, localAccountId: string, remoteAccountId: string, remoteIdentityB64: string): string
  trust_identity(storeJson: string, remoteAccountId: string, identityB64: string): string
  wipe_session(storeJson: string, remoteAccountId: string): string
  rotate_access_key(storeJson: string): string
  prekey_identity(ciphertextB64: string): string
  create_sender_key(storeJson: string, localAccountId: string, distributionId: string): string
  process_sender_key(storeJson: string, senderAccountId: string, distributionB64: string): string
  group_encrypt_message(storeJson: string, localAccountId: string, distributionId: string, plaintext: string): string
  group_decrypt_message(storeJson: string, senderAccountId: string, ciphertextB64: string): string
  seal_note(recipientIdentityB64: string, plaintext: string): string
  open_note(storeJson: string, sealedB64: string): string
  local_identity(storeJson: string): string
}
