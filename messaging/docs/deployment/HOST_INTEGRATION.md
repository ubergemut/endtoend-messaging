# Connect a host application through messaging contract v1

SDK 0.2.0 keeps wire version 1 and all 21 original operation names. Its 41 typed commands include contacts, direct/group messages, files, pending attempts, trusted identity decisions and lifecycle controls. Read the [SDK contract](../architecture/SDK_CONTRACT_V1.md) and [host identity contract](../architecture/HOST_IDENTITY_V1.md) for exact fields, errors and limits. The separate MIT SDK artifact includes source, JavaScript, declarations and both original MIT grants; its runtime imports only the MIT protocol package.

This guide applies to the step-5 source and SDK. The frozen step-4 runtime predates host exchange. Do not serve an old source index as the corresponding source for changed application code. Final expanded release/source offers remain later release steps.

## Configure the public messaging deployment

Generate an Ed25519 signing key in the host backend's protected environment. Configure only its public SPKI PEM in a separate public trust JSON file using the shape below; the placeholder must be replaced by a real public key. The issuer is a stable backend identity, not a browser origin. Audience is an exact opaque deployment identifier: nonblank, at most 256 characters, with no C0/DEL controls. Different projects use different deployments, audiences and vault paths.

```json
{"audience":"urn:messaging:project-a","issuers":[{"issuer":"project-a-login","keys":[{"keyId":"current","publicKey":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"}]}],"sessionTtlSeconds":3600,"assertionMaxAgeSeconds":120}
```

From the current source, install locked dependencies and build the SDK and both public browsers:

```text
yarn install --frozen-lockfile --ignore-scripts
yarn build:sdk
yarn build:agent
yarn build:reference
yarn serve:messaging --data-dir <new-directory-outside-source> --host-identity-config <public-trust.json> --caller-origins https://your-host.example
```

The managed launcher validates trust before creating state. It serves the real persistent relay and proxies `/messaging/v1/*` from its public reference/trusted origins. The additional caller list is an explicit trusted-window origin allowlist; caller origins are bare HTTPS origins except for loopback development. It does not authorize a person or replace their messaging token. Use stable, distinct reference/trusted HTTPS origins and the same browser profile to preserve browser device storage; configure those with `--reference-origin` and `--agent-origin` and a reverse proxy to the printed loopback sockets. The launcher does not provision external hosting.

## Exchange your own login for a messaging grant

After the host has authenticated a person and checked current messaging entitlement, its backend signs these claims. The subject comes from the host's authenticated stable user ID, not a browser-submitted account ID. This example uses Node standard cryptography; it neither imports nor executes the messaging engine.

```js
import {randomUUID, sign} from 'node:crypto'
import {RelayService} from '@e2ee/client/standalone'

const messaging = new RelayService(configuredRelayOrigin, {audience: configuredAudience})
const now = Math.floor(Date.now() / 1000)
const payload = Buffer.from(JSON.stringify({
  version: 1, keyId: configuredKeyId, issuer: configuredIssuer,
  subject: authenticatedUser.stableId, audience: configuredAudience,
  issuedAt: now, expiresAt: now + 60, nonce: randomUUID(), purpose: 'session'
}))
const assertion = payload.toString('base64url') + '.' +
  sign(null, payload, protectedHostPrivateKey).toString('base64url')
const grant = await messaging.exchange(assertion)
```

Return the grant only to that authenticated host session. Keep private signing keys on the backend; never expose them in assets or relay configuration. The messaging SDK omits cookies, rejects redirects and sends only the explicit assertion or messaging token to the configured relay origin. It never forwards your host password, OAuth token or business database model.

On the frontend, obtain the grant from your own authenticated backend. Pair with the trusted agent using the documented origin/source/nonce/capability handshake, then use its authorized `AgentClient`:

```js
const relay = new RelayService(configuredRelayOrigin, {audience: configuredAudience})
await agent.attach(relay.attachInput(grant))
await agent.requestUnlock()
// Device secret entry and identity approval occur in the trusted agent window.
const attemptId = crypto.randomUUID()
await agent.command('send', {handle: recipientHandle, body: text}, {
  operationId: attemptId, signal: abortController.signal
})
```

Node agents accept the same grant but keep a fixed relay and explicit vault/device-secret configuration. A host grant is not a device secret, a vault backup, a second-device enrollment or permission to replace an existing identity. No host integration may silently link an existing password account by matching a handle. Such migration needs its own explicit procedure; original password clients retain `/api/bootstrap`, while new scoped grants use `/messaging/v1/session`.

## Reconnect, cancellation, account switch and logout

Cancellation ends the caller's wait; an accepted send may still commit. Preserve its operation ID and exact content for retries. A fresh request gets a new request ID. Discovery and capabilities describe the live contract; current agents advertise no push events, so use snapshots/sync rather than assuming notifications. Do not infer operation support from package version alone.

After token expiry, obtain a newly authenticated host grant and attach it to the same current vault. Host identity mappings and device keys remain unchanged. Do not reset or restore stale ratchets to make login succeed. An account switch must clear the UI's plaintext and cancel/disconnect the old SDK connection before pairing the intended account. A vault owned by another account is refused; choose that account's own vault instead of reassigning it.

`RelayService.revoke(token)` revokes the current messaging credential. The host backend must also call `hostRevoke` with a fresh `purpose:'revoke'` assertion on host logout or loss of entitlement, and stop issuing new assertions. This revokes all that subject's sessions and blocks unused prelogout assertions through a persistent cutoff. A fresh login needs an assertion issued in a later second; synchronized clocks are required. Removing an issuer from configured trust invalidates its scoped sessions on subsequent requests; rotating a signing key alone stops new assertions from that key but does not revoke existing tokens.

Call `AgentClient.revoke()` and clear your own displayed data when host access ends. The device agent clears authorization on a detected expired/revoked bootstrap or authenticated 401. Already authenticated operations may finish; revocation never rewinds committed cryptographic state or erases previously delivered history. Ordinary group/contact permission refusals do not sign the whole account out. The public relay remains responsible for contact consent, blocking, membership, epochs and media permissions regardless of the host login model.

## Validation

`yarn test` includes wire, SDK lifecycle, service, replay/expiry/revocation, agent binding and migration tests. `yarn test:hosts` creates fresh synthetic email/password and staff-number/PIN host servers, three independent device agents and separate project audiences. It checks real direct/group/file messaging, restart/fresh-token reconnect, preserved vault identities, unsafe account-switch refusal and both logout paths. It never opens existing accounts or user stores.

This technical integration contract does not decide the license of an arbitrary frontend. Concrete frontend independence and grants are step 6; final source offers, release assessment and publication remain later steps.
