/**
 * ChannelTransport - Abstract bidirectional transport interface
 *
 * All transports appear bidirectional from the caller's perspective.
 * The transport encapsulates HOW it sends/receives:
 * - SSE: receives via EventSource, sends via HTTP POST
 * - WebSocket: sends and receives on same connection
 * - Polling: receives via polling, sends via HTTP POST
 *
 * @example
 * ```typescript
 * // SSE transport (internally uses HTTP for send)
 * const transport = new SSETransport({
 *   buildUrl: () => '/events/sse',
 *   sendUrl: '/events',
 * });
 *
 * // WebSocket transport (uses WS for both)
 * const transport = new WebSocketTransport({
 *   url: 'wss://api.example.com/ws',
 * });
 *
 * // Both used the same way
 * transport.connect();
 * transport.onMessage((data) => console.log(data));
 * await transport.send({ channel: 'foo', type: 'bar', payload: {} });
 * ```
 */

export type TransportState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export interface TransportInfo {
  state: TransportState;
  reconnectAttempts: number;
  lastError?: Error;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
}

export interface TransportCallbacks {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onReconnecting?: (attempt: number, delay: number) => void;
  onReconnected?: (attempts: number) => void;
  onReconnectFailed?: (attempts: number) => void;
  onError?: (error: unknown) => void;
  onOffline?: () => void;
  onOnline?: () => void;
  onStateChange?: (state: TransportState, info: TransportInfo) => void;
}

/**
 * Base transport interface - all transports implement this
 */
export interface ChannelTransport {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Connect to the transport */
  connect(): void;

  /** Disconnect from the transport */
  disconnect(): void;

  /** Force reconnection */
  reconnect(): void;

  /** Dispose and cleanup all resources */
  dispose(): void;

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Register a message handler.
   * @returns Unsubscribe function
   */
  onMessage(handler: (data: unknown) => void): () => void;

  /**
   * Send data through the transport.
   * How this is implemented depends on the transport:
   * - SSE: HTTP POST to configured endpoint
   * - WebSocket: ws.send()
   * - Polling: HTTP POST
   *
   * @returns Response from the send operation (e.g., HTTP response body)
   */
  send<T = unknown>(data: unknown): Promise<T>;

  // ===========================================================================
  // State
  // ===========================================================================

  /** Get current connection state */
  getState(): TransportState;

  /** Get detailed connection info */
  getInfo(): TransportInfo;

  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Common configuration for transports with reconnection
 */
export interface TransportReconnectConfig {
  /** Base reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;

  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;

  /** Max reconnect attempts (0 = infinite, default: 0) */
  maxReconnectAttempts?: number;

  /** Jitter factor for reconnect delay (default: 0.25 = ±25%) */
  reconnectJitter?: number;
}
