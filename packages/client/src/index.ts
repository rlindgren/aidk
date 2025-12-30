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

// Types from ./types (not using export * to avoid conflicts)
export type {
  EngineInput,
  ExecutionResult as ExecutionResultType,
  ChannelTarget,
  ChannelEvent as ChannelEventType,
  Execution as ExecutionType,
  ExecutionMetrics as ExecutionMetricsType,
  EngineStreamEvent,
} from "./types";

// Execution handler (framework-agnostic)
export {
  ExecutionHandler,
  StreamProcessor,
  createMessage,
  generateMessageId,
  type StreamEventContext,
  type StreamProcessorCallbacks,
  type ExecutionHandlerCallbacks,
  type ExecutionHandlerConfig,
  type SendMessageOptions,
} from "./execution-handler";

// Channel abstraction (uses core ChannelClient internally)
export { defineChannel, type Channel, type ChannelDefinition, type type } from "./channel";

// Re-export ChannelEvent from core
export type { ChannelEvent } from "./core";

// Core primitives (for custom implementations)
export * from "./core";

// Re-export from aidk-shared
// Note: Using explicit exports to avoid conflicts with local types
export {
  // Block types (enums)
  BlockType,
  MediaSourceType,
  ImageMimeType,
  DocumentMimeType,
  AudioMimeType,
  VideoMimeType,
  CodeLanguage,
  // Streaming (enums and functions)
  StopReason,
  StreamChunkType,
  isStreamEvent,
  isEngineEvent,
  isDeltaEvent,
  isFinalEvent,
  // Tool types (enums)
  ToolExecutionType,
  ToolIntent,
  // Input normalization (functions)
  normalizeMessageInput,
  normalizeContentInput,
  normalizeContentArray,
  isMessage,
  isContentBlock,
  // Error types (classes)
  AbortError,
  ValidationError,
  NotFoundError,
  TransportError,
} from "aidk-shared";

// Type-only re-exports from aidk-shared
export type {
  // Block types (type aliases)
  BlockTypes,
  // Blocks
  ContentBlock,
  TextBlock,
  ImageBlock,
  GeneratedImageBlock,
  AudioBlock,
  VideoBlock,
  DocumentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  JsonBlock,
  XmlBlock,
  CsvBlock,
  HtmlBlock,
  CodeBlock,
  // Messages
  Message,
  MessageRole,
  // Models
  ModelInput,
  ModelOutput,
  ModelConfig,
  TokenUsage,
  // Tools
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolExecutor,
  ClientToolDefinition,
  ToolConfirmationResponse,
  ToolConfirmationResult,
  // Timeline
  TimelineEntry,
  // Input
  MessageInput,
  ContentInput,
  ContentInputArray,
  // Streaming - NEW event types
  StreamEventBase,
  StreamEvent,
  EngineEvent,
  EngineStreamEvent as NewEngineStreamEvent,
  ContentStartEvent,
  ContentDeltaEvent,
  ContentEndEvent,
  ContentEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  ReasoningEvent,
  MessageStartEvent,
  MessageEndEvent,
  MessageEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  ToolCallEvent,
  ToolResultEvent,
  ExecutionStartEvent,
  ExecutionEndEvent,
  ExecutionEvent,
  TickStartEvent,
  TickEndEvent,
  TickEvent,
  ToolConfirmationRequiredEvent,
  ToolConfirmationResultEvent,
  StreamErrorEvent,
  EngineErrorEvent,
} from "aidk-shared";
