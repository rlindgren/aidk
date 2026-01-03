/**
 * Execution Context Types and Utilities
 *
 * Framework-agnostic types and defaults for execution context management.
 * Can be used with Express, NestJS, Fastify, Koa, Elysia, or any server framework.
 */

import type { Engine, EngineInput, COMTimelineEntry } from "aidk";
import { generateUUID } from "./utils";

// =============================================================================
// Core Types
// =============================================================================

/**
 * Extracted context from an incoming request.
 * Framework adapters map their request shape to this.
 */
export interface RequestContext {
  /** Thread/conversation ID */
  threadId: string;
  /** Session ID for real-time channel routing */
  sessionId?: string;
  /** User ID from auth */
  userId: string;
  /** Tenant ID for multi-tenant apps */
  tenantId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Full execution context passed to handlers.
 * Built by middleware from request + config.
 */
export interface ExecutionContext extends RequestContext {
  /** Unique ID for this execution */
  executionId: string;
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
      imageUrl?: string;
      [key: string]: unknown;
    }>;
    metadata?: Record<string, unknown>;
  }>;
  threadId?: string;
  sessionId?: string;
  userId?: string;
  tenantId?: string;
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

export type ContextExtractor<
  TBody = StandardRequestBody,
  THeaders = Record<string, string | undefined>,
> = (body: TBody, headers?: THeaders) => RequestContext;

/**
 * Default context extractor following our conventions.
 * Override this for apps with different field names or auth patterns.
 */
export const defaultContextExtractor: ContextExtractor = (body, headers) => ({
  threadId: body.threadId || generateUUID(),
  sessionId: body.sessionId || headers?.["x-session-id"],
  userId: body.userId || body.userId || "anonymous",
  tenantId: body.tenantId || "default",
  metadata: body.metadata,
});

/**
 * Create a context extractor with custom field mappings
 */
export function createContextExtractor<TBody>(config: {
  threadId?: keyof TBody | ((body: TBody) => string);
  sessionId?:
    | keyof TBody
    | ((body: TBody, headers?: Record<string, string | undefined>) => string | undefined);
  userId?: keyof TBody | ((body: TBody) => string);
  tenantId?: keyof TBody | ((body: TBody) => string);
  metadata?: keyof TBody | ((body: TBody) => Record<string, unknown> | undefined);
}): ContextExtractor<TBody> {
  const get = <T>(
    body: TBody,
    key: keyof TBody | ((body: TBody, ...args: any[]) => T) | undefined,
    ...args: any[]
  ): T | undefined => {
    if (!key) return undefined;
    if (typeof key === "function") return key(body, ...args);
    return body[key] as T;
  };

  return (body, headers) => ({
    threadId: get(body, config.threadId) || generateUUID(),
    sessionId: get(body, config.sessionId, headers),
    userId: get(body, config.userId) || "anonymous",
    tenantId: get(body, config.tenantId) || "default",
    metadata: get(body, config.metadata),
  });
}

// =============================================================================
// Input Transformers
// =============================================================================

export type InputTransformer<TBody = StandardRequestBody> = (
  body: TBody,
  context: RequestContext,
) => EngineInput;

/**
 * Transform standard message format to Engine timeline.
 * Uses loose typing to handle various frontend message formats.
 */
export function messagesToTimeline(messages: StandardRequestBody["messages"]): COMTimelineEntry[] {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  // Use loose typing for content transformation - frontends send various formats
  return messages.map((msg) => ({
    kind: "message" as const,
    message: {
      role: msg.role,
      content: msg.content.map((c: any) => ({
        type: c.type || "text",
        text: c.text || "",
        ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
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
    threadId: context.threadId,
    sessionId: context.sessionId,
    userId: context.userId,
    ...context.metadata,
  },
});

/**
 * Create an input transformer with custom transformation logic
 */
export function createInputTransformer<TBody>(
  transform: (body: TBody, context: RequestContext) => EngineInput,
): InputTransformer<TBody> {
  return transform;
}

// =============================================================================
// Execution Helpers
// =============================================================================

/**
 * Build the withContext options for engine execution
 */
export function buildEngineContext(ctx: RequestContext & { executionId: string }) {
  return {
    user: { id: ctx.userId },
    metadata: {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      threadId: ctx.threadId,
      sessionId: ctx.sessionId,
      executionId: ctx.executionId,
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
  config: ExecutionContextConfig<TBody>,
): Required<ExecutionContextConfig<TBody>> {
  return {
    engine: config.engine,
    generateId: config.generateId || uuidV4Generator,
    extractContext: config.extractContext || (defaultContextExtractor as ContextExtractor<TBody>),
    transformInput: config.transformInput || (defaultInputTransformer as InputTransformer<TBody>),
  };
}

// =============================================================================
// Request Context Attachment
// =============================================================================

/**
 * Symbol key for storing AIDK context on request objects.
 * Using a symbol prevents collisions with other properties.
 */
export const AIDK_CONTEXT_KEY = Symbol.for("aidk.context");

/**
 * Generic request-like object that can have context attached.
 * Works with Express, Fastify, Koa, NestJS, etc.
 */
export interface RequestWithContext {
  [AIDK_CONTEXT_KEY]?: RequestContext;
}

/**
 * Attach AIDK context to a request object.
 * Call this in your framework's middleware/interceptor after extracting context.
 *
 * @param request - The request object (Express req, Fastify request, etc.)
 * @param context - The extracted request context
 *
 * @example Express middleware
 * ```typescript
 * app.use((req, res, next) => {
 *   const ctx = extractContext(req.body, req.headers);
 *   attachContext(req, ctx);
 *   next();
 * });
 * ```
 *
 * @example NestJS interceptor
 * ```typescript
 * const request = context.switchToHttp().getRequest();
 * const ctx = extractContext(request.body, request.headers);
 * attachContext(request, ctx);
 * ```
 */
export function attachContext(request: any, context: RequestContext): void {
  (request as RequestWithContext)[AIDK_CONTEXT_KEY] = context;
}

/**
 * Get AIDK context from a request object.
 * Returns undefined if no context has been attached.
 *
 * @param request - The request object
 * @returns The attached context, or undefined
 *
 * @example Express route handler
 * ```typescript
 * app.get('/api/user', (req, res) => {
 *   const ctx = getContext(req);
 *   if (!ctx?.userId) {
 *     return res.status(401).json({ error: 'Unauthorized' });
 *   }
 *   // ... use ctx.userId, ctx.tenantId, etc.
 * });
 * ```
 *
 * @example NestJS guard
 * ```typescript
 * canActivate(context: ExecutionContext): boolean {
 *   const request = context.switchToHttp().getRequest();
 *   const ctx = getContext(request);
 *   return ctx?.userId != null;
 * }
 * ```
 */
export function getContext(request: any): RequestContext | undefined {
  return (request as RequestWithContext)[AIDK_CONTEXT_KEY];
}

/**
 * Get AIDK context from a request object, throwing if not present.
 *
 * @param request - The request object
 * @returns The attached context
 * @throws Error if no context is attached
 */
export function requireContext(request: any): RequestContext {
  const ctx = getContext(request);
  if (!ctx) {
    throw new Error(
      "AIDK context not found on request. Ensure context middleware/interceptor is applied.",
    );
  }
  return ctx;
}
