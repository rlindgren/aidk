/**
 * # AIDK Core
 *
 * The complete AI agent development framework. Build agents using React-inspired
 * JSX components with declarative state management and type-safe tools.
 *
 * ## Key Features
 *
 * - **Engine** - Orchestrates agent execution with tick-based model interactions
 * - **JSX Components** - React-style components for declarative agent definition
 * - **Hooks** - `useState`, `useEffect`, `useSignal` and more for state management
 * - **Tools** - Type-safe tool definition with Zod schemas and multiple execution modes
 * - **Channels** - Real-time bidirectional streaming communication
 * - **MCP Support** - Model Context Protocol integration for external tools
 *
 * ## Quick Start
 *
 * ```tsx
 * import { Engine, createModel, User, System, Tool } from 'aidk';
 *
 * const MyAgent = () => (
 *   <>
 *     <System>You are a helpful assistant.</System>
 *     <User>{userInput}</User>
 *     <Tool tool={myTool} />
 *   </>
 * );
 *
 * const engine = new Engine({ model: createModel(...) });
 * const result = await engine.execute(<MyAgent />);
 * ```
 *
 * ## Architecture
 *
 * AIDK uses a layered architecture:
 *
 * 1. **Components** render to the Context Object Model (COM)
 * 2. **COM** is compiled into model input format
 * 3. **Engine** orchestrates the tick loop: compile → model call → tool execution
 * 4. **Hooks** provide cross-cutting concerns (logging, telemetry, validation)
 *
 * @see {@link Engine} - The main execution orchestrator
 * @see {@link Component} - Base class for stateful components
 * @see {@link createTool} - Create type-safe tools
 * @see {@link createModel} - Create model adapters
 *
 * @module aidk
 */

export * from "./procedure";
export * from "./hooks";
export * from "./model";
export * from "./tool";
export * from "./config";
export * from "./content";
export * from "./types";
export * from "./utils";
export * from "./com";
export * from "./component";
export * from "./engine";
export * from "./state";
export * from "./compiler";
export * from "./mcp";
export * from "./channels";
export * from "./renderers";
export * from "./client";
// Re-export Context from Engine (returns EngineContext, not KernelContext)
export { Context, context } from "./context";
// Re-export commonly used Kernel types and utilities so Engine users don't need to import from Kernel
export {
  Telemetry,
  Logger,
  composeContextFields,
  defaultContextFields,
  type KernelContext,
  type Procedure,
  type Middleware,
  type MiddlewarePipeline,
  type HandleFactory,
  type LogLevel,
  type LoggerConfig,
  type LogMethod,
  type KernelLogger as LoggerType,
  type ExtractArgs,
  type ExtractReturn,
  type ContextFieldsExtractor,
} from "aidk-kernel";
export * from "aidk-kernel/execution-helpers";
// Note: Components are exported individually to avoid conflicts
export {
  Timeline,
  Section,
  Model,
  Markdown,
} from "./jsx/components/primitives";
export {
  H1,
  H2,
  H3,
  Header,
  Paragraph,
  List,
  ListItem,
  Table,
  Row,
  Column,
  Strong,
  Em,
  InlineCode,
  Mark,
} from "./jsx/components/semantic";
// Message role components
export {
  User,
  Assistant,
  System,
  ToolResult,
  Grounding,
  Message,
} from "./jsx/components/messages";
export type {
  UserProps,
  AssistantProps,
  SystemProps,
  ToolResultProps,
  GroundingProps,
  EphemeralPosition,
} from "./jsx/components/messages";
export { Fork, ForkComponent } from "./jsx/components/fork";
export { Spawn, SpawnComponent } from "./jsx/components/spawn";
export type { ForkProps } from "./jsx/components/fork";
export type { SpawnProps } from "./jsx/components/spawn";
export {
  createForkHandle,
  createSpawnHandle,
  registerWaitHandle,
  getWaitHandles,
} from "./jsx/components/fork-spawn-helpers";
export type {
  CreateForkOptions,
  CreateSpawnOptions,
} from "./jsx/components/fork-spawn-helpers";
// Export JSX namespace and runtime for tsconfig jsxImportSource
export { type JSX } from "./jsx/jsx-runtime";
export * from "./jsx/jsx-runtime";
// Re-export for jsxImportSource: "aidk/jsx-runtime"
export * from "./jsx/jsx-runtime";
