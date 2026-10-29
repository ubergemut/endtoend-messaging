// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, createPublicKey, randomBytes, randomUUID, verify, type KeyObject } from 'node:crypto'
import { isHandle } from '@e2ee/contract'
import type { Sql } from './db.ts'

/** Host backends sign short-lived assertions; private signing keys never enter the relay. */
export type HostIdentityConfig = {
  audience: string
  issuers: Array<{ issuer: string; keys: Array<{ keyId: string; publicKey: string }> }>
  sessionTtlSeconds?: number
  assertionMaxAgeSeconds?: number
}

export type TrustedHostIdentity = {
  audience: string
  issuers: Map<string, Map<string, KeyObject>>
  sessionTtlSeconds: number
  assertionMaxAgeSeconds: number
}

export type HostAssertion = {
  version: 1
  keyId: string
  issuer: string
  subject: string
  audience: string
  issuedAt: number
  expiresAt: number
  nonce: string
  purpose: 'session' | 'revoke'
  handle?: string
  displayName?: string
}

function error(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
}
function seconds(value: unknown, fallback: number, max: number, name: string): number {
  const result = value ?? fallback
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 1 || result > max) throw new Error(`Invalid host identity ${name}`)
  return result
}

/** Run before opening storage or listeners, including when configuration came from a file. */
export function prepareHostIdentity(config?: HostIdentityConfig): TrustedHostIdentity | undefined {
  if (config === undefined) return undefined
  if (!config || !boundedString(config.audience, 256) || !config.audience.trim() || !Array.isArray(config.issuers) || config.issuers.length < 1 || config.issuers.length > 32) throw new Error('Invalid host identity configuration')
  const issuers = new Map<string, Map<string, KeyObject>>()
  for (const issuer of config.issuers) {
    if (!issuer || !boundedString(issuer.issuer, 256) || issuers.has(issuer.issuer) || !Array.isArray(issuer.keys) || issuer.keys.length < 1 || issuer.keys.length > 16) throw new Error('Invalid or duplicate host identity issuer')
    const keys = new Map<string, KeyObject>()
    for (const key of issuer.keys) {
      if (!key || !boundedString(key.keyId, 128) || keys.has(key.keyId) || typeof key.publicKey !== 'string' || key.publicKey.length > 16384 || !key.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Invalid or duplicate host identity public key')
      const publicKey = createPublicKey(key.publicKey)
      if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Host identity signing keys must be Ed25519 public keys')
      keys.set(key.keyId, publicKey)
    }
    issuers.set(issuer.issuer, keys)
  }
  return {
    audience: config.audience, issuers,
    sessionTtlSeconds: seconds(config.sessionTtlSeconds, 3600, 86400, 'session TTL'),
    assertionMaxAgeSeconds: seconds(config.assertionMaxAgeSeconds, 120, 120, 'assertion maximum age'),
  }
}

export function validateHostIdentityConfig(config: HostIdentityConfig): void { prepareHostIdentity(config) }

/** The signed bytes are the decoded first segment, never a reserialized object. */
export function verifyHostAssertion(value: unknown, trust: TrustedHostIdentity | undefined, purpose: HostAssertion['purpose']): HostAssertion {
  if (!trust) throw error(503, 'Host identity exchange is not configured')
  if (typeof value !== 'string' || value.length > 8192) throw error(401, 'Invalid host assertion')
  const segments = value.split('.')
  if (segments.length !== 2 || !segments.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw error(401, 'Invalid host assertion')
  const payload = Buffer.from(segments[0], 'base64url'), signature = Buffer.from(segments[1], 'base64url')
  if (payload.toString('base64url') !== segments[0] || signature.toString('base64url') !== segments[1] || signature.length !== 64) throw error(401, 'Invalid host assertion')
  let assertion: HostAssertion
  try { assertion = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) }
  catch { throw error(401, 'Invalid host assertion') }
  const allowed = new Set(['version', 'keyId', 'issuer', 'subject', 'audience', 'issuedAt', 'expiresAt', 'nonce', 'purpose', 'handle', 'displayName'])
  if (!assertion || Array.isArray(assertion) || typeof assertion !== 'object' || Object.keys(assertion).some(key => !allowed.has(key)) || assertion.version !== 1 || assertion.purpose !== purpose || !boundedString(assertion.issuer, 256) || !boundedString(assertion.subject, 256) || !boundedString(assertion.keyId, 128) || assertion.audience !== trust.audience || typeof assertion.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(assertion.nonce) || !Number.isSafeInteger(assertion.issuedAt) || !Number.isSafeInteger(assertion.expiresAt)) throw error(401, 'Invalid host assertion claims')
  const now = Math.floor(Date.now() / 1000)
  if (assertion.issuedAt > now || assertion.issuedAt < now - trust.assertionMaxAgeSeconds || assertion.expiresAt <= now || assertion.expiresAt <= assertion.issuedAt || assertion.expiresAt - assertion.issuedAt > trust.assertionMaxAgeSeconds) throw error(401, 'Host assertion expired or outside its permitted lifetime')
  if (assertion.handle !== undefined && (typeof assertion.handle !== 'string' || !isHandle(assertion.handle) || assertion.handle !== assertion.handle.toLowerCase())) throw error(400, 'Invalid host messaging handle')
  if (assertion.displayName !== undefined && !boundedString(assertion.displayName, 80)) throw error(400, 'Invalid host display name')
  const key = trust.issuers.get(assertion.issuer)?.get(assertion.keyId)
  if (!key || !verify(null, payload, key, signature)) throw error(401, 'Untrusted host assertion signature')
  return assertion
}

type Transaction = Pick<Sql, 'query' | 'exec'>
async function consumeNonce(db: Transaction, assertion: HostAssertion) {
  const rows = await db.query(`INSERT INTO host_assertion_nonces (issuer, nonce, expires_at)
    VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING nonce`, [assertion.issuer, assertion.nonce, new Date(assertion.expiresAt * 1000).toISOString()])
  if (!rows.length) throw error(409, 'Host assertion has already been used')
}

async function lockIdentity(db: Transaction, assertion: HostAssertion): Promise<number> {
  // This row also serializes exchange/revoke for a subject across PostgreSQL
  // relay processes. Never allow an exchange racing logout to revive a grant.
  await db.query('INSERT INTO host_identity_revocations (issuer, subject) VALUES ($1, $2) ON CONFLICT DO NOTHING', [assertion.issuer, assertion.subject])
  const rows = await db.query<{ revoked_before: number | string }>('SELECT revoked_before FROM host_identity_revocations WHERE issuer = $1 AND subject = $2 FOR UPDATE', [assertion.issuer, assertion.subject])
  return Number(rows[0].revoked_before)
}

export async function exchangeHostSession(db: Sql, assertion: HostAssertion, trust: TrustedHostIdentity) {
  // Unique mapping conflicts can race across PostgreSQL relay processes. Retry
  // the transaction after rollback, then read the winning stable mapping.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async connection => {
        await consumeNonce(connection, assertion)
        const cutoff = await lockIdentity(connection, assertion)
        const now = Math.floor(Date.now() / 1000)
        if (assertion.expiresAt <= now || assertion.issuedAt < now - trust.assertionMaxAgeSeconds) throw error(401, 'Host assertion expired while awaiting exchange')
        if (assertion.issuedAt <= cutoff) throw error(401, 'Host assertion predates host revocation; obtain a fresh assertion')
        const rows = await connection.query<{ id: string; handle: string; display_name: string }>(
          `SELECT a.id, a.handle, a.display_name FROM host_identities h JOIN accounts a ON a.id = h.account_id WHERE h.issuer = $1 AND h.subject = $2`, [assertion.issuer, assertion.subject])
        let account = rows[0]
        if (!account) {
          const handle = assertion.handle ?? `h_${createHash('sha256').update(JSON.stringify([assertion.issuer, assertion.subject])).digest('hex').slice(0, 28)}`
          account = { id: randomUUID(), handle, display_name: assertion.displayName ?? handle }
          const created = await connection.query(`INSERT INTO accounts (id, handle, display_name, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (handle) DO NOTHING RETURNING id`, [account.id, account.handle, account.display_name, `host-only$${randomBytes(32).toString('base64url')}`])
          if (!created.length) {
            const winner = await connection.query('SELECT account_id FROM host_identities WHERE issuer = $1 AND subject = $2', [assertion.issuer, assertion.subject])
            if (winner.length) throw Object.assign(new Error('Concurrent identity provisioning; retry transaction'), { code: '23505' })
            throw error(409, 'Messaging handle is already owned; host identities cannot claim existing accounts')
          }
          await connection.query('INSERT INTO host_identities (issuer, subject, account_id) VALUES ($1, $2, $3)', [assertion.issuer, assertion.subject, account.id])
        } else if (assertion.handle !== undefined && assertion.handle !== account.handle) {
          throw error(409, 'Host identity is already mapped to a different messaging handle')
        }
        const token = randomBytes(32).toString('base64url')
        const expiresAt = new Date(Date.now() + trust.sessionTtlSeconds * 1000).toISOString()
        await connection.query(`INSERT INTO sessions (token_hash, account_id, audience, scope, expires_at, host_issuer, host_subject) VALUES ($1, $2, $3, 'messaging', $4, $5, $6)`, [createHash('sha256').update(token).digest('base64url'), account.id, trust.audience, expiresAt, assertion.issuer, assertion.subject])
        return { version: 1, protocolVersion: 1, audience: trust.audience, token, expiresAt,
          account: { id: account.id, handle: account.handle, displayName: account.display_name }, bootstrapPath: '/messaging/v1/session' }
      })
    } catch (failure) {
      if (attempt === 0 && (failure as { code?: string }).code === '23505') continue
      throw failure
    }
  }
}

export async function revokeHostSessions(db: Sql, assertion: HostAssertion): Promise<string | null> {
  return db.transaction(async connection => {
    await consumeNonce(connection, assertion)
    await lockIdentity(connection, assertion)
    if (assertion.expiresAt <= Math.floor(Date.now() / 1000)) throw error(401, 'Host assertion expired while awaiting revocation')
    await connection.query('UPDATE host_identity_revocations SET revoked_before = GREATEST(revoked_before, $3) WHERE issuer = $1 AND subject = $2', [assertion.issuer, assertion.subject, Math.max(Math.floor(Date.now() / 1000), assertion.issuedAt)])
    const accounts = await connection.query<{ account_id: string }>('SELECT account_id FROM host_identities WHERE issuer = $1 AND subject = $2', [assertion.issuer, assertion.subject])
    await connection.query('DELETE FROM sessions WHERE host_issuer = $1 AND host_subject = $2', [assertion.issuer, assertion.subject])
    return accounts[0]?.account_id ?? null
  })
}
