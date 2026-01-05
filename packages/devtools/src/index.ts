/**
 * # AIDK DevTools
 *
 * Developer tools for visualizing and debugging AIDK agent execution.
 * Provides a real-time browser UI for inspecting executions, ticks, and tool calls.
 *
 * ## Features
 *
 * - **Real-time Streaming** - SSE-based live updates as execution progresses
 * - **Tick-by-tick Inspection** - View compiled context, model responses, and events
 * - **Token Usage Tracking** - Monitor input/output/reasoning tokens per tick
 * - **Tool Call Visualization** - See tool inputs and results in context
 * - **Raw Output Access** - Inspect raw provider responses for debugging
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createEngine } from 'aidk';
 * import { attachDevTools } from 'aidk-devtools/integration';
 *
 * const engine = createEngine();
 *
 * // Attach devtools (starts server and opens browser)
 * const detach = attachDevTools({
 *   instance: engine,
 *   port: 3004,
 *   open: true,
 * });
 *
 * // Later, to stop devtools:
 * detach();
 * ```
 *
 * ## Environment Variables
 *
 * - `DEVTOOLS=true` - Enable devtools
 * - `DEVTOOLS_PORT=3004` - Server port (default: 3004)
 * - `DEVTOOLS_OPEN=false` - Disable auto-open browser
 * - `DEVTOOLS_DEBUG=true` - Enable debug logging
 *
 * @module aidk-devtools
 */

// Event types
export type {
  DevToolsEvent,
  ExecutionStartEvent,
  ExecutionEndEvent,
  TickStartEvent,
  TickEndEvent,
  CompiledEvent,
  ModelStartEvent,
  ContentDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  StateChangeEvent,
  ProcedureStartEvent,
  ProcedureEndEvent,
  ProcedureErrorEvent,
} from "./events.js";

export { DEVTOOLS_CHANNEL } from "./events.js";

// Server exports (for advanced usage)
export { DevToolsServer, type DevToolsServerConfig } from "./server/index.js";
export {
  getDevToolsServer,
  emitDevToolsEvent,
  isDevToolsActive,
  stopDevTools,
} from "./server/index.js";

// Integration exports
export {
  initDevTools,
  initKernelSubscriberRemote,
  isDevToolsActive as devToolsActive,
  devtools,
  attachDevTools,
  type DevToolsEngine,
  type DevToolsOptions,
  type RemoteDevToolsConfig,
} from "./integration/index.js";

// Kernel-level observability exports
export {
  startKernelSubscriber,
  stopKernelSubscriber,
  isKernelSubscriberActive,
} from "./kernel-subscriber.js";
