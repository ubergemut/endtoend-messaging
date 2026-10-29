// SPDX-License-Identifier: MIT
// Fresh desk presentation/controller; runtime imports are the published MIT SDK only.
import { AgentClient, MessagePortTransport, RelayService, bytesToBase64 } from '@e2ee/client/standalone';

const $ = id => document.getElementById(id);
const emptyViews = () => ({ messages: [], friends: [], groups: [], seen: [], peers: {}, pendingTrust: null, revision: 0 });
const state = { config: null, epoch: 0, client: null, service: null, token: null, account: null,
  controller: null, popup: null, connecting: false, active: false, unlocked: false, views: emptyViews(),
  requests: [], pending: [], selection: null, selectedMessageId: null, replyId: null,
  intent: null, capabilities: null, timer: null, refreshing: false, urls: new Set(), unsubscribe: null };

function textNode(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = String(text ?? '');
  if (className) element.className = className;
  return element;
}
function action(text, onClick, attributes = {}) {
  const button = textNode('button', text);
  button.type = 'button';
  for (const [key, value] of Object.entries(attributes)) button.setAttribute(key, value);
  button.addEventListener('click', onClick);
  return button;
}
function notice(message, kind = '') { $('notice').textContent = message; $('notice').className = `notice ${kind}`; }
function isCurrent(epoch) { return state.epoch === epoch && !state.controller?.signal.aborted; }
function requireCurrent(epoch) { if (!isCurrent(epoch)) throw new DOMException('Desk session ended', 'AbortError'); }
function opts() { return { signal: state.controller?.signal }; }
function supported(name) { return !state.capabilities || state.capabilities.operations.includes(name); }
function explanation(error) {
  if (error?.name === 'AbortError' || error?.code === 'cancelled') return 'The operation was cancelled. A send may already have reached the agent.';
  return `${error?.code ? `${error.code}: ` : ''}${error?.message || 'The operation could not be completed.'}`;
}
function fail(error, epoch = state.epoch) {
  if (!isCurrent(epoch)) return;
  if (['locked', 'revoked', 'closed', 'unauthorized'].includes(error?.code)) {
    void endSession('local', `The desk was cleared: ${explanation(error)} Connect again with fresh authority.`);
  } else notice(explanation(error), 'error');
}
async function task(work) {
  const epoch = state.epoch;
  try { await work(epoch); } catch (error) { fail(error, epoch); }
}
function bareOrigin(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be configured.`);
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${label} must be a bare HTTPS origin; HTTP is allowed only on loopback.`);
  return url.origin;
}
function hostPath(value) {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9/_-]+$/.test(value) || value.startsWith('//') || value.includes('..'))
    throw new Error('grantPath must be a safe same-origin absolute path without query, fragment, encoding or traversal.');
  if (new URL(value, location.origin).origin !== location.origin) throw new Error('The grant path must stay on this host.');
  return value;
}
async function readJSON(url, init = {}) {
  const timeout = AbortSignal.timeout(30_000);
  const signal = AbortSignal.any([timeout, ...(init.signal ? [init.signal] : [])]);
  const response = await fetch(url, { ...init, signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/json', ...init.headers } });
  if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('Redirects are not accepted.');
  if (!response.body) throw new Error('The service returned no response.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) throw new Error('The service response exceeds the desk limit.');
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`The service request failed (${response.status}).`);
  return value;
}
async function loadConfig() {
  bareOrigin(location.origin, 'Desk origin');
  const config = await readJSON('/desk-config.json', { credentials: 'same-origin' });
  const agentUrl = bareOrigin(config.agentUrl, 'Agent URL');
  const relayUrl = bareOrigin(config.relayUrl, 'Relay URL');
  if (agentUrl === location.origin) throw new Error('The trusted agent must run on a separate origin.');
  const grantPath = config.grantPath === undefined ? null : hostPath(config.grantPath);
  const nativeAuth = config.nativeAuth === true;
  if (!!grantPath === nativeAuth) throw new Error('Configure exactly one authentication mode: grantPath or nativeAuth:true.');
  if (grantPath) {
    // Let the public SDK validate the audience with its exact Unicode rules.
    const service = new RelayService(relayUrl, { audience: config.audience, fetcher: (input, init) => fetch(input, init) });
    service.close();
  }
  state.config = { agentUrl, relayUrl, grantPath, nativeAuth, audience: config.audience };
  $('native-fields').hidden = !nativeAuth;
  $('connect-agent').hidden = nativeAuth;
  $('connection-description').textContent = nativeAuth
    ? 'This host explicitly enables the public native demo sign-in service.'
    : 'This host supplies a scoped messaging grant using your host session.';
  setControls();
  notice('Your desk is ready. Connect to open the trusted agent.');
}
// Public release metadata is independent of the host login and messaging capability.
async function showSourceNotice() {
  const holder = $('source-notice');
  try {
    const release = await readJSON('/release.json', { credentials: 'omit' });
    if (typeof release.version !== 'string' || !/^[a-f0-9]{64}$/.test(release.sourceSha256)) throw new Error('Missing exact source identity.');
    const links = [['Source for this version', release.sourceUrl], ['Source manifest', release.manifestUrl], ['MIT license', release.licenseUrl], ['Third-party notices', release.noticesUrl], ...(release.messagingSourceUrl ? [['Messaging service source', release.messagingSourceUrl]] : [])];
    const nodes = [textNode('span', `Desk client ${release.version} · MIT`)];
    for (const [label, value] of links) {
      if (typeof value !== 'string') throw new Error('Missing source disclosure link.');
      const url = new URL(value, location.origin);
      if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Invalid source disclosure link.');
      const link = textNode('a', label); link.href = url.href;
      if (label === 'Source for this version') link.title = `SHA-256 ${release.sourceSha256}`;
      nodes.push(link);
    }
    holder.replaceChildren(...nodes);
  } catch { holder.firstChild.textContent = 'Desk client · MIT. Source offer unavailable. '; }
}
void showSourceNotice();
function setControls() {
  const connected = state.active;
  $('welcome').hidden = connected;
  $('desk').hidden = !connected;
  $('connect-agent').disabled = !state.config || state.connecting;
  $('login').disabled = !state.config || state.connecting;
  $('register').disabled = !state.config || state.connecting;
  $('cancel-connect').hidden = !state.connecting;
  for (const id of ['sync', 'lock', 'signout']) $(id).disabled = !connected;
  const selected = connected && state.unlocked && !!state.selection;
  for (const id of ['message-body', 'file-input', 'send', 'send-file']) $(id).disabled = !selected || !!state.intent;
  $('send-file').disabled ||= !$('file-input').files.length;
  for (const id of ['safety-number', 'verify-contact', 'trust-contact']) $(id).disabled = !selected || !state.selection?.handle;
  $('retry-pending').disabled = !connected || !state.unlocked || !state.pending.length || !supported('retryPending');
  $('uncertain-send').hidden = !state.intent;
}
function beginSession() {
  clearLocal();
  state.controller = new AbortController();
  state.connecting = true;
  setControls();
  return state.epoch;
}
function clearLocal() {
  state.epoch++;
  state.controller?.abort();
  state.unsubscribe?.();
  state.unsubscribe = null;
  clearInterval(state.timer);
  state.timer = null;
  for (const url of state.urls) URL.revokeObjectURL(url);
  state.urls.clear();
  state.token = null;
  state.account = null;
  state.views = emptyViews();
  state.requests = [];
  state.pending = [];
  state.selection = null;
  state.selectedMessageId = null;
  state.replyId = null;
  state.intent = null;
  state.capabilities = null;
  state.active = false;
  state.unlocked = false;
  state.connecting = false;
  state.refreshing = false;
  $('auth-form').reset();
  $('contact-form').reset();
  $('room-form').reset();
  $('message-form').reset();
  $('file-label').textContent = 'No file attached';
  $('account-label').textContent = 'A little room for conversation.';
  $('conversation-title').textContent = 'Choose a contact or room';
  $('revision').textContent = '';
  $('safety-value').textContent = '';
  $('reply-label').textContent = '';
  $('reply-context').hidden = true;
  for (const id of ['contacts', 'rooms', 'requests', 'transcript', 'message-details', 'pending-sends']) $(id).replaceChildren();
  $('identity-label').textContent = 'Choose a contact to compare safety numbers.';
  $('contact-count').textContent = '0';
  $('room-count').textContent = '0';
  setControls();
}
async function endSession(kind, message) {
  const client = state.client, service = state.service, token = state.token, config = state.config, popup = state.popup;
  state.client = null; state.service = null; state.popup = null;
  clearLocal();
  notice(message || (kind === 'lock' ? 'Desk locked and cleared. Sign in again to reconnect.' : 'Signed out. The desk has been cleared.'));
  const cleanup = [];
  if (client) cleanup.push((async () => {
    try {
      await client.lock({ signal: AbortSignal.timeout(5000) });
      if (kind === 'signout') await client.disconnect({ signal: AbortSignal.timeout(5000) });
    } catch {} finally { await client.close(); }
  })());
  if (service && token) cleanup.push(service.revoke(token, { signal: AbortSignal.timeout(5000) }).catch(() => {}));
  else if (token && config?.nativeAuth) cleanup.push(readJSON(`${config.relayUrl}/api/auth/logout`, { method: 'POST', credentials: 'omit', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }).catch(() => {}));
  await Promise.allSettled(cleanup);
  service?.close();
  try { popup?.close(); } catch {}
}
function openAgent(epoch) {
  const capability = crypto.randomUUID() + crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const url = new URL(state.config.agentUrl);
  url.hash = new URLSearchParams({ capability, callerOrigin: location.origin }).toString();
  const channel = new MessageChannel();
  let popup = null;
  let settled = false;
  let transferred = false;
  return new Promise((resolve, reject) => {
    const signal = state.controller.signal;
    const cleanup = () => {
      window.removeEventListener('message', ready);
      signal.removeEventListener('abort', aborted);
      channel.port1.removeEventListener('message', connected);
      clearTimeout(timer); clearInterval(closed);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) { channel.port1.close(); channel.port2.close(); reject(error); }
      else resolve({ port: channel.port1, popup });
    };
    const connected = event => {
      if (!isCurrent(epoch)) return finish(new DOMException('Connection cancelled', 'AbortError'));
      if (event.data?.type === 'endtoend-agent-connected' && event.data?.version === 1 && event.data?.nonce === nonce) finish();
    };
    const ready = event => {
      if (!isCurrent(epoch) || transferred || event.source !== popup || event.origin !== state.config.agentUrl || event.data?.type !== 'endtoend-agent-ready' || event.data?.version !== 1) return;
      transferred = true;
      popup.postMessage({ type: 'endtoend-agent-connect', version: 1, nonce, capability }, state.config.agentUrl, [channel.port2]);
    };
    const aborted = () => finish(new DOMException('Connection cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The trusted agent did not finish pairing within 45 seconds.')), 45_000);
    const closed = setInterval(() => { if (popup?.closed) finish(new Error('The trusted agent window was closed.')); }, 300);
    channel.port1.addEventListener('message', connected);
    channel.port1.start();
    window.addEventListener('message', ready);
    signal.addEventListener('abort', aborted, { once: true });
    popup = window.open(url.href, `endtoend-desk-${crypto.randomUUID()}`, 'popup,width=540,height=760');
    state.popup = popup;
    if (!popup) finish(new Error('The popup was blocked. Allow the trusted agent window, then connect again.'));
  });
}
async function connect(mode) {
  if (!state.config || state.connecting || state.active) return;
  const credentials = { handle: $('login-handle').value.trim().toLowerCase(), password: $('login-password').value, displayName: $('display-name').value.trim() };
  if (state.config.nativeAuth && (!/^[a-z0-9_]{3,32}$/.test(credentials.handle) || credentials.password.length < 5)) {
    notice('Use a 3–32 character lowercase handle (letters, numbers, underscores) and a password of at least 5 characters.', 'error');
    return;
  }
  const epoch = beginSession();
  notice('Opening the trusted agent and obtaining messaging authority…', 'busy');
  // Open synchronously in the user gesture; do not await an HTTP response before opening.
  let paired = null;
  const pairing = openAgent(epoch).then(connection => {
    paired = connection;
    if (!isCurrent(epoch)) connection.port.close();
    return connection;
  });
  try {
    if (!state.popup) await pairing;
    if (!state.config.nativeAuth) state.service = new RelayService(state.config.relayUrl, { audience: state.config.audience, fetcher: (input, init) => fetch(input, init) });
    const authorityResponse = state.config.nativeAuth
      ? readJSON(`${state.config.relayUrl}/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
          method: 'POST', credentials: 'omit', signal: state.controller.signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mode === 'register' ? credentials : { handle: credentials.handle, password: credentials.password }) })
      : readJSON(state.config.grantPath, { method: 'POST', credentials: 'same-origin', signal: state.controller.signal,
          headers: { 'content-type': 'application/json' }, body: '{}' });
    credentials.password = '';
    const authority = authorityResponse.then(grant => {
      requireCurrent(epoch);
      let attach;
      if (state.config.nativeAuth) {
        if (!grant || typeof grant.token !== 'string' || !grant.token || /[\s\u0000-\u001f\u007f]/.test(grant.token) || grant.token.length > 16384 || !grant.account || typeof grant.account.id !== 'string' || !grant.account.id || typeof grant.account.handle !== 'string' || typeof grant.account.displayName !== 'string')
          throw new Error('The native service returned invalid account authority.');
        attach = { relay: state.config.relayUrl, token: grant.token, expectedAccountId: grant.account.id, stay: 'tab' };
      } else attach = state.service.attachInput(grant, 'tab');
      // Retain issued authority before pairing finishes so cancellation can revoke it.
      state.token = grant.token;
      state.account = grant.account;
      return attach;
    });
    const [connection, attach] = await Promise.all([pairing, authority]);
    requireCurrent(epoch);
    state.client = new AgentClient(new MessagePortTransport(connection.port));
    await state.client.attach(attach, opts());
    requireCurrent(epoch);
    try { state.capabilities = await state.client.capabilities(opts()); }
    catch (error) { if (error.code !== 'invalid') throw error; }
    requireCurrent(epoch);
    const status = await state.client.requestUnlock(opts());
    requireCurrent(epoch);
    state.active = true; state.connecting = false; state.unlocked = status.unlocked;
    $('account-label').textContent = `${state.account.displayName || state.account.handle} · @${state.account.handle}`;
    if (state.capabilities?.events.length) state.unsubscribe = state.client.subscribe(event => {
      if (!isCurrent(epoch)) return;
      if (['locked', 'revoked', 'disconnected'].includes(event.event)) void endSession('local', 'The agent ended this desk session. Plaintext was cleared.');
      else void task(() => refresh(epoch));
    });
    setControls();
    notice(status.unlocked ? 'Your desk is open.' : 'Complete the unlock in the trusted agent window. This desk is waiting.', status.unlocked ? '' : 'busy');
    await refresh(epoch);
    requireCurrent(epoch);
    state.timer = setInterval(() => {
      if (!isCurrent(epoch)) return;
      if (state.popup?.closed) { void endSession('local', 'The trusted agent window closed. The desk was cleared.'); return; }
      void task(() => refresh(epoch));
    }, 2000);
  } catch (error) {
    credentials.password = '';
    paired?.port.close();
    if (isCurrent(epoch)) await endSession('local', explanation(error));
  }
}
async function refresh(epoch = state.epoch) {
  if (!state.client || state.refreshing) return;
  state.refreshing = true;
  const client = state.client;
  try {
    const status = await client.status(opts());
    requireCurrent(epoch);
    if (!status.unlocked) {
      if (state.unlocked) { await endSession('local', 'The agent locked. Plaintext was cleared.'); return; }
      $('connection-status').textContent = 'Awaiting trusted unlock';
      return;
    }
    if (status.accountId !== state.account.id) { await endSession('local', 'The agent account changed. Connect again with fresh authority.'); return; }
    const opened = !state.unlocked;
    state.unlocked = true;
    await client.sync(opts());
    requireCurrent(epoch);
    const [views, requests, pending] = await Promise.all([
      client.views(opts()), client.requests(opts()), supported('pendingSends') ? client.pendingSends(opts()) : Promise.resolve([])
    ]);
    requireCurrent(epoch);
    state.views = views; state.requests = requests; state.pending = pending;
    if (!state.selection && views.friends.length) state.selection = { handle: views.friends[0].handle };
    if (state.selection?.handle && !views.friends.some(friend => friend.handle === state.selection.handle)) state.selection = null;
    if (state.selection?.groupId && !views.groups.some(group => group.id === state.selection.groupId)) state.selection = null;
    render();
    if (opened) notice('Your desk is open.');
  } finally { if (isCurrent(epoch)) state.refreshing = false; }
}
function selectionTitle() {
  if (state.selection?.handle) return `@${state.selection.handle}`;
  return state.views.groups.find(group => group.id === state.selection?.groupId)?.name || 'Choose a contact or room';
}
function conversationMessages() {
  if (!state.selection) return [];
  const friend = state.views.friends.find(item => item.handle === state.selection.handle);
  return state.views.messages.filter(message => state.selection.groupId ? message.groupId === state.selection.groupId : !message.groupId && friend && message.peerId === friend.id);
}
function selectConversation(selection) {
  state.selection = selection;
  state.selectedMessageId = null; state.replyId = null;
  $('safety-value').textContent = '';
  $('message-form').reset(); $('file-label').textContent = 'No file attached';
  render();
  void task(async epoch => {
    await state.client.focus(selection, opts());
    requireCurrent(epoch);
    const ids = conversationMessages().filter(message => !message.fromMe).map(message => message.id);
    if (ids.length) await state.client.markSeen(ids, opts());
    requireCurrent(epoch);
  });
}
function render() {
  renderRail(); renderRequests(); renderTranscript(); renderDetails(); renderPending();
  $('conversation-title').textContent = selectionTitle();
  $('connection-status').textContent = state.unlocked ? 'Agent connected' : 'Awaiting trusted unlock';
  $('identity-label').textContent = state.selection?.handle ? `Compare @${state.selection.handle} using a separate trusted channel.` : 'Choose a contact to compare safety numbers.';
  $('revision').textContent = `Desk revision ${state.views.revision}`;
  $('reply-context').hidden = !state.replyId;
  const reply = state.views.messages.find(message => message.id === state.replyId);
  $('reply-label').textContent = reply ? `Replying to: ${reply.body.slice(0, 160) || 'Attachment'}` : '';
  setControls();
}
function renderRail() {
  $('contacts').replaceChildren(); $('rooms').replaceChildren();
  $('contact-count').textContent = String(state.views.friends.length);
  $('room-count').textContent = String(state.views.groups.length);
  for (const friend of state.views.friends) {
    const button = action('', () => selectConversation({ handle: friend.handle }), { 'data-contact-handle': friend.handle });
    button.className = `rail-entry ${state.selection?.handle === friend.handle ? 'active' : ''}`;
    button.setAttribute('aria-pressed', String(state.selection?.handle === friend.handle));
    button.append(textNode('span', friend.displayName.slice(0, 1).toUpperCase() || '@', 'avatar'));
    const name = textNode('span', friend.displayName || friend.handle, 'entry-name');
    name.append(textNode('small', `@${friend.handle}${friend.verified ? ' · verified' : ''}`));
    button.append(name); $('contacts').append(button);
  }
  for (const group of state.views.groups) {
    const button = action('', () => selectConversation({ groupId: group.id }), { 'data-room-id': group.id });
    button.className = `rail-entry ${state.selection?.groupId === group.id ? 'active' : ''}`;
    button.setAttribute('aria-pressed', String(state.selection?.groupId === group.id));
    button.append(textNode('span', '#', 'avatar'));
    const name = textNode('span', group.name, 'entry-name');
    name.append(textNode('small', `${group.memberIds.length} members`)); button.append(name); $('rooms').append(button);
  }
  if (!state.views.friends.length) $('contacts').append(textNode('p', 'An open address book.', 'muted'));
  if (!state.views.groups.length) $('rooms').append(textNode('p', 'Room for a new room.', 'muted'));
}
function renderRequests() {
  $('requests').replaceChildren();
  if (!state.requests.length) $('requests').append(textNode('p', 'No requests just now.', 'muted'));
  for (const request of state.requests) {
    const card = textNode('article', '', 'request-card'); card.dataset.requestId = request.id;
    card.append(textNode('strong', `@${request.handle}`), textNode('p', `${request.direction} · ${request.status}`));
    if (request.note) card.append(textNode('p', request.note));
    if (request.status === 'pending') {
      const buttons = textNode('div', '', 'request-actions');
      for (const verb of request.direction === 'incoming' ? ['accept', 'decline'] : ['cancel']) {
        buttons.append(action(verb[0].toUpperCase() + verb.slice(1), () => void task(async epoch => {
          await state.client.respondRequest(request.id, verb, opts()); requireCurrent(epoch);
          await state.client.sync(opts()); requireCurrent(epoch); await refresh(epoch);
          notice(`Contact request ${verb}ed.`);
        }), { 'data-request-action': verb }));
      }
      card.append(buttons);
    }
    $('requests').append(card);
  }
}
function dateLabel(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unavailable'; }
function renderTranscript() {
  const transcript = $('transcript');
  const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 60;
  const scrollTop = transcript.scrollTop;
  transcript.replaceChildren();
  const messages = conversationMessages();
  if (!messages.length) transcript.append(textNode('p', state.selection ? 'The next card is yours to write.' : 'Choose a contact or room to begin.', 'empty'));
  for (const message of messages) {
    const card = textNode('article', '', `message-card ${message.fromMe ? 'mine' : ''} ${state.selectedMessageId === message.id ? 'selected' : ''}`);
    card.dataset.messageId = message.id; card.tabIndex = 0;
    card.setAttribute('aria-label', `${message.fromMe ? 'You' : message.senderHandle || selectionTitle()}: ${message.body.slice(0, 100) || 'Attachment'}`);
    const select = () => { state.selectedMessageId = message.id; renderDetails(); document.querySelectorAll('.message-card').forEach(node => node.classList.toggle('selected', node.dataset.messageId === message.id)); };
    card.addEventListener('click', select);
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    const meta = textNode('div', '', 'message-meta');
    meta.append(textNode('span', message.fromMe ? 'YOU' : message.senderHandle ? `@${message.senderHandle}` : selectionTitle()), textNode('time', dateLabel(message.at)));
    card.append(meta);
    if (message.replyTo) card.append(textNode('blockquote', message.quote || 'Reply to an earlier message'));
    card.append(textNode('p', message.body, 'message-body'));
    for (const attachment of message.attachments || []) card.append(textNode('span', `↳ ${attachment.name}`, 'file-chip'));
    const reply = action('Reply', event => { state.replyId = message.id; render(); $('message-body').focus(); }, { 'data-reply-to': message.id });
    reply.className = 'reply-button'; card.append(reply);
    transcript.append(card);
  }
  transcript.scrollTop = atBottom ? transcript.scrollHeight : scrollTop;
}
function renderDetails() {
  const target = $('message-details'); target.replaceChildren();
  const message = state.views.messages.find(item => item.id === state.selectedMessageId);
  if (!message) { target.append(textNode('p', 'Select a message card to inspect its details.', 'muted')); return; }
  const list = document.createElement('dl');
  for (const [name, value] of [['Message', message.id], ['Date', dateLabel(message.at)], ['Status', message.status || 'Available'], ['Reply to', message.replyTo], ['Expires', message.expiresAt ? dateLabel(message.expiresAt) : null]]) {
    if (value) list.append(textNode('dt', name), textNode('dd', value));
  }
  target.append(list);
  for (const attachment of message.attachments || []) target.append(action(`Download ${attachment.name}`, () => void task(epoch => download(attachment, epoch)), { 'data-download-media-id': attachment.mediaId }));
}
function renderPending() {
  $('pending-sends').replaceChildren();
  if (!state.pending.length) $('pending-sends').append(textNode('p', 'No retained sends.', 'muted'));
  for (const pending of state.pending) {
    const item = textNode('div', '', 'pending-item'); item.dataset.operationId = pending.operationId;
    item.append(textNode('strong', pending.state === 'blocked' ? 'Membership review needed' : 'Awaiting delivery'), textNode('p', pending.body || pending.attachmentNames.join(', ')), textNode('small', pending.operationId));
    $('pending-sends').append(item);
  }
}
async function download(attachment, epoch) {
  const bytes = await state.client.attachment(attachment.mediaId, opts());
  requireCurrent(epoch);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  state.urls.add(url);
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = String(attachment.name || 'attachment').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '') || 'attachment';
  anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => { URL.revokeObjectURL(url); state.urls.delete(url); }, 1000);
  notice('File downloaded as bytes.');
}
async function sendIntent(intent, epoch) {
  state.intent = intent; setControls();
  notice('Sending this message intent…', 'busy');
  try {
    await state.client.command(intent.operation, intent.input, { ...opts(), operationId: intent.operationId });
    requireCurrent(epoch);
    state.intent = null; state.replyId = null;
    $('message-form').reset(); $('file-label').textContent = 'No file attached';
    await state.client.sync(opts()); requireCurrent(epoch); await refresh(epoch);
    notice('Message sent.');
  } catch (error) {
    requireCurrent(epoch);
    if (!['timeout', 'cancelled', 'relay', 'internal', 'protocol'].includes(error?.code)) state.intent = null;
    setControls();
    throw error;
  }
}
async function compose(withFile, epoch) {
  if (!state.selection || state.intent || !state.unlocked) return;
  const input = { ...state.selection, body: $('message-body').value, ...(state.replyId ? { replyTo: state.replyId } : {}) };
  let operation = state.selection.groupId ? 'sendGroup' : 'send';
  if (withFile) {
    const file = $('file-input').files[0];
    if (!file) throw new Error('Choose a file first.');
    if (file.size > 20 * 1024 * 1024) throw new Error('This desk accepts files up to 20 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer()); requireCurrent(epoch);
    Object.assign(input, { name: file.name, mime: file.type || 'application/octet-stream', base64: bytesToBase64(bytes) });
    operation = 'sendFile';
  } else if (!input.body.trim()) throw new Error('Write a message first.');
  await sendIntent({ operation, input, operationId: crypto.randomUUID() }, epoch);
}

$('auth-form').addEventListener('submit', event => { event.preventDefault(); void connect('login'); });
$('register').addEventListener('click', () => void connect('register'));
$('connect-agent').addEventListener('click', () => void connect('host'));
$('cancel-connect').addEventListener('click', () => void endSession('local', 'Connection cancelled. The desk was cleared.'));
$('lock').addEventListener('click', () => void endSession('lock'));
$('signout').addEventListener('click', () => void endSession('signout'));
$('sync').addEventListener('click', () => void task(async epoch => {
  await state.client.sync(opts()); requireCurrent(epoch); await refresh(epoch); notice('Desk synced.');
}));
$('contact-form').addEventListener('submit', event => {
  event.preventDefault(); void task(async epoch => {
    const handle = $('contact-handle').value.trim(); const note = $('contact-note').value;
    await state.client.requestFriend(handle, note || undefined, opts()); requireCurrent(epoch);
    $('contact-form').reset(); await refresh(epoch); notice('Contact request sent.');
  });
});
$('room-form').addEventListener('submit', event => {
  event.preventDefault(); void task(async epoch => {
    const name = $('room-name').value.trim(); const handles = [...new Set($('room-members').value.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];
    if (!name || !handles.length) throw new Error('Give the room a name and at least one member handle.');
    const group = await state.client.createGroup(name, handles, opts()); requireCurrent(epoch);
    state.selection = { groupId: group.id }; $('room-form').reset(); await refresh(epoch); notice('Room created.');
  });
});
$('message-form').addEventListener('submit', event => { event.preventDefault(); void task(epoch => compose(false, epoch)); });
$('send-file').addEventListener('click', () => void task(epoch => compose(true, epoch)));
$('file-input').addEventListener('change', () => { $('file-label').textContent = $('file-input').files[0]?.name || 'No file attached'; setControls(); });
$('cancel-reply').addEventListener('click', () => { state.replyId = null; render(); });
$('retry-intent').addEventListener('click', () => { if (state.intent) void task(epoch => sendIntent(state.intent, epoch)); });
$('clear-intent').addEventListener('click', () => { state.intent = null; setControls(); notice('Intent dismissed locally. Check the conversation and delivery tray before sending new content.'); });
$('retry-pending').addEventListener('click', () => void task(async epoch => {
  await state.client.retryPending(opts()); requireCurrent(epoch); await state.client.sync(opts()); requireCurrent(epoch); await refresh(epoch); notice('Retained sends reviewed and retried by the agent.');
}));
$('safety-number').addEventListener('click', () => void task(async epoch => {
  const handle = state.selection?.handle; if (!handle) return;
  const safety = await state.client.safetyNumber(handle, opts()); requireCurrent(epoch);
  if (state.selection?.handle !== handle) return;
  $('safety-value').textContent = `${safety.safetyNumber}\n${safety.verified ? 'Verified in trusted controls' : 'Not yet verified'}`;
  notice('Compare this safety number through a separate trusted channel.');
}));
$('verify-contact').addEventListener('click', () => void task(async epoch => {
  const handle = state.selection?.handle; if (!handle) return;
  await state.client.markVerified(handle, opts()); requireCurrent(epoch); state.popup?.focus();
  notice('Review the verification request in the trusted agent window.'); await refresh(epoch);
}));
$('trust-contact').addEventListener('click', () => void task(async epoch => {
  const handle = state.selection?.handle; if (!handle) return;
  await state.client.trustIdentity(handle, opts()); requireCurrent(epoch); state.popup?.focus();
  notice('Review the identity request in the trusted agent window.'); await refresh(epoch);
}));
window.addEventListener('pagehide', () => {
  const client = state.client; const service = state.service;
  state.client = null; state.service = null; clearLocal();
  void client?.close(); service?.close();
});
void loadConfig().catch(error => { state.config = null; setControls(); notice(explanation(error), 'error'); });
