# Pinned MPL compatibility and source assessment

Internal assessment, October 25, 2026. Scope: `hpke-rs 0.7.0`, `hpke-rs-crypto 0.7.0` and their use in the pinned EndToEnd/libsignal AGPL messaging work. **No known unresolved MPL compatibility blocker remains for these versions when the documented source/notice route is followed.** This is a reasoned project assessment, not an outside legal opinion, publication approval or conclusion about custom frontends.

## Exact evidence and source

Both packages declare `MPL-2.0` in their original and Cargo-normalized manifests and in crates.io metadata. Their VCS metadata pins libcrux revision `c5fb80f37530ee9b2df9501ae5ff8cb4a973a4bd`, under `crates/protocols/hpke` and its `traits` directory. All 31 package files are supplied unchanged in `dependencies/preferred-source/mpl/`; their checksum records and registry identities are retained. Eleven Rust files and both original manifests match pinned upstream bytes.

No per-file MPL boilerplate or incompatible-secondary-license designation occurs in either shipped package. The explicit package license declarations are the grant evidence; no nonexistent header is claimed. In the original hpke repository, the earliest license-bearing root Cargo manifest found declares MPL 2.0 on August 12, 2020; the initial traits manifest declares MPL 2.0 on November 10, 2021. Earlier root manifests had no license field. No MPL 1.1-or-earlier provenance or Exhibit B application was identified in this evidence. Exact historical files and hashes are included; this is not a claim to have disproved every possible upstream provenance dispute.

The supported-target dependency chain is `e2ee-crypto` → `libsignal-protocol` → `signal-crypto` → these packages. The first three are already AGPL-covered work; this is an actual combination rather than a preference to relabel standalone MPL software.

## Selected route and obligations

MPL 2.0 identifies AGPL version 3 as a secondary license. Section 3.3 permits the additional grant for an eligible combination while retaining recipients' MPL choice. Sections 3.1–3.4 govern source availability, executable-source information and notice retention. This assessment applies those conditions to the exact components above. [MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/), [Mozilla FAQ, question 14](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

Keep the source packages under their original MPL declarations and distribute them additionally under AGPL version 3 as part of the AGPL messaging larger work. Supply both license texts and the explicit `DISTRIBUTION_NOTICE.txt`; do not overwrite crate metadata or remove the MPL grant. Keeping unmodified upstream files intact is consistent with Mozilla's combination guidance. [Mozilla developer guidelines](https://www.mozilla.org/en-US/MPL/2.0/combining-mpl-and-gpl/).

Future runtime/browser releases must point recipients to their exact source archive containing these files and retain the accompanying license/attribution corpus. No extra restriction may contradict the source rights. A change to covered files, license, dependency version, source provenance or actual combination requires reassessment. New material added to MPL-covered files must be licensed consistently with the selected route.

The supplied source, both full license texts, pinned provenance and distribution notice close the material-preparation condition for this step. Release-time packaging, source downloads and runtime notice checks remain obligations of the later artifact release; this document does not claim a future artifact has already passed them.

## Other pinned Cargo declarations

The 202-package graph contains five AGPL-3.0-only declarations, these two MPL declarations, and permissive expressions/alternatives documented in the JSON. Retain AGPL for covered components. Use available MIT/permissive alternatives without removing other original notices; preserve both notices for the five legacy MIT/Apache slash expressions. For `unicode-ident`, the Unicode-3.0 requirement is additional and its complete notice remains supplied. The MIT alternative in `r-efi` avoids assuming its optional LGPL branch governs the release. Apache/LLVM alternatives do not justify stripping their original texts. Existing BSD-style Valgrind header grants are retained in the dependency notice corpus.

No other incompatible license requirement was identified from the pinned package declarations and the inspected special-case source notices. That bounded conclusion does not certify all patent/provenance questions or replace actual source analysis for generated code. The HACL preferred-source work is separate; these two HPKE packages' eleven Rust files contain no HACL/generated-code designation.

`MPL_ASSESSMENT.json` and `scripts/release-mpl-check.mjs` provide the executable evidence inventory. The validator rejects changed crate bytes, license declarations, incompatible-secondary markers, missing source/notices, or an unassessed Cargo license expression. It never contacts or requires an outside reviewer.
