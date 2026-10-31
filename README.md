# EndToEnd reusable messaging

**October 31 candidate:** the editable core tree now contains the tested 0.2.1 hosted-controls candidate, while the original consumers remain 0.2.0 and SDK remains MIT 0.2.1. It is prepared for the named project owner’s content/publication decision and is not yet published. See [the changed-scope assessment](docs/release/HOSTED_CONTROLS_0_2_1_ASSESSMENT.md) and [exact candidate catalog](release/candidates/messaging-v0.2.1/source-disclosure.json). The approved 0.2.0 downloads and decisions below remain retained.

A complete messaging subsystem with a persistent relay, device encryption/session storage, trusted unlock and identity controls, CLI/HTTP/GraphQL/MCP adapters, a reference browser, and two project frontends. Hosts can retain their own account system and presentation through the public SDK and signed messaging grants.

This tree contains the editable approved **messaging/full frontend/desk 0.2.0** sources and **MIT SDK 0.2.1**, including required dependency preferred forms and notices. It starts a separate public source history; it does not publish the original private repository history. Release contents and publication records are identified in `release/APPROVED_RELEASE.json`. This README does not claim a hosted service or production deployment.

## Components and licenses

| Component | Source here | Grant |
| --- | --- | --- |
| Complete messaging implementation, relay, device agents, trusted/reference UI and adapters | `messaging/` | AGPL-3.0-only, with retained third-party terms and identified MIT interface/helper files. |
| Original full EndToEnd web frontend | `consumers/apps/web/` | AGPL-3.0-only. SDK imports do not relicense its original UI. |
| Independently authored desk | `consumers/apps/desk-client/` | MIT for its marked first-party source; the separately running messaging implementation remains AGPL. |
| Public protocol/client SDK 0.2.1 | `sdk/`, also included in consumer source | MIT for the marked protocol/client source. It does not create an exception to another component's copyleft. |

Read [LICENSING.md](LICENSING.md), the component LICENSE files and supplied third-party notices. Root LICENSE is the AGPL text, not a blanket replacement of the component grants. Mixed source/runtime archives preserve those distinctions. A copied or modified AGPL UI remains covered; a future independently licensed frontend needs its own provenance and actual coupling assessment. See the [per-project guide](docs/deployment/PROJECT_INTEGRATION.md).

The internal source/dependency/boundary assessment identifies no unresolved licensing blocker for these exact approved contents under the recorded delivery policy. That is a bounded internal conclusion, not an outside professional opinion, universal private-frontend exemption or legal guarantee.

## Downloads and exact corresponding source

Use the [messaging-v0.2.0 release assets](https://github.com/ubergemut/endtoend-messaging/releases/tag/messaging-v0.2.0). Source downloads use ordinary public web access without an account, payment or NDA.

| Source | Runtime |
| --- | --- |
| [Complete messaging source](https://github.com/ubergemut/endtoend-messaging/releases/download/messaging-v0.2.0/endtoend-messaging-0.2.0-source.tar.gz) | [Messaging runtime](https://github.com/ubergemut/endtoend-messaging/releases/download/messaging-v0.2.0/endtoend-messaging-0.2.0-runtime.tar.gz) |
| [Full frontend and MIT desk source](https://github.com/ubergemut/endtoend-messaging/releases/download/messaging-v0.2.0/endtoend-browser-consumers-0.2.0-source.tar.gz) | [Browser-consumer runtime](https://github.com/ubergemut/endtoend-messaging/releases/download/messaging-v0.2.0/endtoend-browser-consumers-0.2.0-runtime.tar.gz) |
| [MIT SDK source, ESM and declarations](https://github.com/ubergemut/endtoend-messaging/releases/download/messaging-v0.2.0/endtoend-mit-sdk-0.2.1.tar.gz) | Included in that SDK archive. |

Download the [source-disclosure catalog](https://github.com/ubergemut/endtoend-messaging/releases/download/messaging-v0.2.0/source-disclosure.json) and **every file it references**, including source, five manifests and all license/notice files. The catalog SHA-256 is **`f1f345bb8496ae56e347a5b07381edf95527fbb19958b761c59d8126c6b313a2`**. Its records give each exact filename, byte count and SHA-256; [release notes](docs/release/STEP_10_RELEASE_NOTES.md) list the archive identities. The repository's `release/` directory retains the catalog, manifests, checksum list and approved-release summary.

Keep the complete delivery set together. The core source alone is not corresponding source for the separate AGPL full frontend. Archives are the canonical exact release snapshots; the editable `messaging/`, `consumers/` and `sdk/` trees mirror their approved sources, including upstream preferred-source archives. Installed dependencies and generated build outputs are excluded from these source snapshots.

If GitHub CLI is configured, downloading all release assets is convenient:

```text
gh release download messaging-v0.2.0 --repo ubergemut/endtoend-messaging --dir <new-delivery-directory>
```

The CLI is optional; the release-page web downloads provide public access. Check the actual downloaded lengths/hashes before installation. `release-tools/check-published-source.mjs` and `release-tools/verify-published-release.mjs` provide the retained publication/source checks; they do not publish or confer approval.

## Build the editable sources

Use **Node 22.13.0** and **Yarn 1.22.22**. Each source tree is its own workspace; run commands inside that tree, not at this repository's top level. Set `--production=false` explicitly to install build/test tools even when the surrounding environment is configured for production. Lifecycle scripts stay disabled.

For the core, install the pinned tools in `messaging/docs/release/TOOLCHAIN.json`, including Rust's WASM target, wasm-pack, protoc and the C toolchain. **Windows x86_64 GNU is the validated crypto platform**; other platforms need validation. From a fresh source tree without product build outputs:

```text
cd messaging
yarn install --frozen-lockfile --production=false --ignore-scripts --non-interactive
yarn build:crypto
yarn build
yarn test
yarn audit:preferred
```

The Rust build uses locked vendored dependencies and refuses an existing crypto output directory; it does not substitute prebuilt WASM. See [messaging/README.md](messaging/README.md) for build/run details and dependency regeneration limits.

The browser-consumer source builds its included SDK, full frontend and notices and checks desk syntax:

```text
cd consumers
yarn install --frozen-lockfile --production=false --ignore-scripts --non-interactive
node scripts/rebuild-sdk-consumers.mjs
```

See [consumers/README.md](consumers/README.md). For SDK-only work, use `cd sdk`, the same frozen install, then `yarn build` and `yarn test`; see [sdk/README.md](sdk/README.md). These commands assume a new shell at the repository root before each `cd` example.

Embedded checkpoint documents and flags may describe the earlier unpublished/pre-acceptance state. They remain unchanged for exact source integrity. The current top-level operating docs and `release/APPROVED_RELEASE.json` record later decisions/publication evidence without rewriting a source archive to approve its own hash.

## Run a project deployment

For an existing runtime, create fresh extraction directories for the core and optional consumers, separate from the complete delivery set. Extract their runtime archives and run the frozen dependency installation above inside each runtime directory. Core runtime already contains crypto/browser builds; it does not need a Rust compilation.

From the core runtime directory:

```text
node --import tsx scripts/serve-messaging.mjs --data-dir <explicit-state-directory> --source-disclosure <delivery-directory>/source-disclosure.json --release-mode true
```

The launcher prints separate local reference/agent/relay addresses and uses persistent state only at the selected path. Release mode verifies the offered source/notices and installed runtime before serving users. Use stable, distinct HTTPS application/trusted origins and preserve public source routes through your proxy for an external service. No hosted URL is supplied by this repository.

Follow [PROJECT_INTEGRATION.md](docs/deployment/PROJECT_INTEGRATION.md) for the packaged full/desk frontends, host accounts and separate-project audiences; [SOURCE_DELIVERY.md](docs/deployment/SOURCE_DELIVERY.md) for exact source/routes, CLI/MCP discovery and covered-rights terms; and [PUBLIC_PACKAGE.md](docs/deployment/PUBLIC_PACKAGE.md) for installation/storage details. Device secret entry and identity approval remain in trusted controls.

One device per account and one active vault writer remain supported. Software reuse does not add federation, shared cross-project inboxes, concurrent same-account applications or multi-device recovery. Preserve current ratchet/outbox/acknowledgement state during rollback; arbitrary stale-vault restoration is unsupported. Read the [release limits](docs/release/STEP_10_RELEASE_NOTES.md) before adopting a deployment.

## Contributions and source corrections

See [CONTRIBUTING.md](CONTRIBUTING.md) for component grants and permission/provenance requirements; no blanket rights assignment is requested. Report missing/mismatched source or notices through [repository Issues](https://github.com/ubergemut/endtoend-messaging/issues), identifying the version and affected URL/hash without posting credentials, messages or vaults. The project owner handles corrections and retained versions under [ONGOING_COMPLIANCE.md](docs/release/ONGOING_COMPLIANCE.md). Required source remains directly downloadable; opening an issue is not a prerequisite to obtaining it.
