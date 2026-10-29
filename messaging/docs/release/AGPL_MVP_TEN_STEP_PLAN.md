# Ten steps to a compliant, reusable EndToEnd messaging MVP

Owner direction: October 25, 2026. This is the current forward plan for the broader reusable messaging subsystem, replacing the earlier minimum-device-agent release target. It preserves the existing candidate 2 artifacts and receipts as historical evidence.

The outcome is a release with no identified unresolved licensing blockers, complete corresponding source and notices, a documented basis for independently licensed project frontends, and a repeatable process for later versions. This is a licensing-compliance plan, not a guarantee about every law, every future integration or the absence of third-party claims. Tests establish engineering facts; the release assessment must also explain the licensing conclusions.

## Starting point and target

The owner's October 24 statement, “Yes, I control the first-party rights,” is accepted. Do not ask for that confirmation again. It does not grant ownership of third-party material.

Candidate 2 passed its recorded engineering checks: 63 workspace tests, 24 fresh-source tests, 16 packaged browser checks, 17 packaged headless tests and 9 release-runner checks. These runs overlap and are evidence for that exact candidate, not passing results for the expanded release.

The device engine, trusted controls and MIT protocol/client already exist. The current public candidate still excludes the real persistent relay, server contract, automation adapters and full deployment launcher. The actual source/preferred-form questions, MPL treatment and concrete frontend boundary need resolution. Nothing has been externally published.

| Area | Intended treatment |
| --- | --- |
| Complete messaging implementation | Public AGPL-3.0-only: device crypto/session/trust/vault, delivery, groups, attachments, persistent relay, generic messaging policy, service adapters, deployment and reference application. Dependencies retain their applicable terms. |
| Independently authored protocol and transport SDK | MIT: stable wire schemas, ordinary presentation data, transport and safe integration examples. This does not create an exception to upstream AGPL code. |
| Independent project frontends and business services | Their own grants where the actual code and interaction support independence. A custom appearance alone is not evidence. Existing declarations remain until the concrete first-party grant is recorded. |
| User and operational data | Exclude messages, keys, vaults, account databases, credentials and private history. Publish generic schemas, migrations, examples and build/run instructions needed for the covered software. |

The following are ten new completion steps from today's state; their numbers do not claim the old steps 1–7 have been redone or that candidate 2 covers the new scope.

## 1. Freeze the broader release scope and preserve the baseline

Record the intended public modules, independent consumers, supported environments and source-delivery model. Select a new release identity for the expanded scope. Map all 21 existing headless operations and the browser feature matrix to their final component so nothing is dropped to simplify licensing. Preserve original source hashes and candidate 2 archives.

Use separate project deployments as the initial reuse model. Preserve one device per account and one active vault writer. Federation, cross-project shared inboxes and concurrent same-account use in multiple applications require separate design and acceptance; they are not implied by software reuse.

**Complete when:** an approved scope table, module graph, feature matrix and baseline identify every existing feature and intended license role. First-party authority is carried forward as confirmed; no unrelated private project is silently added to the public source.

## 2. Finish the rights, dependency and asset inventory

Create a source-to-artifact inventory covering the broader relay, server contracts, HTTP/GraphQL/MCP/CLI adapters, browser bundles, database/runtime components and deployment materials. Record exact dependency versions/commits, license expressions, notices, modifications, generated-code provenance and how each item is used. Review actual shipped bundles, native/WASM binaries, fonts, icons, images and documentation rather than relying only on package metadata.

Extend the candidate 2 work instead of assuming its 202 Cargo packages and 16 npm mappings cover the broader product. Keep third-party files out of the first-party ownership ledger. Retain applicable copyright, patent, attribution and warranty notices and identify any required modification notices.

Specifically inspect PGlite's PostgreSQL/WASM runtime and its incorporated dependencies, not only the npm wrapper. Identify source inputs, upstream licenses and bundled materials that the expanded source offer must cover.

**Complete when:** every shipped or required source/build item has provenance and an explained license obligation; unknown or incompatible material has been resolved, removed or replaced without losing required features. The inventory distinguishes runtime/bundled code from unmodified general-purpose tools and explains any source exclusion.

## 3. Close the actual compatibility and preferred-source questions

Resolve the pinned MPL-2.0 dependencies, including `hpke-rs` and `hpke-rs-crypto`, from their exact files and notices. Check for secondary-license restrictions, document the applicable combination route and retain the required source grants and notices. Do not treat adding a license text as the entire compatibility analysis.

Resolve HACL-derived generated Rust preferred forms and extraction provenance. Identify the exact upstream Low*/F* inputs, transformations and project-specific generation materials. Our conservative default is to include the relevant upstream preferred sources and required generation instructions/inputs in addition to the editable Rust. Verify their relationship to the shipped dependency; a bare upstream link or a clean Rust build alone does not close this item. Explain the treatment of general-purpose generators rather than requiring every tool to be vendored automatically.

**Complete when:** each named issue has a written conclusion supported by exact source references and the package contains everything that conclusion requires. If an obligation cannot be met, change or replace the affected implementation before release. Uncertainty is not marked passed by a test or by the owner's first-party confirmation.

## 4. Package the complete messaging subsystem as a standalone public product

Add the real persistent `apps/api` relay and required `packages/contract` source, storage schemas/migrations, durable queues/media handling, generic authorization/membership rules, automation adapters and deployment scripts. Include a usable public reference application and the trusted device controls. Refactor product-only assumptions so the public system installs and runs without private EndToEnd, Choice or another host project's source.

Keep generic messaging logic public. Publish configurable examples and synthetic fixtures; retain deployment secrets and actual account/message databases outside the release. Document supported storage and deployment configurations and startup, backup/restore and upgrade behavior for new test data.

Distinguish application rollback from cryptographic-state recovery. A rollback must preserve current vault/ratchet, outbox and acknowledgement state or refuse an unsafe restore; restoring a stale vault after messaging has advanced is not an acceptable rollback procedure.

**Complete when:** a fresh checkout of only the proposed public source starts a persistent relay, device agent and reference client and supports real direct/group/file messaging through a restart. The synthetic relay fixture remains a test tool, not the deployed backend.

## 5. Stabilize the MIT SDK and host integration contracts

Version and document all message, group, file, event, error and identity/authorization contracts. Provide a generic host-account integration so each project can retain its own login and business data. Keep credentials correctly scoped and messaging permissions enforced by the public subsystem. Remove implicit dependence on the original `/api/auth` and `/api/bootstrap` layout where a public integration contract is required.

The independent client exchanges ordinary commands and presentation data. It must not copy protected crypto/session implementation or require imported vault, ratchet, private database models or executable callbacks from private hosts. Document connection, reconnect, retries, cancellation, account switch and revocation.

**Complete when:** the SDK builds from its own declared source/dependencies, all preserved operations are expressible through published contracts, and hosts with different account/UI implementations can connect without changing the messaging implementation. Record MIT provenance and preserve its license in every distribution.

## 6. Complete and assess frontend independence

Reconnect the full EndToEnd frontend through the SDK. Build a second small frontend with a different presentation using only the published SDK/docs, plus retain the CLI/reference client. Use these to demonstrate reuse without requiring changes to Choice. Secret entry, vault handling and cryptographic trust enforcement stay with the public component; custom project code handles its presentation and business workflows through the documented interface.

Inspect imports, compiled bundles, copied source and actual communication semantics. A different frontend style, separate origin or HTTP endpoint is supporting evidence, not a legal exemption. An AGPL widget/reference UI remains covered when copied or modified; author independent client code where a different grant is intended.

Record the intended grant for the concrete audited first-party frontend and preserve applicable third-party terms and previously granted rights. Existing AGPL declarations are not silently revoked. If code cannot be justified as independent, move/refactor the generic messaging implementation into the public component or include the affected covered messaging source. Do not claim unrelated private applications must be published without examining their actual relationship.

**Complete when:** the public subsystem works with independently built consumers, prohibited implementation edges are absent, and a written code-specific assessment explains the chosen grants and any covered UI. An MIT wrapper alone is never the reasoning.

## 7. Prove complete builds, feature preservation and data durability

Generate a new allowlisted source workspace for the expanded product. From a fresh extraction without private sibling source or prebuilt product outputs, build Node/browser crypto, agents, relay, adapters and reference application using locked dependencies. Validate all required build/install/interface inputs, not only the Rust workspace. Preserve useful exact-output reproduction as our engineering check; byte-for-byte reproducibility is not represented as a universal AGPL requirement.

Run the current affected workspace suites plus packaged acceptance for direct/group messaging, files and byte equality, contacts/requests, replies/timers, membership rotation, identity changes, wrong secrets, access refusal, account switch/logout, single writer, encrypted persistence and retries after lost responses/restarts. Test persistent relay restart and the two differently implemented frontends. Use synthetic new data; do not acquire existing personal vaults/databases.

Rehearse upgrades, application rollback and coordinated recovery on synthetic state. Verify they do not roll ratchets backward, erase committed pending sends, replay already acknowledged delivery or silently reopen an unsafe device state.

**Complete when:** every preserved feature has current passing evidence against the new artifacts and all supported public components build/run from the offered source. Record actual commands, tool versions and hashes; historical candidate 2 results do not count as this release's acceptance.

## 8. Make the real source and license obligations work for users

Package the exact corresponding source for each shipped executable, WASM/browser bundle and server version. Include covered dependencies and preferred forms, interface definitions, required build/install/run scripts, configuration templates, schemas/migrations, license texts, attributions, modification notices and applicable installation information. Classify exclusions with reasons; do not assume a lockfile or repository link replaces required source.

Provide prominent version-specific source access for remote users of the modified AGPL service and appropriate notices in the trusted UI, reference UI and adapters. Make exact source available with downloadable artifacts. A host integration must preserve the user's source opportunity. Do not place required source behind payment, an NDA or extra restrictions on covered rights. Ensure service/product terms distinguish independent private software from covered components and do not contradict their licenses.

**Complete when:** tests from a clean user's perspective obtain the right source archive and notices for each running/downloaded version and verify its hash and completeness. Source is ready before the first applicable external use or distribution, including an external beta or delivery of browser code, rather than being deferred until revenue or a later public launch. Record the selected distribution method and its retention obligations.

## 9. Record a defensible decision for the exact release

Update the live release checklist, rights documentation and `scripts/release-audit.mjs` so they implement the current policy: documented ownership/provenance, source completeness, dependency compatibility, actual boundary assessment, no unresolved release blockers and owner approval of the exact publication scope. Replace the self-imposed requirement for a favorable external reviewer/reference; do not fill it with a fictitious opinion. Preserve candidate 2's frozen records unchanged as the history of the earlier policy.

Create a separate release assessment identifying the exact source/runtime/SDK manifest hashes, evidence references, reasoning, assessor and date, limitations and owner decision. Mechanical checks verify hashes/coverage and required evidence; they do not fabricate legal judgments. Reassess changed code after any alteration to a reviewed candidate.

Professional licensing advice is optional risk reduction, especially before promising that a particular proprietary integration is outside copyleft coverage. No outside person is contacted, paid or sent source without authorization. If our own analysis leaves a material blocker unresolved, resolve it through more complete source, refactoring, a compatible replacement or targeted advice; a preference to avoid counsel does not turn an unresolved issue into a pass.

**Complete when:** there is a written, evidence-supported release conclusion with no identified unresolved licensing blockers and accurate statements about which code may have separate grants. The owner approves the concrete release manifests. This is an internal compliance decision unless an actual professional opinion is separately obtained.

## 10. Release compliantly and keep later versions compliant

Prepare the public repository/source artifacts, release notes, download links and deployment instructions from the approved manifests. Publish or deploy externally only with authorization for that concrete release. Verify the live source offer and all notices before users receive the affected code/service; do not stage an external beta first and fix the offer afterward. Retain source for supported, downloadable and rollback versions for the periods required by the chosen delivery route.

Add release checks for license/provenance changes, actual bundle contents, required source/notices, manifest matching and frontend implementation edges. Require a short human assessment when a dependency, generator, source boundary, frontend integration or license changes; ordinary changes inside the already assessed architecture need the relevant regression/completeness checks rather than a new outside opinion each time. Define contributor provenance/licensing rules and an owner for source requests, corrections and retained release records.

**Complete when:** the authorized released version offers its complete source and notices correctly, retained versions remain compliant, and later releases cannot bypass required evidence checks. Provide a per-project integration guide explaining which public components to deploy, what the MIT client permits, what copying AGPL UI entails and what changes require a fresh boundary assessment.

## Completion standard

I would consider this MVP ready to release on licensing grounds when all ten steps have evidence, the complete messaging product works independently, every known dependency/source issue is resolved, the actual frontend grants have a documented basis, and users can obtain the exact required source and notices. No external-review certificate is required by this plan. Do not label engineering acceptance as a guarantee of legal immunity or promise that every future frontend is automatically outside AGPL.

Implementation checkpoint: steps 1–7 are complete. Prior artifacts remain frozen. Step 7 built the complete public stack from a new archive-before-build extraction, with no prebuilt crypto fallback, and verified a separately extracted runtime. Acceptance passed 127 fresh public tests, 11 isolated frontend tests, 4 host-boundary tests, 54 packaged browser checks, 9 host-integration checks and 10 durability checks each against fresh source and packaged runtime. All 10 fresh crypto outputs match the earlier source-bound build; source/runtime manifests verify 10,174/716 files. See STEP_7_COMPLETION.md and STEP_7_ACCEPTANCE.json for exact identities, coverage and limits. Steps 8–10 remain for release-wide source/notice delivery, final release assessment and owner decision, and authorized publication/ongoing compliance. This plan does not itself approve publication or guarantee the legal result of future integrations.

## Evidence and primary guidance

- [Current architecture](../architecture/REUSABLE_MESSAGING_BOUNDARY.md), [preservation matrix](FEATURE_MATRIX.md), [licensing map](../../LICENSING.md).
- [AGPL text pinned to the libsignal revision used](https://raw.githubusercontent.com/signalapp/libsignal/257105c55a7389ca6b1e85185e2769465e6729f1/LICENSE): sections 1, 4–6, 10 and 13 govern source, notices, conveying and the remote-user offer. These support steps 3 and 8; the expanded public boundary is our architecture choice.
- [GNU program-boundary guidance](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation): communication mechanism and semantics both matter. This supports examining actual coupling in steps 5–6; the FAQ is interpretive guidance, not an automatic determination for our code.
- [GNU corresponding-source FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#AGPLv3CorrespondingSource) and [reproducibility clarification](https://www.gnu.org/licenses/gpl-faq.en.html#MustSourceBuildToMatchExactHashOfBinary).
- [MPL 2.0 text](https://www.mozilla.org/media/MPL/2.0/index.txt) and [Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/): source/notice and secondary-license conditions inform step 3; the actual pinned files still need assessment.
- [Pinned HACL upstream description](https://raw.githubusercontent.com/hacl-star/hacl-star/efbf82f29190e2aecdac8899e4f42c8cb9defc98/README.md): upstream identifies Low*/F* and generated outputs. This identifies provenance to investigate in step 3, not a legal conclusion about which files must be supplied.
