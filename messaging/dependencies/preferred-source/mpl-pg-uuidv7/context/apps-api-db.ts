import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

export type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  exec(text: string): Promise<void>
  close(): Promise<void>
}

const SCHEMA = `
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

export async function openDatabase(databaseUrl?: string, dataDir?: string): Promise<Sql> {
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl })
    await pool.query(SCHEMA)
    return {
      async query(text, params) {
        const result = await pool.query(text, params)
        return result.rows as Record<string, unknown>[]
      },
      async exec(text) {
        await pool.query(text)
      },
      async close() {
        await pool.end()
      },
    }
  }

  const db = new PGlite(dataDir)
  await db.waitReady
  await db.exec(SCHEMA)
  return {
    async query(text, params) {
      const result = await db.query(text, params)
      return result.rows as Record<string, unknown>[]
    },
    async exec(text) {
      await db.exec(text)
    },
    async close() {
      await db.close()
    },
  }
}

export { SCHEMA }
