# Licensing map for the public messaging release

The root [LICENSE](LICENSE) is the complete GNU AGPL version 3 text. First-party top-level operating documentation, contribution guidance and release orchestration are AGPL-3.0-only unless a file expressly states another grant. This does not replace component grants or claim ownership of third-party material.

| Path/material | Applicable treatment |
| --- | --- |
| `messaging/` implementation: crypto/session/vault/trust, persistent relay/contracts/schemas, adapters, trusted/reference UI and required orchestration | AGPL-3.0-only first-party source with original dependency terms. See [component licensing map](messaging/LICENSING.md) and [AGPL text](messaging/LICENSE). |
| `messaging/packages/client/`, `messaging/packages/protocol/`, and expressly MIT-marked public interface/static-disclosure files | Their stated MIT grants remain. See [client MIT license](messaging/packages/client/LICENSE) and [protocol MIT license](messaging/packages/protocol/LICENSE). These grants do not relicense the messaging implementation. |
| `consumers/apps/web/` and AGPL-marked consumer build/release orchestration | Original full frontend remains AGPL-3.0-only; see [consumer AGPL text](consumers/LICENSE) and its [source README](consumers/README.md). |
| `consumers/apps/desk-client/` | Independently authored first-party presentation/controller/docs are MIT under the [desk license](consumers/apps/desk-client/LICENSE). Marked static/disclosure helpers retain their specified MIT grant. |
| `sdk/`, and the client/protocol source included in `consumers/` | MIT for the identified first-party SDK source. See [SDK license](sdk/LICENSE), [client license](sdk/packages/client/LICENSE) and [protocol license](sdk/packages/protocol/LICENSE). |
| Vendored dependencies, embedded runtime/helper code and upstream source archives | Original component copyrights, grants, patent/attribution/warranty notices and retained choices apply. The complete source/preferred forms and notices accompany the exact release; root AGPL/MIT declarations do not override them. |

The owner confirmed first-party authority on October 24, 2026. Previously granted rights remain valid. In particular, libsignal/SPQR stay AGPL; the documented MPL components retain their MPL choice and additional AGPL combination route. Nothing here converts third-party crypto to MIT.

The [concrete frontend assessment](messaging/docs/release/FRONTEND_BOUNDARY_ASSESSMENT.md) and [later boundary reassessment](docs/release/STEP_9_BOUNDARY_REASSESSMENT.md) explain the chosen grants. Copying/modifying AGPL UI remains covered. A separate origin, new appearance or MIT wrapper is not a universal private-frontend exception; a changed integration needs its own assessment.

[Exact release metadata](release/APPROVED_RELEASE.json), the [source catalog](release/source-disclosure.json) and [release notes](docs/release/STEP_10_RELEASE_NOTES.md) identify the approved files. Canonical source/runtime archives and complete notices are release assets. [Source delivery](docs/deployment/SOURCE_DELIVERY.md) and [ongoing compliance](docs/release/ONGOING_COMPLIANCE.md) preserve source access, notices and covered rights. User messages, keys, vaults/databases, deployment credentials and original private repository history are not part of this source grant or delivery.
