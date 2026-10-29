# Public messaging reference browser

This AGPL-3.0-only application is a standalone, first-party reference consumer of `@e2ee/client` and `@e2ee/protocol`. It imports no EndToEnd product frontend, vault, session or crypto implementation. It adds no third-party UI runtime. Its handshake was adapted from the original first-party browser consumer and remains AGPL reference code; copying it is not a demonstration of an independently licensed proprietary frontend.

The UI supports registration/login, trusted agent unlock, contact requests, direct conversations, groups and membership, text, replies, disappearing messages, multiple attachments and byte downloads, safety-number display and trusted verification, pending-send retries, lock and logout. Secret generation/entry, device state, cryptography and identity decisions remain in the separate trusted agent window. Membership-changed pending operations are visibly blocked. The existing full EndToEnd frontend remains separate and unchanged by this application.

Build from the repository root after installing the locked workspaces:

```sh
node node_modules/typescript/bin/tsc --noEmit -p apps/messaging-reference/tsconfig.json
node node_modules/vite/bin/vite.js build apps/messaging-reference
node --import tsx --test apps/messaging-reference/test/config.test.ts
```

Serve `dist/` on the reference origin, proxy `/api` to the persistent public relay, and provide `/agent-config.json` with:

```json
{"agentUrl":"https://agent.example/","relayUrl":"https://agent.example/"}
```

The trusted agent needs its existing caller-origin allowlist/runtime configuration and a proxy or CORS policy permitting its relay requests. The reference origin and agent origin must differ. HTTPS is required except for loopback development. Configuration URLs cannot contain credentials, query strings or fragments. The product-to-agent channel verifies the popup source, agent origin, per-attempt nonce and fresh capability before transferring a MessagePort. Agent access is attached to the authenticated account ID and token.

This reference uses the public relay's `/api/auth/register`, `/api/auth/login` and `/api/auth/logout` contract. A generic external host-account adapter belongs to the integration-contract step. Authentication tokens are held only in memory; a page reload requires signing in again. Reload/navigation and popup closure clear plaintext presentation and disconnect the in-memory agent while preserving its chosen remember-key policy. Explicit lock and logout forget the remembered key. Account passwords are cleared after authentication; device secrets never enter this frontend. Pending sends saved by the agent can be retried after reconnecting.

Deployments must serve the exact release's `LICENSE.txt`, `THIRD_PARTY_NOTICES.txt` and corresponding source. The launcher can supply `/release.json` with a same-origin or HTTPS `sourceUrl`; the footer otherwise points to `/source`. These links are deployment obligations, not a claim that a release has already been published.

The browser acceptance module exports `exerciseReferenceApplication({browser, productUrl, prefix})` for the release orchestrator. It creates only new synthetic accounts in a caller-provided fresh relay and checks pairing, request acceptance, direct/reply/group delivery, attachment bytes, inert HTML message rendering, expiry and presentation clearing. Stable labels include `Handle`, `Account password`, `Display name`, `Connect trusted agent`, `Request handle`, `Request note`, `Message`, `Attachments`, `Group name` and `Group members`. Conversation buttons expose `data-peer` and `data-group`; message articles expose `data-message`.

```sh
ENDTOEND_REFERENCE_URL=http://127.0.0.1:PORT node apps/messaging-reference/test/browser-acceptance.mjs
```

Use a new temporary persistent relay directory and loopback listeners assigned port `0`. Do not run acceptance against existing accounts or operational data. The test does not start or select a database itself.
