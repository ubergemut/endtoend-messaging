# EndToEnd headless

This package is the middle layer for EndToEnd. It is one device session: it holds the private key vault, encrypts and decrypts on this machine, and talks to the existing relay. The relay still stores handles, the friend graph, device ids, public prekeys, access keys, and ciphertext. It does not receive message text, group text, filenames, media types, or friend-request notes.

The browser app is a separate device. One account has one key bundle. Do not unlock a handle here if that handle already unlocked in a browser, unless you mean to replace that device.

Three attachments sit on the same operation list in `src/catalog.ts`:

1. Copy this folder into another project and call it directly.
2. Speak MCP on stdin and stdout.
3. Post GraphQL.

Direct HTTP is part of attachment 1. It is the same operations, for a process that cannot import the module.

## Copy this folder and call it

Copy both folders and keep them siblings:

```
packages/crypto
packages/headless
```

`packages/crypto/pkg-node` must be the built WASM package. Do not copy `packages/crypto/target`. From `packages/headless`:

```
yarn install
```

The dependency `@e2ee/crypto` points at `file:../crypto`. Leave that path alone.

Set:

```
ENDTOEND_RELAY=http://127.0.0.1:52588
ENDTOEND_VAULT=./secrets/endtoend-vault.json
ENDTOEND_HANDLE=toolbot
ENDTOEND_PASSWORD=toolbot
ENDTOEND_DEVICE_KEY=
```

`ENDTOEND_DEVICE_KEY` is a 32-byte base64 secret for this vault file. It is not the account password, and it is not written into the vault. A wrong key fails closed and does not publish a new key bundle. Generate one with `node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"`.

Read the relay port from the EndToEnd repo's `.local-ports.json` (`api`). Do not assume 8788 or 5173. The vault file is the device. Put it outside git.

`yarn usage` from this folder prints the operation list and exits.

### In process

```ts
import { openHeadless } from '@e2ee/headless'

const endtoend = openHeadless({
  relay: process.env.ENDTOEND_RELAY!,
  vaultPath: process.env.ENDTOEND_VAULT!,
})

await endtoend.unlock({ handle: 'toolbot', password: process.env.ENDTOEND_PASSWORD! })
await endtoend.requestFriend('test2', 'meet by the cedar')
const sent = await endtoend.send({ handle: 'test2', body: 'the lantern is lit' })
const arrived = await endtoend.sync()
const focus = await endtoend.focus({ handle: 'test2' })
if (focus.threadId) {
  // The new message is a reply. Open that thread in the host UI.
}
await endtoend.markSeen(arrived.messages.map((message) => message.id))
```

Run TypeScript with `tsx`. The package entry is `src/index.ts`.

`unlock` creates the account when the handle is new, generates keys, and publishes only the public bundle. When the handle already exists, `unlock` logs in and uses the vault file. If the handle exists and this vault is empty, `unlock` throws `replace-keys`. Pass `replaceKeys: true` only when this process should become the only device. That overwrites the published bundle and breaks the previous device.

### One-shot command

From `packages/headless`, with the environment above:

```
yarn call -- sync
yarn call -- send --handle test2 --body "the lantern is lit" --replyTo <message-id>
yarn call -- focus --handle test2
```

The process prints JSON and exits.

### HTTP

```
yarn http
```

The process prints `http://127.0.0.1:<port>` and stays up until SIGINT or SIGTERM, then exits. It binds to loopback. If `ENDTOEND_GATE` is set, every route except `GET /health` requires `Authorization: Bearer <gate>`.

```
GET  /health
GET  /operations
GET  /status
POST /unlock          { "handle", "password", "replaceKeys"? }
POST /sync
GET  /friends
GET  /requests
POST /requests        { "handle", "note"? }
POST /requests/respond { "id", "action": "accept" | "decline" | "cancel" }
POST /block           { "handle" }
POST /unfriend        { "handle" }
GET  /chats
GET  /messages?handle=test2
GET  /focus?handle=test2
POST /seen            { "ids": ["..."] }
POST /messages        { "handle", "body", "replyTo"?, "expiresInSeconds"? }
POST /groups
POST /groups/messages { "groupId", "body", "replyTo"? }
POST /files           { "handle"? , "groupId"?, "name", "mime", "base64", "body"? }
GET  /groups
GET  /safety?handle=test2
POST /trust           { "handle"? }
POST /verified        { "handle" }
```

`GET /operations` is the live list. Prefer it over a hardcoded table if this file and the code disagree.

A message result includes `serverCiphertext`, a prefix of the ciphertext the relay stored. The plaintext is the `body` field, and it must not appear inside `serverCiphertext`.

## MCP

```
ENDTOEND_RELAY=... ENDTOEND_VAULT=... ENDTOEND_HANDLE=... ENDTOEND_PASSWORD=... yarn mcp
```

Stdin and stdout are JSON-RPC. Do not write logs to stdout. The process exits when stdin closes.

Cursor MCP config, from the folder that contains `packages/headless`:

```json
{
  "mcpServers": {
    "endtoend": {
      "command": "node",
      "args": ["--import", "tsx", "src/bin.ts", "mcp"],
      "cwd": "C:/Dev/EndToEnd/packages/headless",
      "env": {
        "ENDTOEND_RELAY": "http://127.0.0.1:52588",
        "ENDTOEND_VAULT": "C:/secrets/endtoend-vault.json",
        "ENDTOEND_HANDLE": "toolbot",
        "ENDTOEND_PASSWORD": "toolbot"
      }
    }
  }
}
```

Handshake:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"host","version":"0"}}}
```

Then send a notification with no `id`:

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

`tools/list` returns one tool per operation. `tools/call` arguments match the fields in the catalog. The tool result is a text content block of JSON.

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"send","arguments":{"handle":"test2","body":"the lantern is lit"}}}
```

Call `sync` before reading `messages` or `focus`. Call `markSeen` after the host has shown the messages. Call `trustIdentity` when `status.pendingTrustHandle` is set; sends stay blocked until then.

## GraphQL

```
yarn graphql
```

The process prints a loopback URL. `POST` a JSON body `{ "query", "variables"? }`. The same gate header applies as HTTP. Every operation is a field. Queries and mutations return a `JSON` scalar whose shape is the direct-call result.

```graphql
mutation Start($handle: String!, $password: String!) {
  unlock(handle: $handle, password: $password)
}
mutation Pull { sync }
query Inbox { chats }
query Thread($handle: String!) { focus(handle: $handle) }
mutation Say($handle: String!, $body: String!, $replyTo: String) {
  send(handle: $handle, body: $body, replyTo: $replyTo)
}
```

Example:

```
POST / HTTP/1.1
content-type: application/json

{ "query": "query { chats }" }
```

Field types:

| Kind | GraphQL | HTTP |
|---|---|---|
| string | String | JSON string or query parameter |
| int | Int | number |
| boolean | Boolean | true or "true" |
| stringList | [String!] | JSON array, or a comma-separated query value |

## What the host should do with a new message

`sync` returns new plaintext messages and does not mark them seen. `chats[].unseen` counts incoming messages the host has not marked, including replies inside threads.

`focus` returns the newest unseen message for that chat.

- `threadId` is null when that message is a normal chat message. Show it in the chat and mark it.
- `threadId` is the parent id when that message is a reply. Open that thread, show the message, then `markSeen`.

`serverCiphertext` is safe to display as proof of what the relay stored. Do not send `body`, filenames, or notes to any log that leaves the device.

## Errors

| code | meaning |
|---|---|
| locked | `unlock` has not succeeded on this vault |
| replace-keys | Refusing to publish a new bundle over an account that already has one, or the vault file belongs to someone else |
| untrusted | Their identity key changed. Call `trustIdentity` after comparing safety numbers |
| invalid | Bad handle, empty message, unknown friend |
| relay | The EndToEnd API could not be reached or rejected the call |

HTTP maps `locked` to 401, `invalid` and `replace-keys` to 400, `untrusted` to 409, and `relay` to 500. MCP puts the message in a JSON-RPC error. GraphQL puts it in `errors`.

## Account rules that are not optional

- Handles are `^[a-z0-9_]{3,32}$`.
- Passwords are at least 5 characters.
- A password does not restore keys. The vault file does. Lose the file and this device cannot read old sessions.
- Friend-request notes are sealed to the other identity key. `requests` returns the plaintext note for incoming requests only.
- Group text uses sender keys. The relay row has no sender column.
- Files are sealed with AES-256-GCM here. The relay stores ciphertext and no filename. The key travels inside the session message. Received bytes are written next to the vault, under `<vault-file>.blobs/`.
- Disappearing messages take `expiresInSeconds`. The relay deletes the ciphertext. This device hides the plaintext after that time.

## Tests

From the EndToEnd repo:

```
yarn test:headless
```

The adapter test checks that HTTP, MCP, and GraphQL expose the catalog. The roundtrip starts a temporary relay, creates two vaults, and checks that each side reads plaintext while the posted envelope bodies do not contain it.
