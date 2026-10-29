<!-- SPDX-License-Identifier: MIT -->
# Public browser consumer integration v1

This first-party interface document is MIT under `packages/client/LICENSE`. It describes ordinary public messages; it contains no device-agent implementation. It supplements `SDK_CONTRACT_V1.md`. Wire version stays 1.

## Configuration and authority

Serve the consumer and trusted agent from different origins. Use bare HTTPS origins; HTTP is supported only on loopback for local operation. Reject URL credentials, paths, queries and fragments in configured origins. The agent deployment explicitly allowlists each consumer origin and relay origin. An allowlist entry does not grant access to an account.

Both example frontends accept `{agentUrl, relayUrl, audience, grantPath}`. `grantPath` is a plain absolute path on the current host, never a remote URL, query, encoded path or redirect. After that host authenticates the user, `POST {}` to the path using same-origin host credentials. It returns a `MessagingGrant` directly. The host backend uses the public exchange contract; its signing key and account/business implementation never enter the browser or messaging service.

Configure `RelayService` with the trusted relay origin and audience. Validate metadata and the returned grant; use `attachInput(grant, stay)` to construct the agent attach request. Host cookies belong only on the host request. SDK relay requests omit cookies, refuse redirects, and use only the scoped messaging bearer token. Keep grants in memory and discard them on logout/account switch. A host must stop issuing assertions after it revokes access. See `HOST_IDENTITY_V1.md` in the public messaging source for server setup.

The native standalone demonstration can instead explicitly enable `{agentUrl, relayUrl, nativeAuth:true}`. Its public endpoints are:

| Endpoint | Input | Result |
| --- | --- | --- |
| `POST /api/auth/register` | `{handle,password,displayName?}` | `{token,account:{id,handle,displayName}}` |
| `POST /api/auth/login` | `{handle,password}` | The same authority shape |
| `POST /api/auth/logout` | Bearer token; no password | `{ok:true}` |

Native handles use 3–32 lowercase ASCII letters, digits or underscores; passwords require at least five characters. Attach native authority as `{relay:relayUrl,token,expectedAccountId:account.id,stay:'tab'}`. Native legacy tokens do not use `RelayService.session` or the scoped-host authorization field. The service password is separate from the device unlock secret. Support host grants and native demonstration authority as distinct modes.

## Popup pairing

1. Open the trusted popup synchronously from the user's gesture, or open a blank popup first and navigate it after loading validated configuration. Handle blocked/closed windows, cancellation and a bounded timeout.
2. Generate a fresh capability of 32–128 ASCII letters, digits, `_` or `-` and an independent nonce (at most 160 characters). Two concatenated `crypto.randomUUID()` values are suitable for the capability. Navigate to the configured agent with URL fragment `capability=<capability>&callerOrigin=<consumer origin>`. These values belong in the fragment, not an HTTP query or persistent storage.
3. Accept `{type:'endtoend-agent-ready',version:1}` only when `event.source` is that exact popup and `event.origin` is the configured agent origin.
4. Create a `MessageChannel`. Send `{type:'endtoend-agent-connect',version:1,nonce,capability}` to the exact agent origin and transfer `port2`. Transfer only once per attempt.
5. Require `{type:'endtoend-agent-connected',version:1,nonce}` on `port1` with the exact nonce before constructing `new AgentClient(new MessagePortTransport(port1))`. Close both ports/window and remove listeners/timers on failure or cancellation.
6. Call `attach` with the validated authority, then `requestUnlock`. The trusted agent opens its own unlock controls. Enter the device secret and approve identity changes only in that window. The consumer must not implement a substitute unlock, secret-entry or cryptographic vault.

The agent checks original opener, caller allowlist, capability, wire version and the single transferred port. Ordinary caller-origin access alone cannot pair. A capability is per connection, and is not an account token or device secret. Do not log or persist it. `AgentClient.capabilities()` describes available operations/events; the current agent advertises no events, so consumers poll `status`, `sync` and snapshots.

## Presentation lifetime

Use serialized commands and public account/message/contact/group DTOs. Attachment input/output is authorized plaintext encoded as ordinary bytes; the agent owns encryption, keys, sealed persistence and delivery policy. Retain a send's operation ID and exact input if completion is uncertain; cancellation cannot undo a committed send. Use the agent's pending-send operations for durable retry rather than creating a second delivery engine.

Invalidate the local lifetime before awaiting lock/logout/revocation cleanup. Clear plaintext, requests, pending presentation, selections, drafts, tokens and object URLs. Abort outstanding work and ignore results from older lifetimes. Close the transport and clear again when the agent locks, changes account, is revoked or closes. An ordinary membership/access refusal for one operation is not itself proof that the entire account session was revoked. Ask the agent for current status and preserve safe pending-retry presentation where appropriate.

These are integration requirements and interface semantics, not an exemption from another component's license. Copying covered AGPL UI/implementation retains its applicable obligations. Assess each concrete consumer's provenance and actual dependencies before making licensing claims.
