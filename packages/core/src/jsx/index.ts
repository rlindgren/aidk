/**
 * # AIDK JSX
 *
 * JSX runtime and components for building AIDK agents declaratively.
 * Use familiar React-like syntax to define agent behavior.
 *
 * ## Features
 *
 * - **JSX Runtime** - Custom JSX implementation for AIDK
 * - **Message Components** - User, Assistant, System, ToolResult
 * - **Semantic Components** - H1, H2, Paragraph, List, Table, etc.
 * - **Primitives** - Timeline, Section, Model, Markdown
 * - **Fork/Spawn** - Parallel and concurrent execution
 *
 * ## Quick Start
 *
 * ```tsx
 * import { User, System, Assistant, Fork } from 'aidk';
 *
 * const MyAgent = () => (
 *   <>
 *     <System>You are a helpful assistant.</System>
 *     <User>Hello!</User>
 *   </>
 * );
 * ```
 *
 * ## Message Components
 *
 * ```tsx
 * <User>User message content</User>
 * <Assistant>Assistant response</Assistant>
 * <System>System instructions</System>
 * <ToolResult toolUseId="123" isError={false}>Result</ToolResult>
 * ```
 *
 * ## Semantic Components
 *
 * ```tsx
 * <H1>Title</H1>
 * <Paragraph>Content</Paragraph>
 * <List>
 *   <ListItem>Item 1</ListItem>
 *   <ListItem>Item 2</ListItem>
 * </List>
 * ```
 *
 * @see {@link User} - User message component
 * @see {@link System} - System message component
 * @see {@link Fork} - Parallel execution component
 *
 * @module aidk/jsx
 */

// JSX Runtime
export * from "./jsx-runtime";
export type { JSX } from "./jsx-runtime";

// Components
export * from "./components";

// Fork/Spawn
export { Fork, ForkComponent } from "./components/fork";
export { Spawn, SpawnComponent } from "./components/spawn";
export type { ForkProps } from "./components/fork";
export type { SpawnProps } from "./components/spawn";
export {
  createForkHandle,
  createSpawnHandle,
  registerWaitHandle,
  getWaitHandles,
} from "./components/fork-spawn-helpers";
export type { CreateForkOptions, CreateSpawnOptions } from "./components/fork-spawn-helpers";
