# Step 8 complete: exact user source and license delivery

Portable public rendering: local-machine evidence paths are omitted and documentation links are relocated. The historical assessment/completion status below is preserved; later decisions and public identities are recorded in [release/APPROVED_RELEASE.json](../../release/APPROVED_RELEASE.json). Original frozen sources and assessment packets remain unchanged.

Completed 2026-10-28T20:34:47.026Z. All selected step-8 checks pass. This is an unpublished local candidate; steps 9–10 remain.

## Result

The verified delivery catalog covers the messaging core, retained AGPL full frontend, independently authored MIT desk and MIT SDK. Source, manifests, full licenses, original attributions and modification notices are available through version-specific public GET/HEAD routes before authentication. Release startup verifies every offered file and the executing runtime; browser hosts bind the actual served component and refuse unlisted or altered assets. Direct API, trusted/reference UI, HTTP/GraphQL, CLI and MCP source discovery are included. A host cannot hide these routes behind its grant handler.

The AGPL interfaces visibly identify copyright, warranty and redistribution rights, with exact source/license/notices links. The full original frontend has its own corresponding source; the core archive does not substitute for it. Mixed consumer archives preserve each component's applicable grants. No unrelated host application or real account/vault/message data was acquired or published.

## Exact candidate

| Artifact | SHA-256 |
| --- | --- |
| Core source (261901063 bytes; 10,183 manifest records) | `f941d50f8d4be04195cdcc6da56b39cdb6d2fb20c4d69e90642c714ce19bc4c1` |
| Core runtime (2406412 bytes; 721 files) | `be3013e9c5fcfa7d8d36193641eadface172acea3a55fcbfc68e2e2fc5e20028` |
| Consumer source (26282527 bytes; 129 archive members) | `d7a8ea187d7d93fb1dc512ff34931ab090ef9324f75058dc52ae47b5ad609e4c` |
| Consumer runtime (2526703 bytes; 63 manifest records) | `4a457ddcd6a3cb6ffcec64aca18b92185ad100ba6e0b9ae6c4805dfd4cfac5ac` |
| MIT SDK 0.2.1 | `8a1d1ead6890833cb94f117a752e052b2662870c6765a25b853d752d9c5aa4a7` |
| Delivery catalog | `f1f345bb8496ae56e347a5b07381edf95527fbb19958b761c59d8126c6b313a2` |

The authoritative candidate and evidence hashes are in [public approved-release summary](../../release/APPROVED_RELEASE.json). Canonical delivery files are the [release assets](https://github.com/ubergemut/endtoend-messaging/releases/tag/messaging-v0.2.0); public identities are retained under `release/`. The package tool's historical step7Complete:false fields describe its pre-acceptance snapshot; this separate acceptance records completion. Frozen step-7 artifacts remain unchanged.

## Validation

- Archived the core before any product build, extracted it without prebuilt outputs/private consumers, and verified all 10,183 source records. Frozen installation, new Node/web Rust compilation and both browser/SDK builds passed. All six crypto inputs and all ten actual outputs match the earlier verified source build.
- Passed 139 fresh public tests, strict TypeScript checks, nine host-integration checks, 11 frontend tests and 17 source/consumer guard tests. Groups overlap; they are not a summed grand total.
- The separately offered consumer source rebuilt SDK/frontend from a fresh extraction and reproduced every one of its 63 runtime files. The import/bundle/provenance audit passed.
- Verified 721 core runtime records and 63 consumer records before installation/use. Passed 10 cross-frontend and 15 product-preservation checks in release mode, including source visibility after account changes/revocation, with no browser/asset errors.
- Passed 20 clean-user checks: anonymous exact source/notices downloads on running surfaces, complete downloaded archive membership/file hashes, downloadable artifact hashes, usable CLI/MCP metadata and actual visible UI links. Tests used new synthetic state and closed their deployments.

The exact test definitions are retained under the output's test-definitions directory. The first clean-user attempt failed on a connection following synchronous local tar/hash work; its failed receipt/log are preserved. The accepted rerun uses the retained clean-user-transport.mjs fixture configuration (independent anonymous HTTP connections), with unchanged release artifacts. The separate browser suites use normal browser networking. Fresh build logs, archive-before-build proof, crypto comparison, runtime extraction, consumer rebuild, catalog assembly and browser/download receipts are retained alongside ACCEPTANCE.json.

## Operation and remaining gates

Use the direct-download route in [STEP_8_DISTRIBUTION_POLICY.md](../../messaging/docs/release/STEP_8_DISTRIBUTION_POLICY.md) and the actual launcher/routing/terms instructions in [SOURCE_DELIVERY.md](../deployment/SOURCE_DELIVERY.md). Source requires no payment, NDA or extra restrictions. Retain immutable release records indefinitely as project policy and keep exact source online for active/downloadable/supported cache/rollback versions; do not confuse this selected route with a section 6(b) written offer. Current software-only installation needs no owner signing key; reassess installation-information duties before shipping a User Product.

External proxy/CDN delivery has not occurred and remains a step-10 check. Existing preferred-source regeneration and recovery limits remain explicit. Step 9 still needs the evidence-supported whole-release conclusion and exact owner publication decision. No outside legal opinion, publication, deployment or guarantee about future integrations is claimed.
