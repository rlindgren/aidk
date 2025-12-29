/**
 * # AIDK Server
 *
 * Framework-agnostic utilities for engine backend implementations.
 * Works with Express, NestJS, Fastify, or any Node.js server framework.
 *
 * ## Features
 *
 * - **Persistence Repositories** - Store executions, messages, metrics
 * - **In-Memory Store** - Development and testing storage
 * - **Context Utilities** - Extract and manage request context
 * - **ID Generators** - UUID and prefixed ID generation
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createInMemoryRepositories,
 *   defaultContextExtractor,
 *   buildEngineContext,
 * } from 'aidk-server';
 *
 * // Create persistence layer
 * const repos = createInMemoryRepositories();
 *
 * // Extract context from request
 * const ctx = defaultContextExtractor(req.body, req.headers);
 *
 * // Build engine context
 * const engineCtx = buildEngineContext({ ...ctx, executionId: 'exec_123' });
 * ```
 *
 * @module aidk-server
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
} from "./types";

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
} from "./persistence/in-memory";
export type { InMemoryStore } from "./persistence/in-memory";

// Utility
export { generateUUID } from "./utils";

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
  // Request Context Attachment
  AIDK_CONTEXT_KEY,
  attachContext,
  getContext,
  requireContext,
} from "./execution-context";

export type {
  IdGenerator,
  ContextExtractor,
  InputTransformer,
  RequestContext,
  RequestWithContext,
  ExecutionContext,
  ExecutionContextConfig,
  StandardRequestBody,
} from "./execution-context";
