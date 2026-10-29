# Contributing to EndToEnd messaging

Before contributing, read [LICENSING.md](LICENSING.md) and the [project integration guide](docs/deployment/PROJECT_INTEGRATION.md). The messaging implementation and original full/reference/trusted UI are AGPL-3.0-only. The marked protocol/client SDK, independently authored desk and identified static/disclosure helpers are MIT. Third-party files retain their own terms. A directory or archive name does not override a file/component's grant.

## Permission and provenance

By submitting a contribution for inclusion, confirm that you have permission to contribute it under the existing license applicable to that component, including any employer/client or third-party rights. Identify the applicable component/grant in the contribution description. This is permission to accept your contribution under those terms, not a copyright assignment or a blanket grant over unrelated work. Do not silently change another contributor's license or assume that root AGPL or an MIT package overrides copied third-party code.

For new or imported material, state its origin and exact version/commit, original license/notices, any changes made and how it is used. Retain source and notices. For generated material, include the editable preferred inputs, project-specific transformations/build steps and provenance needed to modify it. If code is assisted/generated, check substantial copied material and its actual sources/permissions; a tool's assertion is not license evidence. Supply generic examples rather than credentials, user messages, private vaults/databases or confidential source you lack authority to contribute.

Contributions to existing MPL-covered dependency files require the documented source/license route and notice preservation; do not paste AGPL-only code into an original MPL file without assessing the resulting rights. See the [pinned MPL assessment](messaging/docs/release/source-closure/MPL_ASSESSMENT.md). Report uncertain origins or grants before asking to merge. No contributor is required to assign all rights or obtain an outside legal certificate.

## Describe and validate the change

Explain the user-visible problem, final behavior and affected interfaces/data. Add meaningful regression coverage where needed and run affected workspace tests. This public repository has no root Yarn workspace. From the repository root, run the release-tool guard tests and the independently pinned source-integrity check:

```text
node --test release-tools/check-published-source.test.mjs release-tools/verify-published-release.test.mjs
node release-tools/check-published-source.mjs --root . --catalog release/source-disclosure.json --expected-catalog-sha256 f1f345bb8496ae56e347a5b07381edf95527fbb19958b761c59d8126c6b313a2
```

The guard tests currently contain 21 cases. The source check validates the frozen approved snapshot and its manifests; a deliberate source change requires new release identities and assessment rather than changing a checksum merely to make that check pass.

For core changes, enter `messaging/`, install/build using its README, then run `yarn test`; `yarn test:package` selects the core packaging regressions. Consumer changes use the documented build/tests inside `consumers/`, and SDK changes use `sdk/`. Preserve failing evidence and state limits; do not claim a platform, migration or build you did not test.

Keep public SDK consumers on public contracts. Device secrets, vault/ratchet handling, attachment encryption and trusted decisions stay in the public implementation. Changes to dependencies, generators, licenses, preferred source, bundled assets, frontend provenance or implementation coupling need the short human assessment described in [ONGOING_COMPLIANCE.md](docs/release/ONGOING_COMPLIANCE.md). Ordinary changes within the assessed design need the relevant regression/completeness checks, not a new outside opinion each time.

The project owner reviews contribution provenance, applicable grants and release consequences. A merge or passing test does not itself authorize a new external publication/deployment or a proprietary-boundary promise. Report missing source/notices through [repository Issues](https://github.com/ubergemut/endtoend-messaging/issues) using the ongoing-compliance process.
