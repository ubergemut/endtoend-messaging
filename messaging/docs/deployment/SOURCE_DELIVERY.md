# Deliver exact source and notices

This guide implements the [source delivery/retention policy](../release/STEP_8_DISTRIBUTION_POLICY.md). It applies to the public messaging service, all its downloadable executables/browser/WASM files and the actual frontend presented to users. Read the component grants in `LICENSING.md`; the original full frontend is AGPL, while the independently authored desk and protocol/client SDK have their marked MIT grants. Do not infer another host's licensing from the sample clients.

## Prepare the delivery directory

Keep the exact release's `source-disclosure.json` next to every basename it references. Its schema version is `1`. Each component has `id`, `version`, `license`, `artifacts`, `source` and `notices`. File records contain `filename`, `bytes` and `sha256`; a source record also contains `manifestFilename` and `manifestSha256`. Retain the source manifest itself. Do not edit an archive, notice or manifest after recording its hash.

The core source must contain the actual agent/relay/adapters, trusted/reference UI, Node/web crypto inputs, interfaces, schema/migrations, run/build/install scripts, templates and dependency/preferred forms. Full-frontend source is a separate component: include the original assets/documentation, the exact SDK and build inputs. A link to the core repository, a generic latest branch, an empty wrapper or a lockfile alone is not this delivery.

Launch the standalone core from its installed runtime directory:

```text
node --import tsx scripts/serve-messaging.mjs --data-dir <explicit-persistent-directory> --source-disclosure <delivery-directory>/source-disclosure.json --release-mode true
```

The separate browser-consumer runtime provides a release launcher for either presentation:

```text
node scripts/run-sdk-consumer.mjs --component endtoend-web --disclosure <delivery-directory>/source-disclosure.json --agent <trusted-agent-origin> --relay <relay-origin>
```

Choose `desk-client` instead of `endtoend-web` for the MIT desk. These launchers print local listening addresses; configuring a public proxy is a separate deployment action. The consumer launcher always requires source-complete release mode. For direct local agent/headless entry points, set `ENDTOEND_RELEASE_MODE=1` and `ENDTOEND_SOURCE_DISCLOSURE` to the same exact catalog; their `--help` describes source discovery. Use the relevant current executable's help for all account/host-grant options.

Local developer mode is for isolated fixtures; it must not be used to serve an external beta while omitting source. A release launcher must refuse missing or altered required files before listening. Keep production state and credentials outside the delivery directory.

## Route the offer through the real host

Publish these routes as ordinary unauthenticated `GET` and `HEAD` resources:

- `/source-disclosure.json`: the current catalog.
- `/releases/<version>/disclosure.json`: the version-specific catalog.
- `/releases/<version>/<filename>`: only the catalog's named source, manifest, notice and artifact files.
- `/release.json`: presentation-specific metadata used to display source and license opportunities.

Preserve the trusted/reference component's own source/notice display and the host's visible messaging source/notice entry. Signed-out users must be able to reach these resources. Do not send source requests through grant handlers, account login, an NDA, payment or a source-request queue. If a different static download origin is used, maintain equivalent copying and clear nearby directions; verify the actual destination, not just the existence of an anchor.

Do not rewrite a previous version's routes to the latest source. Keep browser-cache/CDN/rollback versions mapped to their own files. Deploy new immutable files/catalog first, verify them, and only then expose matching application code. A service rollback must change its source mapping with the running code while preserving the newer version's retained delivery.

Trusted windows may be separate from a host's presentation. That does not allow the host to hide the only source opportunity: include an accessible source/license entry where a messaging user will encounter it, even before authentication. For an independently licensed host, identify the messaging component's source separately from that host's own grant. For an AGPL-derived host frontend, include that frontend's source as well.

Adapters must expose their source/license metadata through normal help/discovery: CLI help/notice commands, HTTP/GraphQL metadata and MCP discovery as implemented by the released adapter. Preserve structured stdout and JSON-RPC framing. Connect a source URL from the actual adapter's disclosure to the version being run; do not advertise a demo version's archive for modified adapter code.

## Covered-rights clause for service/product terms

Use this scope statement with the delivered component notices:

> Open-source components are licensed under the accompanying component licenses, including GNU AGPL version 3 and MIT where identified. Those licenses govern the rights to use, copy, modify and redistribute the covered software. No service or product term adds confidentiality, source-access, modification, redistribution, field-of-use or other restrictions to rights granted by those component licenses. If terms conflict, the applicable component license controls for that software. Separate terms for independently licensed host material apply only to that identified material. User account credentials and personal data are separate from the software source offer.

This is a project operating clause, not a substitute for the full license texts or an assessment of unexamined proprietary code. Service account/access rules and optional paid support must not be presented as a fee to exercise covered software rights. Preserve each component's existing notices, warranty disclaimer and granted rights; do not relabel the AGPL full frontend MIT. No broader private-software license is created by this guide.

## Check as a clean user

Before the first applicable external use, run the release's source-delivery acceptance through the actual planned host/proxy configuration:

1. Open the trusted UI, reference UI and each delivered frontend while signed out. Follow their visible source/license/notices entries. Exercise adapter help/discovery using a new synthetic configuration and no account authority.
2. Fetch the version-specific catalog and each component's source, manifest and notices without cookies, bearer tokens or approval. Check both `GET` bytes and `HEAD` metadata. Compare byte lengths and SHA-256 with the catalog and release assessment. Confirm browser/WASM and downloadable runtime mappings cover the exact versions being served.
3. Extract each source into a new directory. Verify every manifest member/hash and completeness audits, then use its documented frozen install/build instructions and declared public toolchain. Read the complete dependency/license files and confirm source includes the build/interface/schema/configuration inputs, rather than just compiled outputs. Distinguish exact file correspondence from the separately recorded reproducibility claims.
4. Check a real frontend delivery against its own source; obtaining the core archive alone does not pass the AGPL full-frontend check. Confirm MIT desk/SDK notices are preserved too.
5. With a disposable copy, remove/tamper a required source, manifest or notice and verify release startup fails. Check unlisted filenames/traversal do not expose unrelated files, structured adapter responses remain parseable, and source access persists after signout/revocation. Recheck through any final proxy/CDN or embedding path.

Retain the actual command/output evidence, catalog and archive hashes, membership checks, component/bundle bindings and limitations. Keep these exact immutable records and backups under the policy. The release owner must handle a reported missing/mismatched source offer before continuing affected delivery; preserve earlier valid sources during correction. Nothing in a local acceptance result authorizes an external publication or deployment.
