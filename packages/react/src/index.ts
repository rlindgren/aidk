/**
 * React bindings for Engine Client
 * 
 * @example
 * ```tsx
 * import { useEngineClient, useExecution, useChannels } from '@example/shared/react';
 * 
 * function App() {
 *   const { client } = useEngineClient({
 *     baseUrl: 'http://localhost:3001',
 *     userId: user?.id,
 *   });
 *   
 *   const { sendMessage, isStreaming, messages } = useExecution({
 *     client,
 *     agentId: 'task-assistant',
 *   });
 *   
 *   const { publish } = useChannels({
 *     client,
 *     channels: 'todo-updates',
 *     onEvent: (event) => console.log('Update:', event),
 *   });
 *   
 *   return <ChatUI messages={messages} onSend={sendMessage} />;
 * }
 * ```
 */

export { useEngineClient } from './hooks/useEngineClient';
export type { UseEngineClientOptions, UseEngineClientReturn } from './hooks/useEngineClient';

export { useExecution } from './hooks/useExecution';
export type { UseExecutionOptions, UseExecutionReturn } from './hooks/useExecution';

export { useChannel, clearChannelCache } from './hooks/useChannels';

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
} from './blocks';
export type { ContentBlockRendererProps, ContentBlockListProps } from './blocks';

// Re-export from client for convenience
export { EngineClient, createEngineClient, getEngineClient, defineChannel } from 'aidk-client';

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
} from 'aidk-client';

// Core primitives (for advanced use cases)
export { SSETransport, ChannelClient } from 'aidk-client';
export type { 
  SSETransportConfig, 
  ChannelClientConfig,
  ChannelTransport,
  TransportState,
  TransportInfo,
} from 'aidk-client';

