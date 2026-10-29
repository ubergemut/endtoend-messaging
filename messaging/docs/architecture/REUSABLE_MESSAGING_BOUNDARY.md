# Reusable messaging subsystem with independent project frontends

Owner direction recorded October 25, 2026; implementation checkpoint updated October 26. This records the architecture and source scope. Concrete frontend grants and their code-specific reasoning are recorded in [the assessment](../release/FRONTEND_BOUNDARY_ASSESSMENT.md) and [licensing map](../../LICENSING.md); this architecture alone does not decide them or authorize publication.

The owner wants one complete messaging subsystem that can be reused in multiple projects with substantially different frontends. Keep surrounding project code private where it is independent. Prefer including more generic messaging implementation in the public source over maintaining a fragile minimum-file boundary.

The [ten-step AGPL MVP completion plan](../release/AGPL_MVP_TEN_STEP_PLAN.md) defines the remaining implementation, source/license assessment, release acceptance and ongoing compliance work for this direction.

## Intended boundary

| Area | Intended treatment |
| --- | --- |
| Device messaging implementation | Public AGPL: cryptography bindings, session/trust state, sealed vaults, delivery/retry, attachments, expiry, groups, contacts/requests and trusted unlock/verification controls. |
| Generic relay/backend | Public AGPL: messaging endpoints, persistence/schema/migrations, ciphertext queues, media access, membership enforcement and the generic account/identity integration contract needed to operate independently. |
| Automation and independent deployment | Public AGPL: HTTP/GraphQL/MCP/CLI service adapters, runnable deployment/configuration scripts and a working standalone reference application. Third-party code keeps its applicable terms. |
| Protocol and transport client | MIT: documented wire messages, ordinary presentation data, transport/correlation/encoding and integration examples that contain no protected implementation. MIT is a grant for these files, not an exception to another component's copyleft. |
| Project-specific frontend | Intended to remain independently licensed: product layout, chat presentation, navigation, branding and unrelated workflows, authored without copying or importing protected AGPL implementation. Actual independence must be assessed from the code and interaction. |
| Project-specific backend | Intended to remain independently licensed: the host project's account system and business features. Integration uses the documented identity/authorization contract; generic messaging rules belong to the public subsystem. |

A reusable chat widget or reference UI released under AGPL remains AGPL when copied/modified. A custom frontend can instead use the MIT client and public protocol. Different appearance alone does not establish a different program; copying/bundling protected implementation or intimate shared implementation structures can change the analysis. [GNU's explanation of program boundaries](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation), [plug-in guidance](https://www.gnu.org/licenses/gpl-faq.en.html#GPLPlugins).

## Engineering requirements

1. The public subsystem must install, run and perform its complete messaging function without private EndToEnd, Choice or other host-project source.
2. Ship a persistent relay and a usable reference client alongside the device agent. A synthetic relay fixture alone does not make the entire subsystem deployable.
3. Keep versioned public contracts for account identity, authorization, messages, groups, files and events. Use ordinary data and commands rather than importing session objects, vault/ratchet types, host database models or executable callbacks across the boundary.
4. Frontends import only the independent client/protocol. Protected crypto/session/agent implementation stays in the independently operating public component; its trusted secret-entry controls remain there.
5. Keep generic messaging policy, storage and authorization implementation public. Put host-only business rules behind explicit integration contracts without making the public subsystem depend on private modules.
6. Demonstrate the same released subsystem working with multiple independent clients, including distinctly implemented project frontends and a CLI/reference client. Preserve all existing messaging features and durability/security acceptance.
7. Preserve exact source/build inputs, dependency notices and corresponding-source availability for each published version. A shared component's source offer does not include private user databases, messages, vaults, keys or repository history.

These requirements support a reusable independent design. Transport choice, separate origins, package names and a permissive wrapper alone do not prove the legal result. The AGPL's corresponding-source and combined-work provisions still apply to the actual covered work. [Pinned upstream AGPL](https://raw.githubusercontent.com/signalapp/libsignal/257105c55a7389ca6b1e85185e2769465e6729f1/LICENSE).

## Current implementation

Steps 1–5 established preferred-source/dependency closure, an independently runnable public messaging package with real persistent relay, schema/migrations, generic account integration, headless HTTP/GraphQL/MCP/CLI adapters and AGPL reference application. The frozen step-4 full runtime and original candidate-2 evidence remain historical checkpoints; neither is silently updated to stand for the new code.

The full `apps/web` frontend now consumes compiled MIT SDK/protocol entries. Its original AGPL grant remains. The new `apps/desk-client` is an independently authored static MIT consumer with a separately recorded authoring-input list. Both use the same public subsystem; generic crypto, session, trust, vault, delivery and access enforcement stay public. The second client does not copy the AGPL reference/full UI. Source/import checks and actual bundler input graphs support this split; the concrete assessment also examines provenance and semantics.

The public host identity contract supports different account systems through scoped audience-bound grants, finite lifetimes and persisted replay/revocation state. Legacy native demo login remains available. See [host identity](HOST_IDENTITY_V1.md), [SDK contract](SDK_CONTRACT_V1.md), [browser pairing/configuration](BROWSER_CONSUMER_V1.md) and [host deployment](../deployment/HOST_INTEGRATION.md). SDK 0.2.1 corrects native browser Fetch binding discovered during frontend acceptance while retaining wire v1.

Existing one-device/one-writer limits remain explicit. Reusing the subsystem in separate project deployments does not add federation, a shared cross-project inbox or simultaneous same-account multi-application access. Step 7 now provides fresh Node/browser source builds and current feature/durability/rollback/matched-recovery acceptance against exact extracted artifacts; see [its completion record](../release/STEP_7_COMPLETION.md). Exact release-wide source offers, final decisions and publication remain steps 8–10.

## Review process clarification

Outside legal sign-off is not a condition imposed by AGPL for making changes. The earlier release checklist used an additional conservative project gate; it must not be described as a universal license requirement or used to halt private development solely because no external reviewer exists.

Use a documented source/license/boundary assessment for the actual release. Professional advice can reduce uncertainty before relying on proprietary-frontend representations. Complete-source/preferred-form and dependency questions still need a reasoned resolution; tests do not decide them. Do not label an internal engineering assessment as an external qualified legal opinion, change frozen review records, or authorize publication merely by passing tests.
