# Preferred-source editing and import recipes

The supported ordinary EndToEnd build compiles the published editable Rust and
its macro dependency. F*/KaRaMeL are unnecessary for that Rust build. They are
needed when editing the original Low*/F* algorithm and re-extracting it.

## Inspect or modify preferred sources

Every archive is a normal gzip tar source archive. Inspect `PROVENANCE.json`
and verify the entire supplement first:

```text
node scripts/hacl-source-closure.mjs --audit
```

Use a fresh work directory; do not extract over an existing checkout. On a
Unix-like development host, for example, starting in this supplement directory:

```sh
mkdir -p source-inputs/hacl source-inputs/FStar source-inputs/karamel
tar -xzf archives/hacl-snapshot.tar.gz --strip-components=1 -C source-inputs/hacl
tar -xzf archives/fstar-last-source.tar.gz --strip-components=1 -C source-inputs/FStar
tar -xzf archives/karamel-last-source.tar.gz --strip-components=1 -C source-inputs/karamel
```

The earlier HACL/F*/KaRaMeL snapshots remain available for inspecting historical
changes. The later source pair above is pinned by the *C* distribution's INFO,
not an asserted exact original Rust executable combination. All archived paths
and SHA-256 identities are recorded in `PROVENANCE.json`.

The actual HACL algorithm/preferred forms are in `code/`, `lib/`, `specs/`,
`code/meta/` and `vale/`. `RUST_MAPPING.json` gives module entry points; full
snapshots retain their transitive interfaces, proofs, library definitions,
metaprograms, hint records and build configuration. Rust support implementations
are themselves editable under `dist/rs/{fstar,lowstar,lib,krml}`; do not assume
their preferred form is some absent generated algorithm.

## Low*/F* to Rust

Read the supplied F* and KaRaMeL READMEs/build scripts and install their ordinary
OCaml/Dune, Z3 and other declared development prerequisites. Their own source
repositories are included; compiler executables, installed tool dependencies
and an OS image are not part of the EndToEnd application. The original HACL
build also documents its environment in `.docker/`, `.nix/`, `flake.nix`,
`Makefile.common`, `build_local.sh` and the READMEs. Its floating Docker/Nix
inputs are retained as historical configuration and must not be mistaken for
an immutable Rust-generation lock.

After building suitable general-purpose F*/KaRaMeL tools, configure their
absolute locations using HACL's existing variables or `Makefile.config`:

```sh
export FSTAR_HOME="$PWD/source-inputs/FStar"
export KRML_HOME="$PWD/source-inputs/karamel"
make -C source-inputs/hacl dist/rs/Makefile.basic
```

This is the upstream extraction target, not a newly invented partial command.
`Makefile.local`/the root Makefile extract F* modules to `.krml` using F*
`--codegen krml`. `Makefile.common` defines the include paths and algorithm
bundles. The `dist/rs/Makefile.basic` rule invokes KaRaMeL with `-backend rust`,
the precise drop list, `-funroll-loops 32`, and `Lib`, `Bignum`, `Hacl`,
`EverCrypt`, `Vale` crate assignments, using all `.krml` prerequisites. Vale
assembly outputs are disabled for this target, while available Vale F* source
and HACL's ordinary staged prerequisites remain in the snapshot. The separate
`compile-rust` target then invokes Cargo for the experimental upstream workspace.

**This full extraction/proof command has not been executed in our Windows
acceptance run.** Exact original Rust executable revisions were not recorded
upstream. Our checked claim is complete input availability plus exact
post-extraction reconstruction; a newly extracted output must be reviewed and
its adaptation updated if the general tool version changes emitted Rust.

## HACL Rust outputs to the exact published crate (verified)

From the enclosing EndToEnd source root:

```text
node scripts/hacl-source-closure.mjs --audit --reconstruct <new-destination>
```

This command takes the pinned HACL Rust files directly from the archive,
performs the file relocation listed in `RUST_MAPPING.json`, and applies every
hunk in `hacl-to-libcrux.patch` with exact context. It adds the libcrux wrapper,
imports, visibility/module adjustments and retained upstream changes, including
fixed-size streaming buffers and the documented no-op memory-zeroing helper.
It then checks all 25 resulting files against the published crate and upstream
libcrux Git blobs before writing a reconstructed crate with its published Cargo
metadata. The independent macro patch is also reconstructed and compared to
the exact `libcrux-macros` crate. No private patch program or missing manual
edit is required.

For inspection with a general patch utility, first copy/rename the HACL files
according to `RUST_MAPPING.json` into an empty Rust `src` directory (start the
new `lib.rs` wrapper as empty), then apply `hacl-to-libcrux.patch` there with
`git apply -p1`. The Node helper is the portable strict implementation of this
recipe and additionally checks hashes. Keep the exact `.crate` archive metadata
or `Cargo.toml.orig` when changing a libcrux source workspace.

When intentionally changing Low*/F*, review the regenerated module and the
libcrux patch together; do not silently fuzzy-apply a stale patch. Regenerate
the provenance/mapping/inventory, update the exact published dependency or
record our modifications, rerun the Rust/browser crypto tests and reassess the
new source hashes. Existing upstream verification claims do not establish
correctness of unreviewed Rust adaptations.
