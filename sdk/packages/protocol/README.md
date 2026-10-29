# EndToEnd protocol v1

This new MIT package contains only wire validation and presentation DTOs. It depends on no agent, session engine or cryptography library. The independently executing agent remains AGPL.

SDK 0.2.0 publishes the complete typed `OperationMap`, 41 operation names including every legacy name, capability/event/error contracts and the public host assertion/session DTOs. Wire protocol remains v1. `yarn workspace @e2ee/protocol build` produces ordinary ESM and declarations at `@e2ee/protocol/standalone`; TypeScript source development keeps the original entry. See [SDK_CONTRACT_V1.md](../../docs/architecture/SDK_CONTRACT_V1.md) for the full public contract and lifecycle semantics.

Commands are `{version:1,requestId,operation,input,operationId?}`. Responses echo `requestId` and contain either `{ok:true,result}` or `{ok:false,error:{code,message}}`. `operationId` identifies one durable send attempt across retries; `requestId` identifies one transport exchange. Unsupported versions and malformed inputs fail before dispatch.

The 21 legacy headless operation names are exported as `LEGACY_OPERATIONS`. Browser operations include `attach`, `requestUnlock`, `lock`, `views`, `sendAttachments`, `attachment`, membership changes, expiry and agent diagnostics. Unlock/trust confirmation occurs in the browser agent's own trusted window. A caller cannot send a browser device secret or raw ratchet state through this interface.

Views contain messages, public peer identities/verification state, memberships, unseen state, expiry and attachment read handles/MIME/name. They contain no private keys, access keys, attachment encryption keys/nonces, libsignal stores or in-memory implementation objects. Plaintext views are returned only to an authorized client on the user's device. Relay requests remain encrypted.

For browsers, commands use an agent-authorized MessagePort after an origin/source/nonce-checked handshake. For local automation they use bearer-authenticated loopback `POST /v1/command`. The protocol is a technical interface, not an assertion about the legal boundary of any particular distribution.
