# Protocol

Pinned implementation: libsignal `v0.104.0`, compiled in this repo to WASM (`packages/crypto`). The server never decrypts.

## Keys

On first unlock the client generates:

- an identity key pair
- a signed elliptic-curve prekey
- a Kyber-1024 signed prekey (PQXDH)
- 20 one-time prekeys
- a random 32-byte access key

Only the public bundle is uploaded. The private store stays on the device, inside an encrypted local vault. The browser keeps that vault in IndexedDB. The headless client keeps it in a file. A random data key encrypts the vault and each attachment with AES-GCM. A separate 32-byte device secret wraps the data key. That secret is not the account password, it is not derived from the password, and it is not written next to the ciphertext. The browser shows a new device secret once. Later launches ask for it again, unless Stay signed in is set to 1 day, 1 week, 1 month, or forever. That choice keeps the account session and the device secret in this browser until the period ends or you log out. It is not written into the vault. Headless reads `ENDTOEND_DEVICE_KEY`. A wrong secret fails closed and does not publish a new key bundle. An older plaintext vault is encrypted on the next successful open.

## Friend gate

1. Search is an exact handle. The response includes the identity public key so a request note can be sealed.
2. The request is stored as ciphertext. Accept, decline, cancel, and block are explicit.
3. `GET /api/keys/:accountId` returns 403 until the two accounts have an accepted friendship and neither has blocked the other.
4. `POST /api/envelopes` returns 403 unless the body presents the recipient's current access key, or the caller is an accepted friend. The inserted row has recipient, ciphertext, optional group id, queue tag, and expiry. It has no sender column.
5. Unfriend deletes queued blobs whose queue tags the client still knows, and both devices wipe the session. Plaintext already shown on a device stays until that device deletes it.

## Sessions

The sender fetches one unused one-time prekey and runs `process_prekey_bundle` (PQXDH). Later messages use `message_encrypt` / `message_decrypt` (Double Ratchet, including the post-quantum ratchet state libsignal stores in the session).

If the stored identity for that account does not match the published identity or the incoming prekey message, the client stops sending until this device calls `trust_identity` for the new key. Trusting the replacement clears verification. It does not mark the new key verified. Verification is `verifiedIdentityKey` on this device, and the UI shows verified only when that value equals the identity currently in use. A separate action records the identity that was just displayed. The safety number is the libsignal display fingerprint (version 2, 5200 iterations) of the two identity keys and account ids.

## Groups

Groups are a membership list plus an opaque metadata ciphertext. The creator makes a sender-key distribution message and sends it to each member inside the existing 1:1 session, along with the group name. Group texts are `group_encrypt` blobs fanned out as sealed envelopes with a group id.

Each group has a membership epoch. A sender key is valid only for the epoch it was created for. Removing a member, leaving, learning that the member list shrank, or adding a member increments the epoch. The client that learns the change publishes its own sender key for the new epoch, and only to the members who remain. An added member does not receive the previous distribution. A received setup rotates the local key only when its epoch is newer, so setup traffic settles. A send on a key from an older epoch rotates first. Group payloads carry the epoch. Remaining members keep history from before the change and drop a message from an older epoch. An offline member rotates on the next sync, before sending.

Membership still comes from the relay. This is not MLS. A dishonest relay can still mis-state who is in the group. What the epoch does guarantee is that a member who was removed cannot decrypt a later message from a sender who has moved to the new epoch.

## Threads and files

A reply carries `replyTo` inside the libsignal plaintext. The envelope table has no thread column. Images, video, audio, and other files are sealed with a random AES-256-GCM key on the device. The server stores that ciphertext in `media` with a recipient or a group id, and no sender, filename, or media type. The file key travels inside the session or sender-key message. A disappearing timer deletes the media row with the envelope.

## Disappearing messages

The sender sets `expiresAt`. The server deletes the ciphertext on a one-second sweep. The client deletes its plaintext copy on the same timer.

## Durable delivery

A send writes the recipient, the exact ciphertext, and a stable queue tag into the local outbox in the same save as the advanced ratchet, before the POST. The envelope table is unique on `(recipient_account_id, queue_tag)`. A repeat POST is the original delivery. A restart sends the saved ciphertext and does not encrypt again. A group send queues every remaining recipient before the first POST, so a crash in the middle retries the saved ciphertexts.

On receive, the client saves the decrypted message, the new store, and the envelope id to acknowledge before the ack request. A restart acknowledges those ids and does not append the message again. The browser waits for the IndexedDB transaction to complete. The headless client writes a temporary file and replaces the vault. A missing file is no vault. An unreadable or corrupt file is an error, not a new account. One writer owns a vault. A revision counter refuses a stale save. Two browser tabs on one account stay unsupported.

## Run locally

From `C:\Dev\EndToEnd`:

```
yarn install
yarn build:crypto
yarn dev
```

`yarn dev` picks two free local ports the first time and writes them to `.local-ports.json`, then reuses that pair so the web address stays bookmarkable. With no `DATABASE_URL`, the API uses embedded Postgres (PGlite). Set `DATABASE_URL` to use a Postgres server instead. `scripts/build-crypto.ps1` expects the user-local Rust, MinGW, protoc, and wasm-pack toolchain used to build the WASM crate.


## Agent release integration

The versioned application boundary lives in the MIT `packages/protocol` definitions and `packages/client` transport. Agent UI controls authorize browser unlock/replacement/trust; adapters never receive raw cryptographic stores. Stable caller operation IDs survive adapter retries. The relay retains recipient/queue-tag delivery receipts and content fingerprints after envelope acknowledgement, so a lost send response followed by recipient ACK cannot requeue consumed ciphertext. These deduplication records contain no plaintext and remain until recipient-account deletion; deleting an envelope does not delete its receipt.

Group membership changes atomically advance the relay epoch. New queued group messages must match current membership and epoch; duplicate already-accepted operations resolve to their existing receipt. Removed recipients cannot fetch group envelopes. The agent retains blocked old-epoch ciphertext in its sealed archive rather than encrypting a different retry under the same operation.
