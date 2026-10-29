// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { CURRENT_SCHEMA_VERSION, openDatabase, readDatabaseSchemaVersion, SCHEMA, UnsupportedDatabaseVersionError, type Sql } from '../src/db.ts'
import { migrateDatabase } from '../src/migrations.ts'

async function fixture(run: (directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'endtoend-db-lifecycle-'))
  try { await run(join(root, 'relay')) }
  finally {
    assert(resolve(root).startsWith(join(resolve(tmpdir()), 'endtoend-db-lifecycle-')), 'Unexpected fixture cleanup path')
    await rm(root, { recursive: true, force: true })
  }
}

async function seed(db: Pick<Sql, 'query'>) {
  await db.query(`INSERT INTO accounts (id, handle, display_name, password_hash) VALUES
    ('account-a', 'synthetic-a', 'Synthetic A', 'synthetic-password-hash-a'),
    ('account-b', 'synthetic-b', 'Synthetic B', 'synthetic-password-hash-b')`)
  await db.query(`INSERT INTO sessions (token_hash, account_id) VALUES ('synthetic-session-hash', 'account-a')`)
  await db.query(`INSERT INTO devices (id, account_id, registration_id, identity_key,
    signed_prekey_id, signed_prekey_public, signed_prekey_signature,
    kyber_prekey_id, kyber_prekey_public, kyber_prekey_signature, access_key)
    VALUES ('device-a', 'account-a', 1, 'synthetic-identity', 2, 'synthetic-signed-prekey',
      'synthetic-signature', 3, 'synthetic-kyber-prekey', 'synthetic-kyber-signature', 'synthetic-access-key')`)
  await db.query(`INSERT INTO one_time_prekeys (device_id, prekey_id, public_key) VALUES ('device-a', 4, 'synthetic-onetime-prekey')`)
  await db.query(`INSERT INTO friend_requests (id, from_account_id, to_account_id, status, note_ciphertext)
    VALUES ('request-a', 'account-a', 'account-b', 'accepted', 'synthetic-encrypted-note')`)
  await db.query(`INSERT INTO friendships (account_a, account_b) VALUES ('account-a', 'account-b')`)
  await db.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ('account-b', 'account-a')`)
  await db.query(`INSERT INTO groups (id, metadata_ciphertext, epoch) VALUES ('group-a', 'synthetic-encrypted-metadata', 4)`)
  await db.query(`INSERT INTO group_members (group_id, account_id) VALUES ('group-a', 'account-a'), ('group-a', 'account-b')`)
  await db.query(`INSERT INTO envelopes (id, recipient_account_id, group_id, group_epoch, ciphertext, queue_tag)
    VALUES ('live-envelope', 'account-b', 'group-a', 4, 'synthetic-live-ciphertext', 'live-tag')`)
  // ACK removes the queued envelope but its tombstone must survive a restart.
  await db.query(`INSERT INTO envelope_attempts (recipient_account_id, queue_tag, id, payload_hash) VALUES
    ('account-b', 'live-tag', 'live-envelope', 'synthetic-live-hash'),
    ('account-b', 'acknowledged-tag', 'acknowledged-envelope', 'synthetic-acknowledged-hash')`)
  await db.query(`INSERT INTO media (id, ciphertext, recipient_account_id, group_id)
    VALUES ('media-a', 'synthetic-encrypted-media', 'account-b', 'group-a')`)
}

async function checkSeed(db: Pick<Sql, 'query'>) {
  assert.deepEqual(await db.query('SELECT id, password_hash FROM accounts ORDER BY id'), [
    { id: 'account-a', password_hash: 'synthetic-password-hash-a' },
    { id: 'account-b', password_hash: 'synthetic-password-hash-b' },
  ])
  assert.deepEqual(await db.query('SELECT id, ciphertext, group_epoch, queue_tag FROM envelopes'), [
    { id: 'live-envelope', ciphertext: 'synthetic-live-ciphertext', group_epoch: 4, queue_tag: 'live-tag' },
  ])
  assert.deepEqual(await db.query('SELECT queue_tag, id, payload_hash FROM envelope_attempts ORDER BY queue_tag'), [
    { queue_tag: 'acknowledged-tag', id: 'acknowledged-envelope', payload_hash: 'synthetic-acknowledged-hash' },
    { queue_tag: 'live-tag', id: 'live-envelope', payload_hash: 'synthetic-live-hash' },
  ])
  assert.deepEqual(await db.query('SELECT id, ciphertext FROM media'), [{ id: 'media-a', ciphertext: 'synthetic-encrypted-media' }])
  assert.deepEqual(await db.query('SELECT epoch, metadata_ciphertext FROM groups'), [{ epoch: 4, metadata_ciphertext: 'synthetic-encrypted-metadata' }])
  for (const [table, count] of [['sessions', 1], ['devices', 1], ['one_time_prekeys', 1], ['friend_requests', 1], ['friendships', 1], ['blocks', 1], ['group_members', 2]] as const) {
    assert.equal((await db.query<{ count: number }>(`SELECT COUNT(*)::integer AS count FROM ${table}`))[0]?.count, count, table)
  }
}

test('persistent relay restart preserves accounts, queues, media, group state and acknowledgement tombstones', () => fixture(async directory => {
  let db: Sql | undefined = await openDatabase(undefined, directory)
  try {
    assert.equal(await readDatabaseSchemaVersion(db), CURRENT_SCHEMA_VERSION)
    await seed(db)
    await db.close(); db = undefined
    db = await openDatabase(undefined, directory)
    await checkSeed(db)
    assert.equal(await readDatabaseSchemaVersion(db), CURRENT_SCHEMA_VERSION)
    assert.equal((await db.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM messaging_schema_migrations'))[0]?.count, CURRENT_SCHEMA_VERSION)
  } finally { await db?.close() }
}))

test('adopting the unversioned legacy SCHEMA preserves all records and is idempotent', () => fixture(async directory => {
  const legacy = new PGlite(directory)
  try {
    await legacy.waitReady
    await legacy.exec(SCHEMA)
    await seed({ async query<T>(text: string, params?: unknown[]) { return (await legacy.query<T>(text, params)).rows } })
  } finally { await legacy.close() }
  for (let restart = 0; restart < 2; restart++) {
    const db = await openDatabase(undefined, directory)
    try {
      await checkSeed(db)
      assert.equal(await readDatabaseSchemaVersion(db), CURRENT_SCHEMA_VERSION)
      assert.equal((await db.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM messaging_schema_migrations'))[0]?.count, CURRENT_SCHEMA_VERSION)
    } finally { await db.close() }
  }
}))

test('a future database version is refused and failed startup releases the database without changing records', () => fixture(async directory => {
  const current = await openDatabase(undefined, directory)
  try {
    await seed(current)
    await current.query(`INSERT INTO messaging_schema_migrations (version, name, checksum) VALUES (999, 'synthetic-future-release', 'synthetic-future-checksum')`)
  } finally { await current.close() }
  await assert.rejects(openDatabase(undefined, directory), error => {
    assert(error instanceof UnsupportedDatabaseVersionError)
    assert.equal(error.databaseVersion, 999)
    return true
  })
  const inspect = new PGlite(directory)
  try {
    await inspect.waitReady
    await checkSeed({ async query<T>(text: string, params?: unknown[]) { return (await inspect.query<T>(text, params)).rows } })
    assert.deepEqual((await inspect.query('SELECT version, name, checksum FROM messaging_schema_migrations WHERE version = 999')).rows, [
      { version: 999, name: 'synthetic-future-release', checksum: 'synthetic-future-checksum' },
    ])
  } finally { await inspect.close() }
}))

test('changed migration history is refused without silently replacing the checksum', () => fixture(async directory => {
  const db = await openDatabase(undefined, directory)
  try { await db.query(`UPDATE messaging_schema_migrations SET checksum = 'synthetic-changed-history'`) }
  finally { await db.close() }
  await assert.rejects(openDatabase(undefined, directory), /migration history is unrecognized or changed/)
  const inspect = new PGlite(directory)
  try {
    await inspect.waitReady
    assert.equal((await inspect.query<{ checksum: string }>('SELECT checksum FROM messaging_schema_migrations')).rows[0]?.checksum, 'synthetic-changed-history')
  } finally { await inspect.close() }
}))

test('an incompatible legacy queue aborts the entire migration instead of discarding duplicate records', () => fixture(async directory => {
  const legacy = new PGlite(directory)
  try {
    await legacy.waitReady
    // A prior unversioned queue with duplicate tags cannot receive the unique
    // index. Automatic startup must preserve both records for investigation.
    await legacy.exec(`CREATE TABLE accounts (id text PRIMARY KEY, handle text UNIQUE NOT NULL,
      display_name text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE envelopes (id text PRIMARY KEY, recipient_account_id text NOT NULL REFERENCES accounts(id),
        group_id text, ciphertext text NOT NULL, queue_tag text, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO accounts (id, handle, display_name, password_hash) VALUES ('synthetic-owner', 'synthetic-owner', 'Synthetic Owner', 'synthetic-hash');
      INSERT INTO envelopes (id, recipient_account_id, ciphertext, queue_tag) VALUES
        ('synthetic-1', 'synthetic-owner', 'synthetic-cipher-1', 'duplicate-tag'),
        ('synthetic-2', 'synthetic-owner', 'synthetic-cipher-2', 'duplicate-tag');`)
  } finally { await legacy.close() }
  await assert.rejects(openDatabase(undefined, directory), /unique|duplicate/i)
  const inspect = new PGlite(directory)
  try {
    await inspect.waitReady
    assert.deepEqual((await inspect.query('SELECT id, ciphertext FROM envelopes ORDER BY id')).rows, [
      { id: 'synthetic-1', ciphertext: 'synthetic-cipher-1' }, { id: 'synthetic-2', ciphertext: 'synthetic-cipher-2' },
    ])
    assert.equal((await inspect.query<{ name: string | null }>(`SELECT to_regclass('public.messaging_schema_migrations')::text AS name`)).rows[0]?.name, null)
    assert.equal((await inspect.query<{ name: string | null }>(`SELECT to_regclass('public.sessions')::text AS name`)).rows[0]?.name, null)
  } finally { await inspect.close() }
}))

test('a non-public search-path schema is refused before relay tables or ledger are created', async () => {
  const db = new PGlite()
  try {
    await db.waitReady
    await db.exec('CREATE SCHEMA synthetic_other; SET search_path = synthetic_other, public')
    await assert.rejects(migrateDatabase({
      async query<T>(text: string, params?: unknown[]) { return (await db.query<T>(text, params)).rows },
      async exec(text) { await db.exec(text) },
    }), /requires the dedicated public schema/)
    assert.equal((await db.query<{ name: string | null }>(`SELECT to_regclass('public.messaging_schema_migrations')::text AS name`)).rows[0]?.name, null)
    assert.equal((await db.query<{ name: string | null }>(`SELECT to_regclass('synthetic_other.accounts')::text AS name`)).rows[0]?.name, null)
    assert.equal((await db.query<{ name: string | null }>(`SELECT to_regclass('public.accounts')::text AS name`)).rows[0]?.name, null)
  } finally { await db.close() }
})
