# Pinned MPL source and distribution materials

This portable supplement contains exact, unmodified source packages for `hpke-rs 0.7.0` and `hpke-rs-crypto 0.7.0`, copied from the checksum-verified candidate 2 vendor tree. Their registry checksums, upstream revision, per-file hashes, direct upstream comparisons and original-license history are recorded in `PROVENANCE.json`. Original vendor files and existing archives were not modified.

The packages retain MPL-2.0. `DISTRIBUTION_NOTICE.txt` records the additional AGPL version 3 route under MPL section 3.3 when they are distributed in the existing AGPL messaging larger work. The full MPL and AGPL texts are supplied beside the source. The original MPL choice and notices remain available; this is not a blanket replacement of dependency grants.

These Rust sources, manifests, package locks, readmes and auxiliary package files are the actual inputs supplied by the pinned upstream packages. Eleven Rust files and both original Cargo manifests were compared byte-for-byte with the pinned libcrux repository. These two packages do not contain the HACL-generated Rust under assessment elsewhere.

`CARGO_GRAPH.json` records the complete pinned 202-dependency inventory for context. It does not replace those other dependencies' source, supplied by the complete messaging source distribution. This supplement is not an executable messaging release.

From the repository root, run:

```text
node scripts/release-mpl-check.mjs --root .
```

When copied into a future complete source release, retain this entire directory, the assessment in `docs/release/source-closure`, the validator and the full dependency source/notice corpus. Test exact-source links and runtime notices again for the resulting artifacts. The validator checks evidence consistency; it does not turn a missing legal conclusion or an unapproved publication into a pass.
