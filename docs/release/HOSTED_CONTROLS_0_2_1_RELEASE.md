# Messaging 0.2.1: reusable hosted security controls

Owner-approved October 31, 2026. This is a generic core update, with MIT SDK/protocol 0.2.1 and the original full web/desk consumers 0.2.0 unchanged. Wire protocol v1 and existing license grants are retained. No consuming application's UI or account data is included.

- An operator can supply a plain application name. Registered callers may supply bounded hex appearance colors for the separate trusted unlock window; invalid palettes fall back safely and readable foregrounds are derived. Arbitrary CSS, scripts, remote artwork and executable host callbacks are unsupported. Source/license access remains visible.
- A pending direct delivery whose recipient leaves the current consent graph retains its exact ciphertext and original intent for review. Unrelated synchronization/unlock can continue. Restoring consent does not silently resend the prior intent.
- An owning process may request orderly shutdown through the single fixed IPC command. CLI output, vault ownership, device secrets and public protocol boundaries are unchanged.

The [source assessment and owner decision](HOSTED_CONTROLS_0_2_1_ASSESSMENT.md) bind these contents to catalog SHA-256 `345f46cc9685503222eb8a354f1053cd672457afaf24b2071105b9405a059d6c`. The exact release contains 19 source/runtime/manifest/notice files. Core source SHA-256: `c862ce4d402faa00903d9fb677a76fe05cea4973211026886021eb9da2496ee1`; core runtime: `58a3417c20beea90fa47e77ea64d61544471d91ce08ea401b159feeef443aa40`.

Validation passes: fresh source extraction and actual Rust/WASM build with all ten previous crypto outputs matching; 145 core tests; nine host-identity, seven standalone persistence/restart, nine reference-browser, six hosted-controls desktop/mobile and 23 release-guard checks; complete repository/source-manifest binding; and exact anonymous HTTP delivery of all 18 served artifacts. The 19th file is the raw publication catalog. Public GitHub download verification is recorded separately after publication.

Use the [messaging-v0.2.1 downloads](https://github.com/ubergemut/endtoend-messaging/releases/tag/messaging-v0.2.1), retaining all files named by its catalog. The same first-party/component and third-party licenses apply. Download corresponding source and notices before exposing a runtime. The [0.2.0 release](https://github.com/ubergemut/endtoend-messaging/releases/tag/messaging-v0.2.0) and its source remain immutable and available.

One device per account and one active vault writer remain supported. Preserve current ratchet/outbox/acknowledgement state and exact origins during an upgrade. Arbitrary stale-vault rollback and general multi-device recovery remain unsupported. This release does not activate any consuming application's production service.
