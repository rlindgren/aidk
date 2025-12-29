/**
 * # AIDK Express
 *
 * Express.js middleware and utilities for AIDK agent backends.
 * Provides SSE transport, middleware, and route helpers.
 *
 * ## Features
 *
 * - **SSE Transport** - Server-Sent Events for real-time streaming
 * - **Engine Middleware** - Attach engine context to requests
 * - **Channel Routes** - Pub/sub channel communication
 * - **Agent Routes** - Execute and stream agent responses
 *
 * ## Quick Start
 *
 * ```typescript
 * import express from 'express';
 * import { withEngine, agentRoutes, channelRoutes } from 'aidk-express';
 *
 * const app = express();
 *
 * // Attach engine to all requests
 * app.use(withEngine({ engine: createEngine() }));
 *
 * // Add agent endpoints
 * app.use('/api/agents', agentRoutes());
 *
 * // Add channel endpoints
 * app.use('/api/channels', channelRoutes());
 * ```
 *
 * @module aidk-express
 */

// SSE Transport
export {
  SSETransport,
  createSSETransport,
  getSSETransport,
  resetSSETransport,
} from "./transports/sse";
export type { SSETransportConfig } from "./transports/sse";

// Engine Middleware
export {
  withEngine,
  withTransport,
  setupStreamingResponse,
  writeSSEEvent,
  writeSSEEventSafe,
} from "./middleware/engine";
export type {
  EngineRequest,
  ExpressEngineConfig,
  TransportConfig,
} from "./middleware/engine";

// Re-export from server
export * from "aidk-server";
