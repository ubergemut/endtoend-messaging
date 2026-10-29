# Public host identity contract, version 1

The relay owns messaging accounts, contact consent, group membership and encrypted delivery. A host backend owns its login method and decides whether a signed-in person may obtain a messaging session. The relay never calls back into a private host application and never accepts a host password, cookie, OAuth access token, guessed subject or account ID as a messaging credential.

The `@e2ee/client` public relay client uses the `/messaging/v1` contract below. Messaging operations continue through the public agent protocol and existing generic relay operations. A host integration does not need the legacy account-registration form, `/api/auth/*` login model, or a private bootstrap endpoint. Existing standalone registration/password clients remain compatible.

## Deployment trust

Pass `hostIdentity` to `startServer`, or provide the equivalent managed-launcher configuration. The API exports `HostIdentityConfig` from `apps/api/src/hostIdentity.ts` and `apps/api/src/server.ts`; `validateHostIdentityConfig` validates configuration before the launcher creates storage.

```json
{
  "audience": "messaging-project-a",
  "sessionTtlSeconds": 3600,
  "assertionMaxAgeSeconds": 120,
  "issuers": [
    {
      "issuer": "project-a-backend",
      "keys": [
        { "keyId": "2026-10", "publicKey": "-----BEGIN PUBLIC KEY-----\n...Ed25519 SPKI PEM...\n-----END PUBLIC KEY-----\n" }
      ]
    }
  ]
}
```

Only public Ed25519 verification keys enter the relay. Keep private signing keys in the host backend. Do not put them in browser JavaScript, reference-app assets, a source archive or relay configuration. Use a different audience for each independent deployment, even when the same host issuer operates multiple deployments. An audience is an opaque, exact string of 1–256 characters with no C0/DEL control characters and at least one non-whitespace character; it is not trimmed or otherwise normalized. Configure only issuers authorized to provision accounts in that deployment. A trusted issuer can create accounts and revoke its subjects' sessions; it cannot assume an existing account belonging to another identity.

The assertion maximum age defaults to 120 seconds and cannot exceed 120. The session lifetime defaults to one hour and is configurable from 1 second to 24 hours. Configuration errors fail startup before the database opens. Removing an issuer from trust or changing the configured audience invalidates its previously issued scoped sessions on subsequent requests; removing just an old signing key stops new assertions using that key, while already issued sessions remain valid until expiry or revocation.

## Host assertion

An assertion has two canonical unpadded base64url segments separated by one period:

```text
base64url(UTF8(JSON payload)) . base64url(Ed25519 signature over those exact UTF8 bytes)
```

```json
{
  "version": 1,
  "keyId": "2026-10",
  "issuer": "project-a-backend",
  "subject": "opaque-stable-host-user-id",
  "audience": "messaging-project-a",
  "issuedAt": 1792900000,
  "expiresAt": 1792900060,
  "nonce": "fresh-random-base64url-at-least-16-characters",
  "purpose": "session",
  "handle": "optional_unique_handle",
  "displayName": "Optional display name"
}
```

Times are integer Unix seconds. Keep host and relay clocks synchronized: future `issuedAt` values are refused. Sign only after checking the current host login and messaging entitlement; never derive `subject` from an untrusted form field. Use a stable opaque subject within the issuer, rather than an email address that could be reassigned. Generate a fresh cryptographically random nonce for every assertion. The API rejects expired assertions and enforces both maximum age and lifetime. The payload has an exact allowed field set. The signature is verified over the original payload bytes. Assertion bodies are size bounded.

The optional handle is a lowercase 3–32 character messaging handle. It may create a new identity but cannot link to an existing password account or another host identity. Without one, the relay derives a stable `h_` handle from issuer and subject. The mapping `(issuer, subject) -> messaging account ID` is persisted; subsequent assertions cannot remap it by changing a handle or supplying an account ID. A different issuer with the same subject gets a separate account. Host-created accounts have no password login path. The optional display name initializes the public messaging profile; it does not grant access.

## HTTP contract

`GET /messaging/v1/metadata` returns version/protocol version 1, the configured audience, and the paths of the following endpoints. Without host configuration, metadata remains available but assertion exchange is disabled with 503. The standalone audience is `endtoend-relay`.

`POST /messaging/v1/session/exchange` takes only `{ "assertion": "..." }`. A valid session-purpose assertion returns:

```json
{
  "version": 1,
  "protocolVersion": 1,
  "audience": "messaging-project-a",
  "token": "opaque-messaging-bearer-credential",
  "expiresAt": "2026-10-25T16:00:00.000Z",
  "account": { "id": "messaging-account-id", "handle": "person_a", "displayName": "Person A" },
  "bootstrapPath": "/messaging/v1/session"
}
```

Provisioning, assertion nonce consumption and session creation commit in one database transaction. Concurrent/restarted assertion replay returns 409, rather than creating another account or credential. A handle conflict also returns 409 and never adopts the existing account. Keep returned tokens out of logs. The host token grants generic messaging access only; no host application's permissions are encoded or accepted by this relay.

`GET /messaging/v1/session` takes `Authorization: Bearer <messaging token>` for a finite, scoped messaging credential and refuses legacy unscoped tokens with 401. It returns `{version, protocolVersion, audience, account, enrolled, identityKey, expiresAt}`. `enrolled` and `identityKey` report the account's existing one-device enrollment; host exchange never replaces keys, resets a vault, or grants a second device. The trusted agent validates this bootstrap against the account, audience and future expiry before unlocking its local state. Existing password clients keep using `/api/bootstrap`, which retains the legacy `endtoend-relay` audience for legacy tokens. Converting an existing password account to a host identity would require an explicit migration; this contract never links accounts by a matching handle or supplied account ID.

`POST /messaging/v1/session/revoke` takes the same bearer credential and deletes that current session. All its subsequent authenticated HTTP calls fail; existing account notification sockets close and any remaining authorized session can reconnect. It does not revoke another active messaging credential for the account.

`POST /messaging/v1/host/revoke` takes `{ "assertion": "..." }` signed with `purpose: "revoke"` for the issuer/subject. It atomically consumes the nonce, records a persistent revocation cutoff and deletes every active host-issued messaging session mapped to that identity; notification sockets close immediately. An unused session assertion issued before or during that cutoff second is refused, including after relay restart. Issuing a new session after logout requires a newly checked host login and an assertion with `issuedAt` strictly later than the cutoff; a same-second fresh login must retry with a freshly signed assertion in the next second. Exchange and revocation lock the same subject row, so a concurrent exchange cannot revive a pre-revocation assertion. Revoking an unknown subject succeeds without exposing whether the subject has an account and records its cutoff too. A host must call this endpoint on host logout, membership removal or loss of messaging entitlement, and must stop minting session assertions for a person who no longer has access. A host logout does not reach the relay automatically through an unrelated cookie or OAuth provider. An already authenticated in-flight messaging operation can finish; revocation does not rewind committed cryptographic state.

Expired scoped credentials fail every authenticated relay request and their websocket closes at expiry. A valid messaging credential still cannot bypass contact acceptance, blocking, group membership, epoch checks or media authorization. Existing sealed-sender delivery capabilities remain a separate part of the messaging protocol; authentication expiry does not revoke a recipient's previously shared capability. A host revocation is access control, not deletion of encrypted history or previously delivered plaintext.

## Storage, migration and lifecycle

Migration 2 appends host identity mappings, replay nonces, revocation cutoffs and scoped session columns. Migration 1's exact SQL and checksum remain unchanged. Existing accounts, keys, legacy sessions, queues, ACK tombstones, media and group membership are preserved. Legacy sessions retain their previous semantics; the host-identity session expiry policy applies to newly exchanged scoped credentials. A future/incompatible schema is refused rather than downgraded.

Host identity does not introduce cross-project account federation or a shared vault broker. Use a separate relay deployment, audience and device-vault path for each project. Keep stable trusted-agent origins in deployed browser integrations. Reopening a current vault continues the same enrolled device; restoring stale cryptographic state is not a login recovery mechanism. Follow the managed storage/backup documentation for database upgrades and coordinated recovery.

Synthetic tests cover independent password-site and magic-link issuer fixtures, signature/claim validation, stable identity mapping, account-claim refusal, atomic concurrent/restarted replay, migration-1 preservation, session expiry, client/host revocation and existing contact/group enforcement. These tests establish the implemented technical boundary; licensing conclusions and the final release assessment remain separate plan steps.
