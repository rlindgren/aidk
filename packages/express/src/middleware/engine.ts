/**
 * Express Middleware for Engine Execution
 *
 * Provides middleware for setting up execution context and transport coordination.
 * Built on framework-agnostic core from shared/server.
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * app.use('/api/workflows',
 *   withEngine({ engine }),
 *   withTransport({ transport }),
 *   workflowRouter
 * );
 *
 * // Custom ID generator
 * app.use('/api/workflows',
 *   withEngine({
 *     engine,
 *     generateId: () => `exec_${uuidv7()}`,
 *   }),
 *   workflowRouter
 * );
 *
 * // Custom context extraction (different field names)
 * app.use('/api/workflows',
 *   withEngine({
 *     engine,
 *     extractContext: (body, headers) => ({
 *       threadId: body.conversation_id,
 *       sessionId: headers['x-session'],
 *       userId: body.user.id,
 *       tenantId: body.user.org_id,
 *     }),
 *   }),
 *   workflowRouter
 * );
 * ```
 */

import type { Request, Response, NextFunction } from "express";
import type { Engine, EngineInput } from "aidk";
import type { SSETransport } from "../transports/sse";
import {
  type ExecutionContextConfig,
  type RequestContext,
  resolveConfig,
  buildEngineContext,
  attachContext,
} from "aidk-server";

// =============================================================================
// Express Request Extension
// =============================================================================

/**
 * Extended request with engine context.
 * Use this type in your handlers.
 */
export interface EngineRequest extends Request {
  engineContext: {
    /** Engine instance */
    engine: Engine;
    /** Unique execution ID */
    executionId: string;
    /** Thread/conversation ID */
    threadId: string;
    /** Session ID for channel routing */
    sessionId?: string;
    /** User ID */
    userId: string;
    /** Tenant ID */
    tenantId?: string;
    /** Transformed input for engine */
    input: EngineInput;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
    /** Transport (if withTransport middleware used) */
    transport?: SSETransport;
    /** Pre-built context for engine.execute.withContext() */
    withContext: ReturnType<typeof buildEngineContext>;
  };
}

// =============================================================================
// Engine Context Middleware
// =============================================================================

/**
 * Express-specific config (extends base with Express types)
 */
export interface ExpressEngineConfig<
  TBody = any,
> extends ExecutionContextConfig<TBody> {
  // Future: Express-specific options like error handling
}

/**
 * Creates middleware that extracts execution context from the request.
 *
 * @param config - Configuration for context extraction
 * @returns Express middleware
 *
 * @example
 * ```typescript
 * app.use(withEngine({ engine: getEngine() }));
 *
 * // In handler:
 * router.post('/execute', (req: EngineRequest, res) => {
 *   const { engine, input, executionId } = req.engineContext;
 *   const result = await engine.execute.withContext(req.engineContext.withContext)(
 *     input,
 *     <MyWorkflow />
 *   );
 * });
 * ```
 */
export function withEngine<TBody = any>(
  config: ExpressEngineConfig<TBody>,
): (req: Request, res: Response, next: NextFunction) => void {
  const resolved = resolveConfig(config);

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get engine instance
      const engine =
        typeof resolved.engine === "function"
          ? resolved.engine()
          : resolved.engine;

      // Extract context from request
      const headers = req.headers as Record<string, string | undefined>;
      const requestContext = resolved.extractContext(
        req.body as TBody,
        headers,
      );

      // Attach base context to request for guards/simple access
      attachContext(req, requestContext);

      // Generate execution ID
      const executionId = resolved.generateId();

      // Transform input
      const input = resolved.transformInput(req.body as TBody, requestContext);

      // Build full context
      const fullContext = {
        ...requestContext,
        executionId,
      };

      // Attach to request
      (req as EngineRequest).engineContext = {
        engine,
        executionId,
        threadId: requestContext.threadId,
        sessionId: requestContext.sessionId,
        userId: requestContext.userId,
        tenantId: requestContext.tenantId,
        input,
        metadata: requestContext.metadata,
        withContext: buildEngineContext(fullContext),
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

// =============================================================================
// Transport Coordination Middleware
// =============================================================================

export interface TransportConfig {
  /** SSE transport instance */
  transport: SSETransport;
  /**
   * Pattern for room name. Defaults to `thread:{threadId}`.
   * @example (ctx) => `user:${ctx.userId}:thread:${ctx.threadId}`
   */
  roomPattern?: (ctx: RequestContext & { executionId: string }) => string;
}

/**
 * Creates middleware that joins the SSE connection to appropriate rooms.
 * Must be used after withEngine middleware.
 *
 * @param config - Transport configuration
 * @returns Express middleware
 *
 * @example
 * ```typescript
 * app.use(withEngine({ engine }));
 * app.use(withTransport({ transport: getSSETransport() }));
 *
 * // Custom room pattern:
 * app.use(withTransport({
 *   transport,
 *   roomPattern: (ctx) => `org:${ctx.tenantId}:thread:${ctx.threadId}`,
 * }));
 * ```
 */
export function withTransport(
  config: TransportConfig,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const roomPattern =
    config.roomPattern || ((ctx) => `thread:${ctx.threadId}`);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engineReq = req as EngineRequest;

      if (!engineReq.engineContext) {
        return next(
          new Error("withTransport requires withEngine middleware first"),
        );
      }

      const ctx = engineReq.engineContext;

      // Join room if session is connected
      if (ctx.sessionId && config.transport.isConnected(ctx.sessionId)) {
        const room = roomPattern({
          threadId: ctx.threadId,
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          executionId: ctx.executionId,
          metadata: ctx.metadata,
        });
        await config.transport.join(ctx.sessionId, room);
      }

      // Attach transport to context
      ctx.transport = config.transport;

      next();
    } catch (error) {
      next(error);
    }
  };
}

// =============================================================================
// Streaming Response Helpers
// =============================================================================

/**
 * Set up SSE headers for streaming response
 */
export function setupStreamingResponse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}

/**
 * Write an SSE event
 */
export function writeSSEEvent(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Write an SSE event with error serialization
 */
export function writeSSEEventSafe(res: Response, data: unknown): void {
  let serializable = data;

  // Handle Error objects that don't serialize with JSON.stringify
  if (typeof data === "object" && data !== null && "error" in data) {
    const record = data as Record<string, unknown>;
    if (record.error instanceof Error) {
      serializable = {
        ...record,
        error: {
          message: (record.error as Error).message,
          name: (record.error as Error).name,
        },
      };
    }
  }

  res.write(`data: ${JSON.stringify(serializable)}\n\n`);
}
