# EndToEnd agent 0.1.0 local release checklist

**Historical candidate scope:** the [current ten-step AGPL MVP plan](AGPL_MVP_TEN_STEP_PLAN.md) replaces this narrow release target and its mandatory external-review policy for future work. The checklist below records the earlier candidate's process; its frozen evidence is preserved. The live audit script still implements those earlier review gates until the new plan's step 9 updates it. No licensing decision or publication approval is supplied by this pointer.

The approved implementation scope ends at an independently packaged local release candidate and EndToEnd using it successfully. Hosted deployment and Choice migration are later work. Original repository history stays private. No old device data is acquired or migrated; new-data durability remains mandatory.

1. Freeze original commit/hashes and operation/UI behavior in BASELINE.json and FEATURE_MATRIX.md. Preserve the original source and source declarations.
2. Finish protocol/core/client separation, including the browser trusted controls and authenticated local runner; MIT applies only to newly authored protocol/transport code. Record every remaining dependency edge.
3. Run existing and new security/durability/permission tests. Record actual commands, current revision and passing/failing evidence. Historical test counts do not certify the new split.
4. Demonstrate independent use with a source-included reference client and independent relay fixture. Demonstrate the full EndToEnd consumer has no crypto/session/agent implementation in its imports or browser output.
5. Generate a new allowlisted source workspace. It includes all actual core/dependency/build/install/interface inputs and excludes private product/data/history. An incomplete package is a failed candidate, not a smaller successful release.
6. Rebuild both Node and browser WASM from Rust and locked vendored sources in a new directory without existing WASM or private sibling source. Then build the standalone browser agent and run cryptographic interoperability. Record tool versions/output hashes. No prebuilt fallback is allowed.
7. Review actual source manifests, dependency notices and preferred forms; record qualified ownership/boundary review against that exact manifest. A successful build is engineering evidence only.
8. Review paths: favorable review plus ownership evidence allows preparing the exact publication request; unfavorable/uncertain review halts publication for further refactoring. Expanding public scope or changing consumer grants requires a new owner decision. Existing licenses remain intact. Preparing this work does not authorize engaging paid counsel or sending material externally.
9. Produce a versioned source archive/runtime index and verify source availability through a local loopback port-zero server. UI/CLI source notices must identify the exact release. Keep source accessible for each artifact version and retain rollback/provenance receipts.
10. Obtain approval of the exact source/runtime manifest before external publication. Without the outstanding rights/boundary/publication approvals, report a local release candidate with blocked publication; never report a public release or license certification. EndToEnd integration acceptance and release-review status are separate results.

## Local commands

`node scripts/release-baseline.mjs` records only the pinned original Git source; it avoids credential/example-secret files.

`node scripts/release-audit.mjs` validates source roles/licenses and reports unresolved review gates without modifying approvals.

After a candidate is frozen, attach the actual review/owner decision as a separate external JSON record with the fields in REVIEW_DECISIONS.json and the candidate's exact manifest hash. Do not edit the frozen source archive to insert its own approval hash. `node scripts/release-audit.mjs <extracted-source-directory> --review <external-review-record.json>` compares the actual manifest bytes with that reviewed identity. Any source change requires a new manifest and review of the changed scope. A nonempty reviewer reference and a favorable review are separate requirements from engineering tests. This command does not publish or engage a reviewer.

`node scripts/release-source.mjs --dry-run --out <new-directory>` prepares, vendors and packages the allowlisted source candidate. It never publishes. Use `--build` to run the source-only crypto/browser build and crypto tests after isolated dependency installation. The output directory must not exist.

`node scripts/release-availability.mjs <release-index.json>` verifies checksums and downloads over an ephemeral loopback socket, then closes it. `--serve` leaves that local socket running for inspection.

`node scripts/release-reproduce-crypto.mjs <built-source-directory> <new-isolated-directory>` rebuilds only copied Rust/vendor inputs in a relocated directory and compares every generated Node/web WASM/glue file exactly. The pinned compiler uses deterministic /source path remapping and SOURCE_DATE_EPOCH; a mismatch remains a failed reproducibility gate, even if functional crypto tests pass.

Local scripts write only requested release/work directories. They do not read environment/credential files, databases or vaults, change repository visibility, deploy services, install globally or publish artifacts.
