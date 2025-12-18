import { Context, type KernelContext } from './context';
import { ProcedureGraph, ProcedureNode, type ProcedureStatus } from './procedure-graph';
import { Telemetry } from './telemetry';

export interface ExecutionTrackerOptions {
  name?: string;
  metadata?: Record<string, any>;
  parentPid?: string;
}

/**
 * Unified execution tracker for procedures and hooks.
 * Handles automatic telemetry, metrics tracking, and propagation.
 */
export class ExecutionTracker {
  /**
   * Track a procedure/hook execution with automatic telemetry and metrics
   */
  static async track<T>(
    ctx: KernelContext,
    options: ExecutionTrackerOptions,
    fn: (node: ProcedureNode) => Promise<T>
  ): Promise<T> {
    // Initialize graph if needed
    if (!ctx.procedureGraph) {
      ctx.procedureGraph = new ProcedureGraph();
    }
    
    const procedurePid = crypto.randomUUID();
    const parentPid = options.parentPid || ctx.procedurePid;
    const effectiveName = options.name || 'anonymous';
    
    // Determine origin: if this is a root procedure (no parent), origin is undefined
    // Otherwise, use existing origin or find root node
    let origin: ProcedureNode | undefined;
    if (!parentPid) {
      // This is the root procedure - origin is undefined (it IS the origin)
      origin = undefined;
    } else {
      // Use existing origin if set, otherwise find root node
      origin = ctx.origin;
      if (!origin && ctx.procedureGraph) {
        const rootNode = ctx.procedureGraph.getAllNodes().find(node => !node.parentPid);
        origin = rootNode;
      }
    }
    
    // Register procedure
    const node = ctx.procedureGraph.register(
      procedurePid,
      parentPid,
      effectiveName,
      options.metadata
    );
    
    // Start telemetry span
    const span = Telemetry.startSpan(effectiveName);
    span.setAttribute('procedure.pid', procedurePid);
    if (parentPid) {
      span.setAttribute('procedure.parent_pid', parentPid);
    }
    if (options.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        span.setAttribute(`procedure.metadata.${key}`, value);
      }
    }
    
    // Store current PID and origin in context
    const previousPid = ctx.procedurePid;
    const previousNode = ctx.procedureNode;
    const previousOrigin = ctx.origin;
    ctx.procedurePid = procedurePid;
    ctx.procedureNode = node;
    ctx.origin = origin;
    
    // Store original metrics reference (not copy - we'll restore the reference)
    const originalMetricsRef = ctx.metrics;
    
    // Create a new metrics object for this procedure's scope
    // This prevents child procedures from modifying parent's metrics directly
    const procedureMetrics: Record<string, number> = {};
    
    // Create metrics proxy that writes to both procedure scope and node
    // This allows existing code to write to ctx.metrics and it automatically tracks in node
    const metricsProxy = new Proxy(procedureMetrics, {
      set(target, key: string, value: number) {
        const oldValue = target[key] || 0;
        target[key] = value;
        // Accumulate delta in node
        const delta = value - oldValue;
        if (delta !== 0) {
          node.addMetric(key, delta);
        }
        return true;
      },
      get(target, key: string) {
        // Return value from procedure scope
        return target[key] || 0;
      },
      ownKeys(target) {
        return Object.keys(target);
      },
      has(target, key: string) {
        return key in target;
      },
      getOwnPropertyDescriptor(target, key: string) {
        return Object.getOwnPropertyDescriptor(target, key);
      },
    });
    ctx.metrics = metricsProxy as Record<string, number>;
    
    try {
      // Check abort before starting
      if (ctx.signal?.aborted) {
        node.cancel();
        const abortError = new Error('Operation aborted');
        abortError.name = 'AbortError';
        span.recordError(abortError);
        span.end();
        throw abortError;
      }
      
      // Emit start event
      Context.emit('procedure:start', { pid: procedurePid, name: effectiveName });
      
      // Execute function
      const result = await fn(node);
      
      // Update status
      ctx.procedureGraph.updateStatus(procedurePid, 'completed');
      
      // Send metrics to telemetry
      this.sendMetricsToTelemetry(node, span);
      
      span.end();
      Context.emit('procedure:end', { pid: procedurePid, result });
      
      return result;
      
    } catch (error) {
      // Determine if it was an abort
      const isAbort = (error as Error)?.name === 'AbortError' || 
                     (error as Error)?.message?.includes('aborted');
      
      // Update status
      const status: ProcedureStatus = isAbort ? 'cancelled' : 'failed';
      ctx.procedureGraph.updateStatus(procedurePid, status, error as Error);
      
      span.recordError(error);
      this.sendMetricsToTelemetry(node, span);
      span.end();
      
      Context.emit('procedure:error', { pid: procedurePid, error });
      
      // Preserve error name and message
      const err = error as Error;
      if (isAbort && err.name !== 'AbortError') {
        err.name = 'AbortError';
      }
      throw err;
      
    } finally {
      // Restore previous PID and origin
      ctx.procedurePid = previousPid;
      ctx.procedureNode = previousNode;
      ctx.origin = previousOrigin;
      
      // Restore original metrics reference
      // Note: Node metrics are already propagated to parent node via updateStatus
      // The parent's context.metrics will be its own scope when it executes
      ctx.metrics = originalMetricsRef;
    }
  }
  
  /**
   * Send metrics to telemetry system
   */
  private static sendMetricsToTelemetry(node: ProcedureNode, span: any): void {
    for (const [key, value] of Object.entries(node.metrics)) {
      Telemetry.getHistogram(`procedure.${key}`).record(value, {
        procedure: node.name || 'anonymous',
        procedure_pid: node.pid,
        status: node.status,
      });
      
      span.setAttribute(`metrics.${key}`, value);
    }
  }
}

