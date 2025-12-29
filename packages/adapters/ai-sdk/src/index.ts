/**
 * # AIDK Vercel AI SDK Adapter
 *
 * Bidirectional integration between AIDK and the Vercel AI SDK. Use AI SDK models
 * in AIDK agents, or use AIDK's JSX components with AI SDK's execution.
 *
 * ## Two Directions
 *
 * ### 1. AI SDK → AIDK (Use AI SDK models in AIDK Engine)
 *
 * ```typescript
 * import { Engine } from 'aidk';
 * import { aiSdk } from 'aidk-ai-sdk';
 * import { openai } from '@ai-sdk/openai';
 *
 * const engine = new Engine({
 *   model: aiSdk(openai('gpt-4')),
 * });
 * ```
 *
 * ### 2. AIDK → AI SDK (Use AIDK components with AI SDK)
 *
 * Progressive adoption from simple to full-featured:
 *
 * ```typescript
 * import { compile, createCompiler, generateText } from 'aidk-ai-sdk';
 *
 * // Level 1: Compile JSX to AI SDK messages
 * const { messages, tools } = await compile(<MyAgent />);
 *
 * // Level 2: Managed single execution
 * const compiler = createCompiler();
 * const result = await compiler.run(<MyAgent />, executor);
 *
 * // Level 3: Streaming execution
 * for await (const event of compiler.stream(<MyAgent />, executor)) {
 *   // Handle streaming events
 * }
 *
 * // Level 4: Drop-in replacement for AI SDK
 * const result = await generateText(<MyAgent />);
 * ```
 *
 * @see {@link aiSdk} - Create AI SDK model adapter
 * @see {@link compile} - Compile JSX to AI SDK format
 * @see {@link AiSdkCompiler} - Full compiler with execution management
 *
 * @module aidk-ai-sdk
 */

// ============================================================================
// Progressive Adoption API (Engine → ai-sdk direction)
// ============================================================================

// Level 1: Compile only - get library-native input
export { compile, type CompiledInput } from "./compiler";

// Levels 2-3: Compiler with managed execution
export {
  AiSdkCompiler,
  createCompiler,
  createAiSdkCompiler, // Backward compat alias
  type CompilerConfig,
  type Executor,
  type StreamExecutor,
  type GenerateOptions,
  type CompilerStreamEvent,
} from "./compiler";

// Level 4: Mirror library API - generateText/streamText with JSX
export { generateText, streamText } from "./compiler";

// ============================================================================
// Portable Components (use same names across all adapters)
// ============================================================================

// Model component - configure model declaratively
export { AiSdkModel as Model } from "./model";
export { AiSdkModel, type AiSdkModelProps } from "./model";

// Message components
export {
  Message,
  System,
  User,
  Assistant,
  ToolResult,
  Timeline,
  type MessageProps,
  type ToolResultProps,
  type AiSdkContent,
  type AiSdkContentPart,
} from "./components";

// ============================================================================
// Engine Integration (ai-sdk → Engine direction)
// ============================================================================

// Use ai-sdk models within our Engine
export {
  createAiSdkModel,
  aiSdk,
  type AiSdkAdapter,
  type AiSdkAdapterConfig,
} from "./adapter";

// Conversion utilities (for advanced use cases)
export {
  // AI SDK → Engine conversions
  aiSdkMessagesToEngineInput,
  fromAiSdkInputMessages,
  fromAiSdkMessages,
  mapAiSdkContentToContentBlocks,
  mapAiSdkPartToContentBlock,
  mapToolResultToContentBlocks,
  // Engine → AI SDK conversions
  toAiSdkMessages,
  toAiSdkCompiledInput,
  mapContentBlocksToAiSdkContent,
  mapContentBlockToAiSdkPart,
} from "./adapter";
