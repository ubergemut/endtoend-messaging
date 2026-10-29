# Creating the standalone messaging checkpoint

`scripts/package-messaging.mjs` is the new 0.2.0 pipeline. It does not modify
the older device-agent pipeline or any frozen release/steps-1–3 artifact.
Always choose a new output directory outside the source checkout.

```text
node scripts/package-messaging.mjs --out <new-output> --closure-source <verified-source-closure>/verified-extraction --cargo-source <verified-cargo-source-root> --build --reuse-crypto <verified-runtime-root> --crypto-proof <crypto-build-proof.json>
```

The input source-closure manifest is verified before copying. The 813-file
steps-1–3 packet supplies authoritative complete upstream archives plus selected
inspection inputs; expanded upstream source trees are not substituted for the
complete archives. The exact Cargo lock and every vendored source checksum are
checked. All required inputs are copied into the new public workspace. No path
to a private checkout is required when a user installs, builds or runs the
resulting source/runtime.

The public workspace contains crypto/session/agent/protocol/client/contract/
headless packages, the real `apps/api`, trusted browser and public reference
browser. An explicit allowlist excludes `apps/web`, user state, `.env` files,
repository history and generated/installed product outputs. An independent
Yarn install prunes the original resolutions in this copied workspace, then a
frozen installation checks the resulting public lock. New or changed dependency
versions without retained source/notice evidence fail the package.

The original frozen source-closure inventory and lock are preserved as input
provenance under `docs/release/scope/STEP_1_3_INPUT_*`. A derived public inventory
records the actual public lock/workspaces, selected assessed package versions,
current browser module graphs/assets and unchanged dependency source hashes.
This is a new artifact, not a mutation or recertification of the original packet.

`--reuse-crypto` is an explicit checkpoint option. Every current Rust/TS/Cargo
input and all ten Node/browser output hashes must match the supplied real source
build proof. The source archive still excludes those product outputs, and its
repeatable clean build uses `yarn build:crypto`. Reuse is not labeled a new clean
Rust build for the broader release. To perform that build during packaging,
replace the reuse/proof options with `--build-crypto`; it uses the same supplied
source and never falls back to a previous WASM binary.

The pipeline builds both public browsers, tests crypto/API/agent/client/headless
from the copied public workspace, validates preferred-source/MPL inventories,
and preserves all Cargo/npm/PGlite component notices. It writes:

- `source/` and `endtoend-messaging-0.2.0-source.tar.gz` with a complete explicit
  `SOURCE_MANIFEST.json` and all required build/run/deploy inputs.
- `runtime/` and `endtoend-messaging-0.2.0-runtime.tar.gz` with editable Node
  runners, browser builds, crypto WASM, exact lock and notices. It contains no
  installed dependencies; its frozen install is part of fresh runtime acceptance.
- Paired `RELEASE_INDEX.json`, `RUNTIME_MANIFEST.json`, `BUILD_EVIDENCE.json`,
  `SHA256SUMS.txt` and command logs. The index points to the exact source hash.

Archives use an explicit file list checked against the manifest, preserving
upstream source directories named `dist` while excluding generated product
`dist` and nested installed tools. Pristine upstream source archives retain
their original distribution fixtures, including unrelated upstream WASM. These
are unexecuted archival material with preferred source and notices, not prebuilt
EndToEnd build inputs.

Extract both archives into separate fresh directories, verify all hashes and
manifest members, install with lifecycle scripts disabled, and run the public
launcher/restart acceptance there. The source is self-contained for ordinary
builds and execution; it includes the source-closure packaging helper should a
new local preferred-source packet be needed when preparing later archives.
No external publication, owner release approval or legal certification is
implied by this engineering checkpoint.
