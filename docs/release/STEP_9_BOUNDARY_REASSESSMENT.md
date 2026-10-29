# Step 9: boundary reassessment of the exact step-8 candidate

Portable public rendering: local-machine evidence paths are omitted and documentation links are relocated. The historical assessment/completion status below is preserved; later decisions and public identities are recorded in [release/APPROVED_RELEASE.json](../../release/APPROVED_RELEASE.json). Original frozen sources and assessment packets remain unchanged.

Assessor: Codex, internal source, provenance and integration assessment. Assessment date: October 29, 2026. This is an internal licensing conclusion for the identified code, not an external legal opinion. It supplements [the original concrete frontend assessment](../../messaging/docs/release/FRONTEND_BOUNDARY_ASSESSMENT.md); that assessment's historical artifacts and conclusions are not rewritten.

## Conclusion and scope

No unresolved licensing blocker was identified in the concrete frontend/SDK boundary of the frozen step-8 candidate. The complete messaging implementation and original full frontend retain AGPL-3.0-only treatment. The independently authored desk, protocol/client SDK and explicitly identified first-party static hosting/interface helpers retain MIT. Third-party material retains its original terms. Both consumer presentations and the public subsystem have their own applicable source and notice delivery, rather than treating the MIT SDK as an exception to the AGPL.

This conclusion covers the exact archives and manifests below, the `messaging-0.2.0-step-8-consumers-04` build/extractions, and their documented interaction with the step-8 public subsystem. It does not approve publication, promise that a future frontend can remain proprietary, or assess unrelated Choice/private host implementation. The whole-release assessment, exact owner decision and external delivery checks remain separate release requirements.

## Exact reviewed identities

Evidence base: `retained internal evidence location`. The following SHA-256 values were independently recomputed from the frozen files under `delivery/` during this reassessment and match [public approved-release summary](../../release/APPROVED_RELEASE.json).

| Item | SHA-256 |
| --- | --- |
| `source-disclosure.json` | `f1f345bb8496ae56e347a5b07381edf95527fbb19958b761c59d8126c6b313a2` |
| `endtoend-messaging-0.2.0-source.tar.gz` | `f941d50f8d4be04195cdcc6da56b39cdb6d2fb20c4d69e90642c714ce19bc4c1` |
| `SOURCE_MANIFEST.json` | `d4f20500adac02f7d9ab46cf85984fd72efadbf21da546390dcbf0f94323fc2d` |
| `endtoend-messaging-0.2.0-runtime.tar.gz` | `be3013e9c5fcfa7d8d36193641eadface172acea3a55fcbfc68e2e2fc5e20028` |
| `RUNTIME_MANIFEST.json` | `67a3a4bce69dae5fb990db445a911f0527c825455b5894c37da240e2d8cc2724` |
| `endtoend-browser-consumers-0.2.0-source.tar.gz` | `d7a8ea187d7d93fb1dc512ff34931ab090ef9324f75058dc52ae47b5ad609e4c` |
| `CONSUMER_SOURCE_MANIFEST.json` | `402c0d6c4e87fb4da2b1df90d2f1d9b6df20bc5429fd13d90503e417963f4a3e` |
| `endtoend-browser-consumers-0.2.0-runtime.tar.gz` | `4a457ddcd6a3cb6ffcec64aca18b92185ad100ba6e0b9ae6c4805dfd4cfac5ac` |
| `CONSUMER_RUNTIME_MANIFEST.json` | `dc3d1f52c840a88b2e504e5271de3b434a6e9b6701d8e6e562e3c343a628f4c2` |
| `endtoend-mit-sdk-0.2.1.tar.gz` | `8a1d1ead6890833cb94f117a752e052b2662870c6765a25b853d752d9c5aa4a7` |
| `SDK_MANIFEST.json` | `db09c0043e9b1fcfa7321540796dc26af0823a182962dd6f1d122246b9579954` |

The consumer source archive has 129 members: its manifest plus 128 recorded files. The consumer runtime has 64 members: its manifest plus 63 recorded files. During this review, every one of those 128 source and 63 runtime records was checked for exact length and SHA-256 against the retained `fresh-source-extraction` and `runtime-extraction` under `retained internal evidence location`. All 25 source records used by the boundary audit also match that offered source. These checks bind the reasoning to the frozen consumer candidate; they are not a new legal certification or a claim that all product tests were rerun during this document review.

## Grant and provenance decisions

| Concrete code/material | Treatment and basis |
| --- | --- |
| Device crypto/session/vault/trust, generic persistent relay and contract, service adapters, trusted browser and reference application | AGPL-3.0-only first-party treatment with applicable original dependency terms. They are included in the public messaging source/runtime; no independent-host exception is invented. |
| Original `apps/web` presentation, guide material and assets | Retained AGPL-3.0-only source treatment. Its baseline imported protected implementation and handled device state. Reconnecting it through the MIT SDK improves architecture but does not establish independent authorship or withdraw earlier grants. Its exact source is the consumer archive above, not merely the core archive. |
| `apps/desk-client` first-party presentation/controller/documentation | MIT, based on recorded independent authoring from the frozen MIT SDK 0.2.0 and explicit public-interface instructions. The original author did not consult the existing application/engine. Runtime tests use compatible MIT SDK 0.2.1; that patch does not change the original authoring record. |
| `packages/client`, `packages/protocol` | MIT under their full package licenses. The grant covers these first-party interfaces/transports, not Signal/libsignal, SPQR, an AGPL UI or an AGPL combined work. |
| `BROWSER_CONSUMER_V1.md`, `serve-sdk-consumer.mjs` and its test, `run-sdk-consumer.mjs`, `source-disclosure.mjs` and its test | Explicit first-party MIT scope recorded in `LICENSING.md` and file notices. The static metadata helper uses Node built-ins for bounded files, SHA-256 and download routes; the static host/runner do not import protected messaging implementation. Other build, packaging and audit orchestration retains the root AGPL unless explicitly marked. |
| React, React DOM, Scheduler, Vite-emitted helper and all other third-party inputs | Their own licenses/notices remain operative. The web bundle and corresponding source include their identified notices/preferred source; no first-party grant overrides them. |

The owner's October 24 confirmation of first-party rights is carried forward. It supports the first-party grants and does not establish third-party ownership. GNU's [copyright-holder guidance](https://www.gnu.org/licenses/gpl-faq.en.html#HeardOtherLicense) supports parallel owner grants; it gives no authority to relicense another holder's code.

The frozen desk `AUTHORING_PROVENANCE.json` SHA-256 is `01c6509c8d0ce4d8c4a937351838be29bc27d50dbed97c3e249a13bd730a9087`. It accurately distinguishes the October 26 original implementation from later source-notice maintenance. The maintenance agent also inspected the retained full frontend to add that frontend's separate notice. Therefore the current desk must not be described as having had no later maintainer exposure to the original UI. The recorded delta is new first-party source-disclosure UI using the public release metadata contract and existing desk DOM/controller conventions. Inspection found no added engine/session/vault/crypto imports or copied implementation. This limited later maintenance does not require rewriting the original authoring history or granting rights over third-party code. Its concrete first-party notice code is included under the desk's MIT grant.

The combined consumer archive contains AGPL web/build materials alongside MIT desk/SDK/helpers and third-party materials. Shipping them in one archive does not label the entire archive MIT. The source manifest's component grants, root README, package licenses, `MODIFICATIONS.md` and distinct web/desk notice files make the mixed scope explicit.

## Actual interaction and implementation evidence

The desk implements its own presentation/controller state and exchanges public commands/results, account/message/group/trust DTOs and authorized plaintext attachment bytes. The agent holds device secrets, session/vault/ratchet state and attachment encryption keys, and performs delivery, durable retry, group rotation and trust enforcement. Secret entry and identity approvals remain in its trusted controls. Public identity fingerprints and ordinary bearer grants are presentation/authorization data, rather than transferred engine state.

Host login/business services issue a finite signed messaging grant through the public contract. The generic subsystem validates issuer/audience/expiry/replay/revocation and account mapping. No private business model or callback is imported into it. The independent static host's optional `hostHandler` is its own server-side grant handler; it is not an executable callback passed to the agent/service. Public popup pairing verifies origin/source/capability/nonce and transfers a MessagePort for serialized commands. Both native demo accounts and separate host-account fixtures run through the same subsystem without consumer-specific encryption or delivery implementation.

The subsystem also runs with its AGPL reference application and CLI/adapters independently of either consumer. The desk is built/served with the frozen public SDK and no protected sibling implementation. Its only runtime application import is the compiled MIT client, which imports the MIT protocol and relay transport. The web's compiled graph contains React/DOM/Scheduler, Vite's generated preload helper, its own AGPL presentation/documentation and the compiled MIT SDK. It contains no consumer WASM or protected crypto/session implementation. The trusted-agent bundle does contain the crypto/session/WASM implementation, and is correctly treated as part of the public AGPL component.

The frozen `consumers/CONSUMER_BOUNDARY_AUDIT.json` has SHA-256 `65dadbeff99aa4c779712d067ba1bd0c94e85c42639da497b98f9a314c54fd1f`. It records 25 source records, 36 parsed import edges and 44 unique web bundler module records, no protected sibling implementation, and no matches for 100 consecutive exact lexical tokens against the protected implementation/original UI. Copy detection and absent imports support the factual record; they cannot prove legal independence or detect every possible adaptation. The authoring provenance and the substantive allocation of functions above are the additional basis for this conclusion.

The audit is bound to `consumers/CONSUMER_BUILD_RECEIPT.json`, SHA-256 `e944e1a2b9a5d5c84dd3e8dfd186060d3480b6decc580a486545eb1bc238ff95`. That receipt records source preparation before application compilation, independent source extraction/rebuild, exact SDK identity, locked tools, preferred dependency inputs and resulting artifacts. The retained consumer-runtime extraction proves all 63 offered runtime records. `messaging/BROWSER_BUNDLES.json`, SHA-256 `0487f0580ebe742b7fbf4ee4bf8d38abd141efa1d227a346b68c4d1306081183`, identifies the covered trusted/reference bundles separately.

Current step-8 receipts support the deployed relationship with 10 cross-frontend checks, 15 product-preservation checks and 20 clean-user source-delivery checks. They exercise actual packaged runtimes and visible pre-login notices; these counts overlap other suite scopes and are not a summed test total. Source delivery remains public through host grant integration and after account changes/revocation. The full web has its own exact source offer. These are local loopback results; an eventual proxy/CDN deployment must preserve and verify them before external users receive code or service access.

## Limits and future changes

The conclusion is an inference from the concrete source, provenance, communication semantics, recorded grants and engineering evidence. GNU's [program-boundary guidance](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation) treats communication mechanism and semantics together; sockets or RPC alone do not settle whether programs are separate. [AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html), particularly sections 1, 5, 6 and 13, governs the covered work and its source obligations. The chosen grants do not modify those terms.

A future project may use the marked MIT desk/SDK/helper source under MIT, preserving its notices. Its actual integration still needs reassessment if it copies/modifies the AGPL web/reference UI, bundles the engine, exchanges protected implementation state, adds intimate callbacks/control flow or changes which code is necessary to run the covered program. A custom appearance or MIT wrapper alone is insufficient. Where independence cannot be supported, include the affected covered source or refactor the integration before proprietary-licensing promises. No present conclusion requires publishing unrelated private code that has not been examined.

No outside reviewer was contacted and no professional opinion is asserted. This boundary assessment identifies no material unresolved blocker in the frozen scope; it leaves whole-release dependency/source conclusions and the exact owner publication decision to the separate step-9 assessment. Any changed candidate needs relevant new checks and assessment rather than reusing these hashes as approval.
