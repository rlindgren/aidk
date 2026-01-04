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
 * const detach = attachDevTools(engine, {
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
} from "./events";

export { DEVTOOLS_CHANNEL } from "./events";

// Server exports (for advanced usage)
export { DevToolsServer, type DevToolsServerConfig } from "./server";
export { getDevToolsServer, emitDevToolsEvent, isDevToolsActive, stopDevTools } from "./server";

// Integration exports
export {
  initDevTools,
  isDevToolsActive as devToolsActive,
  devtools,
  attachDevTools,
  type DevToolsEngine,
  type DevToolsOptions,
} from "./integration";
