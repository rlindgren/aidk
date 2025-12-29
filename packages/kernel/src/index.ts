/**
 * # AIDK Kernel
 *
 * Low-level execution primitives for the AIDK framework. The kernel provides
 * the foundational infrastructure that all other AIDK packages build upon.
 *
 * ## Core Primitives
 *
 * - **Procedures** - Async function wrappers with middleware, context, and telemetry
 * - **Context** - Request-scoped state with automatic propagation
 * - **Channels** - Async generators for streaming with backpressure
 * - **Telemetry** - Execution tracking, spans, and metrics
 * - **Logger** - Structured logging with configurable levels
 *
 * ## When to Use Kernel Directly
 *
 * Most applications should use the higher-level `aidk` package. Use kernel directly when:
 *
 * - Building custom execution infrastructure
 * - Creating new AIDK adapters or integrations
 * - Need fine-grained control over procedure execution
 *
 * ## Example
 *
 * ```typescript
 * import { procedure, Telemetry, Context } from 'aidk-kernel';
 *
 * const myProcedure = procedure('my-operation', async (ctx, input: string) => {
 *   ctx.logger.info('Processing', { input });
 *   return { result: input.toUpperCase() };
 * });
 *
 * const result = await myProcedure.run(ctx, 'hello');
 * ```
 *
 * @see {@link Procedure} - The core procedure abstraction
 * @see {@link KernelContext} - Request-scoped context
 * @see {@link Channel} - Streaming primitive
 * @see {@link Telemetry} - Execution tracking
 *
 * @module aidk-kernel
 */

export * from "./context";
export * from "./telemetry";
export * from "./procedure-graph";
export * from "./execution-tracker";
export * from "./execution-helpers";
export * from "./metrics-helpers";
export * from "./stream";
export * from "./channel";
export * from "./channel-helpers";
export * from "./procedure";
export * from "./logger";
