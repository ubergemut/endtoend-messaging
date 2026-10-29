# Exact pg_uuidv7 MPL source supplement

This directory supplies license, origin and dependency evidence for the optional pg_uuidv7 1.7.0 extension in PGlite 0.3.16. It supplements the separate two-crate HPKE MPL assessment; it does not change its scope or conclusions.

The complete extension source is preserved at `../pglite-0.3.16/postgres-pglite/pglite/pg_uuidv7`, and the original archive at `../pglite-0.3.16/embedded/pg_uuidv7.tar.gz`. Every one of the 37 upstream Git blobs is compared with the pinned Git tree. The additional `EXTRACTION_LINKS.json` records the inspection extraction; its empty links list confirms no extension source links were substituted. Preserve the original archive for original file modes.

`DISTRIBUTION_NOTICE.txt` preserves the MPL grant and the additional AGPL route for a qualifying larger messaging work. Read `docs/release/source-closure/PG_UUIDV7_ASSESSMENT.md` and `.json` from the source tree for the reasoning and limits. The captured API/PGlite manifests, lockfile, DB import and upstream build script show the actual dependency context, rather than claiming that EndToEnd currently enables the optional extension.

Validate without network access from the source tree root:

```sh
node scripts/release-mpl-pg-uuidv7-check.mjs --root .
```

The validator checks exact inputs and retained notices. It does not certify law, prove reproduction of the extension binary or authorize publication. This supplement must travel with the PGlite source directory and original extension archive. It is not the complete PGlite or EndToEnd runnable release.
