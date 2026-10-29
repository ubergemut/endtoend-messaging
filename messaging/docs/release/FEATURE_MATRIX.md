# EndToEnd 0.1.0 preservation and acceptance matrix

Baseline: original private EndToEnd commit `f8740398a249539d9bf1212a0fa8abfcd25bcaac`. Source hashes are in BASELINE.json. The extraction retains every existing product function, even when it is outside the source archive. A row is a requirement, not a passing test. Test receipts must name the current revision and scenario; historical receipts do not close these rows.

The owner reports no original device data needing migration. We therefore do not acquire, migrate, inspect or delete existing local vaults/databases. This changes the old-data migration requirement only. Committed messages, encrypted attachments, pending ciphertext and acknowledgements must survive supported reload/interruption flows. The original UI's unsent main/thread drafts and staged files are in-session React state; preserve their supported in-session navigation behavior, without claiming reload-persistent draft storage that the baseline did not implement. Choice deployment/migration is later work.

## The 21 existing headless operations

All retain their public names and HTTP/MCP/GraphQL/CLI behavior through the MIT client. The local agent owns encryption, secrets, persistence and trust state.

| Operation | Preserved behavior and required check |
| --- | --- |
| status | Locked/unlocked readiness, account/session context and pending trust information; no raw store/key leakage |
| unlock | Existing login/registration semantics; wrong secret fails closed; replacing an existing device requires explicit trusted confirmation |
| sync | Ciphertext receive/decrypt and durable receive acknowledgements; no message loss on failure or reload |
| friends | Accepted friends and verification display bound to the current identity |
| requests | Incoming/outgoing pending requests; notes decrypted only on the user's device |
| requestFriend | Sealed optional note; valid target and authorization |
| respondRequest | Accept/decline/cancel retain validation and server authorization |
| block | Block takes effect for subsequent key/envelope/media access |
| unfriend | Relationship removal, access rotation and local session cleanup |
| chats | Direct/group lists, preview and unseen counts including thread replies |
| messages | Local plaintext views, direct/group filters, bounded wire response; raw vault omitted |
| focus | Newest unseen target with parent thread identity |
| markSeen | Local seen-state durability and corresponding badge changes |
| send | Direct text, replies and disappearing timer; exact ciphertext/outbox committed before attempt |
| sendGroup | Sender-key messages/replies/timers with authoritative membership/epoch and authenticated displayed sender |
| sendFile | Encrypted attachment bytes, filename/type/caption rendered locally; exact downloaded byte equality |
| createGroup | Selected accepted friends, name and encrypted sender-key setup |
| groups | Current authorized groups and membership view |
| safetyNumber | Matching displayed safety numbers for both synthetic peers |
| trustIdentity | Changed identity blocks sending until explicit confirmation; accepting change clears prior verification |
| markVerified | Records only the identity whose safety number was explicitly compared |

## Existing browser product behavior beyond the catalog

| Area | Behavior that remains in EndToEnd and its acceptance check |
| --- | --- |
| Account flow | Handle lookup, sign-in, account creation, logout, account switch and stay-signed-in choices |
| Trusted device flow | Device-secret creation/display/save acknowledgement, wrong-secret refusal, explicit replacement, lock and revocation |
| Single writer | Simultaneous same-vault tab/process refuses a second writer; interrupted owner releases or expires safely |
| Conversation navigation | Select direct/group chat, recent previews, conversation/thread filtering used by those views and stable selection after sync. The baseline has no separate conversation-search/filter control; its `search` state is the contact-handle input. |
| Replies | Inline and full thread views, parent navigation and reply-specific unseen state |
| Scroll/focus | First-unseen and bottom jumps, message spotlight and sensible arrival behavior |
| Composition | In-session main/thread drafts and staged attachments across supported navigation, multiple attachments, captions and disappearing timer. Reload/logout/lock do not promise retention of unsent plaintext drafts or browser File objects; committed agent outbox state has separate durable-retry requirements. |
| Group membership | Add member, remove member, leave group, key rotation and removed-member refusal; these require extra protocol commands beyond the 21-operation catalog |
| Safety | Display current safety number, explicit verification and visible changed-identity refusal |
| Media | Image/video/audio/file presentation, correct filenames/MIME and authenticated attachment downloads |
| Delivery | Live/sync updates, read/delivery status, reconnect and exact retry after an ambiguous response |
| Notifications | In-app notices, notification permission/dismissal, notification click opening correct chat/thread |
| Appearance | Existing themes/styles, appearance selection, responsive desktop/mobile and readable input contrast |
| Guides/site | Existing product pages, guide images and prose remain product content; source links must identify the new agent release accurately |
| Server sample | Ciphertext sample remains available as a bounded public message field; no secret/internal-state field is added to support it |
| Accessibility/errors | Existing keyboard/form labels, visible readiness/errors and clear trusted-agent-window closure/unlock handling |

## Security and release gates

Require independent synthetic direct/group/file interoperability; one writer/device; account/application/capability isolation; origin/source/nonce handshake; revocation on channel closure/logout; encrypted persistence; exact retry after lost response and reload; group membership rotation; changed-identity refusal; wrong-secret refusal; attachment byte equality; all existing API/headless/session/crypto regressions; private-consumer bundle scans; a source-only Rust-to-both-WASM build; a reference client/relay that imports no private product; complete reviewed notices/source offer; and local source-download availability.

MVP limits remain explicit: one device per account, one active vault writer, no new multi-device/history recovery, no silently enabled backups/admin recovery, no Android/Choice/hosted production acceptance claim. Completion of this component does not close Choice's full level 7 or level 8.
