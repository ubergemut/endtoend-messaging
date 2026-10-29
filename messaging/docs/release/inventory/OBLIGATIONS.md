# Expanded dependency and asset obligations

Exact lock: `4ac56e144d01f037ef3221c1e3d3ed1ef6d632b42d3f74ec7d53056fd2bfa8f1`. Inventoried 119 installed npm packages and 169 lock entries. Actual browser chunks and PGlite WASM/data/extension payloads are recorded in EXPANDED_INVENTORY.json. This is evidence for the expanded scope, not candidate2 acceptance.

## Required treatment

- Distinguish actual runtime/bundled libraries from external tools using each package's roles and module evidence. Build-only package metadata is insufficient for bundled runtime code.
- Retain each package's captured original license/copyright/notice files, including parent-license mappings for platform tool packages. Do not replace third-party grants with first-party AGPL or MIT declarations.
- Include preferred source for covered libraries and generated runtime code. The package lock identifies versions; it does not replace required source.
- PGlite 0.3.16: preserve wrapper Apache terms, PostgreSQL COPYRIGHT, all embedded JS/native/runtime/extension notices and pinned source archives/build scripts under dependencies/preferred-source/pglite-0.3.16. Optional distributed extension archives still need provenance even when the relay does not load them.
- First-party screenshots, inline icons and original documentation rely on the accepted October24 owner confirmation. Fonts use the recorded system stacks; external asset references, if any, require independent inspection. Legal texts and upstream trees remain third-party material.

## Current machine findings

No machine-detected metadata/notice/source-acquisition gaps.

Source acquisition is not a claim of byte-identical PGlite rebuilding. Validate the captured source/build relationship and explain remaining generation or compatibility questions before the final release assessment.
