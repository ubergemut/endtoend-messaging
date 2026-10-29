# Agent candidate notices and modification record

EndToEnd reusable messaging 0.2.0. Agent, crypto and session code: AGPL-3.0-only; see the complete LICENSE. New protocol and transport client: MIT only as identified in their package LICENSE files. Third-party code retains its own copyright/license notices in the supplied source.

Original EndToEnd source baseline: private project commit `f8740398a249539d9bf1212a0fa8abfcd25bcaac`. The original repository remains private; this candidate contains a selected source snapshot and no Git history. This statement describes provenance, not a new grant over someone else's material.

Modified October 23–24, 2026: extracted the independently runnable browser/local agent, added the versioned protocol and trusted controls, strengthened delivery/persistence/isolation, and converted the product/adapters to protocol consumers. Current exact files/hashes are identified by SOURCE_MANIFEST.json; release-specific runtime/source identities are identified by RELEASE_INDEX.json outside the source archive.

Modified October 24–25, 2026: excluded installed dependencies at every workspace depth, added source-inventory regression checks, supplied missing pinned third-party license documents and runtime notice coverage, and disabled the optional Vite module-preload polyfill. The corrected local candidate supersedes the original packaging candidate; the earlier archive is retained as rejected evidence.

Uses libsignal v0.104.0 (`257105c55a7389ca6b1e85185e2769465e6729f1`) and SparsePostQuantumRatchet v1.6.0 (`06959b4708f9b7b1e94d0f8cc835f3958c077e94`). Their required source and original notices are vendored under dependencies/cargo. Signal's README states that use outside Signal is unsupported. No Signal service interoperability or endorsement is claimed.

Both source and runtime packages include `dependencies/cargo-notices/INDEX.json`, preserved per-dependency license/copyright notices, NPM tool notices and pinned upstream notices. Supplemental MPL-2.0 and Apache-2.0 documents, their upstream provenance and exact dependency mappings are in `docs/release/third-party`. These documents retain the declared third-party licenses and do not convert them to first-party AGPL or MIT grants. Vendored upstream test/example binary resources remain unmodified; generated EndToEnd WASM and installed dependencies are excluded from the source archive.

There is no warranty to the extent permitted by the applicable licenses. Recipients retain the modification and redistribution rights stated by those licenses. The source offer does not contain user accounts, messages, private keys, device secrets or production configuration.

Modified October 25–28, 2026: expanded the standalone public product to the persistent relay, schemas/migrations, service adapters and reference UI; stabilized the MIT integration contracts; added persistent delivery/recovery safeguards and version-specific source/notice delivery. The full original frontend remains AGPL and has its own matching source offer. The independent desk and SDK retain their MIT grants.

This is a local unpublished candidate. First-party rights were confirmed on October 24. The current ten-step plan requires an evidence-supported internal release assessment and owner approval of exact publication manifests; an external-review certificate is not mandatory. Historical candidate-2 review records retain their original status. Source/build/offer tests do not authorize publication or decide the licensing of a future private integration.
