# EndToEnd reusable messaging 0.2.0

This public stack contains the real persistent relay, device crypto/session and
trusted controls, HTTP/GraphQL/MCP/CLI adapters, MIT protocol/client, and a usable
reference browser. It builds and runs without the separately packaged full EndToEnd frontend or
another host project's source. The messaging implementation and reference/trusted
UI are AGPL-3.0-only; the protocol/client retain MIT. Dependencies retain their
original terms. See `LICENSING.md`, `DEPENDENCIES.json` and the supplied notices.

This is a local unpublished release candidate. Step 7 proved a fresh source
build of the complete stack and exact runtime acceptance; step 8 adds verified
source and notice delivery. Read the exact paired manifests and disclosure
catalog for the artifact being used. Final release assessment, owner approval
and external publication remain separate gates.

## Install the source or runtime

Use Node **22.13.0** and Yarn **1.22.22**. Extract to a new directory, then run:

```text
yarn install --frozen-lockfile --ignore-scripts --non-interactive
```

The archive contains no installed `node_modules`, secrets or account databases.
This installation fetches the exact public dependencies in its isolated lock;
it does not need any private checkout. Dependency lifecycle scripts remain
disabled. The original pinned dependency source/notices are supplied in the
paired source archive, including the PGlite PostgreSQL runtime and HACL inputs.

The **source** archive additionally needs the validated Rust/WASM toolchain in
`docs/release/TOOLCHAIN.json` to generate its crypto outputs:

```text
yarn build:crypto
yarn build
yarn test
yarn test:package
yarn audit:preferred
```

`build:crypto` performs locked, offline Cargo builds for Node and browser using
`dependencies/cargo`; it refuses an existing crypto output directory. Start
from a fresh source extraction for that command. Install the declared public
Rust target, wasm-pack, protoc and platform C toolchain first. The recorded
validated platform is Windows x86_64 GNU; other platforms need their own
recorded tool validation. F*/KaRaMeL/PostgreSQL toolchains are supplied or
described for dependency regeneration, but are not required to compile the
already editable Rust or run the packaged PGlite runtime.

The **runtime** archive already contains Node/browser crypto and both browser
builds. After its frozen dependency installation, run it directly. Source-build
and source-test commands belong to a separate fresh extraction of the source
archive; the runtime package deliberately contains only its run/adapter commands.

## Start with explicit persistent state

Keep the source/runtime archives, exact manifests, license/notices and
`source-disclosure.json` together outside the runtime checkout. Choose a new persistent state directory outside either
checkout; do not use an existing personal database or vault for a rehearsal.

```text
node --import tsx scripts/serve-messaging.mjs --data-dir <new-persistent-directory> --source-disclosure <artifact-directory>/source-disclosure.json --release-mode true
```

The launcher prints separate loopback URLs for the public reference browser,
trusted browser agent and relay. It binds ephemeral port 0 and records the
deployment identity in the explicitly chosen state directory. It never selects
the old development database implicitly. Open the printed reference URL to
create synthetic accounts and exchange messages, groups and files. Device-secret
entry and trust approval occur in the trusted component.

State is persistent across an orderly restart with the same directory. One
process owns the directory at a time. Vaults and user/device secrets remain
outside this source offer and must be managed as sensitive application data.
For a persistent browser deployment, configure stable, distinct HTTPS reference
and agent origins using the launcher's origin options and the deployment guide;
changing loopback ports changes browser origins and stored bindings. The local
checkpoint does not provision a public reverse proxy or publish a service.

The validated disclosure catalog makes exact matching source and notices
available before login at `/source-disclosure.json` and versioned download URLs.
Release mode refuses missing or mismatched inputs. Follow `SOURCE_DELIVERY.md`
and `docs/release/STEP_8_DISTRIBUTION_POLICY.md` for the selected direct-download
route, source retention, adapter configuration and host terms. A source offer
for the core does not replace the full AGPL frontend's own source offer. A local
packaging check is not authorization for an external beta or production launch.

## Adapters and recovery

`yarn headless:help` lists all operations and adapter environment variables.
The HTTP, GraphQL, MCP and CLI adapters use the independent local agent through
the published client. Configure an agent executable/capability explicitly as
described in `packages/headless/README.md`; account passwords and device secrets
are different inputs. Never put real credentials into a deployment template or
committed command file.

Read the supplied storage/backup/recovery deployment instructions before moving
state. `scripts/messaging-storage.mjs` provides the documented relay backup
operation. An application rollback must preserve current vault/ratchet, pending
send and acknowledgement state or refuse recovery. Restoring an old vault after
cryptographic state has advanced is not a safe application rollback.

The source includes `scripts/test-messaging-standalone.mjs` for an isolated,
synthetic persistent-relay/direct/group/file/restart rehearsal. The current
checkpoint receipts record the actual tested commands and their limits; the
full step-7 feature/durability acceptance is recorded in the release evidence.
Step-8 receipts separately verify user-facing source delivery for each
candidate; neither is an approval to publish.
