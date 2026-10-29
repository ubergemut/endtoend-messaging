# Correspondence desk

A new, independently authored, framework-free browser consumer of the published EndToEnd MIT SDK 0.2.0. The presentation is a warm neutral and green three-column desk: address book and rooms, transcript cards, and details/files. Application code is MIT; the included LICENSE reproduces the SDK owner's first-party MIT grant. This grant does not relicense the separately running agent, relay, engine, or other applications.

The original 2026-10-26 implementation was authored without consulting an existing frontend, agent, backend, encryption, session, or private contract source. The app implements presentation, controller state, public authentication HTTP calls, popup pairing, and SDK calls. It implements no encryption, key handling, vault, signing, or secret persistence. Device unlock and identity approvals occur only in the separate trusted agent window. Native service passwords are used only by the explicitly configured public demo authentication endpoint and cleared from form/controller state immediately.

On 2026-10-27, public source-disclosure links were added using the release metadata interface. The maintenance agent also inspected the retained full frontend to place its separate notice. This later first-party notice code retains MIT; the original blind authoring record and this maintenance delta are recorded in AUTHORING_PROVENANCE.json. Current release tests use SDK 0.2.1, which retains the same protocol v1 and MIT grant.

## Static hosting

Serve this directory as a static web root on HTTPS (HTTP loopback is allowed). No install or build is required. Serve the **published built SDK** at the following same-origin paths:

- `/sdk/client/index.js` and `/sdk/client/relay-service.js`: the archive's `packages/client/dist` files.
- `/sdk/protocol/index.js`: the archive's `packages/protocol/dist/index.js`.

The import map maps `@e2ee/client/standalone` and `@e2ee/protocol/standalone` to those files. All app runtime imports are public MIT SDK modules. There are no framework, package-manager, or third-party runtime dependencies. The host must separately run the public relay and trusted agent. The agent origin must differ from the desk origin.

Provide `/desk-config.json` with exactly one auth mode:

```json
{"agentUrl":"http://127.0.0.1:5202","relayUrl":"http://127.0.0.1:5200","nativeAuth":true}
```

or a host grant flow:

```json
{"agentUrl":"https://agent.example.test","relayUrl":"https://relay.example.test","audience":"host-messaging","grantPath":"/api/desk/grant"}
```

Origins must be bare secure origins without paths, credentials, queries, or fragments. A grant path must begin with one `/` and contain only ASCII letters, digits, `_`, `-`, and `/`; no traversal, query, fragment, encoding, or remote URL is accepted. The host endpoint receives `POST {}` with same-origin host credentials and must return the public `MessagingGrant` directly. The browser holds no host signing keys. `RelayService.attachInput()` validates the grant against the configured audience. Native mode is enabled only by `nativeAuth:true`: public `/api/auth/register` and `/api/auth/login` return `{token,account}`; `/api/auth/logout` receives that bearer token. Native tokens use ordinary `attach`, with no scoped-host authorization or `RelayService.session` call.

Pairing opens the configured agent with hash `capability=<randomUUID+randomUUID>&callerOrigin=<desk origin>`. The desk accepts `endtoend-agent-ready` only from that exact popup and agent origin. It transfers a MessageChannel port in `{type:'endtoend-agent-connect',version:1,nonce,capability}`, then waits for `endtoend-agent-connected` with the same nonce on the other port. Only then is the port passed to `AgentClient(new MessagePortTransport(port))`, attached, and asked to `requestUnlock()`. Popup blocking, closure, local cancellation and 45-second pairing timeout are handled. The explicit handshake wire and native HTTP DTOs were supplied by the task's public-interface clarification; the SDK package itself describes the security requirements but does not enumerate the popup wire or native DTOs.

The desk uses public `views`, `status`, `requests` and `pendingSends` snapshots; a two-second poll keeps an unlocked or pending-unlock session current. Contacts, inbound request acceptance, direct and reply messages, room creation/send, byte-safe file send/download, explicit sync, retained-send retry, safety numbers and trusted verification are available. File uploads are limited to 20 MiB by this desk. Untrusted presentation is written with `textContent`; attachments are downloaded as byte blobs, never interpreted or inserted as HTML. Timed-out sends retain the same operation ID and exact input for a deliberate retry. Pending operations are also available from the agent's delivery tray.

Lock/signout immediately invalidate the presentation lifetime, abort local work, clear plaintext/forms/tokens and revoke object URLs. They then ask the agent to lock (and disconnect on signout), revoke the messaging session and close the port/popup. A failed remote cleanup cannot restore the cleared desk. Popup closure or a locked/revoked/disconnected event clears the local presentation. Reconnection requires fresh authentication and pairing. Nothing is persisted to browser storage.

## Browser acceptance

`test/browser-acceptance.mjs` exports stable selectors, public browser helpers, and `runDeskAcceptance`. The runner supplies Playwright-compatible pages, disposable credentials, trusted-agent UI actions, and download reading. Tests import no protected application implementation. The two-client scenario exercises registration/pairing/unlock, requests and acceptance, direct/reply text, inert untrusted text, file byte equality, room messages, safety/trusted verification, sync/retry, lock and signout cleanup. A cross-client runner can use the exported helpers independently. The runner remains responsible for arranging a pending/timeout fixture when it needs to assert those failure paths.

`test/public-interface-lifecycle.mjs` starts a fresh synthetic public-wire fixture and serves the actual published SDK builds. It accepts a Playwright module path, the published SDK extraction directory, and optionally a Chromium executable path. It reads only this desk's files and the SDK's built distributions, and imports no other application code. Its 17 browser scenarios passed during authoring: native and host attach/revoke/cookie boundaries, immediate lock cleanup, late sends/views, cancellation after authority issuance, ordinary membership refusal, stable uncertain-send intent, wrong ready/connected version or nonce, blocked/closed popup, pairing timeout and unsafe grant path. Playwright is runner-supplied test tooling; it is not an app dependency. Use `npm run check` in this directory for dependency-free JavaScript syntax checks.

## Authoring provenance

Authoring input archive: `endtoend-mit-sdk-0.2.0.tar.gz`, 47,970 bytes, SHA-256 **04e322fe66f3f6bf620b1ea58f75944c48564baca29acbee5599400a137a3077**. Input location: `C:/Users/chris/Documents/Codex/2026-10-23/ex/outputs/messaging-0.2.0-step-5/mit-sdk/`. A fresh extraction was made at `C:/Users/chris/Documents/Codex/2026-10-23/ex/work/step6-independent-sdk-input/`. The archive hash matches `PACKAGE_RECEIPT.json`.

Only these supplied files were consulted during original authoring:

- External `SDK_MANIFEST.json` and `PACKAGE_RECEIPT.json`.
- Extracted root `README.md` and `LICENSE`.
- `docs/architecture/SDK_CONTRACT_V1.md`.
- `packages/client/README.md`.
- `packages/client/dist/index.d.ts`, `index.js` (public lifecycle-method inspection during testing), `relay-service.d.ts`, and `relay-service.js`.
- `packages/protocol/dist/index.d.ts`.

The task's interface instructions supplied the exact popup pairing wire, native public HTTP DTOs, configuration shape, presentation requirements and test expectations. No prior chat, existing application, older snapshot or non-SDK repository file was used as an authoring input. This provenance records source separation; a legal assessment of the broader distribution is a separate responsibility.
