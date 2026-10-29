/** AGPL-3.0-only. Authorization metadata is public; bearer grants stay in memory. */
import { HeadlessError } from './types.ts'

export type AuthorizationBinding = { audience: string; bootstrapPath: string }
export type AuthorizedBootstrap = {
  version?: 1
  protocolVersion: 1
  audience: string
  account: { id: string; handle: string; displayName?: string }
  enrolled: boolean
  identityKey: string | null
  expiresAt?: string | null
}
export const LEGACY_AUTHORIZATION: AuthorizationBinding = { audience: 'endtoend-relay', bootstrapPath: '/api/bootstrap' }

export function authorizationBinding(value?: unknown): AuthorizationBinding {
  if (value === undefined) return { ...LEGACY_AUTHORIZATION }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HeadlessError('Invalid messaging authorization binding', 'invalid')
  const input = value as Record<string, unknown>
  if (typeof input.audience !== 'string' || !input.audience.trim() || input.audience.length > 256 || /[\u0000-\u001f\u007f]/.test(input.audience)
    || input.bootstrapPath !== '/messaging/v1/session') throw new HeadlessError('Unsupported messaging authorization binding', 'invalid')
  return { audience: input.audience, bootstrapPath: input.bootstrapPath }
}

export function validateBootstrap(value: unknown, binding: AuthorizationBinding, expectedAccountId?: string): AuthorizedBootstrap {
  const body = value as AuthorizedBootstrap | null
  const generic = binding.bootstrapPath !== LEGACY_AUTHORIZATION.bootstrapPath
  if (!body || body.audience !== binding.audience || body.protocolVersion !== 1 || (generic && body.version !== 1)
    || !body.account || typeof body.account.id !== 'string' || !body.account.id || typeof body.account.handle !== 'string' || !body.account.handle
    || typeof body.enrolled !== 'boolean' || (body.identityKey !== null && (typeof body.identityKey !== 'string' || !body.identityKey))
    || body.enrolled !== Boolean(body.identityKey)
    || (expectedAccountId !== undefined && body.account.id !== expectedAccountId)) {
    throw new HeadlessError('Relay account authorization does not match the requested messaging account', 'relay')
  }
  if (generic && typeof body.expiresAt !== 'string') throw new HeadlessError('Relay authorization expiry is missing', 'relay')
  if (body.expiresAt !== undefined && body.expiresAt !== null
    && (!/^\d{4}-\d\d-\d\dT/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now())) {
    throw new HeadlessError('Messaging authorization expired; reconnect from the host', 'relay')
  }
  return body
}
