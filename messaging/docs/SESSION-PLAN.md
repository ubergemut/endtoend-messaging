# Shared session

v1 is commit `90da894` on `main`. This plan starts after that snapshot.

Progress: steps 1–3 are in the working tree and not committed. Headless tests pass. The browser send and receive path uses the shared engine. Step 4, the dedicated MCP account, is still open.

The browser and the headless tool each carry a copy of unlock, friends, encrypt, decrypt, threads, and groups. One session package becomes the only copy. The browser and the headless process are two adapters around it.

## Rules that stay

- One account, one key bundle. The browser vault and a headless vault file are two devices. Do not attach the MCP server to `test1` or `test2`.
- The relay still sees ciphertext only.
- Private keys stay in IndexedDB for the browser and in the vault file for headless.

## Steps

1. Move the session engine into `packages/session`. Signal, vault load/save, and blob load/save are injected. No Node or browser imports inside the engine.
2. `packages/headless` becomes the file-vault adapter. `yarn test:headless` must stay green.
3. The browser adapter opens the same engine with IndexedDB. `App.tsx` calls it for unlock, sync, send, friends, and groups, and deletes its private copy of that protocol.
4. Register the MCP server with a new handle and a new vault file. Send one message from an agent. Read the plaintext in the app. Confirm the posted envelope does not contain that plaintext.

## Done when

- `packages/session` is the only implementation of the protocol.
- Headless roundtrip still passes.
- The open chat in the browser sends and receives through that package.
- A dedicated MCP account delivers one message into that chat.

## Not in this pass

- A second transport.
- Replacing the key bundle of an account that already has a browser vault.
- Cursor-hosted remote. The Origin CLI does not run on native Windows. The local `main` commit is the v1 lock.
