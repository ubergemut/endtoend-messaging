/** MIT transport for public host identity exchange. No signing keys, cookies, encryption or agent implementation. */
import { type AttachInput, type MessagingMetadata, type MessagingGrant, type MessagingBootstrap, type Stay } from '@e2ee/protocol/standalone';
import type { RequestOptions } from './index.js';
export type RelayServiceOptions = {
    audience: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
};
/** The configured origin and audience are trusted configuration, never values supplied by a grant. */
export declare class RelayService {
    readonly baseUrl: string;
    readonly audience: string;
    private readonly fetcher;
    private readonly timeoutMs;
    private readonly maxResponseBytes;
    private readonly lifetime;
    private closed;
    constructor(baseUrl: string, options: RelayServiceOptions);
    metadata(options?: RequestOptions): Promise<MessagingMetadata>;
    exchange(assertion: string, options?: RequestOptions): Promise<MessagingGrant>;
    session(messagingToken: string, options?: RequestOptions): Promise<MessagingBootstrap>;
    revoke(messagingToken: string, options?: RequestOptions): Promise<{
        ok: true;
    }>;
    hostRevoke(assertion: string, options?: RequestOptions): Promise<{
        ok: true;
    }>;
    attachInput(grant: MessagingGrant, stay?: Stay): AttachInput;
    close(): void;
    private versioned;
    private request;
}
