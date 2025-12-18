import type { COMSection, COMTimelineEntry, EphemeralPosition } from '../com/types';
import type { ExecutableTool } from '../tool/tool';
import type { SemanticContentBlock, ContentRenderer } from '../renderers';
import type { ContentBlock, MessageRoles } from 'aidk-shared';
import { Fragment, type JSX } from 'aidk/jsx-runtime';
import type { ContextObjectModel } from '../com/object-model';
import type { TickState } from '../component/component';

/**
 * Compiled structure from JSX tree traversal.
 * This is the format-agnostic representation before formatting.
 */
export interface CompiledStructure {
  sections: Map<string, CompiledSection>;
  timelineEntries: CompiledTimelineEntry[];
  systemMessageItems: Array<SystemMessageItem>;
  tools: Array<{ name: string; tool: ExecutableTool }>;
  ephemeral: CompiledEphemeral[];
  metadata: Record<string, unknown>;
}

/**
 * Compiled ephemeral entry (before formatting).
 * Ephemeral content is NOT persisted - rebuilt fresh each tick.
 */
export interface CompiledEphemeral {
  content: SemanticContentBlock[];
  type?: string;
  position: EphemeralPosition;
  order: number;
  id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  renderer?: ContentRenderer;
}

/**
 * Compiled section (before formatting).
 * Contains raw SemanticContentBlocks and renderer context.
 */
export interface CompiledSection {
  id: string;
  title?: string;
  content: SemanticContentBlock[] | string | unknown;
  renderer?: ContentRenderer; // Renderer context from JSX (<Markdown> wrapper)
  visibility?: 'model' | 'observer' | 'log';
  audience?: 'model' | 'human' | 'system';
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Compiled timeline entry (before formatting).
 * Contains raw SemanticContentBlocks and optional renderer context.
 */
export interface CompiledTimelineEntry {
  kind: 'message' | 'event';
  message?: {
    role: MessageRoles;
    content: SemanticContentBlock[];
    id?: string;
    metadata?: Record<string, unknown>;
    created_at?: string | Date;
    updated_at?: string | Date;
  };
  event?: any; // EngineStreamEvent
  renderer?: ContentRenderer; // Only if explicitly wrapped in renderer tag
  id?: string;
  visibility?: 'model' | 'observer' | 'log';
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * System message item (for consolidation).
 */
export interface SystemMessageItem {
  type: 'section' | 'message' | 'loose';
  sectionId?: string;
  content?: SemanticContentBlock[];
  index: number;
  renderer?: ContentRenderer;
}

/**
 * Options for the compileUntilStable method.
 */
export interface CompileStabilizationOptions {
  /** Maximum iterations before forced stabilization. Default: 10 */
  maxIterations?: number;
  /** Enable development mode warnings for forgotten requestRecompile calls. Default: true in development */
  trackMutations?: boolean;
}

/**
 * Result of the compileUntilStable method.
 */
export interface CompileStabilizationResult {
  /** The final stable compiled structure */
  compiled: CompiledStructure;
  /** Number of iterations taken to stabilize */
  iterations: number;
  /** Whether max iterations was reached (forced stabilization) */
  forcedStable: boolean;
  /** Reasons for each recompile request */
  recompileReasons: string[];
}

// Fragment symbol for cross-module identity comparison
// Using Symbol.for ensures we get the same symbol even across different module loads
const FragmentSymbol = Symbol.for('aidk.fragment');

/**
 * Check if a type is a Fragment (works across module boundaries)
 * Fragment is a Symbol, so we check by symbol identity or description
 */
export function isFragment(type: any): boolean {
  return (
    type === Fragment ||
    type === FragmentSymbol ||
    (typeof type === 'symbol' && type.description === 'aidk.fragment') ||
    type?.name === 'Fragment'
  );
}

export interface Fiber {
  type: any;
  props: any;
  instance?: any; // Component instance or null
  children: Fiber[];
  key: string | number | null;
  ref?: string; // Reference name for component instance access
}


// ============================================================================
// Fiber Flags
// ============================================================================

export const FiberFlags = {
  NoFlags: 0b00000000,
  Placement: 0b00000001,      // New fiber, needs mount
  Update: 0b00000010,         // Props/state changed
  Deletion: 0b00000100,       // Needs unmount
  ChildDeletion: 0b00001000,  // Has children to unmount
  HasEffect: 0b00010000,      // Has effects to run
  Ref: 0b00100000,            // Has ref to update
} as const;

export type FiberFlags = (typeof FiberFlags)[keyof typeof FiberFlags];

// ============================================================================
// Hook Tags
// ============================================================================

export const HookTag = {
  // State hooks
  State: 0,
  Reducer: 1,
  ComState: 2,
  WatchState: 3,
  Signal: 4,
  
  // Effect hooks
  Effect: 10,
  TickStart: 11,
  TickEnd: 12,
  AfterCompile: 13,
  Mount: 14,
  Unmount: 15,
  
  // Memoization hooks
  Memo: 20,
  Callback: 21,
  
  // Ref hooks
  Ref: 30,
  COMRef: 31,
  
  // Async hooks
  Async: 40,
  CachedAsync: 41,
} as const;

export type HookTag = (typeof HookTag)[keyof typeof HookTag];

// ============================================================================
// Effect
// ============================================================================

/**
 * Effect phase - when the effect runs in the tick lifecycle.
 */
export const EffectPhase = {
  /** Runs at tick start, before render */
  TickStart: 'tick-start',
  /** Runs after compile, can request recompile */
  AfterCompile: 'after-compile',
  /** Runs at tick end, after model execution */
  TickEnd: 'tick-end',
  /** General effect, runs after commit */
  Commit: 'commit',
  /** Runs once when component mounts */
  Mount: 'mount',
  /** Runs once when component unmounts */
  Unmount: 'unmount',
} as const;

export type EffectPhase = (typeof EffectPhase)[keyof typeof EffectPhase];

/**
 * An effect to run during a tick phase.
 */
export interface Effect {
  /** When this effect runs */
  phase: EffectPhase;
  
  /** Effect creation function (can be async) */
  create: EffectCallback;
  
  /** Cleanup function from previous run */
  destroy: EffectCleanup | null;
  
  /** Dependency array for conditional execution */
  deps: unknown[] | null;
  
  /** Whether effect needs to run this tick */
  pending: boolean;
  
  /** Next effect in linked list */
  next: Effect | null;
  
  /** Debug tag */
  debugLabel?: string;
}

export type EffectCallback = () => void | EffectCleanup | Promise<void | EffectCleanup>;
export type EffectCleanup = () => void | Promise<void>;

// ============================================================================
// Update Queue (for batched state updates)
// ============================================================================

export interface UpdateQueue<S = unknown> {
  pending: Update<S> | null;
  dispatch: Dispatch<S> | null;
  lastRenderedState: S;
}

export interface Update<S = unknown> {
  action: S | ((prev: S) => S);
  next: Update<S> | null;
}

export type Dispatch<S> = (action: S | ((prev: S) => S)) => void;

// ============================================================================
// Hook State
// ============================================================================

export interface HookState<S = unknown> {
  /** Memoized value */
  memoizedState: S;
  
  /** Base state for reducers */
  baseState?: S;
  
  /** Update queue for state hooks */
  queue: UpdateQueue<S> | null;
  
  /** Effect for effect hooks */
  effect: Effect | null;
  
  /** Next hook in linked list */
  next: HookState | null;
  
  /** Hook type */
  tag: HookTag;
}

// ============================================================================
// Fiber Node
// ============================================================================

export interface FiberNode {
  // ============ Identity ============
  type: ComponentType;
  key: string | number | null;
  
  // ============ Props ============
  props: Record<string, unknown>;
  pendingProps: Record<string, unknown> | null;
  
  // ============ State ============
  /** Component instance (class components) */
  stateNode: ComponentInstance | null;
  /** Hook state linked list (function components) */
  memoizedState: HookState | null;
  
  // ============ Tree Structure ============
  parent: FiberNode | null;
  child: FiberNode | null;
  sibling: FiberNode | null;
  index: number;
  
  // ============ Refs ============
  ref: string | null;
  
  // ============ Work Tracking ============
  flags: number;
  subtreeFlags: number;
  deletions: FiberNode[] | null;
  
  // ============ Double Buffering ============
  alternate: FiberNode | null;
  
  // ============ Rendering Context ============
  renderer: ContentRenderer | null;
  
  // ============ Debug ============
  debugName?: string;
}

// ============================================================================
// Component Types
// ============================================================================

/**
 * Function component.
 * Can receive (props), (props, com), or (props, com, state).
 */
export type FunctionComponent<P = Record<string, unknown>> =
  | ((props: P) => FiberChild | Promise<FiberChild>)
  | ((props: P, com: ContextObjectModel) => FiberChild | Promise<FiberChild>)
  | ((props: P, com: ContextObjectModel, state: TickState) => FiberChild | Promise<FiberChild>);

/**
 * Class component constructor.
 */
export type ClassComponent<P = Record<string, unknown>> =
  new (props: P) => ComponentInstance;

/**
 * Any component type.
 */
export type ComponentType =
  | FunctionComponent
  | ClassComponent
  | string    // Intrinsic (Section, Message, etc.)
  | symbol;   // Fragment

/**
 * Component instance (class component).
 */
export interface ComponentInstance {
  props: Record<string, unknown>;
  
  // Lifecycle
  onMount?: (com: ContextObjectModel) => void | Promise<void>;
  onUnmount?: (com: ContextObjectModel) => void | Promise<void>;
  onStart?: (com: ContextObjectModel) => void | Promise<void>;
  onTickStart?: (com: ContextObjectModel, state: TickState) => void | Promise<void>;
  onTickEnd?: (com: ContextObjectModel, state: TickState) => void | Promise<void>;
  onAfterCompile?: (
    com: ContextObjectModel,
    compiled: unknown,
    state: TickState,
    ctx: unknown
  ) => void | Promise<void>;
  onComplete?: (com: ContextObjectModel, finalState: unknown) => void | Promise<void>;
  onError?: (com: ContextObjectModel, state: TickState) => unknown;
  
  // Render
  render?: (
    com: ContextObjectModel,
    state: TickState
  ) => FiberChild | Promise<FiberChild>;
}

// ============================================================================
// Fiber Children
// ============================================================================

/**
 * Valid children in the fiber tree.
 */
export type FiberChild =
  | JSX.Element
  | JSX.Element[]
  | ContentBlock
  | ContentBlock[]
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Normalized child after processing.
 */
export type NormalizedChild =
  | { kind: 'element'; element: JSX.Element }
  | { kind: 'content-block'; block: ContentBlock }
  | { kind: 'text'; text: string };

// ============================================================================
// Render Context
// ============================================================================

/**
 * Context available during component render.
 * Set by compiler, read by hooks.
 */
export interface RenderContext {
  /** Current fiber being rendered */
  fiber: FiberNode;
  
  /** Context Object Model */
  com: ContextObjectModel;
  
  /** Current tick state */
  tickState: TickState;
  
  /** Current hook being processed (from previous render) */
  currentHook: HookState | null;
  
  /** Work-in-progress hook chain being built */
  workInProgressHook: HookState | null;
  
  /** Abort signal for this execution */
  abortSignal?: AbortSignal;
}

// ============================================================================
// Async Hook Results
// ============================================================================

export interface AsyncResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

// ============================================================================
// Compiler Configuration
// ============================================================================

export interface FiberCompilerConfig {
  /** Enable development mode warnings */
  dev?: boolean;
  
  /** Max compile stabilization iterations */
  maxCompileIterations?: number;
  
  /** Enable async effect execution */
  asyncEffects?: boolean;
  
  /** Custom content block type detector */
  isContentBlock?: (value: unknown) => boolean;
  
  /** Default renderer for content blocks */
  defaultRenderer?: ContentRenderer;
}

// ============================================================================
// Compile Result
// ============================================================================

export interface CompileResult {
  /** The compiled structure */
  compiled: CompiledStructure;
  
  /** Number of stabilization iterations */
  iterations: number;
  
  /** Whether max iterations was hit */
  forcedStable: boolean;
  
  /** Reasons for recompilations */
  recompileReasons: string[];
}

// ============================================================================
// Content Block Types
// ============================================================================

export const CONTENT_BLOCK_TYPES = [
  'text',
  'image', 
  'document',
  'audio',
  'video',
  'code',
  'json',
  'tool_use',
  'tool_result',
  'reasoning',
  'user_action',
  'system_event',
  'state_change',
] as const;

export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

/**
 * Check if a value is a content block by shape.
 */
export function isContentBlock(value: unknown): value is ContentBlock {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string' &&
    CONTENT_BLOCK_TYPES.includes(
      (value as { type: string }).type as ContentBlockType
    )
  );
}

// ============================================================================
// Hook Result Types
// ============================================================================

export type StateHookResult<S> = [S, Dispatch<S>];
export type ReducerHookResult<S, A> = [S, (action: A) => void];
export type RefObject<T> = { current: T };
