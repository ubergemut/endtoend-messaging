# PGlite source, embedded runtime and notice assessment

Internal assessment, October 25, 2026. Scope: the installed and locked `@electric-sql/pglite` 0.3.16 used by the EndToEnd persistent relay. The conservative source preparation for this component is complete: actual preferred sources, build recipes, original notices and exact distribution archives are supplied locally. The npm wrapper's Apache declaration is not treated as a license for every embedded component.

## Distribution and preferred-source relationship

The exact npm distribution is captured under `dependencies/preferred-source/npm/` and checked against the lock/registry integrity. Its registry attestation metadata and upstream annotated release identify wrapper commit `4555814e2b0beac8af5d5d760907040b7b8f61df`. This is recorded provenance agreement, not a claim that the complete Sigstore certificate chain was independently verified.

The wrapper's Git tree pins the modified PostgreSQL source at `51e222cc5f799675b8dd098f5cb7bf46cbad75a2`. The full original source archives and selected inspection copies are in `dependencies/preferred-source/pglite-0.3.16/`. Archives retain the complete original source layout; extracted inspection copies in the portable supplement are intentionally partial and exist to run its offline checks. The PostgreSQL tree pins six extension repositories, all supplied at their exact gitlinks. Its build recipes identify the included zlib 1.3.1, libxml2 2.14.5, libxslt 1.1.43, OpenSSL 3.0.17, OSSP UUID 1.6.2 and Emscripten 3.1.74 inputs. Their actual sources and original notices are supplied as well.

The inventory examines 56 distributed WASM/data/extension payloads and all 689 entries of the embedded PostgreSQL filesystem. Extension tar members are identified by content, not merely filename. The offered preferred material includes C/TypeScript/SQL, headers, grammar/specification inputs, source submodules, Docker/build scripts, lockfiles and runtime/library sources. No inspected payload is explained solely by the wrapper's package metadata.

Every available PGlite JavaScript source-map input is mapped either to a byte-identical source file in the pinned wrapper/helper packages or to the PostgreSQL/Emscripten generation inputs. The original npm distribution retains the generated glue and maps. Actual embedded `pg-protocol`, `async-mutex`, `tinytar` and `tsup` code is classified as runtime even when it originated in a build dependency. Native bit-for-bit reproduction remains a later build check; source availability and recorded correspondence do not imply that reproduction has already run.

## Compiler-emitted helper

The actual async-mutex 0.4.1 source/lock/build configuration is supplied at its registry Git revision. The complete TypeScript 5.3.3 source archive is supplied conservatively because that release satisfies its recorded `^5.3.3` build dependency. This is not a claim that the upstream author used exactly that executable build.

The inventory compares every emitted `__awaiter` function body with TypeScript's preferred `src/compiler/factory/emitHelpers.ts`. The bodies match apart from whitespace; the explicit Rollup adaptations rename bindings and replace module-level `this` with `undefined`. Original TypeScript Apache license and third-party notices accompany the source. The complete compiler source archive is authoritative. Its deliberately partial inspection directory contains the helper, package metadata and original notices and is labelled accordingly; no source is lost from the unchanged archive.

## Selected grants and remaining release duties

Retain the original wrapper Apache grant, PostgreSQL COPYRIGHT, and each component's actual grant. The PostgreSQL-style, MIT/ISC-style, Zlib, Apache and Emscripten runtime grants are compatible with the planned AGPL work subject to their retained terms. Do not discard attribution, modification, patent or non-endorsement provisions. Included source snapshots contain additional tool/test material under its own terms; they are preserved source archives, not a claim that every archived file executes in the messaging runtime.

The distributed optional `pg_uuidv7` extension has a distinct MPL-2.0 grant. Its exact source, licence history, retained MPL choice and conditional additional AGPL route are assessed in [PG_UUIDV7_ASSESSMENT.md](PG_UUIDV7_ASSESSMENT.md). The relay does not currently enable this extension. Its distributed payload still receives source and notice coverage.

No known unresolved source-acquisition, preferred-form or MPL-specific blocker remains for this pinned preparation when these materials and conditions are preserved. This is an internal project conclusion, not a professional opinion, a frontend-boundary judgment or publication approval. Steps 4–10 must still assemble the full product, test supported clean builds and attach these exact sources/notices to each actual release and runtime offer.

## Verification

`scripts/release-expanded-inventory.mjs --check` regenerates installed/locked, bundle, source-map, helper, filesystem and notice evidence. `--audit --root <source-root>` verifies the supplied evidence without installed dependencies or network access. `scripts/release-mpl-pg-uuidv7-check.mjs` separately verifies the extension's source/grant evidence. The final source supplement is extracted and all these audits are repeated against its actual files.

Primary source identities, original HTTPS URLs, hashes, build pins and file-level records are retained in `PROVENANCE.json`, `POSTGRES_PROVENANCE.json`, `EMBEDDED_PROVENANCE.json` and `docs/release/inventory/EXPANDED_INVENTORY.json`. The original upstream archives retain their licenses and source layouts, including upstream distribution/test resources; they are never executed by source-inventory verification.
