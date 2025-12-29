/**
 * # AIDK Engine
 *
 * The execution orchestrator - coordinates compilation, model calls, and tool execution.
 * The Engine is the heart of AIDK that manages the complete lifecycle of agent execution.
 *
 * ## Features
 *
 * - **Tick Loop** - Compile JSX → call model → execute tools → update state
 * - **Execution Handles** - Track status, metrics, cancellation, and signals
 * - **Process Management** - Fork and spawn child executions
 * - **Lifecycle Hooks** - Engine-level hooks for init, shutdown, execution events
 * - **Streaming** - Real-time events during execution
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Engine, createModel } from 'aidk';
 *
 * const engine = new Engine({
 *   model: createModel({ provider: 'openai', model: 'gpt-4o' }),
 * });
 *
 * // Execute an agent
 * const result = await engine.execute(<MyAgent />);
 *
 * // Or stream responses
 * for await (const event of engine.stream(<MyAgent />)) {
 *   if (event.type === 'text_delta') {
 *     console.log(event.text);
 *   }
 * }
 * ```
 *
 * ## Execution Handle
 *
 * ```typescript
 * const handle = engine.run(<MyAgent />);
 *
 * // Check status
 * console.log(handle.status); // 'running' | 'completed' | 'failed'
 *
 * // Get metrics
 * console.log(handle.metrics); // { inputTokens, outputTokens, ... }
 *
 * // Cancel execution
 * handle.cancel();
 *
 * // Wait for completion
 * const result = await handle.result;
 * ```
 *
 * @see {@link Engine} - Main execution orchestrator
 * @see {@link ExecutionHandle} - Execution lifecycle management
 * @see {@link EngineStreamEvent} - Stream event types
 *
 * @module aidk/engine
 */

// Core Engine
export { Engine } from "./engine";
export type {
  EngineConfig,
  EngineLifecycleHooks,
  EngineStaticHooks,
} from "./engine";

// Execution
export * from "./execution-handle";
export * from "./execution-types";
export * from "./execution-graph";

// Events and Response
export type { EngineStreamEvent } from "./engine-events";
export type { EngineResponse } from "./engine-response";

// Hooks
export * from "./engine-hooks";
export * from "./engine-lifecycle-hooks";

// Factory
export * from "./factory";