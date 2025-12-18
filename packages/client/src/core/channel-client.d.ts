/**
 * ChannelClient - Pub/sub over any transport
 *
 * Transport-agnostic channel communication. Works with any transport
 * that implements the ChannelTransport interface (SSE, WebSocket, etc.).
 *
 * @example
 * ```typescript
 * // With SSE transport
 * const channels = new ChannelClient({
 *   transport: new SSETransport({
 *     buildUrl: () => '/events/sse',
 *     send: (data) => fetch('/events', { method: 'POST', body: JSON.stringify(data) }),
 *   }),
 * });
 *
 * // With WebSocket transport (hypothetical)
 * const channels = new ChannelClient({
 *   transport: new WebSocketTransport({ url: 'wss://...' }),
 * });
 *
 * // Usage is the same regardless of transport
 * channels.subscribe('my-channel', (event) => console.log(event));
 * await channels.publish('my-channel', 'my-event', { data: 'value' });
 * ```
 */
import type { ChannelTransport, TransportState, TransportInfo } from './transport';
export interface ChannelEvent {
    channel: string;
    type: string;
    payload: unknown;
    metadata?: Record<string, unknown>;
}
export interface ChannelClientConfig {
    /** Transport for send/receive */
    transport: ChannelTransport;
    /**
     * Optional override for publish.
     * If not provided, uses transport.send() with channel event structure.
     */
    publish?: <T = unknown>(channel: string, type: string, payload?: unknown) => Promise<T>;
    /**
     * Optional filter to determine if a message is a channel event.
     * Default: checks for `channel` and `type` properties.
     */
    isChannelEvent?: (data: unknown) => data is ChannelEvent;
}
type EventHandler = (event: ChannelEvent) => void;
export declare class ChannelClient {
    private transport;
    private handlers;
    private publishOverride?;
    private isChannelEvent;
    private unsubscribeTransport?;
    constructor(config: ChannelClientConfig);
    /**
     * Subscribe to channel events.
     * @returns Unsubscribe function
     */
    subscribe(channelFilter: string | string[], handler: EventHandler): () => void;
    /**
     * Publish an event to a channel.
     * Uses publish override if provided, otherwise sends via transport.
     */
    publish<T = unknown>(channel: string, type: string, payload?: unknown): Promise<T>;
    /**
     * Get connection state
     */
    getState(): TransportState;
    /**
     * Get connection info
     */
    getInfo(): TransportInfo;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Force reconnection
     */
    reconnect(): void;
    /**
     * Disconnect (clears all handlers)
     */
    disconnect(): void;
    /**
     * Dispose of client and cleanup
     */
    dispose(): void;
    private defaultIsChannelEvent;
    private handleMessage;
}
export {};
//# sourceMappingURL=channel-client.d.ts.map