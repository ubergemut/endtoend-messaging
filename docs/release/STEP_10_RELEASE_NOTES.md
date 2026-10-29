# EndToEnd reusable messaging 0.2.0 / MIT SDK 0.2.1

These notes describe the exact release contents approved on October 29, 2026. Publication preparation is authorized; successful external publication or deployment is not asserted by this document. The final release page and retained external-download verification identify what was actually made available.

## What is included

The independently runnable messaging product contains the persistent relay and schemas/migrations, Node/browser device crypto and sealed sessions, trusted unlock/identity controls, public reference browser, and CLI/HTTP/GraphQL/MCP adapters. It supports contacts/requests, direct and group conversations, attachments, replies, expiry, group membership/key rotation, safety verification, retained delivery attempts and explicit retries. The full original frontend also retains its existing presentation, guides, appearance controls and tested mobile behavior.

Hosts can use their own account system through audience-bound signed grants and the public identity/authorization contract. The same subsystem works with the full EndToEnd frontend, an independently authored MIT desk and the reference/adapters. Device secrets, ratchets, vault storage, attachment encryption and trust enforcement remain in the public implementation.

SDK **0.2.1** retains wire v1 and the twenty-one original adapter operations. It fixes native browser Fetch receiver binding and includes source, JavaScript, declarations, public contracts and MIT notices. The desk's initial authoring provenance remains tied to SDK 0.2.0; the released desk consumes the corrected 0.2.1 without rewriting that history.

## Grants and exact artifacts

Messaging implementation, trusted/reference UI, adapters and original full frontend remain **AGPL-3.0-only**. The independent desk, protocol/client SDK and explicitly marked static hosting/disclosure helpers retain **MIT**. Third-party components retain their original terms. The combined browser-consumer archive preserves these different grants; it is not blanket MIT. See the [source/license assessment](STEP_9_SOURCE_AND_LICENSE_ASSESSMENT.md) and [frontend assessment](../../messaging/docs/release/FRONTEND_BOUNDARY_ASSESSMENT.md).

The exact source-delivery catalog is `source-disclosure.json`, SHA-256 **`f1f345bb8496ae56e347a5b07381edf95527fbb19958b761c59d8126c6b313a2`**.

| Download | SHA-256 |
| --- | --- |
| `endtoend-messaging-0.2.0-source.tar.gz` | `f941d50f8d4be04195cdcc6da56b39cdb6d2fb20c4d69e90642c714ce19bc4c1` |
| `endtoend-messaging-0.2.0-runtime.tar.gz` | `be3013e9c5fcfa7d8d36193641eadface172acea3a55fcbfc68e2e2fc5e20028` |
| `endtoend-browser-consumers-0.2.0-source.tar.gz` | `d7a8ea187d7d93fb1dc512ff34931ab090ef9324f75058dc52ae47b5ad609e4c` |
| `endtoend-browser-consumers-0.2.0-runtime.tar.gz` | `4a457ddcd6a3cb6ffcec64aca18b92185ad100ba6e0b9ae6c4805dfd4cfac5ac` |
| `endtoend-mit-sdk-0.2.1.tar.gz` | `8a1d1ead6890833cb94f117a752e052b2662870c6765a25b853d752d9c5aa4a7` |

Obtain the paired manifests and complete license/notices alongside these files. The full AGPL frontend has its own source artifact; downloading only the core source does not cover that frontend. [Source delivery](../deployment/SOURCE_DELIVERY.md) documents anonymous version-specific downloads, visible notices and adapter discovery.

## Installation and validation

Use [PUBLIC_PACKAGE.md](../deployment/PUBLIC_PACKAGE.md) for source/runtime installation and the pinned toolchain, and [PROJECT_INTEGRATION.md](../deployment/PROJECT_INTEGRATION.md) to deploy for a separate project. Runtime installation uses Node 22.13.0 and Yarn 1.22.22 with frozen dependencies and lifecycle scripts disabled. Source crypto builds require the recorded Rust/WASM toolchain; Windows x86_64 GNU is the validated platform. Other platforms need their own validation.

The exact candidate passed fresh source/archive/runtime verification, locked Node/web crypto builds, public/consumer builds, host checks and source-delivery acceptance. Step 8 records 139 fresh public tests, 11 frontend tests, 17 source/consumer guards, 9 host checks, 25 cross-client/product browser checks and 20 clean-user source checks. Groups overlap and must not be added as an independent grand total. Step 9 passed all 76 affected release/source/packaging regressions and verified 65 evidence files and five manifests. See [step 8](STEP_8_COMPLETION.md), [public approved-release summary](../../release/APPROVED_RELEASE.json) and the retained receipts for exact scope and earlier failed attempts.

## Known limits and upgrade notes

- One device per account and one active vault writer remain supported. Separate project deployments do not provide federation, a shared cross-project inbox, concurrent same-account multi-application use or multi-device recovery.
- Preserve stable, distinct HTTPS application/trusted origins and current state. Moving browser origins changes storage/bindings. Existing personal databases/vaults were not migrated or accepted by the synthetic rehearsals.
- Application rollback must retain current ratchets, pending outbox and acknowledgement state or refuse recovery. Arbitrary stale same-identity vault restoration is unsupported. Recovery acceptance covers matched stopped checkpoints; PostgreSQL operational recovery and browser-origin migration are outside that acceptance.
- HACL preferred inputs and checked transformations are supplied, but historical F*/KaRaMeL extraction/proofs were not reproduced. Complete PGlite/PostgreSQL preferred sources are supplied without claiming an independent native bit-for-bit rebuild. No new cryptographic proof or upstream Signal interoperability/support is claimed.
- Native notification/clipboard boundaries used synthetic substitutes in preservation tests. No native OS delivery guarantee is inferred. See the [feature matrix](../../messaging/docs/release/FEATURE_MATRIX.md) and [durability scope](../../messaging/docs/release/STEP_7_DURABILITY_ACCEPTANCE.md).

Use the [ongoing compliance process](ONGOING_COMPLIANCE.md) for retained versions, missing-source corrections and future changes. This release assessment concerns the identified implementation; it does not promise that every future proprietary frontend is outside copyleft.
