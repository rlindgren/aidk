/**
 * Compiler - Tick-Based Agent Architecture
 * 
 * A React-inspired fiber architecture designed specifically for AI agent execution.
 * Unlike React, this compiler is async-first and tick-based - no concurrent mode needed.
 * 
 * Key Features:
 * - Hooks in function components (useState, useEffect, etc.)
 * - AI-specific hooks (useComState, useTickStart, useAfterCompile)
 * - Full class component support (signals, lifecycle methods)
 * - Pure content block rendering
 * - Async-first (effects can be async)
 * - Compile stabilization (recompile until stable)
 * 
 * @example Function component with hooks
 * ```tsx
 * function ChatAgent({ maxTurns }: { maxTurns: number }) {
 *   const [turns, setTurns] = useState(0);
 *   const [timeline, setTimeline] = useComState('timeline', []);
 *   
 *   useTickStart((com, state) => {
 *     if (state.currentState?.timeline) {
 *       setTimeline(t => [...t, ...state.currentState.timeline]);
 *       setTurns(t => t + 1);
 *     }
 *   });
 *   
 *   useTickEnd((com, state) => {
 *     if (turns >= maxTurns) {
 *       state.stop('max turns reached');
 *     }
 *   });
 *   
 *   useEffect(async () => {
 *     await logToServer({ turns, messageCount: timeline.length });
 *   }, [turns]);
 *   
 *   return (
 *     <>
 *       <Section id="system">
 *         <Text>You are a helpful assistant.</Text>
 *       </Section>
 *       <Timeline>
 *         {timeline.map((msg, i) => (
 *           <Message key={i} role={msg.role}>{msg.content}</Message>
 *         ))}
 *       </Timeline>
 *     </>
 *   );
 * }
 * ```
 * 
 * @example Class component (existing pattern)
 * ```tsx
 * class ChatAgent extends Component {
 *   timeline = comState<Message[]>('timeline', []);
 *   turns = signal(0);
 *   
 *   async onTickStart(com, state) {
 *     if (state.currentState?.timeline) {
 *       this.timeline.update(t => [...t, ...state.currentState.timeline]);
 *       this.turns.update(t => t + 1);
 *     }
 *   }
 *   
 *   render(com, state) {
 *     return (
 *       <Timeline>
 *         {this.timeline().map(...)}
 *       </Timeline>
 *     );
 *   }
 * }
 * ```
 * 
 * @example Non-rendering component
 * ```tsx
 * function ExecutionController() {
 *   const [turns, setTurns] = useState(0);
 *   
 *   useTickEnd((com, state) => {
 *     setTurns(t => t + 1);
 *     if (turns >= 10) state.stop('max turns');
 *   });
 *   
 *   return null;  // No output - just manages execution
 * }
 * ```
 * 
 * @example Pure content blocks
 * ```tsx
 * function ContentProvider() {
 *   const blocks = [
 *     { type: 'text', text: 'Block 1' },
 *     { type: 'text', text: 'Block 2' },
 *   ];
 *   
 *   return (
 *     <Message role="assistant">
 *       <Text>Hello!</Text>
 *       {blocks}
 *     </Message>
 *   );
 * }
 * ```
 */

// ============================================================================
// Compiler
// ============================================================================

export { FiberCompiler } from './fiber-compiler';

// ============================================================================
// Fiber Utilities
// ============================================================================

export {
  createFiber,
  createWorkInProgress,
  cloneFiber,
  getChildFibers,
  findFiberByKey,
  traverseFiber,
  traverseFiberBottomUp,
  getHookCount,
  getHookAtIndex,
  fiberToDebugString,
  fiberTreeToDebugString,
  findNearestRenderer,
  setFiberRenderer,
} from './fiber';

// ============================================================================
// Types
// ============================================================================

export type {
  FiberNode,
  FiberCompilerConfig,
  FunctionComponent,
  ClassComponent,
  ComponentType,
  ComponentInstance,
  HookState,
  Effect,
  EffectCallback,
  EffectCleanup,
  UpdateQueue,
  Update,
  Dispatch,
  RenderContext,
  FiberChild,
  NormalizedChild,
  AsyncResult,
  CompileResult,
  StateHookResult,
  ReducerHookResult,
  RefObject,
  ContentBlockType,
  CompileStabilizationOptions,
  CompileStabilizationResult
} from './types';

export { 
  FiberFlags, 
  HookTag, 
  EffectPhase,
  CONTENT_BLOCK_TYPES,
  isContentBlock,
  isFragment,
} from './types';

// ============================================================================
// State Hooks
// ============================================================================

export {
  useState,
  useReducer,
  useSignal,
} from './hooks';

// ============================================================================
// COM State Hooks
// ============================================================================

export {
  useComState,
  useWatch,
  useInput,
} from './hooks';

// ============================================================================
// Effect Hooks
// ============================================================================

export {
  useEffect,
  useInit,
  useOnMount,
  useOnUnmount,
  useTickStart,
  useTickEnd,
  useAfterCompile,
} from './hooks';

// ============================================================================
// Async Hooks
// ============================================================================

export {
  useAsync,
} from './hooks';

// ============================================================================
// Memoization Hooks
// ============================================================================

export {
  useMemo,
  useComputed,
  useCallback,
} from './hooks';

// ============================================================================
// Ref Hooks
// ============================================================================

export {
  useRef,
  useCOMRef,
} from './hooks';

// ============================================================================
// Utility Hooks
// ============================================================================

export {
  usePrevious,
  useToggle,
  useCounter,
  useAbortSignal,
  useDebugValue,
} from './hooks';

// ============================================================================
// Internal (for advanced use)
// ============================================================================

export {
  setRenderContext,
  getCurrentFiber,
  getCurrentContext,
  setScheduleWork,
} from './hooks';
