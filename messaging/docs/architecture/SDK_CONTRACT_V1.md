# Messaging SDK 0.2.0: public protocol v1

The independently executing messaging engine, trusted agent, relay and reference application are AGPL-3.0-only. `@e2ee/protocol` and `@e2ee/client` are first-party MIT interface code. The owner has confirmed control of first-party rights. These packages contain DTOs, envelope validation, ordinary encoding and transports; they import no AGPL implementation, libsignal engine, private store or cryptographic state. Their package-local LICENSE files travel with source and builds. The MIT grant covers these packages; it does not grant a separate license to the engine, a copied reference UI or an arbitrary surrounding application.

SDK release `SDK_VERSION` is `0.2.0`; `PROTOCOL_VERSION` remains `1`. New operations and optional fields are additive. Never infer support from package version: ask `capabilities`. An old dispatcher may reject that new operation with `invalid`; use only known operations in that case. Unsupported wire versions require a new negotiated connection. Do not reinterpret a v2 body as v1.

## Build and imports

`yarn workspace @e2ee/protocol build` builds the dependency-free contract. `yarn workspace @e2ee/client build` builds both MIT packages with their declared TypeScript tool. Output is ordinary ESM JavaScript and `.d.ts` declarations. The build imports no AGPL source. Runtime builds need no TypeScript, tsx or Node-specific library. Browser transports require modern browser Fetch, AbortSignal, MessagePort, Web Crypto random UUID and base64 primitives; the Node examples require modern Node with those globals.

The repository's existing TypeScript development entry remains `@e2ee/client` / `@e2ee/protocol`. Plain JavaScript and built declaration consumers use `@e2ee/client/standalone` / `@e2ee/protocol/standalone`. The compiled client imports the compiled protocol subpath. A package containing only those two built distributions and their manifests/licenses runs independently; the isolated build test also compiles a consumer with intentional type-error assertions. The SDK's integration tests that launch a reference agent are test fixtures for interoperability and are not runtime dependencies of the SDK.

## Commands and replies

Request: `{version:1,requestId,operation,input,operationId?}`. Reply: `{version:1,requestId,ok:true,result}` or `{version:1,requestId,ok:false,error:{code,message}}`. Request IDs are nonempty strings up to 128 characters without control characters. A MessagePort never reuses a request ID, including after cancellation or completion. Each `AgentClient.call()` generates a fresh UUID. `operationId` is a different identifier: retain it for the lifetime of one send intent and all retries of exactly that content.

`OperationMap`, `OperationName`, `OperationInput<K>` and `OperationOutput<K>` describe every dispatcher operation. `client.command(name,input,{operationId?,signal?})` checks names, input and output at compilation. The existing `client.call<T>(operation,input={},operationId?,{signal?})` remains available for extensions and old adapters; the generic type is the caller's assertion, not runtime validation of every result. The wire validator checks envelopes, IDs, versions and error shape. The engine validates operation arguments and authorization. Consume remote output as untrusted data and render text safely.

All 21 original operations in `LEGACY_OPERATIONS` remain available. The complete operation list has 41 names, including two aliases. Empty input means `{}`.

| Operation | Input | Result |
| --- | --- | --- |
| `license` | Empty | AGPL engine license, MIT client license, version and optional source URL |
| `capabilities` | Empty | `AgentCapabilities`: version/protocol, supported operations/events, local cancellation and stable-send semantics |
| `status` | Empty | `Status`: lock/account/relay/vault-label/trust status |
| `views` | Empty | `AgentViews`: current live messages, contacts, groups, seen IDs, public identities, trust prompt, revision |
| `attach` | relay, explicit token, expectedAccountId, optional stay and authorization | `Status` |
| `requestUnlock` | Empty | `Status` with optional pending trusted-window prompt |
| `setStay` | stay: tab/day/week/month/forever | remembered-unlock duration |
| `unlock` | handle, password, optional explicit replaceKeys | `Status`; browser agent refuses caller-entered device secrets |
| `cryptoDiagnostic` | Empty | ok, message, optional description |
| `sync` | Empty | public messages and pending-trust handle |
| `friends`, `friendsList` | Empty | contact presentation and verification state; public identity key optional |
| `requests` | Empty | inbound/outbound requests, status and available decrypted note |
| `requestFriend` | handle, optional note | current requests |
| `respondRequest` | id, action: accept/decline/cancel | current requests |
| `block` | handle | `{ok:true}` |
| `unfriend` | handle | `{ok:true}` |
| `chats` | Empty | conversation summaries and unseen counts |
| `messages` | optional handle or groupId | public message presentation rows |
| `focus` | optional handle or groupId | selected message and thread ID |
| `markSeen` | ids | seen count |
| `dropExpired` | Empty | expired message IDs |
| `send` | handle, body, optional replyTo and expiresInSeconds | public message |
| `sendGroup` | groupId, body, optional replyTo and expiresInSeconds | public message |
| `sendFile` | handle or groupId, name, MIME, base64, optional body/reply/timer | public message |
| `sendAttachments` | handle or groupId, files[{name,mime,base64}], optional body/reply/timer | public message |
| `pendingSends` | Empty | retained attempts with operationId, content summary and blocked reason |
| `retryPending` | Empty | results of replaying retained attempts |
| `attachment` | mediaId | base64 plaintext only for an active message attachment |
| `createGroup` | name, handles | group ID/name/member IDs |
| `groups`, `groupsList` | Empty | current group presentation and membership |
| `addMember` | groupId, accountId | member IDs |
| `removeMember` | groupId, memberId | `{ok:true}` |
| `leaveGroup` | groupId | `{ok:true}` |
| `safetyNumber` | handle | handle, safety number and verified state |
| `trustIdentity` | optional handle | ok or pending trusted approval |
| `markVerified` | handle | ok or pending trusted approval |
| `lock` | Empty | `{unlocked:false}`; revoke current unlocked session |
| `close` | Empty | `{unlocked:false}`; engine close command, distinct from closing SDK transport |
| `disconnect` | Empty | `{unlocked:false}`; detach caller authorization |

Public views may contain authorized plaintext and public ciphertext/identities. They never contain attachment encryption keys/nonces, device secrets, libsignal stores, private keys or raw session objects. Those remain within the AGPL agent and its sealed storage. The SDK does not persist any response, token, key or view automatically. Applications must clear their own view state when locking, switching accounts or revoking authority.

## Transport lifecycle, events and cancellation

For local automation, `HttpAgentTransport` accepts a bare HTTP loopback URL and an explicit capability. It posts `/v1/command`, omits cookies, refuses redirects, disables caching, bounds JSON responses to 64 MiB and applies a 120-second timeout. Closing the transport aborts in-flight fetches. It does not claim a push subscription. Reconnect by constructing a new transport using fresh agent readiness details; a stale capability is not retried automatically.

For browsers, complete the trusted agent's origin/source/nonce handshake before passing the authorized port to `MessagePortTransport`. The transport cannot authorize a port by itself. It correlates replies by request ID, rejects duplicate/reused IDs, rejects pending requests on timeout/close and removes abort/timer listeners. Responses arriving after cancellation or close cannot fulfill a later request. Account changes require disconnect/revoke, clearing local presentation state, a fresh authorized handshake and attach to the expected account. Do not change the token beneath queued commands for another account.

`subscribe(listener)` returns an unsubscribe function; unsubscribed listeners are not called. An unsupported transport rejects subscription instead of implying automatic refresh. The current dispatcher advertises `events:[]`; callers explicitly `sync` and read `views`. The SDK validates the following reserved v1 event schema for agents that advertise those events: `{version:1,event,revision,accountId?,reason?}`, with a nonnegative safe-integer revision. Events are hints to reread authorized views, not message payloads or authority grants. Revisions apply to that connection/account and are not a globally durable cursor.

| Event | Meaning and client action |
| --- | --- |
| `views` | Authorized presentation changed; refresh views |
| `status` | Connection/lock status changed; reread status |
| `locked` | Drop displayed plaintext and ask the trusted agent to unlock |
| `revoked` | Reject pending transport calls, close port, clear application views and reconnect with new authority |
| `disconnected` | Same transport teardown as revoked; new handshake required |

`AbortSignal` is supported by generic `call`, typed `command`, and lifecycle/send convenience methods. Cancellation is **local-only**: it stops waiting/receiving and aborts the fetch where possible. It cannot roll back a command already received by the engine. A timed-out, cancelled or disconnected send may already have persisted or delivered. Retain the same operation ID and unchanged content when retrying; inspect `pendingSends`/`retryPending` and the conversation before creating a different intent. Changing content under the same operation ID is refused. Membership changes may block a retained ciphertext; review membership and create a new intent when appropriate. Never retry with new IDs merely because a response was lost.

`AgentClient.close()` cancels all local pending calls and closes its transport. `AgentClient.revoke()` performs the same local teardown with a `revoked` error; neither sends a server revocation request. `client.disconnect()` is the remote detach command. `RelayService.revoke(token)` revokes the server-issued messaging session. Host-wide revocation uses a separately signed purpose-specific assertion. None deletes encrypted history or recovers a stale cryptographic vault. A closed client is not reusable.

| Error code | Caller action |
| --- | --- |
| `invalid` | Correct malformed/unsupported input; do not retry blindly |
| `unauthorized`, `forbidden` | Obtain appropriate messaging authority; never substitute a host cookie |
| `locked` | Clear visible plaintext; unlock through the trusted agent |
| `untrusted` | Review the changed public identity in trusted controls |
| `replace-keys` | Device/account mismatch; explicit user-confirmed replacement or correct vault required |
| `vault`, `device-key` | Preserve local data; resolve storage/writer/secret issue without stale-state rollback |
| `relay` | Relay operation failed; reconnect/sync with the same send intent where delivery is uncertain |
| `internal`, `protocol` | Reject malformed/inconsistent replies; report diagnostic without secrets |
| `timeout`, `cancelled` | Outcome may be uncertain; preserve operation ID |
| `closed`, `revoked` | Clear caller state and establish a fresh authorized client |
| Unknown string | Retain a safe fallback; later compatible versions may add codes |

## Public host identity boundary

`new RelayService(bareOrigin,{audience,fetcher?,timeoutMs?,maxResponseBytes?})` uses a configured HTTPS origin (HTTP allowed only for localhost/127.0.0.1/::1) and an explicit expected audience. Audience is an opaque Unicode string with JavaScript length 1–256, not entirely whitespace, and no C0 or DEL control characters; accepted values retain their exact bytes/code units without trimming or normalization. Relay, agent and SDK apply the same bounds and exact equality. Paths, query strings and credentials are forbidden in configuration. Every request omits cookies, refuses redirects, disables cache, bounds the response (default 1 MiB), and supports caller cancellation and client close. It sends a Bearer token only to fixed messaging session endpoints when the caller passes that messaging token. It neither reads browser storage nor forwards host authentication automatically.

| Method | Fixed public endpoint | Authority/result |
| --- | --- | --- |
| `metadata()` | GET `/messaging/v1/metadata` | Public v1 protocol, audience and fixed same-origin relative endpoints |
| `exchange(assertion)` | POST `/messaging/v1/session/exchange` | Signed host assertion; returns short-lived messaging grant |
| `session(token)` | GET `/messaging/v1/session` | Explicit messaging token; returns account, enrollment/public identity and expiry |
| `revoke(token)` | POST `/messaging/v1/session/revoke` | Revoke that messaging session |
| `hostRevoke(assertion)` | POST `/messaging/v1/host/revoke` | Purpose `revoke` assertion; revoke authority for issuer/subject |

Metadata cannot redirect the SDK to another host or path. Replies must match version 1, protocol 1 and the configured audience. Grants/bootstrap must carry a future parseable expiry, account ID/handle/displayName and the expected bootstrap path. `attachInput(grant,stay?)` derives the existing agent attach shape with `{authorization:{audience,bootstrapPath:'/messaging/v1/session'}}`; the agent independently checks that authorization/account and its public identity before using the vault. Grants are short-lived bearer secrets, not encryption keys. Avoid logs, URLs, analytics and persistent frontend storage.

The public `/messaging/v1/session` bootstrap accepts only a scoped host-exchange grant and always supplies a non-null expiry. Legacy or unscoped native-login tokens receive 401 on that endpoint. Existing native authentication and compatibility clients retain `/api/bootstrap`; their original flow is unchanged and does not imply access to the new scoped bootstrap.

The host backend signs the exact UTF-8 payload bytes with Ed25519. Compact assertion form is two unpadded base64url parts: `payload.signature`. Payload claims are `{version:1,keyId,issuer,subject,audience,issuedAt,expiresAt,nonce,purpose,handle?,displayName?}`. Times are integer Unix seconds. Purpose is `session` for exchange or `revoke` for host revocation. The explicitly configured issuer/key ID selects a trusted Ed25519 public key; no untrusted URL supplies keys. Relay checks signature, audience, time bounds, purpose and replay nonce before linking a stable issuer/subject to an account. Display names and handles are presentation/profile inputs, not account linkage keys. A revoked/disabled issuer or changed subject requires new authority; no implicit account merge is permitted.

The SDK transports a pre-signed assertion and does not possess the host signing key. Signing belongs in a separate trusted host backend using its own secret management; never put it in a browser, generic frontend bundle, grant or agent presentation views. The interface has no imports from host application internals and makes no claim that any particular frontend's legal boundary has been assessed; that assessment remains a separate plan step.
