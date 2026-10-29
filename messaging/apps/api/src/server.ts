import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { WebSocketServer } from 'ws'
import { isHandle, type PublicBundle } from '@e2ee/contract'
import { openDatabase, type Sql } from './db.ts'
import { exchangeHostSession, prepareHostIdentity, revokeHostSessions, verifyHostAssertion, type HostIdentityConfig, type TrustedHostIdentity } from './hostIdentity.ts'
import {loadSourceDisclosure,verifyDisclosedRuntime} from '../../../scripts/source-disclosure.mjs'
import {fileURLToPath} from 'node:url'
export type { HostIdentityConfig } from './hostIdentity.ts'

const scrypt = promisify(scryptCb)

type Ctx = {
  db: Sql
  accountId: string | null
  sessionHash: string | null
  params: Record<string, string>
  body: unknown
  sockets: Map<string, Set<import('ws').WebSocket>>
  audience: string
}

type Route = {
  method: string
  path: string
  auth: boolean
  handler: (ctx: Ctx) => Promise<unknown>
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = (await scrypt(password, salt, 32)) as Buffer
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const actual = (await scrypt(password, Buffer.from(salt, 'base64url'), 32)) as Buffer
  const expected = Buffer.from(hash, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function readBody(req: IncomingMessage, limit = Infinity): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > limit) { reject(httpError(413, 'Request body is too large')); return }
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(httpError(400, 'Invalid JSON request'))
      }
    })
    req.on('error', reject)
  })
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const left = pattern.split('/')
  const right = path.split('/')
  if (left.length !== right.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].startsWith(':')) params[left[index].slice(1)] = decodeURIComponent(right[index])
    else if (left[index] !== right[index]) return null
  }
  return params
}

type RelaySession = { account_id: string; audience: string | null; expires_at: string | Date | null; host_issuer: string | null }
async function sessionFromToken(db: Sql, header: string | undefined, trust?: TrustedHostIdentity): Promise<RelaySession | null> {
  if (!header?.startsWith('Bearer ')) return null
  const rows = await db.query<RelaySession>(
    `SELECT account_id, audience, expires_at, host_issuer FROM sessions WHERE token_hash = $1
     AND ((scope IS NULL AND audience IS NULL) OR (scope = 'messaging' AND audience = $2 AND expires_at > now()))`,
    [hashToken(header.slice(7)), trust?.audience ?? 'endtoend-relay']
  )
  const session = rows[0]
  if (session?.host_issuer && !trust?.issuers.has(session.host_issuer)) return null
  return session ?? null
}

async function areBlocked(db: Sql, a: string, b: string): Promise<boolean> {
  const rows = await db.query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [a, b]
  )
  return rows.length > 0
}

async function areFriends(db: Sql, a: string, b: string): Promise<boolean> {
  const [left, right] = pair(a, b)
  const rows = await db.query('SELECT 1 FROM friendships WHERE account_a = $1 AND account_b = $2', [left, right])
  return rows.length > 0
}

function notify(sockets: Map<string, Set<import('ws').WebSocket>>, accountId: string, payload: unknown) {
  const json = JSON.stringify(payload)
  for (const socket of sockets.get(accountId) ?? []) {
    if (socket.readyState === socket.OPEN) socket.send(json)
  }
}

async function accountHandle(db: Sql, accountId: string): Promise<string> {
  const rows = await db.query<{ handle: string }>('SELECT handle FROM accounts WHERE id = $1', [accountId])
  return rows[0]?.handle ?? ''
}

function notifyAccounts(
  sockets: Map<string, Set<import('ws').WebSocket>>,
  accountIds: string[],
  payload: unknown
) {
  for (const accountId of new Set(accountIds)) notify(sockets, accountId, payload)
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/api/bootstrap',
    auth: true,
    async handler({ db, accountId, audience }) {
      const rows = await db.query<{ id: string; handle: string; display_name: string; identity_key: string | null }>(
        `SELECT a.id, a.handle, a.display_name, d.identity_key
         FROM accounts a LEFT JOIN devices d ON d.account_id = a.id WHERE a.id = $1`, [accountId]
      )
      const account = rows[0]
      if (!account) throw httpError(401, 'Sign in required')
      return {
        account: { id: account.id, handle: account.handle, displayName: account.display_name },
        enrolled: Boolean(account.identity_key), identityKey: account.identity_key,
        audience, protocolVersion: 1,
      }
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    auth: true,
    async handler({ db, accountId, sessionHash, sockets }) {
      await db.query('DELETE FROM sessions WHERE token_hash = $1 AND account_id = $2', [sessionHash, accountId])
      // Disconnect notification channels immediately; subsequent connections must authenticate again.
      for (const socket of sockets.get(accountId!) ?? []) socket.close(1000, 'Signed out')
      return { ok: true }
    },
  },
  {
    method: 'GET',
    path: '/api/auth/handle',
    auth: false,
    async handler({ db, body }) {
      const handle = String((body as { handle?: string }).handle ?? '').trim().toLowerCase()
      if (!isHandle(handle)) throw httpError(400, 'Handle must be 3-32 letters, numbers, or underscores')
      const existing = await db.query('SELECT 1 FROM accounts WHERE handle = $1', [handle])
      return { exists: existing.length > 0 }
    },
  },
  {
    method: 'POST',
    path: '/api/auth/register',
    auth: false,
    async handler({ db, body }) {
      const input = body as { handle?: string; password?: string; displayName?: string }
      const handle = input.handle?.trim().toLowerCase() ?? ''
      const password = input.password ?? ''
      if (!isHandle(handle)) throw httpError(400, 'Handle must be 3-32 letters, numbers, or underscores')
      if (password.length < 5) throw httpError(400, 'Password must be at least 5 characters')
      const existing = await db.query('SELECT id FROM accounts WHERE handle = $1', [handle])
      if (existing.length) throw httpError(409, 'Handle is already taken')
      const id = crypto.randomUUID()
      await db.query(
        'INSERT INTO accounts (id, handle, display_name, password_hash) VALUES ($1, $2, $3, $4)',
        [id, handle, (input.displayName || handle).slice(0, 80), await hashPassword(password)]
      )
      return issueSession(db, id, handle, input.displayName || handle)
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: false,
    async handler({ db, body }) {
      const input = body as { handle?: string; password?: string }
      const handle = input.handle?.trim().toLowerCase() ?? ''
      const rows = await db.query<{ id: string; display_name: string; password_hash: string }>(
        'SELECT id, display_name, password_hash FROM accounts WHERE handle = $1',
        [handle]
      )
      const account = rows[0]
      if (!account || !(await checkPassword(input.password ?? '', account.password_hash))) {
        throw httpError(401, 'Unknown handle or password')
      }
      return issueSession(db, account.id, handle, account.display_name)
    },
  },
  {
    method: 'GET',
    path: '/api/accounts/search',
    auth: true,
    async handler({ db, body }) {
      const handle = String((body as { handle?: string }).handle ?? '').toLowerCase()
      const rows = await db.query<{ id: string; handle: string; display_name: string; identity_key: string | null }>(
        `SELECT a.id, a.handle, a.display_name, d.identity_key
         FROM accounts a LEFT JOIN devices d ON d.account_id = a.id
         WHERE a.handle = $1`,
        [handle]
      )
      const row = rows[0]
      if (!row) return { account: null }
      return {
        account: {
          id: row.id,
          handle: row.handle,
          displayName: row.display_name,
          identityKey: row.identity_key,
        },
      }
    },
  },
  {
    method: 'PUT',
    path: '/api/keys/bundle',
    auth: true,
    async handler({ db, accountId, body }) {
      const bundle = body as PublicBundle
      if (!bundle?.identityKey || !bundle.signedPreKey || !bundle.kyberPreKey || !bundle.accessKey) {
        throw httpError(400, 'Public bundle is incomplete')
      }
      const existing = await db.query<{ identity_key: string; registration_id: number; signed_prekey_public: string; kyber_prekey_public: string }>(
        'SELECT identity_key, registration_id, signed_prekey_public, kyber_prekey_public FROM devices WHERE account_id = $1', [accountId]
      )
      if (existing[0]?.identity_key === bundle.identityKey) {
        if (existing[0].registration_id !== bundle.registrationId || existing[0].signed_prekey_public !== bundle.signedPreKey.publicKey || existing[0].kyber_prekey_public !== bundle.kyberPreKey.publicKey) {
          throw httpError(409, 'Identity retry has different key material')
        }
        return { ok: true }
      }
      const expected = (body as PublicBundle & { replaceIdentityKey?: string }).replaceIdentityKey
      if (expected && existing[0]?.identity_key !== expected) throw httpError(409, 'Published identity changed; review replacement again')
      const deviceId = crypto.randomUUID()
      await db.query('DELETE FROM devices WHERE account_id = $1', [accountId])
      await db.query(
        `INSERT INTO devices (
           id, account_id, registration_id, identity_key,
           signed_prekey_id, signed_prekey_public, signed_prekey_signature,
           kyber_prekey_id, kyber_prekey_public, kyber_prekey_signature, access_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          deviceId,
          accountId,
          bundle.registrationId,
          bundle.identityKey,
          bundle.signedPreKey.id,
          bundle.signedPreKey.publicKey,
          bundle.signedPreKey.signature,
          bundle.kyberPreKey.id,
          bundle.kyberPreKey.publicKey,
          bundle.kyberPreKey.signature,
          bundle.accessKey,
        ]
      )
      for (const prekey of bundle.oneTimePreKeys ?? []) {
        await db.query(
          'INSERT INTO one_time_prekeys (device_id, prekey_id, public_key) VALUES ($1, $2, $3)',
          [deviceId, prekey.id, prekey.publicKey]
        )
      }
      return { ok: true }
    },
  },
  {
    method: 'PUT',
    path: '/api/keys/access',
    auth: true,
    async handler({ db, accountId, body }) {
      const accessKey = (body as { accessKey?: string }).accessKey
      if (!accessKey) throw httpError(400, 'Missing access key')
      await db.query('UPDATE devices SET access_key = $1 WHERE account_id = $2', [accessKey, accountId])
      return { ok: true }
    },
  },
  {
    method: 'GET',
    path: '/api/keys/:accountId',
    auth: true,
    async handler({ db, accountId, params }) {
      const target = params.accountId
      if (target === accountId) throw httpError(400, 'Use your local keys')
      if (await areBlocked(db, accountId!, target) || !(await areFriends(db, accountId!, target))) {
        throw httpError(403, 'Prekeys are available after a friend request is accepted')
      }
      return { bundle: await takeBundle(db, target) }
    },
  },
  {
    method: 'POST',
    path: '/api/friends/requests',
    auth: true,
    async handler({ db, accountId, body, sockets }) {
      const input = body as { handle?: string; noteCiphertext?: string }
      const handle = input.handle?.trim().toLowerCase() ?? ''
      const target = await db.query<{ id: string }>('SELECT id FROM accounts WHERE handle = $1', [handle])
      if (!target[0]) throw httpError(404, 'No account with that handle')
      if (target[0].id === accountId) throw httpError(400, 'You cannot request yourself')
      if (await areBlocked(db, accountId!, target[0].id)) throw httpError(403, 'That account is not available')
      if (await areFriends(db, accountId!, target[0].id)) throw httpError(409, 'You are already friends')
      const id = crypto.randomUUID()
      const saved = await db.query<{ id: string }>(
        `INSERT INTO friend_requests (id, from_account_id, to_account_id, note_ciphertext, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (from_account_id, to_account_id)
         DO UPDATE SET note_ciphertext = EXCLUDED.note_ciphertext, status = 'pending', created_at = now()
         RETURNING id`,
        [id, accountId, target[0].id, input.noteCiphertext ?? null]
      )
      notifyAccounts(sockets, [accountId!, target[0].id], {
        type: 'friend-request',
        actorId: accountId,
        requestId: saved[0]?.id ?? id,
        fromAccountId: accountId,
        fromHandle: await accountHandle(db, accountId!),
        toAccountId: target[0].id,
      })
      return { ok: true }
    },
  },
  {
    method: 'GET',
    path: '/api/friends/requests',
    auth: true,
    async handler({ db, accountId }) {
      const rows = await db.query<{
        id: string
        from_account_id: string
        to_account_id: string
        from_handle: string
        to_handle: string
        note_ciphertext: string | null
        status: string
      }>(
        `SELECT r.id, r.from_account_id, r.to_account_id, f.handle AS from_handle, t.handle AS to_handle,
                r.note_ciphertext, r.status
         FROM friend_requests r
         JOIN accounts f ON f.id = r.from_account_id
         JOIN accounts t ON t.id = r.to_account_id
         WHERE r.status = 'pending' AND (r.from_account_id = $1 OR r.to_account_id = $1)
         ORDER BY r.created_at DESC`,
        [accountId]
      )
      return {
        requests: rows.map((row) => ({
          id: row.id,
          fromAccountId: row.from_account_id,
          toAccountId: row.to_account_id,
          fromHandle: row.from_handle,
          toHandle: row.to_handle,
          noteCiphertext: row.note_ciphertext,
          status: row.status,
          direction: row.to_account_id === accountId ? 'incoming' : 'outgoing',
        })),
      }
    },
  },
  {
    method: 'POST',
    path: '/api/friends/requests/:id/accept',
    auth: true,
    async handler({ db, accountId, params, sockets }) {
      const rows = await db.query<{ from_account_id: string; to_account_id: string; status: string }>(
        'SELECT from_account_id, to_account_id, status FROM friend_requests WHERE id = $1',
        [params.id]
      )
      const request = rows[0]
      if (!request || request.to_account_id !== accountId || request.status !== 'pending') {
        throw httpError(404, 'Incoming request not found')
      }
      const [left, right] = pair(request.from_account_id, request.to_account_id)
      await db.query(
        'INSERT INTO friendships (account_a, account_b) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [left, right]
      )
      await db.query(`UPDATE friend_requests SET status = 'accepted' WHERE id = $1`, [params.id])
      notifyAccounts(sockets, [request.from_account_id, request.to_account_id], {
        type: 'friend-accept',
        actorId: accountId,
        requestId: params.id,
        peerId: request.to_account_id,
        handle: await accountHandle(db, request.to_account_id),
        fromAccountId: request.from_account_id,
        toAccountId: request.to_account_id,
      })
      return { ok: true }
    },
  },
  {
    method: 'POST',
    path: '/api/friends/requests/:id/decline',
    auth: true,
    async handler({ db, accountId, params, sockets }) {
      const updated = await db.query<{ from_account_id: string }>(
        `UPDATE friend_requests SET status = 'declined'
         WHERE id = $1 AND to_account_id = $2 AND status = 'pending'
         RETURNING from_account_id`,
        [params.id, accountId]
      )
      if (!updated.length) throw httpError(404, 'Incoming request not found')
      notifyAccounts(sockets, [updated[0].from_account_id, accountId!], {
        type: 'friend-decline',
        actorId: accountId,
        requestId: params.id,
        fromAccountId: updated[0].from_account_id,
        toAccountId: accountId,
      })
      return { ok: true }
    },
  },
  {
    method: 'POST',
    path: '/api/friends/requests/:id/cancel',
    auth: true,
    async handler({ db, accountId, params, sockets }) {
      const updated = await db.query<{ to_account_id: string }>(
        `UPDATE friend_requests SET status = 'cancelled'
         WHERE id = $1 AND from_account_id = $2 AND status = 'pending'
         RETURNING to_account_id`,
        [params.id, accountId]
      )
      if (!updated.length) throw httpError(404, 'Outgoing request not found')
      notifyAccounts(sockets, [accountId!, updated[0].to_account_id], {
        type: 'friend-cancel',
        actorId: accountId,
        requestId: params.id,
        fromAccountId: accountId,
        toAccountId: updated[0].to_account_id,
      })
      return { ok: true }
    },
  },
  {
    method: 'POST',
    path: '/api/friends/block',
    auth: true,
    async handler({ db, accountId, body, sockets }) {
      const handle = String((body as { handle?: string }).handle ?? '').toLowerCase()
      const target = await db.query<{ id: string }>('SELECT id FROM accounts WHERE handle = $1', [handle])
      if (!target[0]) throw httpError(404, 'No account with that handle')
      await db.query(
        'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [accountId, target[0].id]
      )
      const [left, right] = pair(accountId!, target[0].id)
      await db.query('DELETE FROM friendships WHERE account_a = $1 AND account_b = $2', [left, right])
      await db.query(
        `UPDATE friend_requests SET status = 'declined'
         WHERE status = 'pending' AND (
           (from_account_id = $1 AND to_account_id = $2) OR
           (from_account_id = $2 AND to_account_id = $1)
         )`,
        [accountId, target[0].id]
      )
      notifyAccounts(sockets, [accountId!, target[0].id], {
        type: 'friend-block',
        actorId: accountId,
        peerId: accountId,
        handle: await accountHandle(db, accountId!),
        fromAccountId: accountId,
        toAccountId: target[0].id,
      })
      return { ok: true }
    },
  },
  {
    method: 'POST',
    path: '/api/friends/:accountId/remove',
    auth: true,
    async handler({ db, accountId, params, body, sockets }) {
      const other = params.accountId
      const [left, right] = pair(accountId!, other)
      await db.query('DELETE FROM friendships WHERE account_a = $1 AND account_b = $2', [left, right])
      const tags = ((body as { queueTags?: string[] }).queueTags ?? []).filter(Boolean)
      for (const tag of tags) {
        await db.query('DELETE FROM envelopes WHERE queue_tag = $1', [tag])
      }
      notifyAccounts(sockets, [accountId!, other], {
        type: 'friend-remove',
        actorId: accountId,
        peerId: other,
      })
      return { ok: true }
    },
  },
  {
    method: 'GET',
    path: '/api/friends',
    auth: true,
    async handler({ db, accountId }) {
      const rows = await db.query<{ id: string; handle: string; display_name: string; identity_key: string | null }>(
        `SELECT a.id, a.handle, a.display_name, d.identity_key
         FROM friendships f
         JOIN accounts a ON a.id = CASE WHEN f.account_a = $1 THEN f.account_b ELSE f.account_a END
         LEFT JOIN devices d ON d.account_id = a.id
         WHERE f.account_a = $1 OR f.account_b = $1
         ORDER BY a.handle`,
        [accountId]
      )
      return {
        friends: rows.map((row) => ({
          id: row.id,
          handle: row.handle,
          displayName: row.display_name,
          identityKey: row.identity_key,
        })),
      }
    },
  },
  {
    method: 'POST',
    path: '/api/envelopes',
    auth: false,
    async handler({ db, accountId, body, sockets }) {
      const input = body as {
        recipientAccountId?: string
        ciphertext?: string
        accessKey?: string
        expiresAt?: string | null
        groupId?: string | null
        groupEpoch?: number
        queueTag?: string
      }
      if (!input.recipientAccountId || !input.ciphertext || !input.queueTag) {
        throw httpError(400, 'Envelope is incomplete')
      }
      if (input.expiresAt != null && (typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)))) throw httpError(400, 'Invalid expiry')
      const fingerprint = hashToken(JSON.stringify([input.ciphertext, input.groupId ?? null, input.expiresAt ? new Date(input.expiresAt).toISOString() : null, input.groupEpoch ?? null]))
      const knownAttempt = await db.query<{ id: string; payload_hash: string }>(
        'SELECT id, payload_hash FROM envelope_attempts WHERE recipient_account_id = $1 AND queue_tag = $2',
        [input.recipientAccountId, input.queueTag]
      )
      if (knownAttempt[0]) {
        if (knownAttempt[0].payload_hash !== fingerprint) throw httpError(409, 'Queue tag was used for different content')
        return { id: knownAttempt[0].id }
      }
      let groupEpoch: number | null = null
      if (input.groupId) {
        const group = await db.query<{ epoch: number }>('SELECT epoch FROM groups WHERE id = $1', [input.groupId])
        groupEpoch = group[0]?.epoch ?? null
        if (input.groupEpoch !== undefined && input.groupEpoch !== groupEpoch) throw httpError(409, 'Group membership changed; refresh before sending')
        if (!accountId) throw httpError(403, 'You are not in that group')
        const membership = await db.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND account_id = $2',
          [input.groupId, accountId]
        )
        if (!membership.length) throw httpError(403, 'You are not in that group')
        const recipientMembership = await db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND account_id = $2', [input.groupId, input.recipientAccountId])
        if (!recipientMembership.length) throw httpError(403, 'Recipient is not in that group')
      }
      if (accountId && (await areBlocked(db, accountId, input.recipientAccountId))) {
        throw httpError(403, 'Messages require an accepted friendship')
      }
      const devices = await db.query<{ access_key: string }>(
        'SELECT access_key FROM devices WHERE account_id = $1',
        [input.recipientAccountId]
      )
      const accessMatches = Boolean(input.accessKey && devices[0]?.access_key === input.accessKey)
      const friendSend =
        accountId != null &&
        (await areFriends(db, accountId, input.recipientAccountId)) &&
        !(await areBlocked(db, accountId, input.recipientAccountId))
      if (!accessMatches && !friendSend) {
        throw httpError(403, 'Messages require an accepted friendship')
      }
      const id = crypto.randomUUID()
      const inserted = await db.query<{ id: string }>(
        `WITH claimed AS (
           INSERT INTO envelope_attempts (recipient_account_id, queue_tag, id, payload_hash)
           SELECT $2, $5, $1, $9
           WHERE $3::text IS NULL OR EXISTS (
             SELECT 1 FROM groups g
             JOIN group_members sender ON sender.group_id = g.id AND sender.account_id = $8
             JOIN group_members recipient ON recipient.group_id = g.id AND recipient.account_id = $2
             WHERE g.id = $3 AND g.epoch = $7
           )
           ON CONFLICT (recipient_account_id, queue_tag) DO NOTHING RETURNING id
         ) INSERT INTO envelopes (id, recipient_account_id, group_id, ciphertext, queue_tag, expires_at, group_epoch)
           SELECT claimed.id, $2, $3, $4, $5, $6, $7 FROM claimed RETURNING id`,
        [
          id,
          input.recipientAccountId,
          input.groupId ?? null,
          input.ciphertext,
          input.queueTag,
          input.expiresAt ?? null,
          groupEpoch,
          accountId,
          fingerprint,
        ]
      )
      if (!inserted.length && input.queueTag) {
        const previous = await db.query<{ id: string; payload_hash: string }>(
          'SELECT id, payload_hash FROM envelope_attempts WHERE recipient_account_id = $1 AND queue_tag = $2',
          [input.recipientAccountId, input.queueTag]
        )
        if (!previous[0] || previous[0].payload_hash !== fingerprint) throw httpError(409, 'Queue conflict or group membership changed')
        return { id: previous[0].id }
      }
      notify(sockets, input.recipientAccountId, { type: 'envelope' })
      return { id: inserted[0]?.id ?? id }
    },
  },
  {
    method: 'GET',
    path: '/api/envelopes',
    auth: true,
    async handler({ db, accountId }) {
      await db.exec(`DELETE FROM envelopes WHERE expires_at IS NOT NULL AND expires_at <= now()`)
      await db.exec(`DELETE FROM media WHERE expires_at IS NOT NULL AND expires_at <= now()`)
      const rows = await db.query<{
        id: string
        group_id: string | null
        group_epoch: number | null
        ciphertext: string
        expires_at: string | null
        created_at: string
      }>(
        `SELECT id, group_id, group_epoch, ciphertext, expires_at, created_at
         FROM envelopes e WHERE recipient_account_id = $1 AND (group_id IS NULL OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = e.group_id AND gm.account_id = $1)) ORDER BY created_at`,
        [accountId]
      )
      return {
        envelopes: rows.map((row) => ({
          id: row.id,
          groupId: row.group_id,
          groupEpoch: row.group_epoch,
          ciphertext: row.ciphertext,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        })),
      }
    },
  },
  {
    method: 'POST',
    path: '/api/envelopes/ack',
    auth: true,
    async handler({ db, accountId, body }) {
      const ids = ((body as { ids?: string[] }).ids ?? []).filter(Boolean)
      for (const id of ids) {
        await db.query('DELETE FROM envelopes WHERE id = $1 AND recipient_account_id = $2', [id, accountId])
      }
      return { ok: true }
    },
  },
  {
    method: 'POST',
    path: '/api/groups',
    auth: true,
    async handler({ db, accountId, body }) {
      const input = body as { memberIds?: string[]; metadataCiphertext?: string }
      const memberIds = Array.from(new Set([accountId!, ...(input.memberIds ?? [])]))
      if (!input.metadataCiphertext) throw httpError(400, 'Missing group metadata')
      for (const memberId of memberIds) {
        if (memberId !== accountId && !(await areFriends(db, accountId!, memberId))) {
          throw httpError(403, 'Groups can only include accepted friends')
        }
      }
      const id = crypto.randomUUID()
      await db.query('INSERT INTO groups (id, metadata_ciphertext) VALUES ($1, $2)', [id, input.metadataCiphertext])
      for (const memberId of memberIds) {
        await db.query('INSERT INTO group_members (group_id, account_id) VALUES ($1, $2)', [id, memberId])
      }
      return { id, memberIds, epoch: 1 }
    },
  },
  {
    method: 'GET',
    path: '/api/groups',
    auth: true,
    async handler({ db, accountId }) {
      const groups = await db.query<{ id: string; metadata_ciphertext: string; epoch: number }>(
        `SELECT g.id, g.metadata_ciphertext, g.epoch FROM groups g
         JOIN group_members me ON me.group_id = g.id AND me.account_id = $1
         ORDER BY g.created_at`,
        [accountId]
      )
      const result = []
      for (const group of groups) {
        const members = await db.query<{ account_id: string }>(
          'SELECT account_id FROM group_members WHERE group_id = $1',
          [group.id]
        )
        result.push({
          id: group.id,
          metadataCiphertext: group.metadata_ciphertext,
          epoch: group.epoch,
          memberIds: members.map((member) => member.account_id),
        })
      }
      return { groups: result }
    },
  },
  {
    method: 'DELETE',
    path: '/api/groups/:groupId/members/:accountId',
    auth: true,
    async handler({ db, accountId, params }) {
      const membership = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND account_id = $2',
        [params.groupId, accountId]
      )
      if (!membership.length) throw httpError(403, 'You are not in that group')
      const current = await db.query<{ epoch: number }>(
        `WITH removed AS (
          DELETE FROM group_members WHERE group_id = $1 AND account_id = $2 RETURNING account_id
         ) UPDATE groups SET epoch = epoch + (SELECT count(*)::integer FROM removed) WHERE id = $1 RETURNING epoch`,
        [params.groupId, params.accountId]
      )
      return { ok: true, epoch: current[0]?.epoch }
    },
  },
  {
    method: 'POST',
    path: '/api/groups/:groupId/members',
    auth: true,
    async handler({ db, accountId, params, body }) {
      const memberId = String((body as { accountId?: string }).accountId ?? '')
      const membership = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND account_id = $2',
        [params.groupId, accountId]
      )
      if (!membership.length) throw httpError(403, 'You are not in that group')
      if (!(await areFriends(db, accountId!, memberId)) || (await areBlocked(db, accountId!, memberId))) {
        throw httpError(403, 'Groups can only include accepted friends')
      }
      const current = await db.query<{ epoch: number }>(
        `WITH added AS (
          INSERT INTO group_members (group_id, account_id) VALUES ($1, $2)
          ON CONFLICT DO NOTHING RETURNING account_id
         ) UPDATE groups SET epoch = epoch + (SELECT count(*)::integer FROM added) WHERE id = $1 RETURNING epoch`,
        [params.groupId, memberId]
      )
      const members = await db.query<{ account_id: string }>(
        'SELECT account_id FROM group_members WHERE group_id = $1',
        [params.groupId]
      )
      return { memberIds: members.map((member) => member.account_id), epoch: current[0]?.epoch }
    },
  },
  {
    method: 'POST',
    path: '/api/media',
    auth: true,
    async handler({ db, accountId, body }) {
      const input = body as {
        id?: string
        ciphertext?: string
        expiresAt?: string | null
        recipientAccountId?: string | null
        groupId?: string | null
      }
      if (!input.ciphertext) throw httpError(400, 'Missing ciphertext')
      if (input.ciphertext.length > 36_000_000) throw httpError(413, 'Files must be 25MB or smaller')
      const recipient = input.recipientAccountId || null
      const groupId = input.groupId || null
      if (Boolean(recipient) === Boolean(groupId)) throw httpError(400, 'Media needs one recipient or one group')
      if (recipient) {
        if (!(await areFriends(db, accountId!, recipient)) || (await areBlocked(db, accountId!, recipient))) {
          throw httpError(403, 'Messages require an accepted friendship')
        }
      } else {
        const membership = await db.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND account_id = $2',
          [groupId, accountId]
        )
        if (!membership.length) throw httpError(403, 'You are not in that group')
      }
      if (input.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw httpError(400, 'Invalid media id')
      const id = input.id ?? crypto.randomUUID()
      await db.query(
        `INSERT INTO media (id, ciphertext, recipient_account_id, group_id, expires_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [id, input.ciphertext, recipient, groupId, input.expiresAt ?? null]
      )
      const saved = await db.query<{ ciphertext: string; recipient_account_id: string | null; group_id: string | null; expires_at: string | Date | null }>(
        'SELECT ciphertext, recipient_account_id, group_id, expires_at FROM media WHERE id = $1', [id]
      )
      const row = saved[0]
      const expiry = input.expiresAt ? new Date(input.expiresAt).toISOString() : null
      const savedExpiry = row?.expires_at ? new Date(row.expires_at).toISOString() : null
      if (!row || row.ciphertext !== input.ciphertext || row.recipient_account_id !== recipient || row.group_id !== groupId || expiry !== savedExpiry) {
        throw httpError(409, 'Media id already belongs to another upload')
      }
      return { id }
    },
  },
  {
    method: 'GET',
    path: '/api/media/:id',
    auth: true,
    async handler({ db, accountId, params }) {
      await db.exec(`DELETE FROM media WHERE expires_at IS NOT NULL AND expires_at <= now()`)
      const rows = await db.query<{
        ciphertext: string
        recipient_account_id: string | null
        group_id: string | null
      }>('SELECT ciphertext, recipient_account_id, group_id FROM media WHERE id = $1', [params.id])
      const row = rows[0]
      if (!row) throw httpError(404, 'Media not found')
      if (row.group_id) {
        const membership = await db.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND account_id = $2',
          [row.group_id, accountId]
        )
        if (!membership.length) throw httpError(403, 'You are not in that group')
      } else if (row.recipient_account_id !== accountId) {
        throw httpError(403, 'Messages require an accepted friendship')
      }
      return { ciphertext: row.ciphertext }
    },
  },
]

function httpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

async function issueSession(db: Sql, id: string, handle: string, displayName: string) {
  const token = randomBytes(32).toString('base64url')
  await db.query('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [hashToken(token), id])
  return { token, account: { id, handle, displayName } }
}

async function takeBundle(db: Sql, accountId: string): Promise<PublicBundle> {
  const devices = await db.query<{
    id: string
    registration_id: number
    identity_key: string
    signed_prekey_id: number
    signed_prekey_public: string
    signed_prekey_signature: string
    kyber_prekey_id: number
    kyber_prekey_public: string
    kyber_prekey_signature: string
    access_key: string
  }>('SELECT * FROM devices WHERE account_id = $1', [accountId])
  const device = devices[0]
  if (!device) throw httpError(404, 'That account has not published keys')
  const prekeys = await db.query<{ prekey_id: number; public_key: string }>(
    `SELECT prekey_id, public_key FROM one_time_prekeys
     WHERE device_id = $1 AND used_at IS NULL ORDER BY prekey_id LIMIT 1`,
    [device.id]
  )
  if (prekeys[0]) {
    await db.query(
      'UPDATE one_time_prekeys SET used_at = now() WHERE device_id = $1 AND prekey_id = $2',
      [device.id, prekeys[0].prekey_id]
    )
  }
  return {
    registrationId: device.registration_id,
    identityKey: device.identity_key,
    signedPreKey: {
      id: device.signed_prekey_id,
      publicKey: device.signed_prekey_public,
      signature: device.signed_prekey_signature,
    },
    kyberPreKey: {
      id: device.kyber_prekey_id,
      publicKey: device.kyber_prekey_public,
      signature: device.kyber_prekey_signature,
    },
    oneTimePreKey: prekeys[0]
      ? { id: prekeys[0].prekey_id, publicKey: prekeys[0].public_key }
      : null,
    accessKey: device.access_key,
  }
}

export async function startServer(options: { port?: number; databaseUrl?: string; dataDir?: string; hostIdentity?: HostIdentityConfig;sourceDisclosure?:string;releaseMode?:boolean;verifiedDisclosure?:Awaited<ReturnType<typeof loadSourceDisclosure>> } = {}) {
  const releaseMode=options.releaseMode??process.env.ENDTOEND_RELEASE_MODE==='1'
  const disclosure=options.verifiedDisclosure??await loadSourceDisclosure(options.sourceDisclosure??process.env.ENDTOEND_SOURCE_DISCLOSURE,{required:releaseMode})
  if(releaseMode)await verifyDisclosedRuntime(disclosure,'messaging-core',fileURLToPath(new URL('../../../',import.meta.url)))
  const sourceInfo=disclosure?.component('messaging-core')??{version:'0.2.0',license:'AGPL-3.0-only',sourceUrl:null,sourceStatus:'development'}
  const trust = prepareHostIdentity(options.hostIdentity)
  const db = await openDatabase(options.databaseUrl, options.dataDir)
  const sockets = new Map<string, Set<import('ws').WebSocket>>()
  const server = createServer(async (req, res) => {
    try {
    if(disclosure?.serve(req,res))return
    if((req.method==='GET'||req.method==='HEAD')&&new URL(req.url??'/','http://127.0.0.1').pathname==='/release.json'){
      const bytes=JSON.stringify(sourceInfo);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'}).end(req.method==='HEAD'?undefined:bytes);return
    }
      await handleRequest(req, res, db, sockets, trust,sourceInfo)
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500
      const message = status === 500 ? 'Server error' : (error as Error).message
      sendJson(res, status, { error: message })
    }
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/ws') {
        socket.destroy()
        return
      }
      const session = await sessionFromToken(db, `Bearer ${url.searchParams.get('token') ?? ''}`, trust)
      if (!session) {
        socket.destroy()
        return
      }
      const accountId = session.account_id
      wss.handleUpgrade(req, socket, head, (ws) => {
        const set = sockets.get(accountId) ?? new Set()
        set.add(ws)
        sockets.set(accountId, set)
        // Cover logout racing the asynchronous upgrade authentication: once
        // registered, revocation sees the socket; a prior deletion is caught
        // by this second credential check.
        void sessionFromToken(db, `Bearer ${url.searchParams.get('token') ?? ''}`, trust)
          .then(current => { if (!current) ws.close(1008, 'Messaging session revoked') })
          .catch(() => ws.close(1011, 'Session validation failed'))
        const expiry = session.expires_at ? setTimeout(() => ws.close(1008, 'Messaging session expired'), Math.max(1, new Date(session.expires_at).getTime() - Date.now())) : undefined
        ws.on('close', () => {
          if (expiry) clearTimeout(expiry)
          set.delete(ws)
        })
      })
    } catch {
      socket.destroy()
    }
  })
  const timer = setInterval(() => {
    void db.exec(`DELETE FROM envelopes WHERE expires_at IS NOT NULL AND expires_at <= now()`)
    void db.exec(`DELETE FROM media WHERE expires_at IS NOT NULL AND expires_at <= now()`)
  }, 1000)
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    async close() {
      clearInterval(timer)
      for (const set of sockets.values()) {
        for (const socket of set) socket.close()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await db.close()
    },
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: Sql,
  sockets: Map<string, Set<import('ws').WebSocket>>,
  trust?: TrustedHostIdentity,
  sourceInfo?:Record<string,unknown>
) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'OPTIONS') {
    writeCors(res)
    res.writeHead(204)
    res.end()
    return
  }
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true })
    return
  }
  if (url.pathname.startsWith('/messaging/v1/')) {
    const audience = trust?.audience ?? 'endtoend-relay'
    if (req.method === 'GET' && url.pathname === '/messaging/v1/metadata') {
      sendJson(res, 200, { version: 1, protocolVersion: 1, audience, licenseInfo:sourceInfo,sourceDisclosureUrl:sourceInfo?.sourceStatus==='verified'?'/source-disclosure.json':null,endpoints: { exchange: '/messaging/v1/session/exchange', bootstrap: '/messaging/v1/session', revoke: '/messaging/v1/session/revoke', hostRevoke: '/messaging/v1/host/revoke' } })
      return
    }
    if (req.method === 'POST' && (url.pathname === '/messaging/v1/session/exchange' || url.pathname === '/messaging/v1/host/revoke')) {
      const body = await readBody(req, 16384) as { assertion?: unknown }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'assertion')) throw httpError(400, 'Only a signed host assertion is accepted')
      const revoke = url.pathname.endsWith('/host/revoke')
      const assertion = verifyHostAssertion(body.assertion, trust, revoke ? 'revoke' : 'session')
      if (revoke) {
        const accountId = await revokeHostSessions(db, assertion)
        if (accountId) for (const socket of sockets.get(accountId) ?? []) socket.close(1000, 'Host access revoked')
        sendJson(res, 200, { ok: true })
      } else sendJson(res, 200, await exchangeHostSession(db, assertion, trust!))
      return
    }
    if ((req.method === 'GET' && url.pathname === '/messaging/v1/session') || (req.method === 'POST' && url.pathname === '/messaging/v1/session/revoke')) {
      const session = await sessionFromToken(db, req.headers.authorization, trust)
      if (!session) throw httpError(401, 'Sign in required')
      if (req.method === 'POST') {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(req.headers.authorization!.slice(7))])
        for (const socket of sockets.get(session.account_id) ?? []) socket.close(1000, 'Signed out')
        sendJson(res, 200, { ok: true })
      } else {
        if (!session.audience || !session.expires_at) throw httpError(401, 'A scoped messaging session is required')
        const rows = await db.query<{ id: string; handle: string; display_name: string; identity_key: string | null }>(`SELECT a.id, a.handle, a.display_name, d.identity_key FROM accounts a LEFT JOIN devices d ON d.account_id = a.id WHERE a.id = $1`, [session.account_id])
        const account = rows[0]
        if (!account) throw httpError(401, 'Sign in required')
        sendJson(res, 200, { version: 1, protocolVersion: 1, audience, account: { id: account.id, handle: account.handle, displayName: account.display_name }, enrolled: Boolean(account.identity_key), identityKey: account.identity_key, expiresAt: session.expires_at ? new Date(session.expires_at).toISOString() : null })
      }
      return
    }
  }
  const route = routes.find((candidate) => {
    return candidate.method === req.method && matchPath(candidate.path, url.pathname)
  })
  if (!route) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  const session = await sessionFromToken(db, req.headers.authorization, trust)
  const accountId = session?.account_id ?? null
  if (route.auth && !accountId) {
    sendJson(res, 401, { error: 'Sign in required' })
    return
  }
  const body =
    req.method === 'GET'
      ? Object.fromEntries(url.searchParams.entries())
      : await readBody(req)
  const result = await route.handler({
    db,
    accountId,
    sessionHash: req.headers.authorization?.startsWith('Bearer ') ? hashToken(req.headers.authorization.slice(7)) : null,
    params: matchPath(route.path, url.pathname) ?? {},
    body,
    sockets,
    audience: session?.audience ?? 'endtoend-relay',
  })
  sendJson(res, 200, result ?? { ok: true })
}

function writeCors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, authorization')
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  writeCors(res)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}
