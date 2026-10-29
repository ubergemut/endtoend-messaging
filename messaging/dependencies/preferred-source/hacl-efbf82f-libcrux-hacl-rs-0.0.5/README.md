# HACL preferred-source supplement

This directory is part of the corresponding source for EndToEnd's exact
`libcrux-hacl-rs 0.0.5` dependency and `libcrux-macros 0.0.3` support. It contains
actual pinned source, not links requiring future upstream availability.

- `archives/`: full HACL import and Rust-refresh sources; supplemental F*/KaRaMeL
  compiler/standard-library source; exact published editable Rust crate sources.
- `PROVENANCE.json`: immutable revisions, acquisition URLs, purposes and hashes.
- `origins/`: complete upstream Git blob trees, relevant historical commit
  records and libcrux license files. These are source provenance records.
- `RUST_MAPPING.json`: every shipped helper Rust file, its HACL source path,
  Low*/F* entry points and exact before/after hashes.
- `hacl-to-libcrux.patch`: all 25 Rust files reconstructed from HACL `dist/rs`,
  including the new crate wrapper and upstream semantic adaptations.
- `hacl-krml-to-libcrux-macros.patch`: exact unrolling proc-macro adaptation.
- `GENERATION.md`: using the editable preferred sources and import patch.
- `INVENTORY.json`: SHA-256 and length for every other file in this supplement.

Read `docs/release/source-closure/hacl-preferred-source.md` in the enclosing
release for the assessment, notices, historical tool-pin limits and usage.
Run `node scripts/hacl-source-closure.mjs --audit` there to verify this entire
directory offline. The audit compares archive members with their Git blob
identities, never extracts or executes upstream code, and can reconstruct the
exact Rust crate into a new directory with `--reconstruct <new-path>`.

Each upstream source archive preserves its own license and copyright files.
Third-party material retains those grants; it is not claimed as EndToEnd code.
This README, the generation instructions and the auditing helper are EndToEnd
documentation/code under AGPL-3.0-only. No historical F* proof/extraction rerun
is represented as having occurred.
