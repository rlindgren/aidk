import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { type ChannelServiceInterface } from './channel';
import { ProcedureGraph } from './procedure-graph';
import type { ProcedureNode } from './procedure-graph';

export interface UserContext {
  id: string;
  tenantId?: string;
  roles?: string[];
  [key: string]: any;
}

export interface ExecutionEvent {
  type: string;
  payload: any;
  timestamp: number;
  source: string; // e.g. 'agent:sales', 'model:openai'
  traceId: string;
}

export interface ContextMetadata extends Record<string, any> {

}

export interface ContextMetrics extends Record<string, any> {
}

/**
 * Base KernelContext interface with core properties.
 * Libraries can extend this interface to add their own properties.
 * 
 * @example
 * ```typescript
 * interface EngineContext extends KernelContext {
 *   executionHandle?: ExecutionHandleImpl; // Narrower type than EventEmitter
 * }
 * ```
 */
export interface KernelContext {
  requestId: string;
  traceId: string;
  user?: UserContext;
  metadata: ContextMetadata;
  metrics: ContextMetrics;
  events: EventEmitter; // The Global Request Bus
  signal?: AbortSignal; // Cancellation
  executionHandle?: EventEmitter; // The specific Operation Handle (if any)
  /**
   * Channel service for bidirectional communication (optional).
   * Injected by Engine when channels are configured.
   * Tools and components can access channels via this service.
   */
  channels?: ChannelServiceInterface;
  /**
   * Procedure graph for tracking procedure execution hierarchy.
   * Automatically initialized when first procedure is executed.
   */
  procedureGraph?: ProcedureGraph;
  /**
   * Current procedure PID (for tracking nested procedures).
   */
  procedurePid?: string;
  procedureNode?: ProcedureNode;
  /**
   * Origin procedure node - the root procedure that initiated this execution chain.
   * Undefined for the root procedure itself (since it IS the origin).
   * Set automatically by ExecutionTracker when procedures are executed.
   */
  origin?: ProcedureNode;
}

const storage = new AsyncLocalStorage<KernelContext>();

export class Context {
  /**
   * Creates a new context object with defaults.
   */
  static create(overrides: Partial<Omit<KernelContext, 'events'>> = {}): KernelContext {
    return {
      requestId: overrides.requestId ?? crypto.randomUUID(),
      traceId: overrides.traceId ?? crypto.randomUUID(),
      metadata: overrides.metadata ?? {},
      metrics: {},
      events: new EventEmitter(),
      user: overrides.user,
      signal: overrides.signal,
      executionHandle: overrides.executionHandle,
    };
  }

  /**
   * Runs a function within the given context.
   */
  static run<T>(context: KernelContext, fn: () => Promise<T>): Promise<T> {
    return storage.run(context, fn);
  }

  /**
   * Gets the current context. Throws if not found.
   */
  static get(): KernelContext {
    const store = storage.getStore();
    if (!store) {
      throw new Error(
        'Context not found. Ensure you are running within a Context.run() block or using a Kernel Procedure.'
      );
    }
    return store;
  }

  /**
   * Gets the current context or returns undefined if not found.
   */
  static tryGet(): KernelContext | undefined {
    return storage.getStore();
  }

  /**
   * Helper to emit an event on the current context.
   */
  static emit(type: string, payload: any, source: string = 'system'): void {
    const ctx = this.tryGet();
    if (ctx) {
      const event: ExecutionEvent = {
        type,
        payload,
        timestamp: Date.now(),
        source,
        traceId: ctx.traceId,
      };
      
      // 1. Emit to the Global Request Bus
      ctx.events.emit(type, event);
      ctx.events.emit('*', event);

      // 2. Emit to the Operation Handle (if exists and is an EventEmitter)
      if (ctx.executionHandle) {
        ctx.executionHandle.emit?.(type, event);
        ctx.executionHandle.emit?.('*', event);
      }
    }
  }
}


export class ContextProvider {
  withContext<T>(context: KernelContext, fn: () => Promise<T>): Promise<T> {
    return Context.run(Context.create(context), async () => await fn());
  }
}

/**
 * Symbol used to brand context objects for deterministic detection.
 * This allows procedures to distinguish context from regular arguments.
 */
export const KERNEL_CONTEXT_SYMBOL = Symbol.for('aidk-kernel.context');

/**
 * Brand a context object with a Symbol for deterministic detection.
 * This allows procedures to deterministically identify context vs regular args.
 * 
 * @example
 * ```typescript
 * await proc(input, agent, context({ traceId: "123" }));
 * ```
 */
export function context(ctx: Partial<KernelContext>): Partial<KernelContext> & { [KERNEL_CONTEXT_SYMBOL]: true } {
  return {
    ...ctx,
    [KERNEL_CONTEXT_SYMBOL]: true as const
  };
}

/**
 * Check if an object is a branded context (deterministic check via Symbol).
 * This is 100% reliable - no heuristics needed.
 */
export function isKernelContext(obj: any): obj is Partial<KernelContext> {
  return obj != null && typeof obj === 'object' && KERNEL_CONTEXT_SYMBOL in obj;
}

/**
 * Type for branded context objects
 */
export type BrandedContext = Partial<KernelContext> & { [KERNEL_CONTEXT_SYMBOL]: true };