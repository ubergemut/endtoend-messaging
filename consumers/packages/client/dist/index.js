import { AgentError, isAgentRequest, isAgentResponse, isAgentEvent, } from '@e2ee/protocol/standalone';
export * from '@e2ee/protocol/standalone';
export { RelayService } from './relay-service.js';
/** Authenticated loopback transport. Browser applications use the separate-origin MessagePort transport. */
export class HttpAgentTransport {
    capability;
    fetcher;
    url;
    closed = false;
    pending = new Set();
    constructor(baseUrl, capability, fetcher = fetch) {
        this.capability = capability;
        this.fetcher = fetcher;
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
            || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
            throw new AgentError('The local agent URL must be an HTTP loopback address', 'invalid');
        }
        if (!capability || capability.length > 16 * 1024 || /[\s\u0000-\u001f\u007f]/.test(capability))
            throw new AgentError('A valid local agent capability is required', 'unauthorized');
        this.url = new URL('/v1/command', parsed).href;
    }
    async request(request, options = {}) {
        if (this.closed)
            throw new AgentError('Agent connection is closed', 'closed');
        const controller = new AbortController();
        const timed = AbortSignal.timeout(120_000);
        const signal = AbortSignal.any([controller.signal, timed, ...(options.signal ? [options.signal] : [])]);
        if (signal.aborted)
            throw new AgentError('Agent request was cancelled; delivery may be uncertain', 'cancelled');
        this.pending.add(controller);
        try {
            const response = await this.fetcher.call(globalThis, this.url, {
                method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${this.capability}` },
                body: JSON.stringify(request),
                signal,
            });
            const result = await boundedJson(response);
            if (!isAgentResponse(result))
                throw new AgentError(`Invalid agent response (${response.status})`, response.status === 401 ? 'unauthorized' : 'protocol');
            if (signal.aborted)
                throw signal.reason;
            return result;
        }
        catch (error) {
            if (signal.aborted)
                throw new AgentError(this.closed ? 'Agent connection is closed' : 'Agent request was cancelled or timed out; retain its operation ID', this.closed ? 'closed' : timed.aborted ? 'timeout' : 'cancelled');
            throw error;
        }
        finally {
            this.pending.delete(controller);
        }
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const pending of this.pending)
            pending.abort();
        this.pending.clear();
    }
}
/** A port is usable only after the caller completes the agent's origin/source/nonce handshake. */
export class MessagePortTransport {
    port;
    timeoutMs;
    closed = false;
    usedIds = new Set();
    listeners = new Set();
    pending = new Map();
    onMessage = (event) => {
        if (this.closed)
            return;
        if (isAgentEvent(event.data)) {
            for (const listener of [...this.listeners]) {
                try {
                    listener(event.data);
                }
                catch { /* One consumer cannot prevent revocation. */ }
            }
            if (event.data.event === 'revoked' || event.data.event === 'disconnected')
                this.close('revoked');
            return;
        }
        if (!isAgentResponse(event.data))
            return;
        const pending = this.pending.get(event.data.requestId);
        if (!pending)
            return;
        pending.cleanup();
        this.pending.delete(event.data.requestId);
        pending.resolve(event.data);
    };
    constructor(port, timeoutMs = 120_000) {
        this.port = port;
        this.timeoutMs = timeoutMs;
        port.addEventListener('message', this.onMessage);
        port.addEventListener('messageerror', this.onError);
        port.start();
    }
    onError = () => { this.close(); };
    subscribe(listener) {
        if (this.closed)
            throw new AgentError('Agent connection is closed', 'closed');
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    request(request, options = {}) {
        if (this.closed)
            return Promise.reject(new AgentError('Agent connection is closed', 'closed'));
        if (!isAgentRequest(request))
            return Promise.reject(new AgentError('Invalid protocol request', 'invalid'));
        if (this.usedIds.has(request.requestId))
            return Promise.reject(new AgentError('A request ID must never be reused on a port', 'invalid'));
        if (options.signal?.aborted)
            return Promise.reject(new AgentError('Agent request was cancelled', 'cancelled'));
        this.usedIds.add(request.requestId);
        return new Promise((resolve, reject) => {
            const abort = () => {
                this.pending.delete(request.requestId);
                cleanup();
                reject(new AgentError('Agent request was cancelled; retain the operation ID before retrying', 'cancelled'));
            };
            const timer = setTimeout(() => {
                this.pending.delete(request.requestId);
                cleanup();
                reject(new AgentError('Agent response timed out; retain the operation ID before retrying', 'timeout'));
            }, this.timeoutMs);
            const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
            this.pending.set(request.requestId, { resolve, reject, cleanup });
            options.signal?.addEventListener('abort', abort, { once: true });
            try {
                this.port.postMessage(request);
            }
            catch (error) {
                cleanup();
                this.pending.delete(request.requestId);
                reject(error);
            }
        });
    }
    close(code = 'closed') {
        if (this.closed)
            return;
        this.closed = true;
        this.port.removeEventListener('message', this.onMessage);
        this.port.removeEventListener('messageerror', this.onError);
        this.port.close();
        for (const pending of this.pending.values()) {
            pending.cleanup();
            pending.reject(new AgentError('Agent connection is closed', code));
        }
        this.pending.clear();
        this.listeners.clear();
        this.usedIds.clear();
    }
}
export class AgentClient {
    transport;
    closed = false;
    closureCode = 'closed';
    lifecycle = new AbortController();
    constructor(transport) {
        this.transport = transport;
    }
    async call(operation, input = {}, operationId, options = {}) {
        if (this.closed)
            throw new AgentError('Agent client is closed', this.closureCode);
        if (options.signal?.aborted)
            throw new AgentError('Agent request was cancelled', 'cancelled');
        const request = { version: 1, requestId: crypto.randomUUID(), operation, input, ...(operationId !== undefined ? { operationId } : {}) };
        if (!isAgentRequest(request))
            throw new AgentError('Invalid protocol v1 command', 'invalid');
        const signal = AbortSignal.any([this.lifecycle.signal, ...(options.signal ? [options.signal] : [])]);
        const response = await withAbort(this.transport.request(request, { signal }), signal, () => this.closed ? this.closureCode : 'cancelled');
        if (signal.aborted)
            throw new AgentError('Agent request was cancelled or closed', this.closed ? this.closureCode : 'cancelled');
        if (!isAgentResponse(response) || response.requestId !== request.requestId)
            throw new AgentError('Agent response does not match this request', 'protocol');
        if (response.ok === false)
            throw new AgentError(response.error.message, response.error.code);
        return response.result;
    }
    command(operation, input, options = {}) {
        return this.call(operation, input, options.operationId, options);
    }
    subscribe(listener) {
        if (this.closed)
            throw new AgentError('Agent client is closed', 'closed');
        if (!this.transport.subscribe)
            throw new AgentError('This transport does not provide events; use explicit sync', 'invalid');
        return this.transport.subscribe(listener);
    }
    capabilities(options) { return this.call('capabilities', {}, undefined, options); }
    license(options) { return this.call('license', {}, undefined, options); }
    setStay(stay, options) { return this.call('setStay', { stay }, undefined, options); }
    disconnect(options) { return this.call('disconnect', {}, undefined, options); }
    status(options) { return this.call('status', {}, undefined, options); }
    views(options) { return this.call('views', {}, undefined, options); }
    attach(input, options) { return this.call('attach', input, undefined, options); }
    requestUnlock(options) { return this.call('requestUnlock', {}, undefined, options); }
    cryptoDiagnostic(options) { return this.call('cryptoDiagnostic', {}, undefined, options); }
    pendingSends(options) { return this.call('pendingSends', {}, undefined, options); }
    retryPending(options) { return this.call('retryPending', {}, undefined, options); }
    unlock(input, options) { return this.call('unlock', input, undefined, options); }
    sync(options) { return this.call('sync', {}, undefined, options); }
    friendsList(options) { return this.call('friends', {}, undefined, options); }
    requests(options) { return this.call('requests', {}, undefined, options); }
    requestFriend(handle, note, options) { return this.call('requestFriend', { handle, note }, undefined, options); }
    respondRequest(id, action, options) { return this.call('respondRequest', { id, action }, undefined, options); }
    block(handle, options) { return this.call('block', { handle }, undefined, options); }
    unfriend(handle, options) { return this.call('unfriend', { handle }, undefined, options); }
    chats(options) { return this.call('chats', {}, undefined, options); }
    messages(filter = {}, options) { return this.call('messages', filter, undefined, options); }
    focus(filter, options) { return this.call('focus', filter, undefined, options); }
    markSeen(ids, options) { return this.call('markSeen', { ids }, undefined, options); }
    send(input, operationId = crypto.randomUUID(), options) { return this.call('send', input, operationId, options); }
    sendGroup(input, operationId = crypto.randomUUID(), options) { return this.call('sendGroup', input, operationId, options); }
    sendFile(input, operationId = crypto.randomUUID(), options) { return this.call('sendFile', input, operationId, options); }
    sendAttachments(input, operationId = crypto.randomUUID(), options) { return this.call('sendAttachments', input, operationId, options); }
    createGroup(name, handles, options) { return this.call('createGroup', { name, handles }, undefined, options); }
    groupsList(options) { return this.call('groups', {}, undefined, options); }
    addMember(groupId, accountId, options) { return this.call('addMember', { groupId, accountId }, undefined, options); }
    removeMember(groupId, memberId, options) { return this.call('removeMember', { groupId, memberId }, undefined, options); }
    leaveGroup(groupId, options) { return this.call('leaveGroup', { groupId }, undefined, options); }
    safetyNumber(handle, options) { return this.call('safetyNumber', { handle }, undefined, options); }
    trustIdentity(handle, options) { return this.call('trustIdentity', { handle }, undefined, options); }
    markVerified(handle, options) { return this.call('markVerified', { handle }, undefined, options); }
    dropExpired(options) { return this.call('dropExpired', {}, undefined, options); }
    async attachment(mediaId, options) {
        const result = await this.call('attachment', { mediaId }, undefined, options);
        return base64ToBytes(result.base64);
    }
    lock(options) { return this.call('lock', {}, undefined, options); }
    /** Revoke this local client capability. Server token revocation is RelayService.revoke(). */
    async revoke() { await this.terminate('revoked'); }
    async close() { await this.terminate('closed'); }
    async terminate(code) {
        if (this.closed)
            return;
        this.closureCode = code;
        this.closed = true;
        this.lifecycle.abort();
        await this.transport.close?.();
    }
}
/** Encoding only; these helpers perform no encryption and carry no private state. */
export function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}
export function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function boundedJson(response) {
    if (!response.body)
        return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            length += next.value.length;
            if (length > 64 * 1024 * 1024)
                throw new AgentError('Agent response exceeds 64 MiB', 'protocol');
            chunks.push(next.value);
        }
    }
    catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        return null;
    }
}
function withAbort(work, signal, code) {
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(new AgentError('Agent request was cancelled or closed; delivery may be uncertain', code())); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
        work.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted)
            resolve(value); }, error => { signal.removeEventListener('abort', abort); if (!signal.aborted)
            reject(error); });
    });
}
