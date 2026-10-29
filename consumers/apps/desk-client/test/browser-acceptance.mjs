// SPDX-License-Identifier: MIT
// Browser acceptance helpers. The caller supplies Playwright-compatible pages and
// trusted-agent UI interaction; this module imports no application or engine code.
export const selectors = Object.freeze({
  handle: '#login-handle', password: '#login-password', displayName: '#display-name',
  login: '#login', register: '#register', connect: '#connect-agent', cancel: '#cancel-connect',
  desk: '#desk', status: '#connection-status', notice: '#notice',
  contactHandle: '#contact-handle', contactNote: '#contact-note', requestContact: '#request-contact',
  requests: '#requests', body: '#message-body', send: '#send', file: '#file-input', sendFile: '#send-file',
  transcript: '#transcript', roomName: '#room-name', roomMembers: '#room-members', createRoom: '#create-room',
  safety: '#safety-number', safetyValue: '#safety-value', verify: '#verify-contact', trust: '#trust-contact',
  sync: '#sync', pending: '#pending-sends', retryPending: '#retry-pending',
  lock: '#lock', signout: '#signout', details: '#message-details'
});
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const attr = value => JSON.stringify(String(value));
export const contactSelector = handle => `[data-contact-handle=${attr(handle)}]`;
export const roomSelector = id => `[data-room-id=${attr(id)}]`;
export const messageSelector = id => `[data-message-id=${attr(id)}]`;

export async function openDesk(page, baseUrl) {
  await page.goto(baseUrl);
  await page.locator('#notice').filter({ hasText: 'Your desk is ready' }).waitFor();
}
export async function nativeConnect(page, credentials, unlockAgent, register = false) {
  await page.locator(selectors.handle).fill(credentials.handle);
  await page.locator(selectors.password).fill(credentials.password);
  if (register) await page.locator(selectors.displayName).fill(credentials.displayName || credentials.handle);
  const popupPromise = page.waitForEvent('popup');
  await page.locator(register ? selectors.register : selectors.login).click();
  const popup = await popupPromise;
  await unlockAgent(popup, credentials);
  await page.locator(selectors.desk).waitFor({ state: 'visible' });
  await page.locator(selectors.status).filter({ hasText: 'Agent connected' }).waitFor();
  assert(await page.locator(selectors.password).inputValue() === '', 'Service password should be cleared after connection.');
  return popup;
}
export async function hostConnect(page, unlockAgent) {
  const popupPromise = page.waitForEvent('popup');
  await page.locator(selectors.connect).click();
  const popup = await popupPromise;
  await unlockAgent(popup);
  await page.locator(selectors.status).filter({ hasText: 'Agent connected' }).waitFor();
  return popup;
}
export async function addContact(page, handle, note = '') {
  await page.getByText('Add a contact', { exact: true }).click();
  await page.locator(selectors.contactHandle).fill(handle);
  await page.locator(selectors.contactNote).fill(note);
  await page.locator(selectors.requestContact).click();
  await page.locator(selectors.notice).filter({ hasText: 'Contact request sent' }).waitFor();
}
export async function acceptContact(page, handle) {
  await page.locator(selectors.sync).click();
  const card = page.locator('[data-request-id]').filter({ hasText: `@${handle}` });
  await card.locator('[data-request-action="accept"]').click();
  await page.locator(contactSelector(handle)).waitFor();
}
export async function selectContact(page, handle) { await page.locator(contactSelector(handle)).click(); }
export async function sendText(page, body) {
  await page.locator(selectors.body).fill(body);
  await page.locator(selectors.send).click();
  const card = page.locator('[data-message-id]').filter({ has: page.locator('.message-body').filter({ hasText: body }) }).last();
  await card.waitFor();
  await page.locator(selectors.notice).filter({ hasText: 'Message sent.' }).waitFor();
  return card.getAttribute('data-message-id');
}
export async function waitForText(page, body) {
  await page.locator(selectors.sync).click();
  const card = page.locator('[data-message-id]').filter({ has: page.locator('.message-body').filter({ hasText: body }) }).last();
  await card.waitFor();
  return card;
}
export async function sendReply(page, messageId, body) {
  await page.locator(`[data-reply-to=${attr(messageId)}]`).click();
  return sendText(page, body);
}
export async function sendFile(page, payload, body = '') {
  await page.locator(selectors.body).fill(body);
  await page.locator(selectors.file).setInputFiles(payload);
  await page.locator(selectors.sendFile).click();
  await page.locator(selectors.notice).filter({ hasText: 'Message sent.' }).waitFor();
}
export async function downloadFile(page, card, filename) {
  await card.click();
  const button = page.locator('[data-download-media-id]').filter({ hasText: filename });
  const downloadPromise = page.waitForEvent('download');
  await button.click();
  return downloadPromise;
}
export async function createRoom(page, name, handles) {
  await page.getByText('Start a room', { exact: true }).click();
  await page.locator(selectors.roomName).fill(name);
  await page.locator(selectors.roomMembers).fill(handles.join(', '));
  await page.locator(selectors.createRoom).click();
  await page.locator(selectors.notice).filter({ hasText: 'Room created.' }).waitFor();
  const room = page.locator('[data-room-id]').filter({ hasText: name });
  await room.waitFor();
  return room.getAttribute('data-room-id');
}
export async function askVerification(page, trustedReview) {
  await page.locator(selectors.safety).click();
  await page.waitForFunction(() => document.getElementById('safety-value').textContent.trim().length > 0);
  const value = await page.locator(selectors.safetyValue).textContent();
  await page.locator(selectors.verify).click();
  if (trustedReview) await trustedReview();
  return value;
}
export async function assertCleared(page) {
  await page.locator(selectors.desk).waitFor({ state: 'hidden' });
  assert(await page.locator(selectors.transcript).textContent() === '', 'Transcript plaintext survived teardown.');
  assert(await page.locator(selectors.details).textContent() === '', 'Message details survived teardown.');
  assert(await page.locator(selectors.pending).textContent() === '', 'Pending plaintext survived teardown.');
  assert(await page.locator(selectors.body).inputValue() === '', 'Composer plaintext survived teardown.');
  assert(await page.locator(selectors.password).inputValue() === '', 'Service password survived teardown.');
  assert(await page.locator(selectors.safetyValue).textContent() === '', 'Safety presentation survived teardown.');
  assert((await page.evaluate(() => Object.keys(localStorage))).length === 0, 'Desk unexpectedly persisted data in localStorage.');
}

/** A complete two-desk public native acceptance scenario. Use disposable accounts.
 * unlockAgent(popup,credentials) and trustedReview(popup) interact with trusted UI.
 * readDownload(download) returns Uint8Array bytes using the runner's normal file API.
 */
export async function runDeskAcceptance({ alice, bob, baseUrl, aliceAccount, bobAccount, unlockAgent, trustedReview, filePayload, readDownload }) {
  await Promise.all([openDesk(alice, baseUrl), openDesk(bob, baseUrl)]);
  const alicePopup = await nativeConnect(alice, aliceAccount, unlockAgent, true);
  await nativeConnect(bob, bobAccount, unlockAgent, true);
  const hostileNote = '<img src=x onerror="globalThis.deskInjected=true">';
  await addContact(alice, bobAccount.handle, hostileNote);
  await acceptContact(bob, aliceAccount.handle);
  await alice.locator(selectors.sync).click();
  await selectContact(alice, bobAccount.handle);
  await selectContact(bob, aliceAccount.handle);
  const body = 'A note from the correspondence desk <script>inert text</script>';
  const messageId = await sendText(alice, body);
  const received = await waitForText(bob, body);
  assert(await received.locator('script,img').count() === 0, 'Message content was interpreted as HTML.');
  const replyId = await sendReply(bob, messageId, 'Reply, with the original note attached.');
  const reply = await waitForText(alice, 'Reply, with the original note attached.');
  assert(await reply.locator('blockquote').count() === 1, 'Reply quote was not shown.');
  await sendFile(alice, filePayload, 'Bytes, not a string conversion.');
  const fileCard = await waitForText(bob, 'Bytes, not a string conversion.');
  const download = await downloadFile(bob, fileCard, filePayload.name);
  const actual = await readDownload(download);
  const expected = new Uint8Array(filePayload.buffer);
  assert(actual.length === expected.length && actual.every((byte, index) => byte === expected[index]), 'File download changed the original bytes.');
  const roomId = await createRoom(alice, 'Desk acceptance room', [bobAccount.handle]);
  await sendText(alice, 'A room has its own conversation.');
  await bob.locator(selectors.sync).click();
  await bob.locator(roomSelector(roomId)).click();
  await waitForText(bob, 'A room has its own conversation.');
  await selectContact(alice, bobAccount.handle);
  const safety = await askVerification(alice, trustedReview ? () => trustedReview(alicePopup) : null);
  await alice.locator(selectors.sync).click();
  if (await alice.locator(selectors.retryPending).isEnabled()) await alice.locator(selectors.retryPending).click();
  await alice.locator(selectors.lock).click(); await assertCleared(alice);
  await bob.locator(selectors.signout).click(); await assertCleared(bob);
  return { messageId, replyId, roomId, safety, fileBytes: actual.length };
}
