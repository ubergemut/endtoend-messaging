# Threat model

EndToEnd hides message contents from the server and from anyone who is not a device in the conversation. It does not hide the social graph.

## Secret

- Message text, group message text, attachment bytes, filenames, and the optional friend-request note.
- Identity private keys, signed prekey private keys, Kyber prekey private keys, one-time prekey private keys, session state, and sender-key state.
- The device secret that wraps the local data key, and the binding between a safety number and one identity key.

Private keys are created on the device with libsignal. The local vault and decrypted attachments are encrypted with a data key that is wrapped by a device secret. The account password is not that secret, and changing the password does not rotate the data key. The upload bundle contains only public keys and signatures.

## Visible to the server

- Account handles, display names, and password hashes.
- Who requested, accepted, declined, blocked, or removed whom.
- Device ids, public prekeys, and the unidentified access key used to authorize a send.
- That a ciphertext blob was queued for a device, when, and whether it belongs to a group id.
- Connection IP addresses.

A stored envelope has no sender column. The sender identity is inside the libsignal ciphertext. The server accepts the send when the caller presents the recipient's access key. That key is public to the server and is only returned by the prekey API after friendship is accepted. Rotating it on block or unfriend stops the previous key.

## Not a guarantee

- A recipient can copy, screenshot, or forward plaintext. Disappearing messages delete the local copy and the server ciphertext when the timer fires. They do not reach into someone else's notes.
- The server can withhold or replay ciphertext. Replay of a session message is rejected by the ratchet. Replay of a still-valid sender-key iteration is limited by the sender-key chain.
- This build is one device per account. A copy of the locked vault is ciphertext. Opening it requires the device secret, which is not stored in IndexedDB or the vault file. Stay signed in can keep a copy of that secret in this browser's local storage until the chosen period ends or you log out. Anyone who can read that storage during the period can open the vault without typing the secret. A wrong secret does not create a new key bundle.
- Same-origin script can still read plaintext and keys while the app is unlocked. Logout drops the data key from memory. That does not protect an unlocked page from malicious script in the same origin.
- A dishonest relay can still mis-state group membership. Epochs are not MLS. They stop a removed member from decrypting later messages sent by members who have moved to the new epoch.
- A crash after the local outbox commit retries the original ciphertext. The relay treats the same recipient and queue tag as one delivery. A crash after a message is saved locally acknowledges that envelope again and does not append a second plaintext copy.
- One writer owns a vault. A second tab on the same account is unsupported, and a stale save is refused.
- Traffic is plaintext HTTP on localhost. A deployed server needs TLS. TLS protects the pipe. It does not replace the message cipher.
- Friend-request notes use a one-shot seal (ephemeral X25519, HKDF, AES-256-GCM) to the recipient identity key because no session exists yet. Conversation messages use libsignal PQXDH and the Double Ratchet. Group messages use libsignal sender keys.
- Safety numbers detect an identity key change. Verification is stored for one identity key. Trusting a replacement clears that binding until the new number is compared and verified on its own. A safety number does not prove a person is who they claim until the two of you compare it on a channel you already trust.
