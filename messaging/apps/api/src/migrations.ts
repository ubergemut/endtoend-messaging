// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

export type SchemaConnection = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  exec(text: string): Promise<void>
}

// The existing unversioned schema is migration 1. Keep applied migration text
// unchanged: later releases append migrations rather than rewriting history.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  handle text UNIQUE NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  registration_id integer NOT NULL,
  identity_key text NOT NULL,
  signed_prekey_id integer NOT NULL,
  signed_prekey_public text NOT NULL,
  signed_prekey_signature text NOT NULL,
  kyber_prekey_id integer NOT NULL,
  kyber_prekey_public text NOT NULL,
  kyber_prekey_signature text NOT NULL,
  access_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS one_time_prekeys (
  device_id text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  prekey_id integer NOT NULL,
  public_key text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (device_id, prekey_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id text PRIMARY KEY,
  from_account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  note_ciphertext text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_account_id, to_account_id)
);
CREATE TABLE IF NOT EXISTS friendships (
  account_a text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_b text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_a, account_b),
  CHECK (account_a < account_b)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS envelope_attempts (
  recipient_account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  queue_tag text NOT NULL,
  id text NOT NULL,
  payload_hash text NOT NULL,
  PRIMARY KEY (recipient_account_id, queue_tag)
);
CREATE TABLE IF NOT EXISTS envelopes (
  id text PRIMARY KEY,
  recipient_account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id text,
  ciphertext text NOT NULL,
  queue_tag text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS envelopes_recipient_queue ON envelopes (recipient_account_id, queue_tag);
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  metadata_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 1;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS group_epoch integer;
CREATE TABLE IF NOT EXISTS group_members (
  group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, account_id)
);
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY,
  ciphertext text NOT NULL,
  recipient_account_id text REFERENCES accounts(id) ON DELETE CASCADE,
  group_id text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
`

const migrations = [
  { version: 1, name: 'adopt-existing-relay-schema', sql: SCHEMA },
  { version: 2, name: 'host-identity-and-scoped-sessions', sql: `
CREATE TABLE host_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  account_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE host_assertion_nonces (
  issuer text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (issuer, nonce)
);
CREATE TABLE host_identity_revocations (
  issuer text NOT NULL,
  subject text NOT NULL,
  revoked_before bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (issuer, subject)
);
ALTER TABLE sessions ADD COLUMN audience text;
ALTER TABLE sessions ADD COLUMN scope text;
ALTER TABLE sessions ADD COLUMN expires_at timestamptz;
ALTER TABLE sessions ADD COLUMN host_issuer text;
ALTER TABLE sessions ADD COLUMN host_subject text;
ALTER TABLE sessions ADD CONSTRAINT scoped_session_fields CHECK (
  (audience IS NULL AND scope IS NULL AND expires_at IS NULL AND host_issuer IS NULL AND host_subject IS NULL)
  OR (audience IS NOT NULL AND scope IS NOT NULL AND scope = 'messaging' AND expires_at IS NOT NULL AND host_issuer IS NOT NULL AND host_subject IS NOT NULL)
);
CREATE INDEX sessions_host_identity ON sessions (host_issuer, host_subject);
` },
].map(migration => ({
  ...migration,
  checksum: createHash('sha256').update(migration.sql).digest('hex'),
}))

export const CURRENT_SCHEMA_VERSION = migrations.at(-1)!.version

export class UnsupportedDatabaseVersionError extends Error {
  readonly code = 'UNSUPPORTED_DATABASE_VERSION'
  constructor(readonly databaseVersion: number) {
    super(`Relay database schema ${databaseVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}; use a compatible relay release. The database was not downgraded.`)
    this.name = 'UnsupportedDatabaseVersionError'
  }
}

async function hasLedger(db: SchemaConnection): Promise<boolean> {
  const rows = await db.query<{ name: string | null }>(
    `SELECT to_regclass('public.messaging_schema_migrations')::text AS name`
  )
  return rows[0]?.name != null
}

export async function readDatabaseSchemaVersion(db: SchemaConnection): Promise<number> {
  if (!(await hasLedger(db))) return 0
  const rows = await db.query<{ version: number }>(
    'SELECT COALESCE(MAX(version), 0)::integer AS version FROM public.messaging_schema_migrations'
  )
  return rows[0]?.version ?? 0
}

/** The caller must supply one connection with no concurrent application queries. */
export async function migrateDatabase(db: SchemaConnection, options: { postgres?: boolean } = {}): Promise<void> {
  await db.exec('BEGIN')
  try {
    const schema = await db.query<{ name: string | null }>('SELECT current_schema() AS name')
    if (schema[0]?.name !== 'public') {
      throw new Error('Relay storage requires the dedicated public schema; refusing to migrate a different search-path schema.')
    }
    // Startup is serialized across PostgreSQL relay processes. PGlite has one
    // connection and the supported deployment has one writer for its data dir.
    if (options.postgres) await db.query('SELECT pg_advisory_xact_lock(1160656229, 1)')
    const applied = await hasLedger(db)
      ? await db.query<{ version: number; name: string; checksum: string }>(
        'SELECT version, name, checksum FROM public.messaging_schema_migrations ORDER BY version'
      )
      : []
    const latest = applied.at(-1)?.version ?? 0
    if (latest > CURRENT_SCHEMA_VERSION) throw new UnsupportedDatabaseVersionError(latest)
    for (let index = 0; index < applied.length; index++) {
      const row = applied[index], known = migrations[index]
      if (!known || row.version !== known.version || row.name !== known.name || row.checksum !== known.checksum) {
        throw new Error('Relay schema migration history is unrecognized or changed; refusing automatic startup. Preserve the database and use the matching release or investigate offline.')
      }
    }
    await db.exec(`CREATE TABLE IF NOT EXISTS public.messaging_schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    for (const migration of migrations.filter(migration => migration.version > latest)) {
      await db.exec(migration.sql)
      await db.query(
        'INSERT INTO public.messaging_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum]
      )
    }
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined)
    throw error
  }
}
