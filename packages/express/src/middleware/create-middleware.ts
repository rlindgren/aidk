/**
 * Express Middleware Factory
 *
 * Creates a pre-configured Express router with agent execution and streaming routes.
 * This is the main entry point for most Express applications.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createExpressMiddleware } from 'aidk-express';
 * import { createEngine } from 'aidk';
 *
 * const app = express();
 * const engine = createEngine();
 *
 * // Simple usage - routes at /execute and /stream
 * app.use('/api/agent', createExpressMiddleware({
 *   engine,
 *   agent: MyAgent,
 * }));
 *
 * // With multiple agents
 * app.use('/api/agents', createExpressMiddleware({
 *   engine,
 *   agents: {
 *     chat: ChatAgent,
 *     task: TaskAgent,
 *   },
 * }));
 *
 * // With SSE transport for channels
 * app.use('/api/agents', createExpressMiddleware({
 *   engine,
 *   agents: { chat: ChatAgent },
 *   transport: getSSETransport(),
 * }));
 * ```
 */

import { Router, type Request, type Response } from "express";
import type { Engine, ComponentDefinition } from "aidk";
import type { SSETransport } from "../transports/sse";
import {
  withEngine,
  withTransport,
  setupStreamingResponse,
  writeSSEEventSafe,
  type EngineRequest,
  type ExpressEngineConfig,
  type TransportConfig,
} from "./engine";

// =============================================================================
// Types
// =============================================================================

/**
 * Agent registry - maps agent IDs to component definitions
 */
export type AgentRegistry = Record<string, ComponentDefinition>;

/**
 * Configuration for createExpressMiddleware
 */
export interface CreateExpressMiddlewareConfig<TBody = any> {
  /**
   * Engine instance or factory function
   */
  engine: Engine | (() => Engine);

  /**
   * Single agent component (routes will be /execute and /stream)
   */
  agent?: ComponentDefinition;

  /**
   * Multiple agents (routes will be /:agentId/execute and /:agentId/stream)
   */
  agents?: AgentRegistry;

  /**
   * SSE transport for channel support (optional)
   */
  transport?: SSETransport;

  /**
   * Transport room pattern (optional)
   */
  roomPattern?: TransportConfig["roomPattern"];

  /**
   * Custom context extraction (optional, uses defaults)
   */
  extractContext?: ExpressEngineConfig<TBody>["extractContext"];

  /**
   * Custom input transformation (optional, uses defaults)
   */
  transformInput?: ExpressEngineConfig<TBody>["transformInput"];

  /**
   * Custom ID generator (optional, uses UUID)
   */
  generateId?: ExpressEngineConfig<TBody>["generateId"];

  /**
   * Called on execution errors (optional)
   */
  onError?: (error: Error, req: Request, res: Response) => void;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates Express middleware with pre-configured agent routes.
 *
 * @param config - Middleware configuration
 * @returns Express Router
 *
 * @example Single agent
 * ```typescript
 * app.use('/api/chat', createExpressMiddleware({
 *   engine,
 *   agent: ChatAgent,
 * }));
 * // Routes: POST /api/chat/execute, POST /api/chat/stream
 * ```
 *
 * @example Multiple agents
 * ```typescript
 * app.use('/api/agents', createExpressMiddleware({
 *   engine,
 *   agents: { chat: ChatAgent, task: TaskAgent },
 * }));
 * // Routes: POST /api/agents/chat/execute, POST /api/agents/task/stream, etc.
 * ```
 */
export function createExpressMiddleware<TBody = any>(
  config: CreateExpressMiddlewareConfig<TBody>,
): Router {
  const router = Router();

  // Validate config
  if (!config.agent && !config.agents) {
    throw new Error("createExpressMiddleware requires either 'agent' or 'agents' config");
  }

  if (config.agent && config.agents) {
    throw new Error("createExpressMiddleware: provide either 'agent' or 'agents', not both");
  }

  // Build middleware stack
  const engineConfig: ExpressEngineConfig<TBody> = {
    engine: config.engine,
    extractContext: config.extractContext,
    transformInput: config.transformInput,
    generateId: config.generateId,
  };

  const middlewareStack: any[] = [withEngine(engineConfig)];

  if (config.transport) {
    middlewareStack.push(
      withTransport({
        transport: config.transport,
        roomPattern: config.roomPattern,
      }),
    );
  }

  // Default error handler
  const handleError =
    config.onError ||
    ((error: Error, _req: Request, res: Response) => {
      console.error("Agent execution error:", error);
      res.status(500).json({ error: error.message });
    });

  // Track configured routes for logging
  const configuredRoutes: string[] = [];

  // ==========================================================================
  // Single Agent Routes
  // ==========================================================================

  if (config.agent) {
    const Agent = config.agent;

    // Execute (non-streaming)
    router.post("/execute", ...middlewareStack, async (req: Request, res: Response) => {
      try {
        const engineReq = req as unknown as EngineRequest;
        const { engine, input, executionId, threadId, sessionId, withContext } =
          engineReq.engineContext;

        const result = await engine.execute.withContext(withContext).run(input, Agent);

        res.json({
          executionId,
          threadId,
          sessionId,
          result,
        });
      } catch (error: any) {
        handleError(error, req, res);
      }
    });

    // Stream
    router.post("/stream", ...middlewareStack, async (req: Request, res: Response) => {
      try {
        const engineReq = req as unknown as EngineRequest;
        const { engine, input, withContext } = engineReq.engineContext;

        setupStreamingResponse(res);

        const stream = await engine.stream.withContext(withContext).run(input, Agent);

        for await (const event of stream) {
          writeSSEEventSafe(res, event);
        }

        res.end();
      } catch (error: any) {
        handleError(error, req, res);
      }
    });
  }

  // ==========================================================================
  // Multi-Agent Routes
  // ==========================================================================

  if (config.agents) {
    const agents = config.agents;

    // Execute (non-streaming)
    router.post("/:agentId/execute", ...middlewareStack, async (req: Request, res: Response) => {
      try {
        const Agent = agents[req.params.agentId];

        if (!Agent) {
          return res.status(404).json({ error: `Agent '${req.params.agentId}' not found` });
        }

        const engineReq = req as unknown as EngineRequest;
        const { engine, input, executionId, threadId, sessionId, withContext } =
          engineReq.engineContext;

        const result = await engine.execute.withContext(withContext).run(input, Agent);

        res.json({
          executionId,
          threadId,
          sessionId,
          result,
        });
      } catch (error: any) {
        handleError(error, req, res);
      }
    });

    // Stream
    router.post("/:agentId/stream", ...middlewareStack, async (req: Request, res: Response) => {
      try {
        const Agent = agents[req.params.agentId];

        if (!Agent) {
          return res.status(404).json({ error: `Agent '${req.params.agentId}' not found` });
        }

        const engineReq = req as unknown as EngineRequest;
        const { engine, input, withContext } = engineReq.engineContext;

        setupStreamingResponse(res);

        const stream = await engine.stream.withContext(withContext).run(input, Agent);

        for await (const event of stream) {
          writeSSEEventSafe(res, event);
        }

        res.end();
      } catch (error: any) {
        handleError(error, req, res);
      }
    });
  }

  // Log configured routes
  if (config.agent) {
    configuredRoutes.push("POST /execute", "POST /stream");
  }

  if (config.agents) {
    const agentIds = Object.keys(config.agents);
    for (const agentId of agentIds) {
      configuredRoutes.push(`POST /${agentId}/execute`, `POST /${agentId}/stream`);
    }
  }

  const transportInfo = config.transport ? " (with SSE transport)" : "";
  console.log(`🤖 [AIDK] Express middleware configured${transportInfo}:`);
  for (const route of configuredRoutes) {
    console.log(`   ${route}`);
  }

  return router;
}
