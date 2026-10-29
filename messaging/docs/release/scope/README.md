# Frozen scope for the reusable messaging release

The owner authorized steps 1–3 of the October 25 completion plan. The next broader release is identified as **0.2.0** for preparation; no runnable 0.2.0 artifact or publication is claimed by this freeze. Existing workspace versions and grants are preserved until the relevant implementation/release steps.

`RELEASE_SCOPE.json` defines every current workspace and its runtime/build dependency edges. Seven messaging workspaces are intended for the public AGPL subsystem; protocol/client remain MIT. The current full EndToEnd frontend is a consumer whose existing AGPL declaration remains intact. A usable public reference application and any different concrete frontend grant are implementation/assessment work in steps 4–6. No unrelated Choice or other project source is included.

`FEATURE_SCOPE.json` allocates all 21 existing operations and 16 browser feature areas to their owners. `FEATURE_MATRIX.md` remains the behavior specification. The mapping does not imply that a new expanded candidate has passed acceptance.

`WORKSPACE_BASELINE.json` hashes 152 application/configuration/source inputs at this checkpoint, including the original baseline and the accepted ten-step plan. `PROTECTED_ARTIFACTS.json` hashes 62 original and candidate 2 archives, manifests, receipts and logs. Generated source-closure evidence is separately inventoried, avoiding a self-referential manifest. Future source changes require a new explained checkpoint, not rewriting this one.

Private files and installed/generated outputs are skipped before reading. No existing credentials, databases, vaults or private project history were acquired. The source model is a complete versioned snapshot and required notices; it does not require publishing private Git history or user data.

The baseline supports the already used Windows/Node/browser environment. Broader supported deployment claims need the standalone system and acceptance in steps 4 and 7. Reuse initially means separate project deployments with one device per account and one vault writer. Federation, shared inboxes and concurrent cross-project account use remain separate features.

Verify without changing the freeze:

```text
node scripts/release-scope.mjs --evidence-root <directory-containing-original-and-candidate-2-artifacts>
```

This compares actual files, feature allocations, module graph and historical artifacts with the frozen records. It does not approve publication or decide the frontend licensing boundary.
