// ============================================================================
// Progressive Adoption API (Engine → ai-sdk direction)
// ============================================================================

// Level 1: Compile only - get library-native input
export { compile, type CompiledInput } from './compiler';

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
} from './compiler';

// Level 4: Mirror library API - generateText/streamText with JSX
export { generateText, streamText } from './compiler';

// ============================================================================
// Portable Components (use same names across all adapters)
// ============================================================================

// Model component - configure model declaratively
export { AiSdkModel as Model } from './model';
export { AiSdkModel, type AiSdkModelProps } from './model';

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
} from './components';

// ============================================================================
// Engine Integration (ai-sdk → Engine direction)
// ============================================================================

// Use ai-sdk models within our Engine
export {
  createAiSdkModel,
  aiSdk,
  type AiSdkAdapter,
  type AiSdkAdapterConfig,
} from './adapter';

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
} from './adapter';
