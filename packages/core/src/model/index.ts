/**
 * # AIDK Models
 *
 * Model adapters and utilities for connecting to AI providers.
 * Models are the interface between AIDK and AI services.
 *
 * ## Features
 *
 * - **ModelAdapter** - Base class for model adapters
 * - **createModel** - Factory for creating model instances
 * - **Model Hooks** - Before/after hooks for model calls
 * - **Streaming** - Built-in streaming support
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createModel } from 'aidk/model';
 *
 * // Create a model using an adapter
 * const model = createModel({
 *   adapter: openaiAdapter,
 *   model: 'gpt-4o',
 * });
 *
 * // Use in an engine
 * const engine = new Engine({ model });
 * ```
 *
 * ## Adapters
 *
 * Use pre-built adapters from:
 * - `aidk-ai-sdk` - Vercel AI SDK
 * - `aidk-openai` - OpenAI native
 * - `aidk-google` - Google AI native
 *
 * @see {@link ModelAdapter} - Base adapter class
 * @see {@link createModel} - Model factory
 *
 * @module aidk/model
 */

export * from "./model";
export * from "./model-hooks";
export * from "./utils";
