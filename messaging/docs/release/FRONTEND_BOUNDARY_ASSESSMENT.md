# Concrete frontend boundary assessment

Assessor: Codex, internal automated source/provenance and integration assessment, October 26, 2026. This is not an external legal opinion. Scope is the concrete EndToEnd full frontend, newly authored Correspondence desk, MIT SDK and their communication with the public messaging subsystem. The accompanying `FRONTEND_BOUNDARY_ASSESSMENT.json` identifies the tested inputs, manifests and evidence. A changed integration needs the relevant reassessment.

## Decision and grants

The first-party source in `apps/web` remains **AGPL-3.0-only**. The new independently authored first-party source/documentation in `apps/desk-client` is **MIT** under its full LICENSE. Protocol/client packages retain MIT. The device agent, generic relay, adapters and reference application retain AGPL and applicable third-party terms. This decision preserves earlier grants; it does not relicense third-party crypto or silently withdraw AGPL rights.

The owner's October 24 confirmation of control over first-party application rights is the authority for the first-party grants. The desk author received a fresh context restricted to the frozen MIT SDK 0.2.0 archive and its documentation, plus explicit public popup/native-auth interface instructions and presentation requirements. Its `AUTHORING_PROVENANCE.json` lists the consulted files and archive hash. No original frontend, agent, crypto, session, backend, reference UI or history was an authoring input. The concrete desk uses no third-party UI framework or borrowed assets. Its host/build tooling and shipped SDK notices are identified separately.

The original web source has different provenance. Baseline `f8740398a249539d9bf1212a0fa8abfcd25bcaac` directly imported crypto/session/contract code and handled device secrets/vaults. The current extraction moves those responsibilities to the agent and reconnects through compiled SDK entries. That technical improvement does not establish independent reauthoring. Keeping the original frontend AGPL avoids relying on such a claim. Its protocol-documentation embed and existing guide assets are included in its source inventory and covered source treatment.

## Actual implementation relationship

| Concern | Consumer side | Public subsystem side |
| --- | --- | --- |
| Authority | Host authenticates its own user and supplies a finite messaging grant; native demo login remains optional. Browser holds ordinary bearer authority in memory (full native UI preserves its existing explicit stay-login preference). | Generic service validates public signed assertions, audience, expiry/replay/logout cutoffs and account mapping. No private business model/callback is imported. |
| Pairing | Fresh popup capability, exact source/origin/version/nonce checks and transferred MessagePort. | Trusted agent independently checks opener, allowlist and capability before exposing serialized commands. |
| Messages/groups/contacts | Commands plus public account/message/group DTOs and presentation state. | Session/ratchet storage, encrypted delivery, retry, group membership/rotation, expiry and trust implementation. |
| Files | Ordinary authorized plaintext bytes/base64 for upload and display/download. | Attachment keys/nonces, encryption, sealed persistence and access enforcement. |
| Secret/trust controls | Request unlock/verification and focus the trusted window. | Device-secret entry and identity-change/verification approval remain in trusted agent controls. Browser RPC cannot directly supply a device unlock secret. |
| Lifecycle | Clear presentation lifetime, abort/ignore late work, revoke grants and close transport. | Enforce actual authorization, lock state and safe durable pending sends. A client cannot undo an already committed send. |

Only serialized public command/result data crosses the boundary. No executable callbacks, host database models, Session/Vault objects, ratchet stores, attachment keys or private implementation imports cross it. Public identity fingerprints and verification/message metadata are presentation data. Specialized messaging operations are examined as part of this relationship; calling them over RPC is not by itself the reasoning.

The generic public subsystem continues to operate with its AGPL reference and CLI/adapters independently of either frontend. The exact same subsystem is tested with both frontend implementations and separate host-auth fixtures. Consumer-specific encryption/delivery code was not added to the subsystem. The desk's own layout, state/controller and authentication integration were authored from public contracts. These facts support treating that concrete consumer source as independent and issuing its MIT grant; they are more substantial than a change of styling, origin or wrapper name.

## Engineering and provenance evidence

`scripts/build-sdk-consumers.mjs` verifies the SDK archive/manifest, extracts it fresh and copies only consumer sources, the web's embedded documentation/license, and declared tool manifests into a new workspace. It derives byte-identical existing lock resolutions, installs without lifecycle scripts, freezes the lock, typechecks/tests the full frontend and builds with tools installed in that workspace. No protected sibling implementation or prebuilt app is present. Its bundler module graph records actual included inputs; web uses compiled MIT SDK entries. The plain desk is served from its exact authored files and the frozen built SDK, with no frontend compiler/runtime library.

`scripts/audit-sdk-consumers.mjs` inspects parsed source import edges, SDK package hashes, bundler graph and a conservative long exact-token copy detector against existing covered implementation/UI. It also checks for stale crypto/state implementation. The old unused AES file helpers were removed from `apps/web`; the remaining file-size helper preserves the 25 MiB limit. The web bundle embeds protocol prose describing AES, which must not be mistaken for an executable encryption module. No consumer WASM or protected engine module is bundled. Negative scans alone do not prove authorship or legal independence; recorded authoring inputs and the actual semantics provide the substantive evidence.

Browser acceptance uses fresh synthetic accounts/state and exercises both presentations, byte-equal files, replies, rooms, trusted verification, host grants and lifecycle cancellation. Separate targeted tests exercise late views/sends, wrong pairing messages and ordinary refusal versus account revocation. The SDK 0.2.1 patch corrects native browser Fetch receiver binding discovered during this work; wire v1 and public operations remain compatible. The original 0.2.0 authoring archive and prior checkpoint evidence are retained unchanged.

## Limits and release consequences

This assessment identifies no unresolved first-party grant/boundary blocker for the concrete MIT desk as documented. It does not guarantee that every future private frontend or combined deployment falls outside copyleft. MIT grants permission for the marked source; they do not create an exception to AGPL for a covered combined work. Copying/modifying the AGPL reference/full UI or bundling protected implementation changes the analysis and preserves the applicable source obligations. If a future boundary cannot be supported, include the affected covered source or refactor the implementation into the public subsystem.

The broader public subsystem's complete rebuilt artifacts, dependency/preferred-source closure, exact source opportunities and final publication decision are later release gates. Browser delivery and external beta use must have the applicable notices/source in place before users receive the covered code/service. No source was published or service deployed by this step. No professional opinion is fabricated, and no outside person was contacted.

## Primary guidance checked

- [GNU AGPL v3 text](https://www.gnu.org/licenses/agpl-3.0.html), especially §§1, 5–6 and 13: corresponding source, covered combinations, conveying and modified network-service source opportunities. These govern the actual covered work, not the names used in this architecture.
- [GNU program-boundary guidance](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation): mechanism and communication semantics both matter; sockets/RPC do not automatically establish separate programs. This is interpretive guidance applied above, not an automatic legal determination.
- [GNU copyright-holder grants](https://www.gnu.org/licenses/gpl-faq.en.html#HeardOtherLicense): an owner can issue parallel grants for owned source; third-party permission cannot be assumed.
- [GNU AGPL source FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#AGPLv3CorrespondingSource): the source opportunity must cover the actual covered version and its required source. Build tests are supporting evidence rather than legal certification.
