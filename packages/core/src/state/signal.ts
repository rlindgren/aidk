/**
 * Signal implementation for reactive state management.
 * 
 * Signals provide a lightweight, framework-agnostic way to manage reactive state.
 * Similar to Angular/SolidJS signals.
 * 
 * **Important:** Signals only work in class components (`EngineComponent`).
 * They do NOT work in pure function components. See `use-state.ts` for details.
 * 
 * @example
 * ```typescript
 * // Create a signal
 * const count = signal(0);
 * 
 * // Read value
 * console.log(count()); // 0
 * 
 * // Update value
 * count.set(10);
 * console.log(count()); // 10
 * 
 * // Update with function
 * count.update(n => n + 1);
 * console.log(count()); // 11
 * 
 * // Computed signal (memoized, auto-updates)
 * const doubled = computed(() => count() * 2);
 * console.log(doubled()); // 22
 * 
 * // Cleanup when done
 * count.dispose();
 * ```
 * 
 * @see docs/state-management.md for full documentation
 */

// Import for render phase detection
import { isCompilerRendering, shouldSkipRecompile, getActiveCompiler } from '../compiler/fiber-compiler';

// ============================================================================
// Types
// ============================================================================

export const SIGNAL_SYMBOL = Symbol.for('aidk.signal');
export const COMPUTED_SYMBOL = Symbol.for('aidk.computed');
export const EFFECT_SYMBOL = Symbol.for('aidk.effect');

type EqualityFn<T> = (a: T, b: T) => boolean;
type CleanupFn = () => void;

export interface SignalOptions<T> {
  /** Custom equality function. Default: Object.is */
  equal?: EqualityFn<T>;
  /** Signal name for debugging */
  name?: string;
}

export interface Signal<T> {
  /** Read the current value */
  (): T;
  /** Set a new value */
  set: (value: T | ((prev: T) => T)) => void;
  /** Update value with a function */
  update: (updater: (value: T) => T) => void;
  /** Current value (property access) */
  readonly value: T;
  /** Dispose this signal and clean up all listeners */
  dispose: () => void;
  /** Check if signal is disposed */
  readonly disposed: boolean;
}

export interface ComputedSignal<T> {
  /** Read the current value */
  (): T;
  /** Current value (property access) */
  readonly value: T;
  /** Dispose this computed and stop tracking */
  dispose: () => void;
  /** Check if computed is disposed */
  readonly disposed: boolean;
}

/**
 * A read-only signal that can be observed but not modified.
 * Used for watching state owned by another component.
 */
export interface ReadonlySignal<T> {
  /** Read the current value */
  (): T;
  /** Current value (property access) */
  readonly value: T;
  /** Dispose this signal and stop watching */
  dispose: () => void;
  /** Check if disposed */
  readonly disposed: boolean;
}

export interface EffectRef {
  /** Dispose this effect and stop running */
  dispose: () => void;
  /** Check if effect is disposed */
  readonly disposed: boolean;
}

// ============================================================================
// Batching
// ============================================================================

let batchDepth = 0;
const pendingEffects = new Set<() => void>();
let flushScheduled = false;

/**
 * Batch multiple signal updates together.
 * Effects only run once after all updates complete.
 * 
 * @example
 * ```typescript
 * batch(() => {
 *   count.set(1);
 *   name.set('Alice');
 *   // Effects run once here, not twice
 * });
 * ```
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flushPendingEffects();
    }
  }
}

function scheduleEffect(effectFn: () => void): void {
  if (batchDepth > 0) {
    pendingEffects.add(effectFn);
    return;
  }
  
  // Schedule microtask flush if not already scheduled
  pendingEffects.add(effectFn);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushPendingEffects);
  }
}

function flushPendingEffects(): void {
  flushScheduled = false;
  const effects = [...pendingEffects];
  pendingEffects.clear();
  
  for (const effectFn of effects) {
    try {
      effectFn();
    } catch (error) {
      console.error('Error in signal effect:', error);
    }
  }
}

// ============================================================================
// Dependency Tracking
// ============================================================================

/**
 * Subscription represents a connection between a signal and a subscriber.
 * Calling dispose() removes the subscriber from the signal.
 */
interface Subscription {
  notify: () => void;
  dispose: () => void;
}

/**
 * A reactive node that can be subscribed to.
 * Both signals and computeds implement this.
 */
interface ReactiveSource {
  _subscribe: (notify: () => void) => Subscription;
}

// Stack of currently tracking computeds/effects
interface TrackingContext {
  onDependency: (source: ReactiveSource) => void;
}

const trackingStack: TrackingContext[] = [];

function getCurrentTrackingContext(): TrackingContext | undefined {
  return trackingStack[trackingStack.length - 1];
}

function pushTrackingContext(ctx: TrackingContext): void {
  trackingStack.push(ctx);
}

function popTrackingContext(): void {
  trackingStack.pop();
}

// ============================================================================
// Signal
// ============================================================================

/**
 * Creates a writable signal with an initial value.
 * 
 * @example
 * ```typescript
 * const count = signal(0);
 * count();           // 0
 * count.set(10);     // set to 10
 * count.update(n => n + 1);  // increment
 * count.dispose();   // cleanup
 * ```
 */
export function signal<T>(initialValue: T, options?: SignalOptions<T>): Signal<T> {
  let value = initialValue;
  let isDisposed = false;
  const subscriptions = new Set<Subscription>();
  const equal = options?.equal ?? Object.is;

  const notify = () => {
    for (const sub of subscriptions) {
      scheduleEffect(sub.notify);
    }
  };

  // Internal: subscribe to this signal
  const _subscribe = (notifyFn: () => void): Subscription => {
    const subscription: Subscription = {
      notify: notifyFn,
      dispose: () => {
        subscriptions.delete(subscription);
      }
    };
    subscriptions.add(subscription);
    return subscription;
  };

  const getter = (): T => {
    if (isDisposed) {
      return value;
    }
    
    // Track this signal as a dependency of current computed/effect
    const context = getCurrentTrackingContext();
    if (context) {
      context.onDependency({ _subscribe } as ReactiveSource);
    }
    
    return value;
  };

  const setter = (newValue: T | ((prev: T) => T)): void => {
    if (isDisposed) {
      console.warn('Attempted to set disposed signal');
      return;
    }
    
    const nextValue = typeof newValue === 'function' 
      ? (newValue as (prev: T) => T)(value)
      : newValue;
    
    if (!equal(nextValue, value)) {
      value = nextValue;
      notify();
    }
  };

  const updater = (updaterFn: (value: T) => T): void => {
    setter(updaterFn(value));
  };

  const dispose = (): void => {
    isDisposed = true;
    subscriptions.clear();
  };

  const signalFn = getter as Signal<T> & ReactiveSource;
  signalFn.set = setter;
  signalFn.update = updater;
  signalFn.dispose = dispose;
  signalFn._subscribe = _subscribe;
  (signalFn as any)[SIGNAL_SYMBOL] = true;
  
  Object.defineProperty(signalFn, 'value', {
    get: getter,
    enumerable: true,
    configurable: true,
  });
  
  Object.defineProperty(signalFn, 'disposed', {
    get: () => isDisposed,
    enumerable: true,
    configurable: true,
  });

  return signalFn;
}

// ============================================================================
// Computed
// ============================================================================

/**
 * Creates a computed signal that derives its value from other signals.
 * Computed values are memoized and only recompute when dependencies change.
 * 
 * @example
 * ```typescript
 * const count = signal(0);
 * const doubled = computed(() => count() * 2);
 * 
 * doubled();  // 0
 * count.set(5);
 * doubled();  // 10 (recomputed)
 * doubled();  // 10 (cached, no recompute)
 * ```
 */
export function computed<T>(computation: () => T, options?: SignalOptions<T>): ComputedSignal<T> {
  let cachedValue: T;
  let isDirty = true;
  let isDisposed = false;
  let isComputing = false;
  const _equal = options?.equal ?? Object.is;
  
  // Subscriptions to our dependencies (signals we read)
  const dependencySubscriptions = new Set<Subscription>();
  // Subscriptions from our dependents (things that read us)
  const dependentSubscriptions = new Set<Subscription>();

  const markDirty = () => {
    if (!isDirty && !isDisposed) {
      isDirty = true;
      // Notify our dependents that we might have changed
      for (const sub of dependentSubscriptions) {
        scheduleEffect(sub.notify);
      }
    }
  };

  // Internal: subscribe to this computed
  const _subscribe = (notifyFn: () => void): Subscription => {
    const subscription: Subscription = {
      notify: notifyFn,
      dispose: () => {
        dependentSubscriptions.delete(subscription);
      }
    };
    dependentSubscriptions.add(subscription);
    return subscription;
  };

  const clearDependencies = () => {
    // Unsubscribe from all current dependencies
    for (const sub of dependencySubscriptions) {
      sub.dispose();
    }
    dependencySubscriptions.clear();
  };

  const recompute = (): T => {
    if (isComputing) {
      throw new Error('Circular dependency detected in computed signal');
    }
    
    isComputing = true;
    
    // Clear old dependencies
    clearDependencies();
    
    // Set up tracking context to capture new dependencies
    const trackingContext: TrackingContext = {
      onDependency: (source: ReactiveSource) => {
        // Subscribe to this dependency
        const subscription = source._subscribe(markDirty);
        dependencySubscriptions.add(subscription);
      }
    };
    pushTrackingContext(trackingContext);
    
    try {
      const newValue = computation();
      cachedValue = newValue;
      isDirty = false;
      return cachedValue;
    } finally {
      popTrackingContext();
      isComputing = false;
    }
  };

  const getter = (): T => {
    if (isDisposed) {
      return cachedValue;
    }
    
    // Track this computed as dependency of parent computed/effect
    const context = getCurrentTrackingContext();
    if (context) {
      context.onDependency({ _subscribe } as ReactiveSource);
    }
    
    // Recompute if dirty (lazy evaluation)
    if (isDirty) {
      recompute();
    }
    
    return cachedValue;
  };

  const dispose = (): void => {
    if (isDisposed) return;
    
    isDisposed = true;
    isDirty = false;
    
    // Unsubscribe from all dependencies - THIS FIXES THE MEMORY LEAK
    clearDependencies();
    
    // Clear our dependents (they'll get undefined on next read)
    dependentSubscriptions.clear();
  };

  const computedFn = getter as ComputedSignal<T> & ReactiveSource;
  computedFn.dispose = dispose;
  computedFn._subscribe = _subscribe;
  (computedFn as any)[COMPUTED_SYMBOL] = true;
  
  Object.defineProperty(computedFn, 'value', {
    get: getter,
    enumerable: true,
    configurable: true,
  });
  
  Object.defineProperty(computedFn, 'disposed', {
    get: () => isDisposed,
    enumerable: true,
    configurable: true,
  });

  return computedFn;
}

// ============================================================================
// Effect
// ============================================================================

/**
 * Runs an effect that automatically re-runs when dependencies change.
 * Use sparingly - prefer computed() for derived values.
 * 
 * Best for: syncing to external APIs (localStorage, canvas, DOM, etc.)
 * 
 * @example
 * ```typescript
 * const count = signal(0);
 * 
 * const ref = effect(() => {
 *   console.log('Count:', count());
 * });
 * 
 * count.set(5);  // logs "Count: 5"
 * 
 * ref.dispose();  // stop the effect
 * ```
 */
export function effect(fn: (onCleanup: (cleanup: CleanupFn) => void) => void | CleanupFn): EffectRef {
  let isDisposed = false;
  let cleanupFn: CleanupFn | undefined;
  const dependencySubscriptions = new Set<Subscription>();

  const clearDependencies = () => {
    for (const sub of dependencySubscriptions) {
      sub.dispose();
    }
    dependencySubscriptions.clear();
  };

  const runEffect = () => {
    if (isDisposed) return;
    
    // Run cleanup from previous execution
    if (cleanupFn) {
      try {
        cleanupFn();
      } catch (error) {
        console.error('Error in effect cleanup:', error);
      }
      cleanupFn = undefined;
    }
    
    // Clear old dependencies
    clearDependencies();
    
    // Set up tracking context
    const trackingContext: TrackingContext = {
      onDependency: (source: ReactiveSource) => {
        const subscription = source._subscribe(runEffect);
        dependencySubscriptions.add(subscription);
      }
    };
    pushTrackingContext(trackingContext);
    
    try {
      // Allow effect to register cleanup via callback or return value
      const onCleanup = (cleanup: CleanupFn) => {
        cleanupFn = cleanup;
      };
      
      const result = fn(onCleanup);
      
      // Also accept cleanup as return value (like React useEffect)
      if (typeof result === 'function') {
        cleanupFn = result;
      }
    } finally {
      popTrackingContext();
    }
  };

  const dispose = (): void => {
    if (isDisposed) return;
    
    isDisposed = true;
    
    // Unsubscribe from all dependencies
    clearDependencies();
    
    // Run final cleanup
    if (cleanupFn) {
      try {
        cleanupFn();
      } catch (error) {
        console.error('Error in effect cleanup:', error);
      }
      cleanupFn = undefined;
    }
  };

  // Run immediately
  runEffect();

  const effectRef: EffectRef = {
    dispose,
    get disposed() {
      return isDisposed;
    }
  };
  
  // Mark as effect for cleanup detection
  (effectRef as any)[EFFECT_SYMBOL] = true;
  
  return effectRef;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Read a signal without tracking it as a dependency.
 * Useful when you want to read a value in a computed/effect without
 * triggering re-runs when that value changes.
 * 
 * @example
 * ```typescript
 * effect(() => {
 *   const user = currentUser();
 *   const count = untracked(() => counter());  // won't trigger re-run
 *   console.log(`User ${user} has count ${count}`);
 * });
 * ```
 */
export function untracked<T>(fn: () => T): T {
  // Temporarily remove tracking context
  const savedStack = [...trackingStack];
  trackingStack.length = 0;
  
  try {
    return fn();
  } finally {
    trackingStack.push(...savedStack);
  }
}

/**
 * Check if a value is a signal.
 */
export function isSignal(value: unknown): value is Signal<unknown> {
  return typeof value === 'function' && (value as any)[SIGNAL_SYMBOL] === true;
}

/**
 * Check if a value is a computed signal.
 */
export function isComputed(value: unknown): value is ComputedSignal<unknown> {
  return typeof value === 'function' && (value as any)[COMPUTED_SYMBOL] === true;
}

/**
 * Check if a value is an effect ref.
 */
export function isEffect(value: unknown): value is EffectRef {
  return value !== null && typeof value === 'object' && (value as any)[EFFECT_SYMBOL] === true;
}

// ============================================================================
// COM State Signal
// ============================================================================

export const COM_SIGNAL_SYMBOL = Symbol.for('aidk.comSignal');

/**
 * Creates a signal bound to COM state.
 * Changes sync bidirectionally between signal and COM.
 * 
 * @internal Used by comState() after COM is available
 */
export function createCOMStateSignal<T>(
  com: { 
    getState: (key: string) => T | undefined; 
    setState: (key: string, value: unknown) => void; 
    on: (event: any, handler: (...args: any[]) => void) => any; 
    off?: (event: any, handler: (...args: any[]) => void) => any;
  },
  key: string,
  initialValue?: T
): Signal<T | undefined> {
  const sig = signal<T | undefined>(com.getState(key) ?? initialValue);
  
  // Flag to prevent circular updates
  let isUpdatingFromCOM = false;
  
  // Listen for COM state changes from other sources
  const handler = (changedKey: string, value: unknown) => {
    if (changedKey === key && !isUpdatingFromCOM) {
      isUpdatingFromCOM = true;
      try {
        // Update signal without triggering our own setter logic
        const internalSet = sig.set;
        internalSet(value as T);
        
        // AUTOMATIC RECOMPILATION: If COM state changes during render phase,
        // request recompile to ensure consistency across sibling components
        // BUT: Skip in phases where recompile is unnecessary
        if (isCompilerRendering() && !shouldSkipRecompile()) {
          const compiler = getActiveCompiler();
          if (compiler) {
            const comObj = com as any;
            if (comObj.requestRecompile) {
              comObj.requestRecompile(`comState '${key}' changed during render`);
            }
          }
        }
      } finally {
        isUpdatingFromCOM = false;
      }
    }
  };
  
  com.on('state:changed', handler);
  
  // Override set to also update COM
  const originalSet = sig.set;
  sig.set = (value) => {
    if (isUpdatingFromCOM) {
      originalSet.call(sig, value);
      return;
    }
    
    const currentValue = sig();
    const nextValue = typeof value === 'function' 
      ? (value as (prev: T | undefined) => T | undefined)(currentValue)
      : value;
    
    // Bailout if value hasn't changed
    if (Object.is(currentValue, nextValue)) {
      return;
    }
    
    // DEV WARNING: Setting comState during render
    if (process.env['NODE_ENV'] === 'development' && isCompilerRendering()) {
      console.warn(
        `[AIDK] comState '${key}' is being set during render phase.\n` +
        `This may cause sibling components to see stale data in the current iteration.\n` +
        `Consider updating state in lifecycle methods (onTickStart, onMount) instead.\n` +
        `An automatic recompile will be triggered to ensure consistency.`
      );
    }
    
    // Update COM first (will trigger handler, but flag prevents circular)
    isUpdatingFromCOM = true;
    try {
      com.setState(key, nextValue);
    } finally {
      isUpdatingFromCOM = false;
    }
    
    // Then update signal
    originalSet.call(sig, nextValue);
    
    // AUTOMATIC RECOMPILATION: Request recompile after state change
    // This ensures useComState behaves like useState for triggering re-renders
    // BUT: Skip recompile in certain phases where it's unnecessary:
    // - tickStart: Render is about to happen anyway
    // - tickEnd: Current tick is done, next tick will see the update
    // - complete: Execution is complete, no more renders
    // - unmount: Component is being removed
    // - render (class onMount): Class component onMount runs during render, before render() is called
    // 
    // ALLOW recompile in:
    // - mount (useOnMount): Function component useOnMount runs after first render, can trigger recompile
    if (!shouldSkipRecompile()) {
      const comObj = com as any;
      if (comObj.requestRecompile) {
        comObj.requestRecompile(`comState '${key}' updated`);
      }
    }
  };
  
  // Override dispose to cleanup COM listener
  const originalDispose = sig.dispose;
  sig.dispose = () => {
    if (com.off) {
      com.off('state:changed', handler);
    }
    originalDispose.call(sig);
  };
  
  // Mark as COM signal
  (sig as any)[COM_SIGNAL_SYMBOL] = key;
  
  return sig;
}

export const WATCH_SIGNAL_SYMBOL = Symbol.for('aidk.watchSignal');
export const PROPS_SIGNAL_SYMBOL = Symbol.for('aidk.propsSignal');
export const REQUIRED_INPUT_SYMBOL = Symbol.for('aidk.requiredInput');

/**
 * Creates a read-only signal that watches COM state.
 * The signal updates when COM state changes, but cannot modify it.
 * 
 * @internal Used by watchComState() and watch()
 */
export function createReadonlyCOMStateSignal<T>(
  com: { 
    getState: (key: string) => T | undefined; 
    on: (event: any, handler: (...args: any[]) => void) => any; 
    off?: (event: any, handler: (...args: any[]) => void) => any;
  },
  key: string,
  defaultValue?: T
): ReadonlySignal<T | undefined> {
  let value: T | undefined = com.getState(key) ?? defaultValue;
  let isDisposed = false;
  
  // Listen for COM state changes
  const handler = (changedKey: string, newValue: unknown) => {
    if (changedKey === key && !isDisposed) {
      value = newValue as T;
      // Notify any computed/effects that depend on this
      scheduleEffect(() => {});  // Force reactivity check
      
      // AUTOMATIC RECOMPILATION: If watched COM state changes during render,
      // request recompile to ensure consistency across sibling components
      // BUT: Skip in phases where recompile is unnecessary
      if (isCompilerRendering() && !shouldSkipRecompile()) {
        const compiler = getActiveCompiler();
        if (compiler) {
          const comObj = com as any;
          if (comObj.requestRecompile) {
            comObj.requestRecompile(`watched comState '${key}' changed during render`);
          }
        }
      }
    }
  };
  
  com.on('state:changed', handler);
  
  const getter = (): T | undefined => {
    if (isDisposed) return value;
    
    // Track as dependency if inside computed/effect
    const context = getCurrentTrackingContext();
    if (context) {
      // Create a virtual subscription for tracking
      context.onDependency({
        _subscribe: (notify: () => void) => ({
          notify,
          dispose: () => {}
        })
      } as any);
    }
    
    return value;
  };
  
  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    if (com.off) {
      com.off('state:changed', handler);
    }
  };
  
  const readonlySignal: ReadonlySignal<T | undefined> = Object.assign(getter, {
    dispose,
    get value() { return getter(); },
    get disposed() { return isDisposed; }
  });
  
  // Mark for cleanup detection
  (readonlySignal as any)[WATCH_SIGNAL_SYMBOL] = key;
  
  return readonlySignal;
}
