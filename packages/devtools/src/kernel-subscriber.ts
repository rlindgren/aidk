/**
 * DevTools Kernel Subscriber
 *
 * Subscribes to kernel-level procedure events via Context.subscribeGlobal()
 * and forwards them to the DevTools event emitter.
 *
 * This enables observability of ALL procedure executions including:
 * - Engine execute/stream
 * - Model generate/stream
 * - Tool handlers
 * - Compiler service
 * - Any nested procedure calls
 */
import { Context, type ExecutionEvent, type KernelContext } from "aidk-kernel";
import { devToolsEmitter, type DevToolsEvent } from "aidk-shared";

let unsubscribe: (() => void) | null = null;
let debugMode = false;
let remoteConfig: { url: string; secret?: string } | null = null;

export interface KernelSubscriberOptions {
  debug?: boolean;
  /** Remote mode config - if set, events are POSTed to remote URL */
  remote?: {
    url: string;
    secret?: string;
  };
}

/**
 * Start subscribing to kernel procedure events.
 * Events are forwarded to devToolsEmitter (local) or POSTed to remote URL.
 *
 * @param options - Subscriber options
 * @returns Unsubscribe function
 */
export function startKernelSubscriber(options: KernelSubscriberOptions = {}): () => void {
  if (unsubscribe) {
    // Already subscribed
    return unsubscribe;
  }

  debugMode = options.debug ?? false;
  remoteConfig = options.remote ?? null;

  if (debugMode) {
    console.log("[DevTools:Kernel] Starting kernel subscriber", {
      remote: remoteConfig ? remoteConfig.url : false,
    });
  }

  unsubscribe = Context.subscribeGlobal((event: ExecutionEvent, ctx: KernelContext) => {
    // Log ALL events when debug mode is enabled (helps diagnose why procedures aren't showing)
    if (debugMode) {
      console.log("[DevTools:Kernel] Received event:", event.type, {
        payload: event.payload,
        traceId: ctx.traceId,
        procedurePid: ctx.procedurePid,
        requestId: ctx.requestId,
      });
    }

    try {
      const devToolsEvents = transformToDevToolsEvents(event, ctx);
      for (const devToolsEvent of devToolsEvents) {
        emitEvent(devToolsEvent);

        if (debugMode) {
          const debugInfo: Record<string, unknown> = {
            executionId: devToolsEvent.executionId,
          };
          // Only include procedureId for procedure events
          if (devToolsEvent.type.startsWith("procedure_")) {
            debugInfo.procedureId = (devToolsEvent as any).procedureId;
          }
          // Include execution boundary info
          if ((devToolsEvent as any).isExecutionBoundary) {
            debugInfo.isExecutionBoundary = true;
            debugInfo.executionType = (devToolsEvent as any).executionType;
          }
          console.log("[DevTools:Kernel] Emitted DevTools event:", devToolsEvent.type, debugInfo);
        }
      }
    } catch (err) {
      if (debugMode) {
        console.error("[DevTools:Kernel] Error transforming event:", err);
      }
    }
  });

  if (debugMode) {
    console.log("[DevTools:Kernel] Started kernel subscriber");
  }

  return () => {
    stopKernelSubscriber();
  };
}

/**
 * Emit event to appropriate destination (local emitter or remote server)
 */
function emitEvent(event: DevToolsEvent): void {
  if (remoteConfig) {
    // Remote mode: POST to remote server
    postToRemote(event).catch((err) => {
      if (debugMode) {
        console.error("[DevTools:Kernel] Failed to POST event:", err);
      }
    });
  } else {
    // Local mode: emit to in-process singleton
    devToolsEmitter.emitEvent(event);
  }
}

/**
 * POST event to remote DevTools server
 */
async function postToRemote(event: DevToolsEvent): Promise<void> {
  if (!remoteConfig) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (remoteConfig.secret) {
    headers["Authorization"] = `Bearer ${remoteConfig.secret}`;
  }

  await fetch(`${remoteConfig.url}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
  });
}

/**
 * Stop subscribing to kernel events.
 */
export function stopKernelSubscriber(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    if (debugMode) {
      console.log("[DevTools:Kernel] Stopped kernel subscriber");
    }
  }
}

/**
 * Check if kernel subscriber is active.
 */
export function isKernelSubscriberActive(): boolean {
  return unsubscribe !== null;
}

/**
 * Transform a kernel ExecutionEvent to DevTools event(s).
 * Returns an array of events (may include execution_start for boundaries).
 */
function transformToDevToolsEvents(event: ExecutionEvent, ctx: KernelContext): DevToolsEvent[] {
  const events: DevToolsEvent[] = [];

  const baseFields = {
    timestamp: event.timestamp,
    traceId: ctx.traceId,
  };

  switch (event.type) {
    case "procedure:start": {
      const payload = event.payload as {
        pid: string;
        name: string;
        parentPid?: string;
        executionId: string;
        isExecutionBoundary?: boolean;
        executionType?: string;
      };

      const { pid, name, parentPid, executionId, isExecutionBoundary, executionType } = payload;

      // Get procedure node for additional metadata
      const node = ctx.procedureGraph?.get(pid);
      const metadata = node?.metadata || {};

      // Detect self-referential parent (bug indicator)
      if (parentPid && parentPid === pid) {
        console.warn("[DevTools:Kernel] Self-referential parent detected in procedure_start", {
          procedureId: pid,
          name,
          parentPid,
        });
      }

      // If this is an execution boundary, emit execution_start first
      if (isExecutionBoundary) {
        events.push({
          type: "execution_start",
          executionId,
          ...baseFields,
          executionType: executionType || "unknown",
          rootProcedureId: pid,
          agentName: name, // Use procedure name as agent name for boundaries
        } as DevToolsEvent);
      }

      // Emit procedure-level event
      events.push({
        type: "procedure_start",
        executionId,
        ...baseFields,
        procedureId: pid,
        procedureName: name,
        procedureType: executionType || (metadata.type as string | undefined),
        parentProcedureId: parentPid,
        isExecutionBoundary,
        executionType,
        metadata,
      } as DevToolsEvent);

      break;
    }

    case "procedure:end": {
      const payload = event.payload as {
        pid: string;
        executionId: string;
        result?: unknown;
      };

      const { pid, executionId } = payload;
      const node = ctx.procedureGraph?.get(pid);

      events.push({
        type: "procedure_end",
        executionId,
        ...baseFields,
        procedureId: pid,
        procedureName: node?.name,
        parentProcedureId: node?.parentPid,
        status: "completed",
        metrics: node?.metrics || {},
        durationMs: node?.completedAt
          ? node.completedAt.getTime() - node.startedAt.getTime()
          : undefined,
      } as DevToolsEvent);

      // If this was an execution boundary, emit execution_end
      if (node?.isExecutionBoundary) {
        // Aggregate metrics from procedure into totalUsage
        const metrics = node?.metrics || {};
        events.push({
          type: "execution_end",
          executionId,
          ...baseFields,
          totalUsage: {
            inputTokens: metrics["usage.inputTokens"] || 0,
            outputTokens: metrics["usage.outputTokens"] || 0,
            totalTokens: (metrics["usage.inputTokens"] || 0) + (metrics["usage.outputTokens"] || 0),
          },
        } as DevToolsEvent);
      }

      break;
    }

    case "procedure:error": {
      const payload = event.payload as {
        pid: string;
        executionId: string;
        error: Error;
      };

      const { pid, executionId, error } = payload;
      const node = ctx.procedureGraph?.get(pid);

      events.push({
        type: "procedure_error",
        executionId,
        ...baseFields,
        procedureId: pid,
        procedureName: node?.name,
        parentProcedureId: node?.parentPid,
        status: node?.status || "failed",
        error: {
          name: error?.name || "Error",
          message: error?.message || "Unknown error",
          stack: error?.stack,
        },
        metrics: node?.metrics || {},
      } as DevToolsEvent);

      // If this was an execution boundary, emit execution_end with error status
      if (node?.isExecutionBoundary) {
        const metrics = node?.metrics || {};
        events.push({
          type: "execution_end",
          executionId,
          ...baseFields,
          totalUsage: {
            inputTokens: metrics["usage.inputTokens"] || 0,
            outputTokens: metrics["usage.outputTokens"] || 0,
            totalTokens: (metrics["usage.inputTokens"] || 0) + (metrics["usage.outputTokens"] || 0),
          },
          status: "error",
        } as DevToolsEvent);
      }

      break;
    }

    case "stream:chunk": {
      // High-frequency event - only forward if it contains meaningful content
      const value = event.payload?.value;
      if (value && typeof value === "object" && "delta" in value) {
        // For stream chunks, use context's procedureNode executionId
        const executionId = ctx.procedureNode?.executionId || ctx.requestId || "unknown";
        events.push({
          type: "content_delta",
          executionId,
          ...baseFields,
          delta: String(value.delta),
          tick: (value as any).tick || 0,
        } as DevToolsEvent);
      }
      break;
    }

    default:
      // Skip unknown events
      break;
  }

  return events;
}
