# Relay storage, upgrades and recovery

The public relay supports PGlite in a dedicated persistent data directory and PostgreSQL through `openDatabase(databaseUrl, dataDir)`. An omitted PGlite directory creates temporary in-memory state and is suitable only for tests. The standalone deployment must provide an explicit directory outside source, distribution, build and dependency directories. Keep account databases, agent vaults, backups and credentials outside the published source and its source offer.

After the public applications have been built, the managed local start command is:

```powershell
node --import tsx scripts/serve-messaging.mjs --data-dir "D:\EndToEndData\project-a"
```

Choose your own new or already managed private path. The managed root contains `messaging-state.json` and the PGlite `relay/` directory. This launcher holds an exclusive process/nonce `.messaging-relay.lock` throughout relay use and refuses an active writer; it also guards state markers and path symlinks/junctions. Only verified dead-process locks are reclaimed under an exclusive reclaim lock. Do not delete lock files to bypass a refusal. Raw `openDatabase()` is a lower-level API with an operational one-writer requirement; use the managed command for the supported standalone lifecycle.

Use a dedicated database with the default `public` schema for either backend. Startup refuses a different current search-path schema rather than adopting another schema's data. Use one relay process for a PGlite directory. Stop the old process and wait for its database close before opening another. Do not copy a running PGlite directory, open it from two processes, place backups inside it, or move a live directory. Separate project deployments use separate relay databases and device vaults; copying a database does not create an independent account/device identity.

The relay database contains account/password and session hashes, device public bundles and access keys, relationships, encrypted envelopes/media, group epochs and durable envelope-attempt tombstones. Treat the whole directory or SQL backup as sensitive even though message content is encrypted. The relay does not contain the device's full cryptographic ratchet state. Durable device identity, ratchets, outbox, pending acknowledgements and local delivery history live in the agent vault and must also be protected.

## Versioned startup

`apps/api/src/migrations.ts` is the authoritative append-only migration list. `CURRENT_SCHEMA_VERSION` is the version supported by this release; `readDatabaseSchemaVersion(db)` reads a database version without changing it. Version zero means no version ledger was found, including the previous unversioned relay schema.

The first migration adopts the existing schema using the original idempotent table/index/add-column statements. It preserves records and introduces `messaging_schema_migrations`, recording each version, name, SQL checksum and application timestamp. The schema statements and ledger update run in one transaction. PostgreSQL uses one checked-out connection and a transaction advisory lock for startup migration; application pool queries begin only after it commits. A failed migration rolls back and closes the failed database connection. Duplicate data that prevents a required unique index is preserved for investigation; startup does not discard it to make the migration pass.

Startup refuses a database version newer than the runtime supports, a gap/unknown entry, or a changed applied migration name/checksum. Preserve the database on refusal and use the matching release or investigate an offline copy. Never clear the ledger, lower a version number or rewrite a checksum to bypass the refusal. Future migrations must be appended and must explain any data transformation and compatibility limits; never edit already applied migration SQL. This release does not implement automatic down migrations.

## Upgrade and current-state application rollback

1. Record the running release identity, schema version, PGlite/PostgreSQL version, storage locations and agent vault format. Keep installation artifacts and release/source hashes; keep secrets out of logs and release records.
2. Stop client/adaptor commands, all device agents and the relay. Wait for outstanding writes and shutdown to complete. Prevent background jobs or another deployment from reopening these stores.
3. Take the coordinated offline checkpoint described below. Rehearse the proposed upgrade on copies of synthetic state with the same schema and vault formats before using a real deployment.
4. Start the new relay once against the current persistent database and then the compatible agents. Confirm accounts, queued ciphertext, media, group membership/epochs and acknowledgement behavior using the release's synthetic acceptance suite. Record the resulting version.
5. To roll back application code, stop all writers again and retain the **current** relay database and **current** agent vaults, including committed outbox and acknowledgement state. Only use a release compatible with both current schema and vault format. An older unversioned runner is not a supported rollback target. If the older code cannot read current state, leave the deployment stopped and use a compatible release or a forward repair.

Rolling application code back is different from restoring old data. An upgrade checkpoint is not permission to replace advanced cryptographic state with an earlier vault. This guide promises no automatic rollback after an incompatible schema or vault change.

## Coordinated offline checkpoint

For a PGlite deployment, with every relay and agent writer stopped and closed:

1. Choose a new, access-controlled backup directory outside every live data/source/build directory. Refuse an existing destination; label the checkpoint with a unique identifier and the component/release/schema versions.
2. Copy the complete closed managed root, including its state marker and PGlite `relay/` data directory, as a unit. Its active writer/reclaim lock files must be absent after shutdown. Keep all database files together; selecting individual SQL/table/control files does not make a valid physical backup. Use the same PGlite/PostgreSQL storage version and supported platform when restoring a physical copy. Preserve the original live directory until a replacement has been validated.
3. Copy each complete closed agent vault/state set at the **same stopped checkpoint**, including its encrypted current identity/ratchets, group epochs, pending/committed outbox, pending acknowledgements and local message/delivery state. Preserve the required unlock material separately under the operator's secret-storage policy. Do not invent or reset those fields during recovery.
4. Record the component set and hashes of the completed backup files in an access-controlled backup manifest. Verify all intended components were copied. Keep that manifest and any account metadata private. This release's tooling does not inspect or acquire existing user databases or vaults automatically.
5. Rehearse recovery only in an isolated deployment using synthetic state. Give the rehearsal distinct ports, data directories and project endpoints, and ensure agents from it cannot contact the live relay. A cloned device identity must not be active alongside its original.

For an additional **relay-only** snapshot of a stopped managed deployment, the bounded helper is:

```powershell
node scripts/messaging-storage.mjs backup "D:\EndToEndData\project-a" "D:\EndToEndBackups\new-relay-snapshot"
```

It requires a managed source, acquires the same writer lease, refuses an active managed relay, refuses overlapping/existing destinations and verifies copied file hashes. Its `SNAPSHOT.json` explicitly records that agent/vault state is excluded and automatic restore is unsupported. This relay-only output is not the complete managed-root/vault checkpoint above; it cannot establish a current cryptographic recovery point. It does not stop agents or replace the operator's coordinated shutdown procedure.

For PostgreSQL, stop application/agent writers for the coordinated checkpoint and use the database operator's supported consistent backup procedure, such as a complete `pg_dump` custom-format backup, with a compatible PostgreSQL tool version. Restore to a new empty database with the corresponding restore tool. Credentials, role grants and service configuration require their own protected backup. Do not copy a running PostgreSQL data directory as if it were a closed PGlite folder. PostgreSQL backup/restore needs a deployment-specific rehearsal; the PGlite lifecycle tests do not establish PostgreSQL recovery acceptance.

## Restore and recovery limits

Restore into **new** empty locations while all affected relay/agent writers remain stopped. Verify the backup manifest and component/release versions, retain the current state unchanged, and point a compatible deployment at the restored set. Do not merge individual database or vault files. Before reconnecting, establish whether any component or remote peer advanced after the checkpoint.

A coordinated checkpoint is usable for a controlled rehearsal when no participant has advanced beyond it. If messaging occurred afterward, restoring an old vault can rewind ratchets, lose committed sends/ACKs or reuse prior cryptographic state. This is not a supported general device/history recovery procedure. Do not bring a stale cloned identity online, pair an old vault with a newer active deployment, or promise that a matching relay backup makes such a rewind safe. A relay-only backup is useful evidence and a server recovery input; it is not a full cryptographic recovery point.

For a live incident with advanced or missing state, preserve the most recent available device state and the failed/current stores, keep the affected identity offline, and investigate a release-specific recovery or explicit new-device enrollment procedure before resuming. Do not silently wipe a vault or use an old checkpoint to make startup succeed. Current one-device/account constraints and unsupported history recovery remain in effect.

## Evidence in this release

`apps/api/test/database-lifecycle.test.ts` uses newly created temporary synthetic databases only. It checks persistent restart, unversioned-schema adoption, account/device/relationship/group/queue/media preservation, retained ACK tombstones, future-version refusal, changed-history refusal, failed-open cleanup and atomic refusal of a legacy duplicate queue. This is database lifecycle evidence, not proof of coordinated vault recovery, a PostgreSQL production rehearsal or a full deployment backup service.
