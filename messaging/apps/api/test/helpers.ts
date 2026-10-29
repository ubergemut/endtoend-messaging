import assert from 'node:assert/strict'
import { signal } from '@e2ee/crypto/node'
import { startServer } from '../src/server.ts'

export const password = 'correct-horse'

export type Started = Awaited<ReturnType<typeof startServer>>

export type Actor = {
  token: string
  account: { id: string; handle: string }
  store: string
  bundle: { accessKey: string; identityKey: string }
}

export async function listen(): Promise<Started> {
  return startServer()
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

export async function call(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {}
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token) headers.authorization = `Bearer ${options.token}`
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

export async function register(baseUrl: string, handle: string): Promise<Actor> {
  const created = await call(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { handle, password, displayName: handle },
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const generated = JSON.parse(signal.generate_account(created.body.account.id))
  const upload = await call(baseUrl, '/api/keys/bundle', {
    method: 'PUT',
    token: created.body.token,
    body: generated.bundle,
  })
  assert.equal(upload.status, 200, JSON.stringify(upload.body))
  return {
    token: created.body.token as string,
    account: created.body.account,
    store: JSON.stringify(generated.store),
    bundle: generated.bundle,
  }
}

export async function becomeFriends(baseUrl: string, from: Actor, to: Actor) {
  const requested = await call(baseUrl, '/api/friends/requests', {
    method: 'POST',
    token: from.token,
    body: { handle: to.account.handle },
  })
  assert.equal(requested.status, 200, JSON.stringify(requested.body))
  const incoming = await call(baseUrl, '/api/friends/requests', { token: to.token })
  const request = incoming.body.requests.find(
    (item: { direction: string; fromHandle: string }) => item.direction === 'incoming' && item.fromHandle === from.account.handle
  )
  assert.ok(request, 'expected an incoming request')
  const accepted = await call(baseUrl, `/api/friends/requests/${request.id}/accept`, {
    method: 'POST',
    token: to.token,
    body: {},
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
}

export async function openSession(baseUrl: string, local: Actor, remote: Actor) {
  const fetched = await call(baseUrl, `/api/keys/${remote.account.id}`, { token: local.token })
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body))
  return {
    store: signal.establish_session(local.store, local.account.id, remote.account.id, JSON.stringify(fetched.body.bundle)),
    accessKey: fetched.body.bundle.accessKey as string,
  }
}

export async function enqueue(
  baseUrl: string,
  sender: Actor | null,
  recipientId: string,
  ciphertext: string,
  options: { accessKey?: string; groupId?: string | null; queueTag?: string; expiresAt?: string | null } = {}
) {
  return call(baseUrl, '/api/envelopes', {
    method: 'POST',
    token: sender?.token,
    body: {
      recipientAccountId: recipientId,
      ciphertext,
      accessKey: options.accessKey,
      groupId: options.groupId ?? null,
      queueTag: options.queueTag ?? crypto.randomUUID(),
      expiresAt: options.expiresAt ?? null,
    },
  })
}
