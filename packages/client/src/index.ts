/**
 * # AIDK Client
 *
 * Browser client for connecting to AIDK agents. Provides real-time streaming,
 * tool execution coordination, and channel-based communication.
 *
 * ## Architecture
 *
 * Two layers for progressive adoption:
 *
 * 1. **EngineClient** - Opinionated client with AIDK conventions (recommended)
 * 2. **Core Primitives** - SSETransport, ChannelClient for custom implementations
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createEngineClient } from 'aidk-client';
 *
 * const client = createEngineClient({
 *   baseUrl: 'http://localhost:3001',
 *   userId: 'user-123',
 * });
 *
 * // Execute an agent
 * const execution = await client.execute({ input: 'Hello!' });
 *
 * // Stream responses
 * for await (const event of execution.stream()) {
 *   if (event.type === 'text') console.log(event.text);
 * }
 * ```
 *
 * ## Custom Transports
 *
 * For custom transport implementations, use the core primitives:
 *
 * ```typescript
 * import { SSETransport, ChannelClient } from 'aidk-client/core';
 *
 * const transport = new SSETransport({
 *   buildUrl: () => '/my/sse/endpoint',
 *   send: (data) => fetch('/my/publish', { method: 'POST', body: data }),
 * });
 *
 * const channels = new ChannelClient({ transport });
 * ```
 *
 * @see {@link EngineClient} - Main client class
 * @see {@link createEngineClient} - Factory function
 * @see {@link ExecutionHandler} - Execution lifecycle management
 *
 * @module aidk-client
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
} from "./engine-client";
// Note: EngineStreamEvent and EngineInput are exported from './types'

// Legacy types re-export
export * from "./types";

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
} from "./execution-handler";

// Channel abstraction (uses core ChannelClient internally)
export {
  defineChannel,
  type Channel,
  type ChannelDefinition,
  type type,
} from "./channel";

// Re-export ChannelEvent from core
export type { ChannelEvent } from "./core";

// Core primitives (for custom implementations)
export * from "./core";

export * from "aidk-shared";
