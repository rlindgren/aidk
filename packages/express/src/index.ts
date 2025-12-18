/**
 * Shared Express Utilities
 * 
 * Express-specific utilities for engine backend implementations.
 * Provides transports, middleware, and route helpers.
 */

// SSE Transport
export {
  SSETransport,
  createSSETransport,
  getSSETransport,
  resetSSETransport,
} from './transports/sse';
export type { SSETransportConfig } from './transports/sse';

// Engine Middleware
export {
  withEngine,
  withTransport,
  setupStreamingResponse,
  writeSSEEvent,
  writeSSEEventSafe,
} from './middleware/engine';
export type {
  EngineRequest,
  ExpressEngineConfig,
  TransportConfig,
} from './middleware/engine';

// Re-export from server
export * from 'aidk-server';