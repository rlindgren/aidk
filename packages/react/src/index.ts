/**
 * # AIDK React
 *
 * React hooks and components for building AI-powered UIs. Provides state management
 * for agent execution, real-time streaming, and content block rendering.
 *
 * ## Hooks
 *
 * - **useEngineClient** - Manage client connection lifecycle
 * - **useExecution** - Execute agents and stream responses
 * - **useChannel** - Subscribe to real-time channels
 *
 * ## Components
 *
 * - **ContentBlockRenderer** - Render any content block type
 * - **ContentBlockList** - Render arrays of content blocks
 * - **TextBlock, ImageBlock, CodeBlock** - Individual block renderers
 *
 * ## Quick Start
 *
 * ```tsx
 * import { useEngineClient, useExecution } from 'aidk-react';
 *
 * function ChatApp() {
 *   const { client } = useEngineClient({
 *     baseUrl: 'http://localhost:3001',
 *     userId: 'user-123',
 *   });
 *
 *   const { sendMessage, messages, isStreaming } = useExecution({
 *     client,
 *     agentId: 'my-agent',
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <Message key={msg.id} {...msg} />)}
 *       <input onSubmit={(e) => sendMessage(e.target.value)} />
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link useEngineClient} - Client connection hook
 * @see {@link useExecution} - Agent execution hook
 * @see {@link ContentBlockRenderer} - Block rendering component
 *
 * @module aidk-react
 */

export { useEngineClient } from "./hooks/useEngineClient";
export type {
  UseEngineClientOptions,
  UseEngineClientReturn,
} from "./hooks/useEngineClient";

export { useExecution } from "./hooks/useExecution";
export type {
  UseExecutionOptions,
  UseExecutionReturn,
} from "./hooks/useExecution";

export { useChannel, clearChannelCache } from "./hooks/useChannels";

// Content block renderers
export {
  ContentBlockRenderer,
  ContentBlockList,
  TextBlock,
  ReasoningBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageBlock,
  CodeBlock,
  PlaceholderBlock,
} from "./blocks";
export type {
  ContentBlockRendererProps,
  ContentBlockListProps,
} from "./blocks";

// Re-export from client for convenience
export {
  EngineClient,
  createEngineClient,
  getEngineClient,
  defineChannel,
} from "aidk-client";

export type {
  EngineInput,
  ExecutionResult,
  EngineStreamEvent,
  ChannelEvent,
  Channel,
  ChannelDefinition,
  EngineClientConfig,
  EngineRoutes,
  ConnectionState,
  ConnectionInfo,
  Message,
  ContentBlock,
  TimelineEntry,
} from "aidk-client";

// Core primitives (for advanced use cases)
export { SSETransport, ChannelClient } from "aidk-client";
export type {
  SSETransportConfig,
  ChannelClientConfig,
  ChannelTransport,
  TransportState,
  TransportInfo,
} from "aidk-client";
