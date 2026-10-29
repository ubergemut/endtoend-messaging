/** Wire-only contracts. This package deliberately has no implementation dependencies. */
export const PROTOCOL_VERSION = 1;
export const VERSION = PROTOCOL_VERSION;
export const SDK_VERSION = '0.2.1';
export const AGENT_EVENTS = ['views', 'status', 'locked', 'revoked', 'disconnected'];
export function isAgentEvent(value) {
    return isRecord(value) && value.version === 1 && AGENT_EVENTS.includes(value.event)
        && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
        && (value.accountId === undefined || value.accountId === null || typeof value.accountId === 'string')
        && (value.reason === undefined || typeof value.reason === 'string');
}
/** Known v1 codes; consumers must retain an unknown-code fallback for additive releases. */
export const ERROR_CODES = ['invalid', 'unauthorized', 'forbidden', 'locked', 'untrusted', 'replace-keys',
    'vault', 'device-key', 'relay', 'internal', 'protocol', 'timeout', 'cancelled', 'closed', 'revoked'];
export class AgentError extends Error {
    code;
    constructor(message, code = 'invalid') {
        super(message);
        this.code = code;
        this.name = 'AgentError';
    }
}
/** Compatibility name for adapters; this error contains no session implementation. */
export { AgentError as HeadlessError };
export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isAgentRequest(value) {
    if (!isRecord(value))
        return false;
    return value.version === 1 && validId(value.requestId) && typeof value.operation === 'string'
        && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(value.operation) && isRecord(value.input)
        && (value.operationId === undefined || validId(value.operationId));
}
export function isAgentResponse(value) {
    if (!isRecord(value) || value.version !== 1 || !validId(value.requestId))
        return false;
    if (value.ok === true)
        return Object.hasOwn(value, 'result');
    return value.ok === false && isRecord(value.error)
        && typeof value.error.code === 'string' && typeof value.error.message === 'string';
}
export function validateRequest(value) {
    if (!isAgentRequest(value))
        throw new AgentError('Invalid protocol v1 request', 'invalid');
    return value;
}
export const validateAgentRequest = validateRequest;
function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
}
export const LEGACY_OPERATIONS = [
    'status', 'unlock', 'sync', 'friends', 'requests', 'requestFriend', 'respondRequest', 'block', 'unfriend',
    'chats', 'messages', 'focus', 'markSeen', 'send', 'sendGroup', 'sendFile', 'createGroup', 'groups',
    'safetyNumber', 'trustIdentity', 'markVerified',
];
export const OPERATIONS = ['license', 'capabilities', 'status', 'views', 'attach', 'requestUnlock', 'setStay', 'unlock',
    'cryptoDiagnostic', 'sync', 'friends', 'friendsList', 'requests', 'requestFriend', 'respondRequest', 'block', 'unfriend',
    'chats', 'messages', 'focus', 'markSeen', 'dropExpired', 'send', 'sendGroup', 'sendFile', 'sendAttachments', 'pendingSends',
    'retryPending', 'attachment', 'createGroup', 'groups', 'groupsList', 'addMember', 'removeMember', 'leaveGroup',
    'safetyNumber', 'trustIdentity', 'markVerified', 'lock', 'close', 'disconnect'];
export const MESSAGING_PATHS = {
    metadata: '/messaging/v1/metadata', exchange: '/messaging/v1/session/exchange', bootstrap: '/messaging/v1/session',
    revoke: '/messaging/v1/session/revoke', hostRevoke: '/messaging/v1/host/revoke',
};
