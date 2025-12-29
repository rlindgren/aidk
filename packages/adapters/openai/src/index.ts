/**
 * # AIDK OpenAI Adapter
 *
 * Native OpenAI API adapter for AIDK. Provides direct integration with
 * OpenAI models without requiring the Vercel AI SDK.
 *
 * ## Features
 *
 * - **Native API** - Direct OpenAI API integration
 * - **Streaming** - Full streaming support with deltas
 * - **Tool Calling** - Native function calling support
 * - **All Models** - GPT-4o, GPT-4, GPT-3.5, and more
 *
 * ## Quick Start
 *
 * ```typescript
 * import { openai } from 'aidk-openai';
 *
 * const model = openai('gpt-4o');
 *
 * // Use with engine
 * const engine = createEngine();
 * const result = await engine.execute(
 *   <Model model={model}>
 *     <System>You are a helpful assistant.</System>
 *     <User>Hello!</User>
 *   </Model>
 * );
 * ```
 *
 * @module aidk-openai
 */
export * from "./openai-model";
export * from "./openai";
