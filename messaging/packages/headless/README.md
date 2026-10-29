# EndToEnd local adapters

The existing 21 CLI, MCP, HTTP and GraphQL operations remain available. This package now calls a separately executing local messaging agent through protocol v1. Its runtime imports only the independent MIT client/schema and adapter dependencies; it never loads the session engine, WASM or vault keys. Existing AGPL notices for this adapter are retained.

`openHeadless(options)` still constructs synchronously. Operations, including `status()`, return promises because they cross a process boundary. Always `await client.close()` when finished. No `record`, raw `Vault`, ratchet store or private attachment-key APIs are exposed.

Configure `ENDTOEND_RELAY`, `ENDTOEND_VAULT` and `ENDTOEND_DEVICE_KEY`, then either:

- Set `ENDTOEND_AGENT_EXECUTABLE` to the released independent runner. Optional `ENDTOEND_AGENT_ARGUMENTS` is a JSON string array, never a shell command.
- Connect an existing loopback runner with `ENDTOEND_AGENT_URL` and `ENDTOEND_AGENT_CAPABILITY`.

Development and tests can explicitly supply `agentExecutable: process.execPath` and `agentArguments: ['--import', 'tsx', absoluteAgentRunnerPath]`. Resolving the runner is installation configuration; there is no default import of implementation code from a sibling checkout. A launched runner emits one `agent-ready` JSON line containing its loopback URL and capability. Device secrets enter that local runner through its environment, not protocol results.

The HTTP/GraphQL adapters bind only to `127.0.0.1`. Every operation requires `Authorization: Bearer <capability>`; a random capability is generated when `ENDTOEND_GATE` is omitted. Startup prints `{ "url": "http://127.0.0.1:PORT", "capability": "..." }` to the invoking local process. `/health` returns readiness without exposing account state. Browser `Origin` headers and unexpected `Host` values are rejected. These interfaces are local automation endpoints, not a cloud decryption service.

CLI example after runner configuration: `yarn workspace @e2ee/headless call status`. MCP continues on stdin/stdout; malformed JSON produces a parse error. GraphQL preserves operation names and JSON result shapes. File input remains standard base64.

`AgentClient.send`, `sendGroup`, `sendFile` and `sendAttachments` accept an optional durable operation ID. Retain that ID for an explicit retry after a lost response. A new call without it represents a new user action. The agent persists pending attempts and rejects a reused ID with different content.

Run `yarn workspace @e2ee/headless test` to cover old session regressions, real independent-process messaging, all adapters, capability/origin restrictions and protocol/client behavior. Internal session regression fixtures remain tests of the AGPL program; they are not consumer runtime dependencies.
