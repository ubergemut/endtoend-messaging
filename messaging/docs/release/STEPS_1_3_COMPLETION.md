# Steps 1–3 complete: reusable AGPL messaging MVP

Completed October 25, 2026. **All 63 workspace tests and 26 new release/source tests passed**, with zero failures. Frontend type checking, protected-import/bundle checks, scope verification and portable extracted-source audits also passed.

| Step | Completion evidence |
| --- | --- |
| 1. Freeze scope and baseline | Planned 0.2.0 scope: 10 workspaces, 21 existing operations, 16 browser feature areas, 152 frozen source inputs and 62 unchanged historical artifacts. Accepted first-party authority is carried forward. |
| 2. Rights/dependency/asset inventory | 202 Cargo packages; 119 installed npm packages and 169 lock entries; exact npm source archives plus 11 upstream source snapshots; actual two browser bundles, 33 first-party assets, 56 PGlite payloads and 689 embedded files. Original grants/notices and runtime/tool roles recorded. |
| 3. Source and compatibility closure | Exact HPKE and pg_uuidv7 MPL source/notice routes documented; HACL preferred inputs and exact 25-file Rust/macro reconstruction supplied; complete pinned PGlite/PostgreSQL/extensions/runtime/helper sources, build recipes and notices captured. |

Source/preferred-form assessments are internal, evidence-supported project conclusions for these exact dependencies. Tests validate inputs and behavior; they do not produce legal opinions. No outside reviewer is required by this plan. Recipients' MPL choice and all original third-party terms must be preserved in the eventual source/runtime distributions.

The HACL record does not claim historical F*/KaRaMeL extraction or proof reproduction; upstream did not record exact executable revisions. PGlite source correspondence is established without claiming an independent native binary rebuild. These limitations are explicit, and the actual preferred forms and project transformations are supplied.

## Portable source supplement

The locally packaged supplement contains 813 manifest-listed files and was freshly extracted and verified. HACL, both MPL assessments and the expanded inventory audits pass against that extracted copy without a private sibling checkout or installed dependencies. Pristine upstream archives may retain distribution/test binaries and WASM; these are distinguished from EndToEnd build inputs and were not executed.

- Archive: `endtoend-messaging-0.2.0-source-closure.tar.gz` (239,542,803 bytes).
- SHA-256: `654938823024577587e52ef68d77c07684eb3883da483bd74b1e7c8b681b07b3`.
- Manifest SHA-256: `21238121a1951f3ec536e1bdac2594c48de62f2e1390be72fd8cd855d204e66e`.

See `ACCEPTANCE.json`, `portable-checks.json`, `source-closure-verified/PACKAGE_RECEIPT.json`, actual test logs and the repository's `docs/release/{scope,inventory,source-closure}/` for evidence.

## Remaining work

This completes only the new plan's steps 1–3. The source supplement is not the complete runnable 0.2.0 release. Step 4 packages the standalone persistent messaging stack; steps 5–10 complete host integration, concrete frontend assessment, broader builds/acceptance, real source offers and authorized release. Older candidate 2 receipts and artifacts remain unchanged. Nothing was published, deployed or changed in production.
