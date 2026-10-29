# Reuse messaging in a separate project

This guide applies to messaging core/full frontend/desk 0.2.0 and SDK 0.2.1. Start from the exact release catalog/manifests in the [release notes](../release/STEP_10_RELEASE_NOTES.md). Deploy a separate messaging instance, audience and persistent state for each project. Sharing source does not create federation or permission to open one account/vault concurrently across projects.

## Choose the presentation and its grant

| Choice | Treatment |
| --- | --- |
| Use or modify the original full EndToEnd frontend or AGPL reference UI | Preserve AGPL and required notices; supply the corresponding source for your actual modified version. The MIT SDK does not relicense copied UI. |
| Use or modify the concrete independent desk | Its marked first-party source is MIT; preserve its and the SDK's complete MIT notices. The separately running messaging product remains AGPL with its own source opportunity. |
| Author a new frontend/business service | Start from public SDK/contracts and your own code. Assess its actual provenance, imports, bundle contents and communication with messaging before selecting a separate/private grant. Different styling, HTTP or origins alone do not decide coverage. |

The [concrete boundary assessment](../../messaging/docs/release/FRONTEND_BOUNDARY_ASSESSMENT.md) explains the current clients. Keep generic messaging implementation public. Presentation code exchanges ordinary commands and account/message/group/file DTOs; do not import crypto/session/agent implementation, vault/ratchet types, attachment keys, private host models or executable callbacks across the interface. When a new relationship is uncertain, include the affected covered source or change the integration rather than promise blanket proprietary status.

## Install the exact product and source delivery

1. Keep the approved source/runtime archives, all manifests, full notices and `source-disclosure.json` together in an immutable delivery directory. Verify hashes before extraction. Preserve previous versions separately.
2. Extract core runtime into a new directory. Use Node 22.13.0 and Yarn 1.22.22; run `yarn install --frozen-lockfile --ignore-scripts --non-interactive`. Use [PUBLIC_PACKAGE.md](PUBLIC_PACKAGE.md) for source builds instead of substituting prebuilt WASM into a claimed fresh build.
3. Choose explicit persistent state outside source/runtime/delivery directories. Configure backups using the storage/recovery instructions and [accepted recovery limits](../../messaging/docs/release/STEP_7_DURABILITY_ACCEPTANCE.md). Rehearse initially with synthetic accounts.
4. Configure stable, distinct HTTPS origins for the reference browser, trusted agent and your application. Put your proxy in front of the launcher's printed loopback sockets. Allow the application origin explicitly; an origin allowlist does not authenticate a person.

Start the core from its runtime directory, substituting your own origins and paths:

```text
node --import tsx scripts/serve-messaging.mjs --data-dir <project-state> --source-disclosure <delivery>/source-disclosure.json --release-mode true --reference-origin https://reference.project.example --agent-origin https://agent.project.example --caller-origins https://app.project.example
```

The trusted origin proxies the public relay API used by the browser clients. For the packaged consumer runtime, install its frozen dependencies and run either presentation from that runtime directory:

```text
node scripts/run-sdk-consumer.mjs --component desk-client --disclosure <delivery>/source-disclosure.json --agent https://agent.project.example --relay https://agent.project.example
```

Use `endtoend-web` for the original AGPL frontend. These launchers bind local ephemeral sockets; they do not provision a public proxy or stable hosting. Retain full source/notice routes outside login/payment/grant handlers. A public source/download destination must be independently verified before the corresponding code or service reaches users. Follow [SOURCE_DELIVERY.md](SOURCE_DELIVERY.md), including `/source-disclosure.json`, `/releases/<version>/...` and `/release.json`.

## Connect the project's accounts

Native demonstration accounts remain available. For your own account system, add `--host-identity-config <public-trust.json>` to the core launcher and configure the issuer/public signing key, exact project audience and bounded lifetimes in [HOST_IDENTITY_V1.md](../../messaging/docs/architecture/HOST_IDENTITY_V1.md). The backend retains its private signing key and stable authenticated subject; the browser does not choose another person's identity.

Use the public [SDK contract](../../messaging/docs/architecture/SDK_CONTRACT_V1.md), [pairing/configuration contract](../../messaging/docs/architecture/BROWSER_CONSUMER_V1.md) and the detailed exchange/revoke examples in [HOST_INTEGRATION.md](../../messaging/docs/deployment/HOST_INTEGRATION.md). Those examples describe wire v1; use the current 0.2.1 SDK and source-delivery release options above rather than its earlier checkpoint packaging instructions. Return a finite scoped grant from your own authenticated backend. Pair the browser with the distinct trusted window, attach through `RelayService.attachInput(grant)` and request unlock there. Secret entry and identity approval remain trusted-agent actions.

For the packaged desk/full consumer's host mode, add `--grant-path <same-origin-path> --audience <project-audience>` and provide that host endpoint as described by the browser contract. Route that path at the public application origin to your own authenticated backend; the static launcher does not implement your business login or grant endpoint. The independent host backend returns the public messaging grant; it is not an executable callback imported into messaging. Native account mode is used only when no host-grant path is configured.

Keep one current vault per account/device, preserve operation IDs and exact input for intentional retries, and clear presentation/token state on account switch or revocation. Host logout must stop new grants and issue the documented host revocation; local UI cleanup alone is not server revocation. A signed grant is neither a device secret nor authority to restore an old ratchet or silently migrate an existing account by matching its handle.

Direct CLI/MCP source discovery needs `ENDTOEND_RELEASE_MODE=1`, `ENDTOEND_SOURCE_DISCLOSURE=<delivery>/source-disclosure.json` and a validated `ENDTOEND_SOURCE_BASE_URL` pointing to the actual reachable HTTPS delivery origin. Loopback HTTP is for local use. HTTP/GraphQL adapters expose source metadata/downloads without the messaging capability; their messaging operations remain gated.

## Accept the project's integration

Record the actual source/build/bundle/provenance relationship and grants; run relevant host, SDK, lifecycle, permission and persistence tests. Exercise both sign-in methods used by the project, expiry/revocation/account switch and byte-equal attachments. Check actual visible source/license/notices links while signed out and after revocation, then download and hash every exact source/notice through the final proxy/CDN. An AGPL-derived custom frontend needs its own source mapping; the stock core source is insufficient.

Use the covered-rights clause in [SOURCE_DELIVERY.md](SOURCE_DELIVERY.md). Independently licensed host terms apply only to that material and cannot reduce covered component rights. Keep source access and retained versions under [ONGOING_COMPLIANCE.md](../release/ONGOING_COMPLIANCE.md). A later device/appliance transaction, new implementation coupling or dependency/grant change needs the corresponding reassessment.
