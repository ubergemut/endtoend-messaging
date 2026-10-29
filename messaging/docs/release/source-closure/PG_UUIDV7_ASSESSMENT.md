# pg_uuidv7 1.7.0 MPL assessment

The exact pg_uuidv7 source at `c707aae2411181be4802f5fa565b44d9c0bcbc29` has no known unresolved MPL-specific compatibility blocker for the planned AGPL messaging distribution, subject to the source, notice and retained-choice conditions below. This is an internal evidence assessment, not a legal certification or publication approval. No outside review is required by this assessment.

## Exact source and origin

PGlite 0.3.16 identifies PostgreSQL submodule `51e222cc5f799675b8dd098f5cb7bf46cbad75a2`, whose `pglite/pg_uuidv7` gitlink identifies this extension commit. The extension's `META.json`, SQL and control file identify version 1.7.0/1.7. Its manifest uses the generic value `open_source`; the affirmative license evidence is the full upstream `LICENSE`, which is MPL 2.0. Do not infer MIT or Apache from PGlite's own wrapper license.

All 37 upstream Git blobs match the supplied source bytes. The inspection directory contains these files plus one explicitly identified, empty-link extraction record. The original source archive is retained with SHA-256 `422b882887ace16a1358150eb8bcfcf41a74ae60db89818929ba4f59ba360251`. C, SQL, PGXS Makefile, tests and build documentation are present; none of these source files has been rewritten to claim a new upstream grant.

Upstream's observed `LICENSE` history contains one addition: `44d79cb8d67e0796f138bcf3359b468bb323b5ce` on January 2, 2023. That original MPL 2.0 text exactly matches the current extension license. The earliest repository commit observed is also January 2, 2023. The contributor guide directs contributions under the project's license and DCO. These observations support the identified MPL 2.0 origin; they are not an exhaustive warranty about every contributor or imported line. The original historical license and history observations are included in the supplement.

## Eligibility and selected treatment

[MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/) section 1.12 includes GNU AGPL version 3 as a Secondary License. Sections 1.5 and 3.3 permit the additional route for a qualifying larger work unless the covered source carries an incompatibility designation or the disqualifying earlier-MPL origin. No separately attached Exhibit B designation, MPL-2.0-no-copyleft-exception identifier or earlier MPL grant was identified in this source. The standard Exhibit B template printed at the end of the full license is part of the unmodified license; its presence alone is not an attached designation. No per-file MPL boilerplate is claimed: the directory license, original history and contribution policy supply the license evidence.

The selected primary treatment retains MPL-2.0 for the unchanged extension. `dependencies/preferred-source/mpl-pg-uuidv7/DISTRIBUTION_NOTICE.txt` additionally offers AGPL-3.0-only when the extension is distributed in the larger EndToEnd AGPL messaging work, while preserving the recipient's MPL choice. This follows the original MPL section 3.3 rather than replacing upstream's license or assuming every collection of files is an AGPL combination. A standalone component remains available under MPL.

The actual API is AGPL-3.0-only, declares PGlite, and imports it in its DB module. The locked dependency is PGlite 0.3.16. PGlite supplies an optional pg_uuidv7 payload; EndToEnd's DB module does not currently import or enable that extension. Source and notice duties apply to a conveyed payload even when unused. This assessment does not claim the extension is statically linked into EndToEnd or that it is enabled at runtime. The compatibility conclusion does not depend on silently changing that behavior.

## Distribution conditions and limits

- Preserve all original extension files, notices and grants, including the full MPL license. Supply this complete extension source and its build/test inputs with the matching release source; include both full license texts and the retained-choice notice.
- Under MPL sections 3.1–3.4, tell executable recipients how to obtain the exact covered source by reasonable, timely means. Copy the MPL and supplemental notices into the final release's source/runtime notice set and test the actual version-specific source link. The generic release source offer must also cover the rest of the public messaging work.
- Keep AGPL additional licensing tied to the actual qualifying larger work and retain the MPL option. Do not label upstream extension code MIT, and do not infer any custom frontend's independence from this assessment.
- Reassess source/version changes, modifications, changed origin evidence, an incompatibility designation or a materially changed combination. The PGlite binary-to-source/rebuild assessment and the other embedded components remain separate. Matching Git source and SQL/control observations do not prove the compiled `.so` or full PGlite WASM was reproduced.

The executable validator checks the bounded evidence, exact source tree, original archive, license history and required notice statements. Its passing result supports this assessment's input integrity; it does not determine legal conclusions automatically.
