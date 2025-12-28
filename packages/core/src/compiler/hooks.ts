/**
 * V2 Hooks Implementation
 *
 * React-inspired hooks for function components in the tick-based agent model.
 * Key difference from React: async-first, effects can be async.
 *
 * Rules of Hooks:
 * 1. Only call hooks at the top level of a function component
 * 2. Only call hooks from function components or custom hooks
 * 3. Call hooks in the same order every render
 */

import type {
  FiberNode,
  HookState,
  Effect,
  UpdateQueue,
  Update,
  RenderContext,
  StateHookResult,
  ReducerHookResult,
  RefObject,
  AsyncResult,
  EffectCallback,
  EffectCleanup,
  Dispatch,
} from "./types";
import { HookTag, EffectPhase } from "./types";
import {
  signal as createSignal,
  computed,
  createCOMStateSignal,
  createReadonlyCOMStateSignal,
  type Signal,
  type ComputedSignal,
  type ReadonlySignal,
  isSignal,
  isComputed,
} from "../state/signal";
import { shouldSkipRecompile } from "./fiber-compiler";
import type { ContextObjectModel } from "../com/object-model";
import type { TickState } from "../component/component";
import type { CompiledStructure } from "./types";
import type { ExecutionMessage } from "../engine/execution-types";

// ============================================================================
// Render Context (Global During Render)
// ============================================================================

let renderContext: RenderContext | null = null;

/**
 * Get current render context. Throws if called outside render.
 */
export function getCurrentContext(): RenderContext {
  if (renderContext === null) {
    throw new Error(
      "Invalid hook call. Hooks can only be called inside a function component.\n" +
        "Possible causes:\n" +
        "1. Calling a hook outside a component\n" +
        "2. Calling hooks conditionally or in a loop\n" +
        "3. Mismatched aidk package versions",
    );
  }
  return renderContext;
}

/**
 * Set render context (called by compiler).
 */
export function setRenderContext(ctx: RenderContext | null): void {
  renderContext = ctx;
}

/**
 * Get current fiber (for advanced use).
 */
export function getCurrentFiber(): FiberNode | null {
  return renderContext?.fiber ?? null;
}

// ============================================================================
// Work Scheduling
// ============================================================================

let scheduleWorkFn: ((fiber: FiberNode) => void) | null = null;

export function setScheduleWork(fn: (fiber: FiberNode) => void): void {
  scheduleWorkFn = fn;
}

function scheduleWork(fiber: FiberNode): void {
  if (scheduleWorkFn) {
    scheduleWorkFn(fiber);
  }
}

// ============================================================================
// Hook State Management
// ============================================================================

function mountWorkInProgressHook(): HookState {
  const hook: HookState = {
    memoizedState: undefined as unknown,
    queue: null,
    effect: null,
    next: null,
    tag: HookTag.State,
  };

  const ctx = getCurrentContext();

  if (ctx.workInProgressHook === null) {
    ctx.fiber.memoizedState = hook;
  } else {
    ctx.workInProgressHook.next = hook;
  }
  ctx.workInProgressHook = hook;

  return hook;
}

function updateWorkInProgressHook(): HookState {
  const ctx = getCurrentContext();
  const current = ctx.currentHook;

  if (current === null) {
    throw new Error(
      "Rendered more hooks than during the previous render. " +
        "Hooks must be called in the same order every render.",
    );
  }

  const newHook: HookState = {
    memoizedState: current.memoizedState,
    baseState: current.baseState,
    queue: current.queue,
    effect: current.effect,
    next: null,
    tag: current.tag,
  };

  if (ctx.workInProgressHook === null) {
    ctx.fiber.memoizedState = newHook;
  } else {
    ctx.workInProgressHook.next = newHook;
  }
  ctx.workInProgressHook = newHook;
  ctx.currentHook = current.next;

  return newHook;
}

function mountOrUpdateHook(tag: HookTag): HookState {
  const ctx = getCurrentContext();
  const isMount = ctx.currentHook === null && ctx.fiber.alternate === null;
  const hook = isMount ? mountWorkInProgressHook() : updateWorkInProgressHook();
  hook.tag = tag;
  return hook;
}

/**
 * Extract signal values for dependency comparison.
 * Signals/computed values are unwrapped to their current value.
 */
function unwrapDeps(
  deps: unknown[] | undefined | null,
): unknown[] | undefined | null {
  if (!deps) return deps;

  return deps.map((dep) => {
    // If it's a signal or computed, read its current value
    if (isSignal(dep) || isComputed(dep)) {
      return (dep as any)();
    }
    return dep;
  });
}

// ============================================================================
// STATE HOOKS
// ============================================================================

/**
 * useState - Local component state.
 *
 * @deprecated Use `useSignal` instead for better composability and consistency.
 *
 * State persists across renders via fiber storage.
 *
 * @example
 * ```tsx
 * // Old (deprecated):
 * const [count, setCount] = useState(0);
 *
 * // New (recommended):
 * const count = useSignal(0);
 * count.set(10) or count.update(n => n + 1)
 * ```
 */
export function useState<S>(initialState: S | (() => S)): StateHookResult<S> {
  return useReducer(
    (state: S, action: S | ((prev: S) => S)) =>
      typeof action === "function" ? (action as (prev: S) => S)(state) : action,
    initialState as S,
    typeof initialState === "function" ? (initialState as () => S) : undefined,
  );
}

/**
 * useReducer - State with reducer pattern.
 */
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialArg: S,
  init?: (arg: S) => S,
): ReducerHookResult<S, A> {
  const hook = mountOrUpdateHook(HookTag.Reducer);
  const ctx = getCurrentContext();
  const fiber = ctx.fiber;

  if (hook.queue === null) {
    // Mount: initialize
    const initialState = init ? init(initialArg) : initialArg;
    hook.memoizedState = initialState;
    hook.baseState = initialState;

    const queue: UpdateQueue<A> = {
      pending: [], // Array instead of circular linked list - safer for concurrent dispatch
      dispatch: null,
      lastRenderedState: initialState as unknown as A,
    };
    hook.queue = queue as unknown as UpdateQueue;

    const dispatch = (action: A) => {
      dispatchAction(
        fiber,
        hook,
        queue as unknown as UpdateQueue<A>,
        reducer,
        action,
      );
    };
    queue.dispatch = dispatch as unknown as Dispatch<A>;
  } else {
    // Update: process pending updates
    const queue = hook.queue as unknown as UpdateQueue<A>;
    let newState = hook.baseState as S;

    // Process all pending updates from the array
    if (queue.pending.length > 0) {
      for (const update of queue.pending) {
        newState = reducer(newState, update.action as A);
      }
      // Clear the queue after processing
      queue.pending = [];
    }

    hook.memoizedState = newState;
    queue.lastRenderedState = newState as unknown as A;
  }

  return [
    hook.memoizedState as S,
    hook.queue!.dispatch as unknown as (action: A) => void,
  ];
}

function dispatchAction<S, A>(
  fiber: FiberNode,
  hook: HookState,
  queue: UpdateQueue<A>,
  reducer: (state: S, action: A) => S,
  action: A,
): void {
  const update: Update<A> = { action };

  // Array.push is atomic in JavaScript's single-threaded model,
  // avoiding race conditions that could occur with circular linked list manipulation
  // when multiple async operations dispatch concurrently.
  queue.pending.push(update);

  // Eagerly compute for bailout
  const currentState = hook.memoizedState as S;
  const newState = reducer(currentState, action);

  if (Object.is(currentState, newState)) {
    return; // Bailout
  }

  scheduleWork(fiber);
}

/**
 * useSignal - Signal-based state in function components.
 *
 * Provides full signal API (not just [value, setter]).
 * Automatically triggers recompiles when the signal is updated (like useState).
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const count = useSignal(0);
 *   return <Text>Count: {count()}</Text>;
 * }
 * ```
 */
export function useSignal<T>(initialValue: T): Signal<T> {
  const hook = mountOrUpdateHook(HookTag.Signal);
  const fiber = getCurrentFiber();

  if (hook.memoizedState === undefined) {
    const baseSignal = createSignal(initialValue);

    // Wrap set and update to trigger recompiles (like useState)
    // This makes useSignal behave consistently with useState for triggering renders
    const originalSet = baseSignal.set;
    const originalUpdate = baseSignal.update;

    const wrappedSet = (value: T | ((prev: T) => T)): void => {
      originalSet(value);
      // Trigger recompile if we have a fiber and we're not in a phase that should skip
      if (fiber && !shouldSkipRecompile()) {
        scheduleWork(fiber);
      }
    };

    const wrappedUpdate = (updater: (value: T) => T): void => {
      originalUpdate(updater);
      // Trigger recompile if we have a fiber and we're not in a phase that should skip
      if (fiber && !shouldSkipRecompile()) {
        scheduleWork(fiber);
      }
    };

    // Create wrapped signal with original signal's functionality
    const wrappedSignal = baseSignal as Signal<T>;
    wrappedSignal.set = wrappedSet;
    wrappedSignal.update = wrappedUpdate;

    hook.memoizedState = wrappedSignal;
  }

  return hook.memoizedState as Signal<T>;
}

// ============================================================================
// COM STATE HOOKS
// ============================================================================

/**
 * useComState - COM-bound shared state.
 *
 * Returns a signal bound to COM state. State is shared across all components
 * and persisted. Changes automatically trigger recompilation.
 *
 * @example
 * ```tsx
 * function Timeline() {
 *   const messages = useComState('timeline', []);
 *   return <Timeline>{messages().map(...)}</Timeline>;
 * }
 * ```
 */
export function useComState<T>(key: string, initialValue: T): Signal<T> {
  const hook = mountOrUpdateHook(HookTag.ComState);
  const ctx = getCurrentContext();

  if (hook.memoizedState === undefined) {
    const signal = createCOMStateSignal(ctx.com, key, initialValue);
    hook.memoizedState = signal;

    // Cleanup on unmount
    hook.effect = {
      phase: EffectPhase.Unmount,
      create: () => undefined,
      destroy: () => (signal as { dispose: () => void }).dispose(),
      deps: null,
      pending: false,
      next: null,
    };
  }

  // Safe to cast: initialValue is required, so T is never undefined
  return hook.memoizedState as Signal<T>;
}

/**
 * useWatch - Read-only COM state observation.
 * Returns a ReadonlySignal for reactive access to the watched state.
 *
 * @example
 * ```tsx
 * function StatusDisplay() {
 *   const status = useWatch('agentStatus', 'idle');
 *   return <Text>Status: {status()}</Text>;
 * }
 * ```
 */
export function useWatch<T>(
  key: string,
  defaultValue?: T,
): ReadonlySignal<T | undefined> {
  const hook = mountOrUpdateHook(HookTag.WatchState);
  const ctx = getCurrentContext();

  if (hook.memoizedState === undefined) {
    const signal = createReadonlyCOMStateSignal(ctx.com, key, defaultValue);
    hook.memoizedState = signal;

    hook.effect = {
      phase: EffectPhase.Unmount,
      create: () => undefined,
      destroy: () => (signal as { dispose: () => void }).dispose(),
      deps: null,
      pending: false,
      next: null,
    };
  }

  return hook.memoizedState as ReadonlySignal<T | undefined>;
}

/**
 * useInput - Reactive prop access with default value.
 */
export function useInput<T>(propKey: string, defaultValue?: T): T | undefined {
  const ctx = getCurrentContext();
  const value = ctx.fiber.props[propKey];
  return (value !== undefined ? value : defaultValue) as T | undefined;
}

// ============================================================================
// EFFECT HOOKS
// ============================================================================

/**
 * useEffect - Side effect after commit.
 *
 * Unlike React, callback CAN be async.
 * Signals/computed values in deps array are automatically unwrapped.
 *
 * @example
 * ```tsx
 * function Logger() {
 *   const message = useComState('message', '');
 *
 *   useEffect(async () => {
 *     await logToServer(message());  // Read signal value
 *     return () => console.log('cleanup');
 *   }, [message]);  // Signal auto-tracked by value
 * }
 * ```
 */
export function useEffect(create: EffectCallback, deps?: unknown[]): void {
  const hook = mountOrUpdateHook(HookTag.Effect);

  // Unwrap signals in deps for comparison
  const unwrappedDeps = unwrapDeps(deps);

  const hasDepsChanged =
    hook.effect === null ||
    unwrappedDeps === undefined ||
    unwrappedDeps === null ||
    !areHookInputsEqual(unwrappedDeps, hook.effect.deps);

  if (hasDepsChanged) {
    hook.effect = {
      phase: EffectPhase.Commit,
      create,
      destroy: hook.effect?.destroy ?? null,
      deps: unwrappedDeps ?? null,
      pending: true,
      next: null,
    };
  }
}

/**
 * useInit - Component initialization that runs once on mount.
 * Can be async and should be awaited if it returns a Promise.
 * Runs DURING render, blocking until complete.
 *
 * Use for: loading initial data, setting up state before first render
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const data = useComState('data', []);
 *
 *   await useInit(async (com, state) => {
 *     const initialData = await loadData();
 *     data.set(initialData);
 *   });
 *
 *   return <Section>{data().map(...)}</Section>;
 * }
 * ```
 */
export async function useInit(
  callback: (com: ContextObjectModel, state: TickState) => void | Promise<void>,
): Promise<void> {
  const ctx = getCurrentContext();
  const hook = mountOrUpdateHook(HookTag.Memo);

  if (hook.memoizedState === undefined) {
    const result = callback(ctx.com, ctx.tickState);
    const promise = result instanceof Promise ? result : Promise.resolve();
    hook.memoizedState = promise;
    await promise;
    return;
  }

  // Already initialized - return cached promise
  (await hook.memoizedState) as Promise<void>;
}

/**
 * useOnMount - Run once when component mounts as a side effect.
 * Runs AFTER render (as an effect), does not block rendering.
 * Use for non-critical side effects like logging, analytics.
 *
 * For blocking initialization, use `useInit` instead.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useOnMount((com) => {
 *     log.info('Component mounted');
 *   });
 *   return <Text>Hello</Text>;
 * }
 * ```
 */
export function useOnMount(
  callback: (com: ContextObjectModel) => void | Promise<void>,
): void {
  const ctx = getCurrentContext();

  useEffect(() => {
    callback(ctx.com);
  }, []);
}

/**
 * useOnUnmount - Run once when component unmounts.
 */
export function useOnUnmount(
  callback: (com: ContextObjectModel) => void | Promise<void>,
): void {
  const ctx = getCurrentContext();

  useEffect(() => {
    return () => callback(ctx.com);
  }, []);
}

/**
 * useTickStart - Run at start of each tick, before render.
 */
export function useTickStart(
  callback: (com: ContextObjectModel, state: TickState) => void | Promise<void>,
): void {
  const hook = mountOrUpdateHook(HookTag.TickStart);
  const ctx = getCurrentContext();

  // Always pending - runs every tick
  hook.effect = {
    phase: EffectPhase.TickStart,
    create: () => callback(ctx.com, ctx.tickState),
    destroy: null,
    deps: null,
    pending: true,
    next: null,
  };
  hook.memoizedState = callback;
}

/**
 * useTickEnd - Run at end of each tick, after model execution.
 */
export function useTickEnd(
  callback: (com: ContextObjectModel, state: TickState) => void | Promise<void>,
): void {
  const hook = mountOrUpdateHook(HookTag.TickEnd);
  const ctx = getCurrentContext();

  hook.effect = {
    phase: EffectPhase.TickEnd,
    create: () => callback(ctx.com, ctx.tickState),
    destroy: null,
    deps: null,
    pending: true,
    next: null,
  };
  hook.memoizedState = callback;
}

/**
 * useAfterCompile - Run after compile, can request recompile.
 */
export function useAfterCompile(
  callback: (
    com: ContextObjectModel,
    compiled: CompiledStructure,
    state: TickState,
  ) => void,
): void {
  const hook = mountOrUpdateHook(HookTag.AfterCompile);
  const ctx = getCurrentContext();

  // Store callback and create effect
  hook.memoizedState = callback;
  hook.effect = {
    phase: EffectPhase.AfterCompile,
    create: () => {
      // Will be called by compiler with compiled structure
      return undefined;
    },
    destroy: null,
    deps: null,
    pending: true,
    next: null,
  };
}

/**
 * useOnMessage - Handle execution messages.
 *
 * Called immediately when messages are sent to the running execution via:
 * - CompileSession.sendMessage() - Direct programmatic injection
 * - ExecutionHandle.send() - Via handle reference
 * - Channel events with type='message' - From client
 *
 * Messages are processed immediately when they arrive, not at tick boundaries.
 * Use com.abort() to interrupt execution if needed, or update state for the next tick.
 * Messages are also available in TickState.queuedMessages during render.
 *
 * @example
 * ```tsx
 * function InteractiveAgent() {
 *   const feedback = useComState('userFeedback', []);
 *
 *   useOnMessage((com, message, state) => {
 *     if (message.type === 'stop') {
 *       com.abort('User requested stop');
 *     } else if (message.type === 'feedback') {
 *       feedback.update(f => [...f, message.content]);
 *     }
 *   });
 *
 *   return <Section>{feedback().map(f => <Paragraph>{f}</Paragraph>)}</Section>;
 * }
 * ```
 */
export function useOnMessage(
  callback: (
    com: ContextObjectModel,
    message: ExecutionMessage,
    state: TickState,
  ) => void | Promise<void>,
): void {
  const hook = mountOrUpdateHook(HookTag.OnMessage);

  // Store the latest callback in memoizedState
  // This will be retrieved and called by notifyOnMessage in FiberCompiler
  hook.memoizedState = callback;

  // Mark with OnMessage tag for identification during traversal
  hook.effect = {
    phase: EffectPhase.OnMessage,
    create: () => undefined, // Will be called dynamically with message
    destroy: null,
    deps: null,
    pending: false, // Not pending by default - only runs when message arrives
    next: null,
  };
}

// ============================================================================
// ASYNC HOOKS
// ============================================================================

/**
 * useAsync - Async data fetching.
 *
 * Unlike React (which needs Suspense), we just track loading state.
 * The tick can wait for async work to complete.
 *
 * @example
 * ```tsx
 * function UserProfile({ userId }) {
 *   const { data: user, loading, error } = useAsync(
 *     () => fetchUser(userId),
 *     [userId]
 *   );
 *
 *   if (loading) return null;
 *   if (error) return <Text>Error: {error.message}</Text>;
 *
 *   return <Text>User: {user.name}</Text>;
 * }
 * ```
 */
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  deps: unknown[],
): AsyncResult<T> {
  const [state, setState] = useState<AsyncResult<T>>({
    data: undefined,
    loading: true,
    error: undefined,
  });

  // Track if deps changed
  const prevDeps = useRef<unknown[] | null>(null);
  const depsChanged =
    prevDeps.current === null || !areHookInputsEqual(deps, prevDeps.current);
  prevDeps.current = deps;

  // Only trigger on deps change
  if (depsChanged && state.loading === false) {
    setState({ data: undefined, loading: true, error: undefined });
  }

  useEffect(() => {
    let cancelled = false;

    asyncFn()
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, error: undefined });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ data: undefined, loading: false, error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, deps);

  return state;
}

// ============================================================================
// MEMOIZATION HOOKS
// ============================================================================

/**
 * useMemo - Memoize expensive computation.
 */
export function useMemo<T>(factory: () => T, deps: unknown[]): T {
  const hook = mountOrUpdateHook(HookTag.Memo);

  const memoState = hook.memoizedState as [T, unknown[]] | undefined;
  const prevDeps = memoState?.[1];

  if (prevDeps !== undefined && areHookInputsEqual(deps, prevDeps)) {
    return memoState![0];
  }

  const value = factory();
  hook.memoizedState = [value, deps];
  return value;
}

/**
 * useComputed - Create a reactive computed signal that persists across renders.
 *
 * Unlike useMemo which returns a plain value, useComputed returns a ComputedSignal
 * that automatically tracks dependencies and updates when they change.
 * The computed signal is disposed and recreated only when deps change.
 *
 * @example
 * ```typescript
 * const timeline = useComState('timeline', []);
 * const recentMessages = useComputed(() => timeline().slice(-10), []);
 *
 * // Read the computed value
 * const messages = recentMessages();  // or recentMessages.value
 * ```
 */
export function useComputed<T>(
  computation: () => T,
  deps: unknown[],
): ComputedSignal<T> {
  const hook = mountOrUpdateHook(HookTag.Memo);

  const memoState = hook.memoizedState as
    | [ComputedSignal<T>, unknown[]]
    | undefined;
  const prevDeps = memoState?.[1];

  // If deps haven't changed, return existing computed
  if (prevDeps !== undefined && areHookInputsEqual(deps, prevDeps)) {
    return memoState![0];
  }

  // Deps changed or first render - dispose old computed if it exists
  if (memoState?.[0]) {
    memoState[0].dispose();
  }

  // Create new computed signal
  const computedSignal = computed(computation);
  hook.memoizedState = [computedSignal, deps];

  return computedSignal;
}

/**
 * useCallback - Memoize callback function.
 */
export function useCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  deps: unknown[],
): T {
  return useMemo(() => callback, deps);
}

// ============================================================================
// REF HOOKS
// ============================================================================

/**
 * useRef - Mutable ref that persists across renders.
 */
export function useRef<T>(initialValue: T): RefObject<T> {
  const hook = mountOrUpdateHook(HookTag.Ref);

  if (hook.memoizedState === undefined) {
    hook.memoizedState = { current: initialValue };
  }

  return hook.memoizedState as RefObject<T>;
}

/**
 * useCOMRef - Get component ref from COM.
 */
export function useCOMRef<T>(refName: string): T | undefined {
  const ctx = getCurrentContext();
  return ctx.com.getRef<T>(refName);
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * usePrevious - Track previous value.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const previous = ref.current;

  // Update ref during render (not in effect) so it's ready for next render
  ref.current = value;

  return previous;
}

/**
 * useToggle - Boolean toggle state.
 */
export function useToggle(initial = false): [boolean, () => void] {
  const sig = useSignal(initial);
  const toggle = useCallback(() => sig.set((v) => !v), []);
  return [sig(), toggle];
}

/**
 * useCounter - Numeric counter.
 */
export function useCounter(initial = 0): {
  count: number;
  increment: () => void;
  decrement: () => void;
  set: (n: number) => void;
  reset: () => void;
} {
  const [count, setCount] = useState(initial);

  return {
    count,
    increment: useCallback(() => setCount((c) => c + 1), []),
    decrement: useCallback(() => setCount((c) => c - 1), []),
    set: setCount,
    reset: useCallback(() => setCount(initial), [initial]),
  };
}

/**
 * useAbortSignal - Get abort signal for current execution.
 */
export function useAbortSignal(): AbortSignal | undefined {
  const ctx = getCurrentContext();
  return ctx.abortSignal;
}

/**
 * useDebugValue - Display value in devtools (no-op in production).
 */
export function useDebugValue<T>(
  value: T,
  formatter?: (value: T) => unknown,
): void {
  if (process.env["NODE_ENV"] === "development") {
    const ctx = getCurrentContext();
    ctx.fiber.debugName = String(formatter ? formatter(value) : value);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function areHookInputsEqual(
  nextDeps: unknown[],
  prevDeps: unknown[] | null,
): boolean {
  if (prevDeps === null) return false;

  if (
    process.env["NODE_ENV"] === "development" &&
    nextDeps.length !== prevDeps.length
  ) {
    console.warn(
      "Hook dependency array changed size between renders. " +
        "The array must remain constant in length.",
    );
  }

  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue;
    return false;
  }

  return true;
}
