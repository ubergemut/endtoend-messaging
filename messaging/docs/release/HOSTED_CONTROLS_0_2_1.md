# Messaging core 0.2.1 candidate: hosted security controls

Prepared October 31, 2026. **Candidate only: not approved or published.** The 0.2.0 release, immutable downloads and prior owner decisions remain retained. This document records changed scope for the project owner's review under the ongoing-compliance process; it does not record a human review that has not occurred.

## Change and provenance

The trusted browser can display an operator-configured plain application name. A registered opener can supply a bounded JSON hex-color palette in the pairing fragment. The trusted program validates the field names/values, corrects text and control contrast, removes the fragment before configuration/crypto loading and ignores invalid styling. No callbacks, host implementation, raw CSS, scripts, fonts, artwork, uploads or remote asset URLs are accepted. Separate origins, capability pairing, vault ownership, trusted identity decisions and prominent source/license/notices remain in the existing AGPL implementation.

Pending direct ciphertext for a recipient absent from the fresh consent graph moves into retained blocked-outbox history, using the existing membership-changed protocol state. It does not prevent unlocking/syncing unrelated conversations and is not silently resent if that relationship later returns. Retry refreshes current membership first. Original message/attempt IDs, ciphertext, plaintext history, ratchet state and files are retained; no vault format migration or message re-encryption is introduced.

The standalone CLI accepts a single owned IPC shutdown message when launched with an IPC channel. Parent disconnection also requests orderly shutdown. Arbitrary messages do not run commands. Normal signal handling remains available.

These modifications and tests are newly authored, code-assisted contributions to the existing AGPL component. They contain no copied host application code or artwork. Existing MIT SDK/protocol, consumer source, cryptographic sources, dependency versions, licenses and notices remain unchanged. No license grant is changed. The generic public browser tests use fresh native synthetic accounts solely as a local fixture; a consuming application still owns its identity/UI through the existing public contracts.

## Validation and release correspondence

Record exact candidate source/runtime manifests, artifacts, build evidence and catalog hashes in the release packet. Explicit crypto reuse must verify every current source input and each of the ten outputs against the retained actual source-build proof; it is not a fresh Rust rebuild. The existing source-only reconstruction and runtime/source-delivery checks remain required. Browser acceptance covers light/dark desktop/mobile controls, contrast, keyboard focus, invalid colors, unregistered opener refusal, real pairing/unlock, separate origins and retained source/notices. Core regressions include blocked direct delivery across unlock, exact ciphertext retention, unrelated-contact delivery, no silent resend after restored consent, CLI shutdown and persistent deployment reopening.

Before external deployment/publication, the named human project owner must review the changed frontend/preferred inputs and material bundle content, bind its content decision to the exact candidate hashes and authorize publication. Publish matching source before serving the new runtime. Preserve 0.2.0 source and old cached/recovery mappings indefinitely. Passing these tests does not certify a proprietary boundary, Android migration, host-production deployment, multi-device support or full offline operation.
