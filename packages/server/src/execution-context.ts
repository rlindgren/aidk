/**
 * Execution Context Types and Utilities
 * 
 * Framework-agnostic types and defaults for execution context management.
 * Can be used with Express, NestJS, Fastify, Koa, Elysia, or any server framework.
 */

import type { Engine, EngineInput, COMTimelineEntry } from 'aidk';
import { generateUUID } from './utils';

// =============================================================================
// Core Types
// =============================================================================

/**
 * Extracted context from an incoming request.
 * Framework adapters map their request shape to this.
 */
export interface RequestContext {
  /** Thread/conversation ID */
  thread_id: string;
  /** Session ID for real-time channel routing */
  session_id?: string;
  /** User ID from auth */
  user_id: string;
  /** Tenant ID for multi-tenant apps */
  tenant_id?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Full execution context passed to handlers.
 * Built by middleware from request + config.
 */
export interface ExecutionContext extends RequestContext {
  /** Unique ID for this execution */
  execution_id: string;
  /** Engine instance */
  engine: Engine;
  /** Transformed input ready for engine */
  input: EngineInput;
}

/**
 * Raw request body shape (our conventions).
 * Apps with different conventions provide their own extractor.
 */
export interface StandardRequestBody {
  messages?: Array<{
    role: string;
    content: Array<{
      type?: string;
      text?: string;
      image_url?: string;
      [key: string]: unknown;
    }>;
    metadata?: Record<string, unknown>;
  }>;
  thread_id?: string;
  sessionId?: string;
  user_id?: string;
  userId?: string;
  tenant_id?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// ID Generators
// =============================================================================

export type IdGenerator = () => string;

/**
 * Default UUID v4 generator
 */
export const uuidV4Generator: IdGenerator = generateUUID;

/**
 * Create a prefixed ID generator
 * @example createPrefixedIdGenerator('exec') // -> 'exec_abc123...'
 */
export function createPrefixedIdGenerator(prefix: string): IdGenerator {
  return () => `${prefix}_${generateUUID()}`;
}

/**
 * Create an ID generator that uses a provided function
 * Useful for DB sequences, UUIDv7, etc.
 */
export function createIdGenerator(fn: () => string): IdGenerator {
  return fn;
}

// =============================================================================
// Context Extractors
// =============================================================================

export type ContextExtractor<TBody = StandardRequestBody, THeaders = Record<string, string | undefined>> = (
  body: TBody,
  headers?: THeaders
) => RequestContext;

/**
 * Default context extractor following our conventions.
 * Override this for apps with different field names or auth patterns.
 */
export const defaultContextExtractor: ContextExtractor = (body, headers) => ({
  thread_id: body.thread_id || generateUUID(),
  session_id: body.sessionId || headers?.['x-session-id'],
  user_id: body.user_id || body.userId || 'anonymous',
  tenant_id: body.tenant_id || 'default',
  metadata: body.metadata,
});

/**
 * Create a context extractor with custom field mappings
 */
export function createContextExtractor<TBody>(
  config: {
    threadId?: keyof TBody | ((body: TBody) => string);
    sessionId?: keyof TBody | ((body: TBody, headers?: Record<string, string | undefined>) => string | undefined);
    userId?: keyof TBody | ((body: TBody) => string);
    tenantId?: keyof TBody | ((body: TBody) => string);
    metadata?: keyof TBody | ((body: TBody) => Record<string, unknown> | undefined);
  }
): ContextExtractor<TBody> {
  const get = <T>(body: TBody, key: keyof TBody | ((body: TBody, ...args: any[]) => T) | undefined, ...args: any[]): T | undefined => {
    if (!key) return undefined;
    if (typeof key === 'function') return key(body, ...args);
    return body[key] as T;
  };

  return (body, headers) => ({
    thread_id: get(body, config.threadId) || generateUUID(),
    session_id: get(body, config.sessionId, headers),
    user_id: get(body, config.userId) || 'anonymous',
    tenant_id: get(body, config.tenantId) || 'default',
    metadata: get(body, config.metadata),
  });
}

// =============================================================================
// Input Transformers
// =============================================================================

export type InputTransformer<TBody = StandardRequestBody> = (
  body: TBody,
  context: RequestContext
) => EngineInput;

/**
 * Transform standard message format to Engine timeline.
 * Uses loose typing to handle various frontend message formats.
 */
export function messagesToTimeline(messages: StandardRequestBody['messages']): COMTimelineEntry[] {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  // Use loose typing for content transformation - frontends send various formats
  return messages.map((msg) => ({
    kind: 'message' as const,
    message: {
      role: msg.role,
      content: msg.content.map((c: any) => ({
        type: c.type || 'text',
        text: c.text || '',
        ...(c.image_url ? { image_url: c.image_url } : {}),
      })),
    },
    metadata: msg.metadata || {},
  })) as COMTimelineEntry[];
}

/**
 * Default input transformer following our conventions.
 * Expects messages in body, transforms to Engine timeline format.
 */
export const defaultInputTransformer: InputTransformer = (body, context) => ({
  timeline: messagesToTimeline(body.messages),
  metadata: {
    thread_id: context.thread_id,
    ...context.metadata,
  },
});

/**
 * Create an input transformer with custom transformation logic
 */
export function createInputTransformer<TBody>(
  transform: (body: TBody, context: RequestContext) => EngineInput
): InputTransformer<TBody> {
  return transform;
}

// =============================================================================
// Execution Helpers
// =============================================================================

/**
 * Build the withContext options for engine execution
 */
export function buildEngineContext(ctx: RequestContext & { execution_id: string }) {
  return {
    user: { id: ctx.user_id },
    metadata: {
      user_id: ctx.user_id,
      tenant_id: ctx.tenant_id,
      thread_id: ctx.thread_id,
      session_id: ctx.session_id,
      execution_id: ctx.execution_id,
      ...ctx.metadata,
    },
  };
}

// =============================================================================
// Configuration Type
// =============================================================================

/**
 * Configuration for execution context middleware.
 * Framework adapters use this to build their middleware.
 */
export interface ExecutionContextConfig<TBody = StandardRequestBody> {
  /** Engine instance or factory */
  engine: Engine | (() => Engine);
  /** ID generator for execution IDs */
  generateId?: IdGenerator;
  /** Extract context from request body/headers */
  extractContext?: ContextExtractor<TBody>;
  /** Transform request body to engine input */
  transformInput?: InputTransformer<TBody>;
}

/**
 * Resolved config with defaults applied
 */
export function resolveConfig<TBody = StandardRequestBody>(
  config: ExecutionContextConfig<TBody>
): Required<ExecutionContextConfig<TBody>> {
  return {
    engine: config.engine,
    generateId: config.generateId || uuidV4Generator,
    extractContext: config.extractContext || (defaultContextExtractor as ContextExtractor<TBody>),
    transformInput: config.transformInput || (defaultInputTransformer as InputTransformer<TBody>),
  };
}

