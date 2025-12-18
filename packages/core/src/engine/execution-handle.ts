import {
  type ExecutionHandle,
  type ExecutionStatus,
  type ExecutionType,
  type ExecutionMetrics,
  type ExecutionState,
  type SignalType,
  type SignalEvent,
  generatePid,
} from './execution-types';
import type { COMInput } from '../com/types';
import type { EngineStreamEvent } from './engine-events';
import { EventEmitter } from 'node:events';
import { ProcedureGraph, ProcedureNode, type ExecutionHandle as KernelExecutionHandle, type HandleFactory } from 'aidk-kernel';
import { Context } from 'aidk-kernel';
import { ContextObjectModel } from '../com/object-model';
import { ExecutionGraph } from './execution-graph';
import type { EngineContext } from '../types';

/**
 * Concrete implementation of ExecutionHandle
 * Also implements Kernel's ExecutionHandle<TOutput> for Procedure compatibility
 */
export class ExecutionHandleImpl extends EventEmitter implements ExecutionHandle, KernelExecutionHandle<COMInput> {
  public readonly pid: string;
  public readonly parentPid?: string;
  public readonly rootPid: string;
  public readonly type: ExecutionType;
  public status: ExecutionStatus;
  public readonly startedAt: Date;
  public completedAt?: Date;
  
  // Kernel ExecutionHandle<TOutput> compatibility
  public readonly result: Promise<COMInput>; // Maps to completionPromise
  public readonly events: EventEmitter; // Self-reference since we extend EventEmitter
  public traceId: string = ''; // Set by handle factory
  
  private resultValue?: COMInput; // Actual result value (set when complete)
  private error?: Error;
  private cancelController?: AbortController;
  private completionPromise: Promise<COMInput>;
  private completionResolve?: (value: COMInput) => void;
  private completionReject?: (error: Error) => void;
  private comInstance?: ContextObjectModel;
  private streamIterator?: AsyncIterable<EngineStreamEvent>;
  private tickCount: number = 0;
  private shutdownHooks: Array<() => Promise<void> | void> = [];
  private parentHandle?: ExecutionHandle;
  private executionGraph?: { getChildren: (pid: string) => ExecutionHandle[] };
  public executionGraphForStatus?: { updateStatus: (pid: string, status: ExecutionStatus, error?: Error, phase?: string) => void };
  private procedureGraph?: ProcedureGraph; // Procedure graph for this execution
  private _abortEmitted: boolean = false; // Track if abort signal was already emitted (before listeners were set up)
  private _listenersSetup: boolean = false; // Track if abort listeners have been set up in iterateTicks
  
  constructor(
    pid: string,
    rootPid: string,
    type: ExecutionType,
    parentPid?: string,
    parentHandle?: ExecutionHandle,
    executionGraph?: { getChildren: (pid: string) => ExecutionHandle[] }
  ) {
    super();
    this.pid = pid;
    this.rootPid = rootPid;
    this.type = type;
    this.parentPid = parentPid;
    this.status = 'running';
    this.startedAt = new Date();
    this.parentHandle = parentHandle;
    this.executionGraph = executionGraph;
    
    // Create completion promise
    this.completionPromise = new Promise<COMInput>((resolve, reject) => {
      this.completionResolve = resolve;
      this.completionReject = reject;
    });
    // Prevent unhandled promise rejection when fail() or cancel() is called but no one is waiting
    // This catch handler ensures that rejections are always handled, even if waitForCompletion() is never called
    this.completionPromise.catch((error) => {
      // Error is stored in this.error and will be returned by waitForCompletion
      // if called later. This catch prevents Node.js from complaining about
      // unhandled rejections when we use fail() or cancel() internally.
      // Silently handle the rejection - it's expected behavior
    });
    
    // Kernel ExecutionHandle<TOutput> compatibility
    // result maps to completionPromise (Kernel expects Promise<TOutput>)
    this.result = this.completionPromise;
    // events is self-reference since we extend EventEmitter
    this.events = this;
    
    // For forks: monitor parent status
    if (type === 'fork' && parentHandle) {
      // If parent has already completed, fork runs independently (orphaned fork)
      // Clear any abort flags that might have been set by propagated signals from completed parent
      // Also mark listeners as setup to prevent wasAbortEmitted() from returning true
      // for aborts that occurred before the fork started executing
      if (parentHandle.status !== 'running') {
        this._abortEmitted = false; // Clear flag - parent completed, fork runs independently
        this._listenersSetup = true; // Mark as setup to ignore pre-execution aborts
      }
      this.setupParentStatusMonitor(parentHandle);
    }
  }
  
  /**
   * Monitor parent status (forks only)
   * When parent fails or is cancelled AFTER fork is created, abort fork.
   * 
   * Note: If parent completes successfully, fork continues running independently.
   * If parent is already completed/failed when fork is created, the fork runs independently
   * as an "orphaned fork" (see ExecutionGraph.getOrphanedForks()). This allows forks to
   * be created from completed parents for testing and post-execution workflows.
   */
  private setupParentStatusMonitor(parent: ExecutionHandle): void {
    // Only monitor if parent is still running
    // If parent is already completed/failed, fork runs independently (orphaned fork)
    if (parent.status !== 'running') {
      // Parent already completed/failed - fork runs independently
      // This is intentional: forks created after parent completes are "orphaned forks"
      return;
    }
    
    // Only abort fork if parent fails or is cancelled - NOT on successful completion
    // Forks should continue running after parent completes successfully
    parent.once('failed', () => {
      if (this.status === 'running') {
        this.emitSignal('abort', 'Parent execution failed', {
          propagatedFrom: parent.pid,
        });
      }
    });
    
    // Monitor cancellation via abort signal (parent.cancel() emits abort)
    parent.once('abort', () => {
      if (this.status === 'running') {
        this.emitSignal('abort', 'Parent execution cancelled', {
          propagatedFrom: parent.pid,
        });
      }
    });
    
    // Also monitor via waitForCompletion as fallback
    // Only abort on failure/cancellation, not on successful completion
    if (parent.status === 'running') {
      parent.waitForCompletion().catch((error) => {
        // Parent failed or was cancelled - abort fork
        // Don't abort on successful completion - fork should continue running
        if (this.status === 'running') {
          this.emitSignal('abort', 'Parent execution failed', {
            propagatedFrom: parent.pid,
          });
        }
      });
      // Note: Successful completion resolves the promise, but we don't abort the fork
      // The fork continues running independently after parent completes
    }
  }
  
  /**
   * Set the stream iterator for this execution
   */
  setStreamIterator(iterator: AsyncIterable<EngineStreamEvent>): void {
    this.streamIterator = iterator;
  }
  
  /**
   * Set the cancel controller
   */
  setCancelController(controller: AbortController): void {
    this.cancelController = controller;
    // Setup listener for abort signal
    // Only add listener if signal is not already aborted
    // Note: This listener will emit when controller is aborted externally
    // When cancel() is called, it emits the signal first, then aborts the controller
    // So this listener acts as a fallback for external aborts
    if (!controller.signal.aborted) {
      controller.signal.addEventListener('abort', () => {
        // Only emit if we're still running (avoid duplicate if cancel() was called)
        if (this.status === 'running') {
          this.emitSignal('abort', 'Execution cancelled');
        }
      });
    }
    // Note: If signal is already aborted when setCancelController is called,
    // we don't need to do anything here because:
    // 1. For normal executions, the controller is always fresh (not aborted)
    // 2. For forks, the merged signal (which may be aborted) is passed via context,
    //    not via setCancelController. The abort will be detected via ctx.signal.aborted
    //    in iterateTicks.
  }
  
  /**
   * Set the execution graph (for signal propagation to children)
   */
  setExecutionGraph(graph: { getChildren: (pid: string) => ExecutionHandle[] }): void {
    this.executionGraph = graph;
  }
  
  /**
   * Set the execution graph for status updates (for spawn/fork handles registered in parent engine)
   */
  setExecutionGraphForStatus(graph: { updateStatus: (pid: string, status: ExecutionStatus, error?: Error, phase?: string) => void }): void {
    this.executionGraphForStatus = graph;
  }

  /**
   * Get the cancel signal (if cancel controller is set)
   */
  getCancelSignal(): AbortSignal | undefined {
    // Don't return signal if execution has completed or failed
    // This prevents forks from inheriting aborted signals from completed parents
    if (this.status !== 'running' && this.status !== 'cancelled') {
      return undefined;
    }
    return this.cancelController?.signal;
  }
  
  /**
   * Increment tick count
   */
  incrementTick(): void {
    this.tickCount++;
  }
  
  /**
   * Mark execution as completed
   */
  complete(result: COMInput): void {
    if (this.status !== 'running') {
      return;
    }
    
    this.status = 'completed';
    this.completedAt = new Date();
    this.resultValue = result;
    
    // Emit completion event
    this.emit('completed', result);
    
    if (this.completionResolve) {
      const resolve = this.completionResolve;
      // Clear resolve function to prevent double-resolution
      this.completionResolve = undefined;
      this.completionReject = undefined; // Also clear reject since we're resolving
      resolve(result);
    }
  }
  
  /**
   * Mark execution as failed
   */
  fail(error: Error): void {
    if (this.status !== 'running') {
      return;
    }
    
    this.status = 'failed';
    this.completedAt = new Date();
    this.error = error;
    
    // Emit failure event
    this.emit('failed', error);
    
    if (this.completionReject) {
      const reject = this.completionReject;
      // Clear reject function to prevent double-rejection
      this.completionReject = undefined;
      this.completionResolve = undefined; // Also clear resolve since we're rejecting
      
      // Reject the promise - the catch handler in constructor will prevent unhandled rejection
      try {
        reject(error);
      } catch (rejectionError) {
        // Ignore errors if promise already settled (this is expected and harmless)
        // The promise's catch handler will still prevent unhandled rejection
      }
    }
  }
  
  /**
   * Wait for execution to complete
   */
  async waitForCompletion(options?: { timeout?: number }): Promise<COMInput> {
    if (!this.completionPromise) {
      throw new Error('Execution handle not properly initialized');
    }
    
    if (options?.timeout) {
      return Promise.race([
        this.completionPromise,
        new Promise<COMInput>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Execution ${this.pid} timed out after ${options.timeout}ms`));
          }, options.timeout);
        }),
      ]);
    }
    
    return this.completionPromise;
  }
  
  /**
   * Cancel the execution (triggers abort signal)
   */
  cancel(reason?: string): void {
    if (this.status !== 'running') {
      return;
    }
    
    this.status = 'cancelled';
    this.completedAt = new Date();
    
    // Emit abort signal first (this will propagate to children)
    // Note: We emit before aborting the controller to avoid duplicate signals
    // The controller's abort listener will also emit, but we check for already-aborted status
    this.emitSignal('abort', reason || 'Execution cancelled');
    
    // Abort the controller (this will trigger its listener, but we've already emitted)
    if (this.cancelController && !this.cancelController.signal.aborted) {
      this.cancelController.abort();
    }
    
    // Reject the completion promise if it hasn't been settled yet
    // Reject synchronously - callers should handle the rejection
    // Clear reject function immediately to prevent double-rejection
    if (this.completionReject) {
      const reject = this.completionReject;
      const error = new Error(reason || 'Execution cancelled');
      this.completionReject = undefined;
      this.completionResolve = undefined; // Also clear resolve since we're rejecting
      
      // Store error for waitForCompletion() if called later
      this.error = error;
      
      // Reject the promise - the catch handler in constructor will prevent unhandled rejection
      try {
        reject(error);
      } catch (rejectionError) {
        // Ignore errors if promise already settled (this is expected and harmless)
        // The promise's catch handler will still prevent unhandled rejection
      }
    }
  }
  
  /**
   * Emit signal for this execution (and its children)
   */
  emitSignal(signal: SignalType, reason?: string, metadata?: Record<string, any>): void {
    const event: SignalEvent = {
      type: signal,
      source: 'execution',
      pid: this.pid,
      parentPid: this.parentPid,
      reason,
      timestamp: Date.now(),
      metadata,
    };
    
    // Track if abort was emitted BEFORE listeners were set up
    // Only set flag if listeners haven't been set up yet (to catch early aborts)
    // Once listeners are set up, they will catch all aborts, so we don't need the flag
    if (signal === 'abort' && !this._listenersSetup) {
      this._abortEmitted = true;
    }
    
    this.emit(signal, event);
    
    // Propagate to children (forks only, not spawns)
    // Only propagate if this execution is still running or was cancelled
    // Don't propagate aborts from completed/failed executions - those are final states
    // and forks created from completed parents should run independently (orphaned forks)
    if ((signal === 'abort' || signal === 'interrupt' || signal === 'shutdown') && this.executionGraph) {
      // Only propagate if execution is still active (running or cancelled)
      // Completed/failed executions shouldn't propagate signals to children
      if (this.status === 'running' || this.status === 'cancelled') {
        const children = this.executionGraph.getChildren(this.pid);
        for (const child of children) {
          if (child.type === 'fork') {
            child.emitSignal(signal, reason, {
              ...metadata,
              propagatedFrom: this.pid,
            });
          }
        }
      }
    }
    
    // If abort signal, trigger cancel controller (if not already aborted)
    // Note: cancel() already aborts the controller, so this is mainly for external signals
    if (signal === 'abort' && this.cancelController && !this.cancelController.signal.aborted) {
      this.cancelController.abort();
    }
  }
  
  /**
   * Mark that abort listeners have been set up in iterateTicks.
   * Called by iterateTicks after setting up listeners to prevent false positives.
   * Once listeners are set up, future emitSignal('abort') calls won't set _abortEmitted,
   * and wasAbortEmitted() will return false (since it checks !_listenersSetup).
   */
  markListenersSetup(): void {
    this._listenersSetup = true;
    // Clear the flag for cleanup (redundant since wasAbortEmitted() checks !_listenersSetup,
    // but keeps the state clean)
    this._abortEmitted = false;
  }
  
  /**
   * Check if abort signal was already emitted (before listeners were set up)
   * Used by iterateTicks to detect early abort signals
   * 
   * Note: Only checks if THIS execution emitted an abort via emitSignal('abort'),
   * not if the signal is aborted (which could be from a parent signal in forks).
   * Signal aborted state is checked separately in iterateTicks via ctx.signal.aborted.
   * 
   * This should only be checked ONCE at the start of iterateTicks, before listeners are set up.
   */
  wasAbortEmitted(): boolean {
    // Only check the flag - don't check status because status might be set by cancel()
    // which is called AFTER abort is detected, creating a circular dependency
    // Also only return true if listeners haven't been set up yet
    return !this._listenersSetup && this._abortEmitted;
  }
  
  /**
   * Register graceful shutdown hook for this execution
   */
  onShutdown(handler: () => Promise<void> | void): () => void {
    this.shutdownHooks.push(handler);
    return () => {
      const index = this.shutdownHooks.indexOf(handler);
      if (index > -1) {
        this.shutdownHooks.splice(index, 1);
      }
    };
  }
  
  /**
   * Run shutdown hooks (called before aborting)
   */
  async runShutdownHooks(): Promise<void> {
    for (const hook of this.shutdownHooks) {
      try {
        await hook();
      } catch (error) {
        console.error(`Error in shutdown hook for execution ${this.pid}:`, error);
      }
    }
  }
  
  /**
   * Get execution result
   */
  getResult(): COMInput | undefined {
    return this.resultValue;
  }
  
  /**
   * Kernel ExecutionHandle<TOutput> compatibility
   * Maps status to Kernel's status type
   */
  getStatus(): 'running' | 'completed' | 'failed' | 'cancelled' {
    // Map 'pending' to 'running' for Kernel compatibility
    return this.status === 'pending' ? 'running' : this.status;
  }
  
  /**
   * Stream execution events
   */
  stream(): AsyncIterable<EngineStreamEvent> {
    if (!this.streamIterator) {
      throw new Error('Stream iterator not set');
    }
    
    return this.streamIterator;
  }
  
  /**
   * Get execution metrics
   */
  getMetrics(): ExecutionMetrics {
    const duration = this.completedAt
      ? this.completedAt.getTime() - this.startedAt.getTime()
      : Date.now() - this.startedAt.getTime();
    
    return {
      pid: this.pid,
      parentPid: this.parentPid,
      rootPid: this.rootPid,
      type: this.type,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration,
      tickCount: this.tickCount,
      error: this.error ? {
        message: this.error.message,
        phase: undefined, // TODO: Track phase
      } : undefined,
    };
  }
  
  /**
   * Get execution duration
   */
  getDuration(): number {
    const endTime = this.completedAt || new Date();
    return endTime.getTime() - this.startedAt.getTime();
  }
  
  /**
   * Create execution state for persistence
   */
  toState(agent: any, input: any, currentTick: number, previousState?: COMInput): ExecutionState {
    return {
      pid: this.pid,
      parentPid: this.parentPid,
      rootPid: this.rootPid,
      type: this.type,
      status: this.status,
      input,
      agent,
      currentTick,
      previousState,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      error: this.error ? {
        message: this.error.message,
        stack: this.error.stack,
      } : undefined,
    };
  }
  
  /**
   * Set procedure graph for this execution
   * Called by Engine when execution starts to link execution to its procedure graph
   */
  setProcedureGraph(graph: ProcedureGraph): void {
    this.procedureGraph = graph;
  }
  
  /**
   * Get procedure graph for this execution
   * Returns undefined if no procedures were executed in this execution's context
   */
  getProcedureGraph(): ProcedureGraph | undefined {
    // If we have a stored reference, return it
    if (this.procedureGraph) {
      return this.procedureGraph;
    }
    
    // Otherwise, try to get it from current context (for active executions)
    // This allows accessing procedure graph even if execution is still running
    const ctx = Context.tryGet();
    if (ctx?.procedureGraph) {
      // Store reference for future access
      this.procedureGraph = ctx.procedureGraph;
      return ctx.procedureGraph;
    }
    
    return undefined;
  }
  
  /**
   * Get aggregated metrics from all procedures in this execution
   * Includes both execution-level metrics and procedure-level metrics
   */
  getProcedureMetrics(): Record<string, number> {
    const graph = this.getProcedureGraph();
    if (!graph) {
      return {};
    }
    
    // Aggregate metrics from all procedure nodes
    const aggregated: Record<string, number> = {};
    const allNodes = graph.getAllNodes();
    
    for (const node of allNodes) {
      for (const [key, value] of Object.entries(node.metrics)) {
        aggregated[key] = (aggregated[key] || 0) + value;
      }
    }
    
    return aggregated;
  }
  
  /**
   * Get procedure nodes for this execution
   */
  getProcedureNodes(): ProcedureNode[] {
    const graph = this.getProcedureGraph();
    return graph ? graph.getAllNodes() : [];
  }
  
  /**
   * Get root procedure node (if any procedures were executed)
   */
  getRootProcedureNode(): ProcedureNode | undefined {
    const graph = this.getProcedureGraph();
    if (!graph) {
      return undefined;
    }
    
    // Find root procedure (no parent)
    const allNodes = graph.getAllNodes();
    return allNodes.find(node => !node.parentPid);
  }

  setComInstance(com: ContextObjectModel): void {
    this.comInstance = com;
  }

  getComInstance(): ContextObjectModel | undefined {
    return this.comInstance;
  }
}



/**
 * Create handle factory for Engine
 * Creates ExecutionHandleImpl instances for Procedure executions
 * 
 * Note: ExecutionHandleImpl implements ExecutionHandle from execution-types.ts,
 * but HandleFactory expects ExecutionHandle<TOutput> from procedure.ts.
 * We adapt ExecutionHandleImpl to satisfy both interfaces.
 */
export function createEngineHandleFactory(
  executionGraph: ExecutionGraph,
): HandleFactory<ExecutionHandleImpl, EngineContext> {
  return (events: EventEmitter, traceId: string, result: Promise<any> | AsyncIterable<any>, context: EngineContext): ExecutionHandleImpl => {
    // In Engine, EngineContext is augmented with Engine-specific fields via module augmentation
    // Context is already EngineContext, so we can use it directly
    // Check if a handle is already provided in context (e.g., from fork/spawn)
    // This allows fork/spawn to pass their pre-created handles
    if (context.executionHandle) {
      const existingHandle = context.executionHandle;
      // Set traceId (now a native property)
      existingHandle.traceId = traceId;
      // Note: result and events are already set in constructor, no need to update
      return existingHandle;
    }

    // Get execution type from context or default to 'root'
    // These are Engine-specific properties added via module augmentation
    const executionType = context.executionType || 'root';
    const parentPid = context.parentPid;
    const parentHandle = context.parentHandle;

    const pid = generatePid(executionType);
    const rootPid = parentHandle?.rootPid || pid;

    const handle = new ExecutionHandleImpl(pid, rootPid, executionType, parentPid, parentHandle, executionGraph);
    handle.setExecutionGraph(executionGraph);
    executionGraph.register(handle);

    // Create AbortController for handle.cancel()
    const cancelController = new AbortController();
    handle.setCancelController(cancelController);

    // Set traceId (now a native property, not dynamically added)
    handle.traceId = traceId;

    // Set execution handle in context
    context.executionHandle = handle;

    // ExecutionHandleImpl now properly implements Kernel's ExecutionHandle<TOutput>
    // result and events are set in constructor, traceId is set above
    return handle;
  };
}