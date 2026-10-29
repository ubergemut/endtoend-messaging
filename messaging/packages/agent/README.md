# EndToEnd messaging agent

AGPL-3.0-only. Copyright EndToEnd contributors. No warranty. Modification and redistribution are permitted under the accompanying LICENSE. The independently usable protocol and client packages are MIT licensed.

The agent owns libsignal, encryption sessions, trust decisions, sealed vaults, attachments and durable delivery. Product clients use protocol v1 JSON commands and receive explicit presentation data. They never receive private keys, ratchet stores, attachment keys or executable crypto objects. The independent synthetic relay in `test/reference-relay.ts` is a conformance fixture, not a production database or account service.

## Local use

Install the pinned source distribution dependencies with Yarn and build the crypto artifacts as described in the distribution README. Run the agent with `node packages/agent/src/cli.mjs` (or `node --import tsx packages/agent/src/bin.ts`). Set `ENDTOEND_RELAY` to the authorized relay URL, `ENDTOEND_VAULT` to the local vault file, and `ENDTOEND_DEVICE_KEY` to a random 32-byte base64 device secret. An account password cannot recover that device secret. `ENDTOEND_PARENT_PID` optionally binds lifetime to the owning process. `--license` and `--source` report licensing and the optional `ENDTOEND_SOURCE_URL` without opening a vault.

The first stdout line is `{ "type":"agent-ready", "version":1, "url":"http://127.0.0.1:<assigned>", "capability":"<random>" }`. Treat this pipe as private. Send JSON to `POST /v1/command` with `Authorization: Bearer <capability>` and `Content-Type: application/json`. The listener binds once to loopback port zero, checks its exact Host, refuses browser Origin headers and requires the random capability. It does not enable CORS. All user input/errors use command responses; stdout is reserved for the startup record.

Commands use `{version:1,requestId,operation,input,operationId?}`. The safe surface includes status/unlock/lock/close, direct and group sends, friends/requests, groups/membership, messages/chats/focus/seen/expiry, safety verification, attachment reads and pending delivery/retry. `views` returns presentation DTOs. `attachment` accepts a mediaId and returns base64 bytes from a live message. `sendAttachments` accepts named base64 files up to 25 MiB each. A stable operationId retries the original durable send; reusing it with different content fails. Acknowledgement loss never creates a new ciphertext or identity.

Only one process can hold a vault. The vault lock uses an exclusive file and a guarded dead-owner reclamation; unreadable or interrupted reclamation locks fail closed and require inspection rather than risking two writers. Writes sync temporary bytes before switching committed files and retain the previous file during an interrupted replacement. Platform/filesystem guarantees still apply.

## Browser use

Build `yarn workspace @e2ee/agent-browser build` and host its static assets at a distinct origin. Supply `/config.json` using `apps/agent-browser/config.example.json` as a template. Register exact caller origins and authorized relay origins. The relay must allow the agent origin's bearer requests or be exposed through an authorized agent-origin proxy. Device state is scoped by verified relay origin and account ID.

The caller opens a top-level agent window through a user gesture, with random 32-byte base64url capability and callerOrigin in its URL fragment. The agent scrubs that fragment, validates configuration, sends an `endtoend-agent-ready` event and accepts a single origin/source/capability/nonce-bound MessagePort handshake. The caller then uses ordinary v1 commands on that port. `attach` verifies `/api/bootstrap` before accepting the account. `requestUnlock` focuses the agent's trusted secret-entry controls; raw secrets/passwords are refused on the browser protocol. Replacement, changed-identity trust and safety verification require confirmation in the agent window. The caller must send periodic commands; a 30-second idle channel timeout revokes the capability and locks the vault. Closing/navigating the agent or losing its opener also locks it. Reconnect with a new window and capability.

The agent retains the existing tab/day/week/month/forever remembered-unlock choices inside its own origin. Explicit lock/sign-out clears remembered device-secret material. Fresh browser storage is used in this implementation; no production vault migration or cross-origin import is performed. A changed group membership retains incompatible pending ciphertext instead of replaying it into a different membership; review the current group and start a new intent.

Run `yarn workspace @e2ee/agent test` for isolated protocol, independent-relay, byte-equality, author-integrity, durable-send, lock and interruption checks. The source/runtime release is a local candidate until the ownership and license-boundary review and explicit publication decision are completed.
