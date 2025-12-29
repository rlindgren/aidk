/**
 * # AIDK Channels
 *
 * Real-time bidirectional communication channels for AIDK agents.
 * Enables pub/sub messaging between server and clients.
 *
 * ## Features
 *
 * - **ChannelService** - Manage channel subscriptions and publishing
 * - **ChannelRouter** - Route messages to handlers
 * - **Transports** - WebSocket, Socket.IO, HTTP streaming
 * - **Adapters** - Redis for distributed deployments
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ChannelService } from 'aidk/channels';
 *
 * const channels = new ChannelService();
 *
 * // Subscribe to a channel
 * channels.subscribe('my-channel', (event) => {
 *   console.log('Received:', event);
 * });
 *
 * // Publish to a channel
 * await channels.publish('my-channel', 'my-event', { data: 'hello' });
 * ```
 *
 * @see {@link ChannelService} - Main channel service
 * @see {@link ChannelRouter} - Message routing
 *
 * @module aidk/channels
 */

export * from "./service";
export * from "./transports";
export * from "./adapters";
