/**
 * Shared Server Utilities
 * 
 * Framework-agnostic utilities for engine backend implementations.
 * Works with Express, NestJS, Fastify, or any Node.js server framework.
 */

// Types and Interfaces
export type {
  // Entities
  ExecutionEntity,
  MetricsEntity,
  MessageEntity,
  MessageBlockEntity,
  InteractionEntity,
  ToolStateEntity,
  // Repository interfaces
  ExecutionRepository,
  MetricsRepository,
  MessageRepository,
  MessageBlockRepository,
  InteractionRepository,
  ToolStateRepository,
  // Config
  PersistenceRepositories,
} from './types';

// In-Memory Store (for development/testing)
export {
  createInMemoryStore,
  clearStore,
  createInMemoryRepositories,
  // Individual repository classes if needed
  InMemoryExecutionRepository,
  InMemoryMetricsRepository,
  InMemoryMessageRepository,
  InMemoryMessageBlockRepository,
  InMemoryInteractionRepository,
  InMemoryToolStateRepository,
} from './persistence/in-memory';
export type { InMemoryStore } from './persistence/in-memory';

// Utility
export { generateUUID } from './utils';

// Execution Context (framework-agnostic core)
export {
  // ID Generators
  uuidV4Generator,
  createPrefixedIdGenerator,
  createIdGenerator,
  // Context Extractors
  defaultContextExtractor,
  createContextExtractor,
  // Input Transformers
  messagesToTimeline,
  defaultInputTransformer,
  createInputTransformer,
  // Helpers
  buildEngineContext,
  resolveConfig,
} from './execution-context';

export type {
  IdGenerator,
  ContextExtractor,
  InputTransformer,
  RequestContext,
  ExecutionContext,
  ExecutionContextConfig,
  StandardRequestBody,
} from './execution-context';

