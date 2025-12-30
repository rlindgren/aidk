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

import type { ChannelTransport, TransportState, TransportInfo } from "./transport";

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

export class ChannelClient {
  private transport: ChannelTransport;
  private handlers = new Map<string, Set<EventHandler>>();
  private publishOverride?: <T = unknown>(
    channel: string,
    type: string,
    payload?: unknown,
  ) => Promise<T>;
  private isChannelEvent: (data: unknown) => data is ChannelEvent;
  private unsubscribeTransport?: () => void;

  constructor(config: ChannelClientConfig) {
    this.transport = config.transport;
    this.publishOverride = config.publish;
    this.isChannelEvent = config.isChannelEvent || this.defaultIsChannelEvent;

    // Subscribe to transport messages
    this.unsubscribeTransport = this.transport.onMessage((data) => this.handleMessage(data));
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Subscribe to channel events.
   * @returns Unsubscribe function
   */
  subscribe(channelFilter: string | string[], handler: EventHandler): () => void {
    const channels = Array.isArray(channelFilter) ? channelFilter : [channelFilter];

    for (const channel of channels) {
      if (!this.handlers.has(channel)) {
        this.handlers.set(channel, new Set());
      }
      this.handlers.get(channel)!.add(handler);

      if (channel === "todo-list") {
        console.log(
          `[ChannelClient] Subscribed to ${channel}, total handlers:`,
          this.handlers.get(channel)?.size,
        );
      }
    }

    // Connect transport if we have handlers
    if (this.handlers.size > 0 && !this.transport.isConnected()) {
      console.log("[ChannelClient] Connecting transport...");
      this.transport.connect();
    }

    return () => {
      for (const channel of channels) {
        this.handlers.get(channel)?.delete(handler);
        if (this.handlers.get(channel)?.size === 0) {
          this.handlers.delete(channel);
        }
      }

      // Disconnect if no more handlers
      if (this.handlers.size === 0) {
        console.log("[ChannelClient] No more handlers, disconnecting transport");
        this.transport.disconnect();
      }
    };
  }

  /**
   * Publish an event to a channel.
   * Uses publish override if provided, otherwise sends via transport.
   */
  async publish<T = unknown>(channel: string, type: string, payload?: unknown): Promise<T> {
    if (this.publishOverride) {
      return this.publishOverride<T>(channel, type, payload);
    }

    // Default: send channel event structure via transport
    return this.transport.send<T>({ channel, type, payload });
  }

  /**
   * Get connection state
   */
  getState(): TransportState {
    return this.transport.getState();
  }

  /**
   * Get connection info
   */
  getInfo(): TransportInfo {
    return this.transport.getInfo();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.transport.isConnected();
  }

  /**
   * Force reconnection
   */
  reconnect(): void {
    if (this.handlers.size > 0) {
      this.transport.reconnect();
    }
  }

  /**
   * Disconnect (clears all handlers)
   */
  disconnect(): void {
    this.handlers.clear();
    this.transport.disconnect();
  }

  /**
   * Dispose of client and cleanup
   */
  dispose(): void {
    this.unsubscribeTransport?.();
    this.handlers.clear();
    this.transport.dispose();
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private defaultIsChannelEvent(data: unknown): data is ChannelEvent {
    return (
      typeof data === "object" &&
      data !== null &&
      "channel" in data &&
      "type" in data &&
      typeof (data as ChannelEvent).channel === "string" &&
      typeof (data as ChannelEvent).type === "string"
    );
  }

  private handleMessage(data: unknown): void {
    if (!this.isChannelEvent(data)) {
      return;
    }

    const event = data;

    if (event.channel === "todo-list") {
      console.log(
        `[ChannelClient] Received event for ${event.channel}:`,
        event.type,
        "handlers:",
        this.handlers.get(event.channel)?.size || 0,
      );
    }

    // Dispatch to channel-specific handlers
    const handlers = this.handlers.get(event.channel);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    } else if (event.channel === "todo-list") {
      console.warn(`[ChannelClient] No handlers found for channel: ${event.channel}`);
    }

    // Dispatch to wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(event);
      }
    }
  }
}
