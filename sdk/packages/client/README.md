# EndToEnd agent client

This new MIT package imports only `@e2ee/protocol`. It performs transport and encoding, with no cryptographic implementation or agent imports.

SDK 0.2.1 keeps wire protocol v1. Build with `yarn workspace @e2ee/client build`; plain JavaScript and declaration consumers import `@e2ee/client/standalone` (and `@e2ee/protocol/standalone`). The source development entry remains unchanged. `command(name,input,{operationId?,signal?})` uses the complete typed `OperationMap`; generic `call` remains compatible. `RelayService` handles the fixed public metadata/session exchange/bootstrap/revoke endpoints with an explicit audience and messaging token. The full operation, lifecycle and host identity contract is [SDK_CONTRACT_V1.md](../../docs/architecture/SDK_CONTRACT_V1.md).

Patch 0.2.1 invokes default and explicitly supplied Fetch functions with `globalThis` as their receiver. Browser-native `window.fetch` therefore receives its required Window receiver instead of a transport instance. This corrects the browser `Illegal invocation` failure without changing the public protocol, endpoints, credential policy or cancellation behavior.

Create `new AgentClient(new HttpAgentTransport(loopbackUrl, capability))` for local automation, or `new AgentClient(new MessagePortTransport(port))` after the separate-origin agent has authorized the browser channel. Generic `call(operation,input,operationId?)` and typed compatibility methods return promises. `close()` rejects pending port requests and releases the transport. Timeouts report uncertain delivery; keep the same operation ID for retries.

The HTTP client refuses non-loopback addresses, includes only its explicit bearer capability, omits cookies and refuses redirects. Browser handshake authorization belongs to the agent and caller bootstrap, not this low-level port wrapper. It must include origin/source/nonce checks and account-bound authority before the port is passed here.

`node --import tsx packages/client/examples/reference-client.ts --help` runs the independent command-line example. Configure `ENDTOEND_AGENT_URL` and `ENDTOEND_AGENT_CAPABILITY` from the runner, then call `status` or another documented operation. JSON input comes from `--input-file path.json` or `--input-file -` for stdin. Send attempts print their durable operation ID to stderr before sending; reuse it with `--operation-id` after a lost response. The example imports only this transport package and Node standard modules.
