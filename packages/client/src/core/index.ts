/**
 * Core client primitives
 * 
 * Transport-agnostic building blocks:
 * - ChannelTransport: Interface for any transport (SSE, WebSocket, etc.)
 * - SSETransport: SSE implementation of ChannelTransport
 * - ChannelClient: Pub/sub over any transport
 * 
 * @example
 * ```typescript
 * // Use SSE transport
 * const transport = new SSETransport({
 *   buildUrl: () => '/events/sse',
 *   send: (data) => fetch('/events', { method: 'POST', body: JSON.stringify(data) }),
 * });
 * 
 * const channels = new ChannelClient({ transport });
 * channels.subscribe('my-channel', handler);
 * await channels.publish('my-channel', 'event-type', { data: 'value' });
 * ```
 */

// Transport interface
export type {
  ChannelTransport,
  TransportState,
  TransportInfo,
  TransportCallbacks,
  TransportReconnectConfig,
} from './transport';

// SSE transport implementation
export { 
  SSETransport,
  type SSETransportConfig,
} from './sse-transport';

// Channel client (uses any transport)
export {
  ChannelClient,
  type ChannelClientConfig,
  type ChannelEvent,
} from './channel-client';

// Legacy exports for backwards compatibility
// (SSEClient is now SSETransport)
export { SSETransport as SSEClient } from './sse-transport';
export type { SSETransportConfig as SSEClientConfig } from './sse-transport';
export type { TransportState as SSEConnectionState } from './transport';
export type { TransportInfo as SSEConnectionInfo } from './transport';
export type { TransportCallbacks as SSEClientCallbacks } from './transport';
