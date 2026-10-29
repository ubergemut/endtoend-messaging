# HACL-derived Rust: preferred source and extraction provenance

Assessment date: 2026-10-25. Scope: the exact `libcrux-hacl-rs` **0.0.5** and `libcrux-macros` **0.0.3** selected by `packages/crypto/Cargo.lock`. This supplements the dependency source; it does not modify the algorithms, change their license or alter frozen candidate 2 artifacts.

## Conclusion and supplied material

For this dependency, the conservative preferred-source condition in step 3 is satisfied by the locally supplied supplement at `dependencies/preferred-source/hacl-efbf82f-libcrux-hacl-rs-0.0.5/`. It contains the actual upstream Low*/F* implementation, specifications, interfaces, proof hints, metaprograms, build rules and Rust outputs, the exact published editable Rust and proc-macro source, and a lossless, checked description of every adaptation into the shipped Rust. These are downloadable source bytes, not an upstream-link-only offer. The future broader release must include this whole directory, this document and `scripts/hacl-source-closure.mjs`; that future archive has not yet been accepted by this assessment.

The conclusion is about supplying the required source forms and project-specific transformations. It does **not** claim that we reproduced F* verification or historical Low*/F*-to-Rust extraction. The upstream Rust distribution does not record exact original executable revisions; this remaining historical tool identification limit is described below. Nothing here relies on the owner's first-party rights to grant rights over HACL or libcrux.

## Exact relationship to shipped code

The crate archive SHA-256 is `66106db376ae249af86911aee048cf73ea1f394d6653026fc988dd22cf2a4ace`, matching Cargo's registry checksum. Its `.cargo_vcs_info.json` identifies libcrux commit `451259bb704d4a9dab8cd31ac68a97e766fbd2bc`, directory `crates/utils/hacl-rs`. Its [`src/lib.rs`](https://github.com/cryspen/libcrux/blob/451259bb704d4a9dab8cd31ac68a97e766fbd2bc/crates/utils/hacl-rs/src/lib.rs) records HACL import revision `efbf82f29190e2aecdac8899e4f42c8cb9defc98`.

`RUST_MAPPING.json` maps **every one of the crate's 25 Rust files** to a pinned HACL `dist/rs` file or the new libcrux crate wrapper, with before/after SHA-256 values. `hacl-to-libcrux.patch` records the complete textual transformation, including formatting. The audit applies that patch strictly in memory and compares every resulting byte with both the exact published crate and, when requested, the actual vendored dependency. It independently checks the Rust files against the libcrux Git blob identities. No fuzzy matching or generated files fetched from a moving branch are used.

| Shipped area | Preferred implementation and recorded adaptation |
| --- | --- |
| `bignum/*` | `code/bignum/Hacl.Bignum*.fst/.fsti`, related specs and library modules; HACL crate bundling, then module relocation/import/visibility and formatting changes. HACL `bignum/bignum.rs` becomes libcrux `bignum/base.rs`. |
| `bignum25519_51.rs` | `code/curve25519/Hacl.Impl.Curve25519.Field51.fst`, curve metaprograms/specs and library inputs; HACL's `CURVE_BUNDLE_BASE` renames Field51 to this Rust module. |
| `curve25519_51.rs` | `Hacl.Curve25519_51.fst/.fsti` plus curve generic, field, inversion and add/double modules. The complete transitive source tree is included rather than assuming just one `.fst` is sufficient. |
| `streaming_types.rs` | `code/streaming/Hacl.Streaming.Types.fst`; libcrux also changes boxed state/buffer fields into fixed arrays. This is a substantive upstream change, retained in the patch. |
| `util/inttypes_intrinsics.rs` | `code/fallback/Hacl.IntTypes.Intrinsics.fst` and `lib/Lib.IntTypes.Intrinsics.fsti`, plus the Rust import adjustment. |
| `fstar/*`, `lowstar/*`, `util/memzero0.rs`, module roots | Editable Rust support implementations are supplied in HACL `dist/rs`, alongside applicable Low* interfaces and supplemental F* standard-library source. The libcrux no-std conversion, inline attributes, crate wrapper and imports remain explicit Rust source. They are not falsely represented as all generated from a single HACL algorithm file. |
| Rust unrolling support | HACL `dist/rs/krml/src/lib.rs`, exact published `libcrux-macros` source, and `hacl-krml-to-libcrux-macros.patch`. This preserves the actual project-specific `unroll_for!` implementation, not just the name of a compiler. |

The [upstream libcrux memory-zeroing helper](https://github.com/cryspen/libcrux/blob/451259bb704d4a9dab8cd31ac68a97e766fbd2bc/crates/utils/hacl-rs/src/util/memzero0.rs) is intentionally a no-op, with its TODO retained. The original HACL Rust helper writes zero values. This assessment documents that existing upstream adaptation; it does not assert zeroization guarantees or prove that upstream adaptations preserve the F* proofs. EndToEnd's existing crypto tests and build evidence assess the Rust that actually ships.

## Source snapshots and generation chain

The complete snapshots are supplied as ordinary gzip tar source archives, preserving all upstream license files and embedded notices. `PROVENANCE.json` records their immutable URLs, revision identities, byte counts, SHA-256 hashes and purposes. `origins/*-tree.json` records every upstream Git blob identity; the offline audit checks **all archive members**, including link text, against these trees.

The pristine HACL snapshots also preserve upstream distribution examples such as `dist/wasm/*.wasm` (62 at the import revision). These are archival upstream outputs, with their preferred source in the same snapshot. They are not prebuilt EndToEnd outputs, not used to satisfy its clean build, and are never executed by this audit. Similarly, compiler snapshots retain their own upstream fixtures. Keep that classification explicit instead of claiming these original upstream archives contain no binaries at all.

1. **Imported HACL source:** `efbf82f29190e2aecdac8899e4f42c8cb9defc98`. The original Low*/F*, specifications, `lib/`, `code/meta`, hints, Vale sources, distribution files and generation configuration are present.
2. **Last Rust refresh:** `cc27b6215653160781e3d4689aba28a9d7ea4023` ([commit](https://github.com/hacl-star/hacl-star/commit/cc27b6215653160781e3d4689aba28a9d7ea4023)). Every imported mapped Rust file is byte-identical between this snapshot and the import revision. The history and commit record are stored locally.
3. **Earlier Rust regeneration:** `14eb64194ad5152238a9f4e25008f388dddb512f` ([commit](https://github.com/hacl-star/hacl-star/commit/14eb64194ad5152238a9f4e25008f388dddb512f)). Curve25519/field files last changed here; its complete earlier preferred sources are also supplied.
4. **General compiler and library source:** full F* and KaRaMeL snapshots at the revisions recorded in the respective C-distribution `INFO.txt` files, plus a contemporaneous KaRaMeL snapshot. These include the F* integer/endianness library inputs and KaRaMeL's editable Rust backend. Their roles are explicitly supplemental, not a claim about the unrecorded original Rust tool executables.
5. **Published Rust import/adaptation:** exact crates.io source archives, upstream Git metadata, original grants, the file mapping and the two tested patches.

The pinned HACL [`Makefile.local`](https://github.com/hacl-star/hacl-star/blob/efbf82f29190e2aecdac8899e4f42c8cb9defc98/Makefile.local) extracts F* modules to KaRaMeL `.krml` with `--codegen krml`. The root [`Makefile`](https://github.com/hacl-star/hacl-star/blob/efbf82f29190e2aecdac8899e4f42c8cb9defc98/Makefile) defines `dist/rs/Makefile.basic` using `-backend rust`, explicit free-function drops, 32-iteration unrolling and `Lib`, `Bignum`, `Hacl`, `EverCrypt`, `Vale` crate bundles. `Makefile.common` supplies the algorithm module bundles, including the Field51 rename. The actual invocation passes all extracted `.krml` prerequisites to KaRaMeL; `compile-rust` then invokes Cargo. The complete original recipes, not a paraphrased substitute, are included inside each HACL archive. See the supplement's `GENERATION.md` for extraction and reconstruction commands.

## Tool classification and historical limits

F*, KaRaMeL, OCaml/Dune, Z3, Python, make, Rust/Cargo and ordinary archive/patch utilities are general-purpose development tools used unmodified here. EndToEnd has no undisclosed custom F*/KaRaMeL plugin, compiler modification or private extraction service. HACL's project-specific extraction metaprograms, flags and runtime helpers are supplied. F* and KaRaMeL sources are additionally included as a conservative convenience because their standard libraries/backend clarify the generated code; including them does not represent every transitive compiler build dependency as covered EndToEnd application code.

The HACL Rust directories contain no `INFO.txt`. The C `INFO.txt` at the earlier refresh records F* `6e8b1573b5137c59004c715b229d5dfb4754adbf` and KaRaMeL `c31a22c1e07d2118c07ee5cebb640d863e31a198`; the later C info records F* `8b6fce63ca91b16386d8f76e82ea87a3c109a208` and KaRaMeL `ff98b1385644e0c5f845531a5bf2e32010daaf1a`. These are **C-generation records**. Similarly, the later libcrux workspace flake's HACL `b75b1a44...` is not this crate's recorded HACL origin. Neither is substituted for missing Rust tool history.

The application preferred inputs, all imported Rust outputs and exact project adaptations are nevertheless supplied and verified. The missing historical executable identity limits reproduction of the upstream generation environment; it does not withhold a project source input or necessary custom transformation. A clean Rust build uses the exact editable Rust and macro source without F*/KaRaMeL. Changes made in Low*/F* can be regenerated with suitable general tools, then reviewed against the explicit import patches. Do not claim byte-for-byte historical extraction or extend HACL proof claims to the adapted Rust without doing that separate work.

## Grants, notices and release integration

The HACL repository's [Apache-2.0 grant](https://github.com/hacl-star/hacl-star/blob/efbf82f29190e2aecdac8899e4f42c8cb9defc98/LICENSE), per-file copyright notices, `AUTHORS.md` and distribution license material are retained. The libcrux helper and macro package metadata identify Apache-2.0; the upstream libcrux license files are retained separately. The HACL README's additional MIT statement about generated **C** is not used to infer an MIT grant for this Rust dependency. F*/KaRaMeL and incorporated material retain all notices present in their full source snapshots. No EndToEnd copyright claim is made over these third-party files.

Supplying this source does not remove Apache notice, patent and modification obligations or replace the main dependency notices. The new broader source archive must include this supplement as third-party source, keep it out of the first-party ownership ledger, and retain the exact Rust dependency source already used in the build. The public-source inventory/audit must account for the nested source archives, not classify them as executable artifacts or skip them as unexplained binary blobs.

## Verification

From the repository or new public source root:

```text
node scripts/hacl-source-closure.mjs --audit --report hacl-source-check.json
node scripts/hacl-source-closure.mjs --audit --cargo-dir <public-source>/dependencies/cargo
node scripts/hacl-source-closure.mjs --audit --reconstruct <new-empty-destination>
node --test scripts/hacl-source-closure.test.mjs
```

The audit verifies archive SHA-256, every upstream Git blob, source coverage, exact crate/Git provenance, Cargo.lock checksums, all 25 Rust mappings, strict patch reconstruction and the macro-runtime adaptation. `--cargo-dir` additionally compares the concrete dependency source used by the release. It executes no fetched source, contacts no network, and follows no archive symlinks. Its receipt states that Low*/F*-to-Rust extraction was not rerun. An integrity failure, newly unmapped file or changed source must fail the new release's completeness check.
