import { type AgentRequest, type AgentResponse, type AgentViews, type AttachmentsInput, type ChatSummary, type ConversationFilter, type FileInput, type FocusResult, type FriendRequestView, type GroupSendInput, type GroupView, type PublicMessage, type SendInput, type Status, type SyncResult, type AttachInput, type IdentityDecisionResult, type PendingSendView, type AgentEvent, type OperationName, type OperationInput, type OperationOutput, type AgentCapabilities, type LicenseInfo, type Stay, type FriendSummary } from '@e2ee/protocol/standalone';
export * from '@e2ee/protocol/standalone';
export { RelayService, type RelayServiceOptions } from './relay-service.js';
export type RequestOptions = {
    signal?: AbortSignal;
};
export type EventListener = (event: AgentEvent) => void;
export interface AgentTransport {
    request(request: AgentRequest, options?: RequestOptions): Promise<AgentResponse>;
    subscribe?(listener: EventListener): () => void;
    close?(): void | Promise<void>;
}
/** Authenticated loopback transport. Browser applications use the separate-origin MessagePort transport. */
export declare class HttpAgentTransport implements AgentTransport {
    private readonly capability;
    private readonly fetcher;
    private readonly url;
    private closed;
    private readonly pending;
    constructor(baseUrl: string, capability: string, fetcher?: typeof fetch);
    request(request: AgentRequest, options?: RequestOptions): Promise<AgentResponse>;
    close(): void;
}
/** A port is usable only after the caller completes the agent's origin/source/nonce handshake. */
export declare class MessagePortTransport implements AgentTransport {
    private readonly port;
    private readonly timeoutMs;
    private closed;
    private readonly usedIds;
    private readonly listeners;
    private readonly pending;
    private readonly onMessage;
    constructor(port: MessagePort, timeoutMs?: number);
    private readonly onError;
    subscribe(listener: EventListener): () => void;
    request(request: AgentRequest, options?: RequestOptions): Promise<AgentResponse>;
    close(code?: string): void;
}
export declare class AgentClient {
    private readonly transport;
    private closed;
    private closureCode;
    private readonly lifecycle;
    constructor(transport: AgentTransport);
    call<T = unknown>(operation: string, input?: Record<string, unknown>, operationId?: string, options?: RequestOptions): Promise<T>;
    command<K extends OperationName>(operation: K, input: OperationInput<K>, options?: RequestOptions & {
        operationId?: string;
    }): Promise<OperationOutput<K>>;
    subscribe(listener: EventListener): () => void;
    capabilities(options?: RequestOptions): Promise<AgentCapabilities>;
    license(options?: RequestOptions): Promise<LicenseInfo>;
    setStay(stay: Stay, options?: RequestOptions): Promise<{
        stay: Stay;
    }>;
    disconnect(options?: RequestOptions): Promise<{
        unlocked: false;
    }>;
    status(options?: RequestOptions): Promise<Status>;
    views(options?: RequestOptions): Promise<AgentViews>;
    attach(input: AttachInput, options?: RequestOptions): Promise<Status>;
    requestUnlock(options?: RequestOptions): Promise<Status & {
        pending?: boolean;
    }>;
    cryptoDiagnostic(options?: RequestOptions): Promise<{
        ok: boolean;
        message: string;
        description?: string;
    }>;
    pendingSends(options?: RequestOptions): Promise<PendingSendView[]>;
    retryPending(options?: RequestOptions): Promise<PublicMessage[]>;
    unlock(input: {
        handle: string;
        password: string;
        replaceKeys?: boolean;
    }, options?: RequestOptions): Promise<Status>;
    sync(options?: RequestOptions): Promise<SyncResult>;
    friendsList(options?: RequestOptions): Promise<FriendSummary[]>;
    requests(options?: RequestOptions): Promise<FriendRequestView[]>;
    requestFriend(handle: string, note?: string, options?: RequestOptions): Promise<FriendRequestView[]>;
    respondRequest(id: string, action: 'accept' | 'decline' | 'cancel', options?: RequestOptions): Promise<FriendRequestView[]>;
    block(handle: string, options?: RequestOptions): Promise<{
        ok: true;
    }>;
    unfriend(handle: string, options?: RequestOptions): Promise<{
        ok: true;
    }>;
    chats(options?: RequestOptions): Promise<ChatSummary[]>;
    messages(filter?: ConversationFilter, options?: RequestOptions): Promise<PublicMessage[]>;
    focus(filter: ConversationFilter, options?: RequestOptions): Promise<FocusResult>;
    markSeen(ids: string[], options?: RequestOptions): Promise<{
        seen: number;
    }>;
    send(input: SendInput, operationId?: string, options?: RequestOptions): Promise<PublicMessage>;
    sendGroup(input: GroupSendInput, operationId?: string, options?: RequestOptions): Promise<PublicMessage>;
    sendFile(input: FileInput, operationId?: string, options?: RequestOptions): Promise<PublicMessage>;
    sendAttachments(input: AttachmentsInput, operationId?: string, options?: RequestOptions): Promise<PublicMessage>;
    createGroup(name: string, handles: string[], options?: RequestOptions): Promise<{
        id: string;
        name: string;
        memberIds: string[];
    }>;
    groupsList(options?: RequestOptions): Promise<GroupView[]>;
    addMember(groupId: string, accountId: string, options?: RequestOptions): Promise<{
        memberIds: string[];
    }>;
    removeMember(groupId: string, memberId: string, options?: RequestOptions): Promise<{
        ok: true;
    }>;
    leaveGroup(groupId: string, options?: RequestOptions): Promise<{
        ok: true;
    }>;
    safetyNumber(handle: string, options?: RequestOptions): Promise<{
        handle: string;
        safetyNumber: string;
        verified: boolean;
    }>;
    trustIdentity(handle?: string, options?: RequestOptions): Promise<IdentityDecisionResult>;
    markVerified(handle: string, options?: RequestOptions): Promise<IdentityDecisionResult>;
    dropExpired(options?: RequestOptions): Promise<string[]>;
    attachment(mediaId: string, options?: RequestOptions): Promise<Uint8Array>;
    lock(options?: RequestOptions): Promise<{
        unlocked: false;
    }>;
    /** Revoke this local client capability. Server token revocation is RelayService.revoke(). */
    revoke(): Promise<void>;
    close(): Promise<void>;
    private terminate;
}
/** Encoding only; these helpers perform no encryption and carry no private state. */
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function base64ToBytes(value: string): Uint8Array;
