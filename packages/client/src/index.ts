/**
 * Engine Client Package
 * 
 * Two layers:
 * 1. Core primitives (SSETransport, ChannelClient) - transport-agnostic
 * 2. EngineClient - opinionated layer with our conventions
 * 
 * @example
 * ```typescript
 * // Use the opinionated client (recommended)
 * import { EngineClient, createEngineClient } from '@example/packages/client';
 * 
 * const client = createEngineClient({
 *   baseUrl: 'http://localhost:3001',
 *   userId: 'user-123',
 * });
 * 
 * // Or use core primitives for custom transports
 * import { SSETransport, ChannelClient } from '@example/packages/client/core';
 * 
 * const transport = new SSETransport({
 *   buildUrl: () => '/my/sse/endpoint',
 *   send: (data) => fetch('/my/publish', { method: 'POST', body: JSON.stringify(data) }),
 * });
 * 
 * const channels = new ChannelClient({ transport });
 * ```
 */

// Opinionated engine client
export { 
  EngineClient, 
  getEngineClient, 
  createEngineClient,
  type EngineClientConfig,
  type EngineRoutes,
  type ConnectionState,
  type ConnectionInfo,
  type EngineClientCallbacks,
  type ExecutionResult,
  type Execution,
  type ExecutionMetrics,
} from './engine-client';
// Note: EngineStreamEvent and EngineInput are exported from './types'

// Legacy types re-export
export * from './types';

// Execution handler (framework-agnostic)
export {
  ExecutionHandler,
  StreamProcessor,
  createMessage,
  normalizeMessageInput,
  generateMessageId,
  type MessageInput,
  type StreamEvent,
  type StreamEventContext,
  type StreamProcessorCallbacks,
  type ExecutionHandlerCallbacks,
  type ExecutionHandlerConfig,
  type SendMessageOptions,
} from './execution-handler';

// Channel abstraction (uses core ChannelClient internally)
export { 
  defineChannel,
  type Channel,
  type ChannelDefinition,
  type type,
} from './channel';

// Re-export ChannelEvent from core
export type { ChannelEvent } from './core';

// Core primitives (for custom implementations)
export * from './core';

export * from 'aidk-shared';