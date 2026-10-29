/** Wire-only contracts. This package deliberately has no implementation dependencies. */
export declare const PROTOCOL_VERSION: 1;
export declare const VERSION: 1;
export declare const SDK_VERSION: "0.2.1";
export type AgentRequest = {
    version: 1;
    requestId: string;
    operation: string;
    input: Record<string, unknown>;
    operationId?: string;
};
export type AgentResponse<T = unknown> = {
    version: 1;
    requestId: string;
    ok: true;
    result: T;
} | {
    version: 1;
    requestId: string;
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
export declare const AGENT_EVENTS: readonly ["views", "status", "locked", "revoked", "disconnected"];
export type AgentEventName = typeof AGENT_EVENTS[number];
export type AgentEvent = {
    version: 1;
    event: AgentEventName;
    revision: number;
    accountId?: string | null;
    reason?: string;
};
export declare function isAgentEvent(value: unknown): value is AgentEvent;
/** Known v1 codes; consumers must retain an unknown-code fallback for additive releases. */
export declare const ERROR_CODES: readonly ["invalid", "unauthorized", "forbidden", "locked", "untrusted", "replace-keys", "vault", "device-key", "relay", "internal", "protocol", "timeout", "cancelled", "closed", "revoked"];
export type AgentErrorCode = typeof ERROR_CODES[number];
export declare class AgentError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
/** Compatibility name for adapters; this error contains no session implementation. */
export { AgentError as HeadlessError };
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function isAgentRequest(value: unknown): value is AgentRequest;
export declare function isAgentResponse(value: unknown): value is AgentResponse;
export declare function validateRequest(value: unknown): AgentRequest;
export declare const validateAgentRequest: typeof validateRequest;
export type Account = {
    id: string;
    handle: string;
    displayName: string;
};
export type FriendView = Account & {
    identityKey: string | null;
    verified: boolean;
};
/** List command returns verification state; full views additionally contain the public identity. */
export type FriendSummary = Omit<FriendView, 'identityKey'>;
export type Friend = FriendView;
export type FriendRequestView = {
    id: string;
    direction: 'incoming' | 'outgoing';
    handle: string;
    status: string;
    note: string | null;
};
/** Read handles and presentation metadata only; encryption keys/nonces never cross the interface. */
export type AttachmentView = {
    mediaId: string;
    mime: string;
    name: string;
};
export type Attachment = AttachmentView;
export type MessageView = {
    id: string;
    peerId: string | null;
    groupId: string | null;
    body: string;
    fromMe: boolean;
    senderId?: string | null;
    senderHandle?: string | null;
    expiresAt: string | null;
    at: string;
    replyTo?: string | null;
    quote?: string | null;
    status?: 'sent' | 'delivered';
    system?: boolean;
    envelopeCiphertext?: string | null;
    mediaCiphertext?: string | null;
    attachments?: AttachmentView[];
};
export type GroupView = {
    id: string;
    name: string;
    memberIds: string[];
    memberHandles: string[];
};
export type PublicPeer = {
    identityKey?: string;
    verifiedIdentityKey?: string | null;
};
export type AgentViews = {
    accountId?: string;
    handle?: string;
    messages: MessageView[];
    friends: FriendView[];
    groups: GroupView[];
    seen: string[];
    peers: Record<string, PublicPeer>;
    pendingTrust: {
        peerId: string;
        identityKey: string;
    } | null;
    revision: number;
};
export type PublicMessage = {
    id: string;
    peerId: string | null;
    handle: string | null;
    groupId: string | null;
    groupName: string | null;
    body: string;
    fromMe: boolean;
    replyTo: string | null;
    quote: string | null;
    at: string;
    unseen: boolean;
    status: string | null;
    system: boolean;
    attachmentNames: string[];
    serverCiphertext: string | null;
};
export type ChatSummary = {
    peerId: string | null;
    groupId: string | null;
    handle: string | null;
    title: string;
    preview: string;
    at: string;
    unseen: number;
};
export type Status = {
    unlocked: boolean;
    handle: string | null;
    accountId: string | null;
    relay: string;
    vaultPath: string;
    pendingTrustHandle: string | null;
};
export type SyncResult = {
    messages: PublicMessage[];
    pendingTrustHandle: string | null;
};
export type FocusResult = {
    message: PublicMessage | null;
    threadId: string | null;
};
export type ConversationFilter = {
    handle?: string;
    groupId?: string;
};
export type SendInput = {
    handle: string;
    body: string;
    replyTo?: string;
    expiresInSeconds?: number;
};
export type GroupSendInput = {
    groupId: string;
    body: string;
    replyTo?: string;
    expiresInSeconds?: number;
};
export type FileInput = ConversationFilter & {
    name: string;
    mime: string;
    base64: string;
    body?: string;
    replyTo?: string;
    expiresInSeconds?: number;
};
export type AttachmentsInput = ConversationFilter & {
    body?: string;
    replyTo?: string;
    expiresInSeconds?: number;
    files: {
        name: string;
        mime: string;
        base64: string;
    }[];
};
export type AgentReady = {
    type: 'agent-ready';
    version: 1;
    url: string;
    capability: string;
};
export type AttachInput = {
    relay: string;
    token: string;
    expectedAccountId: string;
    stay?: 'tab' | 'day' | 'week' | 'month' | 'forever';
    authorization?: {
        audience: string;
        bootstrapPath: '/messaging/v1/session';
    };
};
export type IdentityDecisionResult = {
    ok?: true;
    pending?: true;
};
export type PendingSendView = {
    operationId: string;
    handle: string | null;
    groupId: string | null;
    body: string;
    replyTo: string | null;
    attachmentNames: string[];
    state: 'pending' | 'blocked';
    reason: 'membership-changed' | null;
};
export declare const LEGACY_OPERATIONS: readonly ["status", "unlock", "sync", "friends", "requests", "requestFriend", "respondRequest", "block", "unfriend", "chats", "messages", "focus", "markSeen", "send", "sendGroup", "sendFile", "createGroup", "groups", "safetyNumber", "trustIdentity", "markVerified"];
export type Stay = NonNullable<AttachInput['stay']>;
export type LicenseInfo = {
    license: 'AGPL-3.0-only';
    clientLicense: 'MIT';
    version: string;
    sourceUrl: string | null;
};
export type AgentCapabilities = {
    version: 1;
    protocolVersion: 1;
    operations: OperationName[];
    events: AgentEventName[];
    cancellation: 'local-only';
    operationIds: 'send-idempotency';
    attachments: 'base64';
    transport?: 'message-port' | 'http' | 'local';
};
type Command<I, O> = {
    input: I;
    output: O;
};
type Empty = Record<string, never>;
/** The complete v1 dispatcher surface, including all 21 original operation names. */
export interface OperationMap {
    license: Command<Empty, LicenseInfo>;
    capabilities: Command<Empty, AgentCapabilities>;
    status: Command<Empty, Status>;
    views: Command<Empty, AgentViews>;
    attach: Command<AttachInput, Status>;
    requestUnlock: Command<Empty, Status & {
        pending?: boolean;
    }>;
    setStay: Command<{
        stay: Stay;
    }, {
        stay: Stay;
    }>;
    unlock: Command<{
        handle: string;
        password: string;
        replaceKeys?: boolean;
    }, Status>;
    cryptoDiagnostic: Command<Empty, {
        ok: boolean;
        message: string;
        description?: string;
    }>;
    sync: Command<Empty, SyncResult>;
    friends: Command<Empty, FriendSummary[]>;
    friendsList: Command<Empty, FriendSummary[]>;
    requests: Command<Empty, FriendRequestView[]>;
    requestFriend: Command<{
        handle: string;
        note?: string;
    }, FriendRequestView[]>;
    respondRequest: Command<{
        id: string;
        action: 'accept' | 'decline' | 'cancel';
    }, FriendRequestView[]>;
    block: Command<{
        handle: string;
    }, {
        ok: true;
    }>;
    unfriend: Command<{
        handle: string;
    }, {
        ok: true;
    }>;
    chats: Command<Empty, ChatSummary[]>;
    messages: Command<ConversationFilter, PublicMessage[]>;
    focus: Command<ConversationFilter, FocusResult>;
    markSeen: Command<{
        ids: string[];
    }, {
        seen: number;
    }>;
    dropExpired: Command<Empty, string[]>;
    send: Command<SendInput, PublicMessage>;
    sendGroup: Command<GroupSendInput, PublicMessage>;
    sendFile: Command<FileInput, PublicMessage>;
    sendAttachments: Command<AttachmentsInput, PublicMessage>;
    pendingSends: Command<Empty, PendingSendView[]>;
    retryPending: Command<Empty, PublicMessage[]>;
    attachment: Command<{
        mediaId: string;
    }, {
        base64: string;
    }>;
    createGroup: Command<{
        name: string;
        handles: string[];
    }, {
        id: string;
        name: string;
        memberIds: string[];
    }>;
    groups: Command<Empty, GroupView[]>;
    groupsList: Command<Empty, GroupView[]>;
    addMember: Command<{
        groupId: string;
        accountId: string;
    }, {
        memberIds: string[];
    }>;
    removeMember: Command<{
        groupId: string;
        memberId: string;
    }, {
        ok: true;
    }>;
    leaveGroup: Command<{
        groupId: string;
    }, {
        ok: true;
    }>;
    safetyNumber: Command<{
        handle: string;
    }, {
        handle: string;
        safetyNumber: string;
        verified: boolean;
    }>;
    trustIdentity: Command<{
        handle?: string;
    }, IdentityDecisionResult>;
    markVerified: Command<{
        handle: string;
    }, IdentityDecisionResult>;
    lock: Command<Empty, {
        unlocked: false;
    }>;
    close: Command<Empty, {
        unlocked: false;
    }>;
    disconnect: Command<Empty, {
        unlocked: false;
    }>;
}
export type OperationName = keyof OperationMap;
export type OperationInput<K extends OperationName> = OperationMap[K]['input'];
export type OperationOutput<K extends OperationName> = OperationMap[K]['output'];
export declare const OPERATIONS: readonly ["license", "capabilities", "status", "views", "attach", "requestUnlock", "setStay", "unlock", "cryptoDiagnostic", "sync", "friends", "friendsList", "requests", "requestFriend", "respondRequest", "block", "unfriend", "chats", "messages", "focus", "markSeen", "dropExpired", "send", "sendGroup", "sendFile", "sendAttachments", "pendingSends", "retryPending", "attachment", "createGroup", "groups", "groupsList", "addMember", "removeMember", "leaveGroup", "safetyNumber", "trustIdentity", "markVerified", "lock", "close", "disconnect"];
export declare const MESSAGING_PATHS: {
    readonly metadata: "/messaging/v1/metadata";
    readonly exchange: "/messaging/v1/session/exchange";
    readonly bootstrap: "/messaging/v1/session";
    readonly revoke: "/messaging/v1/session/revoke";
    readonly hostRevoke: "/messaging/v1/host/revoke";
};
export type MessagingMetadata = {
    version: 1;
    protocolVersion: 1;
    audience: string;
    endpoints: Pick<typeof MESSAGING_PATHS, 'exchange' | 'bootstrap' | 'revoke' | 'hostRevoke'>;
};
/** Compact assertion = base64url(exact UTF-8 JSON payload).base64url(Ed25519 signature of those bytes). */
export type HostAssertionClaims = {
    version: 1;
    keyId: string;
    issuer: string;
    subject: string;
    audience: string;
    issuedAt: number;
    expiresAt: number;
    nonce: string;
    purpose: 'session' | 'revoke';
    handle?: string;
    displayName?: string;
};
export type MessagingGrant = {
    version: 1;
    protocolVersion: 1;
    audience: string;
    token: string;
    expiresAt: string;
    account: Account;
    bootstrapPath: typeof MESSAGING_PATHS.bootstrap;
};
export type MessagingBootstrap = {
    version: 1;
    protocolVersion: 1;
    audience: string;
    account: Account;
    enrolled: boolean;
    identityKey: string | null;
    expiresAt: string;
};
