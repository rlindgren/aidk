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
import { Context, Logger, type ExecutionEvent, type KernelContext } from "aidk-kernel";
import { devToolsEmitter, type DevToolsEvent } from "aidk-shared";

// Create logger for this module
const log = Logger.for("DevTools:Kernel");

let unsubscribe: (() => void) | null = null;
let remoteConfig: { url: string; secret?: string } | null = null;

// Track current tick per execution for associating procedures with ticks
const currentTickByExecution = new Map<string, number>();

export interface KernelSubscriberOptions {
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
 * Debug logging is controlled by Logger level (set via Logger.configure or AIDK_DEBUG env var).
 *
 * @param options - Subscriber options
 * @returns Unsubscribe function
 */
export function startKernelSubscriber(options: KernelSubscriberOptions = {}): () => void {
  if (unsubscribe) {
    // Already subscribed
    return unsubscribe;
  }

  remoteConfig = options.remote ?? null;

  log.debug({ remote: remoteConfig ? remoteConfig.url : false }, "Starting kernel subscriber");

  unsubscribe = Context.subscribeGlobal((event: ExecutionEvent, ctx: KernelContext) => {
    log.debug(
      {
        eventType: event.type,
        payload: event.payload,
        traceId: ctx.traceId,
        procedurePid: ctx.procedurePid,
        requestId: ctx.requestId,
      },
      "Received kernel event",
    );

    try {
      const devToolsEvents = transformToDevToolsEvents(event, ctx);
      for (const devToolsEvent of devToolsEvents) {
        emitEvent(devToolsEvent);

        const debugInfo: Record<string, unknown> = {
          eventType: devToolsEvent.type,
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
        // Include parentExecutionId for execution_start events
        if (devToolsEvent.type === "execution_start") {
          debugInfo.parentExecutionId = (devToolsEvent as any).parentExecutionId;
        }
        log.debug(debugInfo, "Emitted DevTools event");
      }
    } catch (err) {
      log.error({ err }, "Error transforming event");
    }
  });

  log.debug("Started kernel subscriber");

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
      log.error({ err }, "Failed to POST event to remote");
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
    // Clean up tick tracking state
    currentTickByExecution.clear();
    log.debug("Stopped kernel subscriber");
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

  // Base fields for all DevTools events - includes telemetry-friendly fields
  const baseFields = {
    timestamp: event.timestamp,
    // Correlation IDs for distributed tracing
    traceId: event.traceId,
    requestId: event.requestId,
    // User context for multi-tenant telemetry
    userId: event.userId,
    tenantId: event.tenantId,
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
        parentExecutionId?: string; // For child execution boundaries (Phase 3)
      };

      const {
        pid,
        name,
        parentPid,
        executionId,
        isExecutionBoundary,
        executionType,
        parentExecutionId: payloadParentExecutionId,
      } = payload;

      // Get procedure node for additional metadata
      const node = ctx.procedureGraph?.get(pid);
      const metadata = node?.metadata || {};

      // Get current tick for this execution (may be undefined for non-tick procedures)
      const tick = currentTickByExecution.get(executionId);

      // Detect self-referential parent (bug indicator)
      if (parentPid && parentPid === pid) {
        log.warn(
          { procedureId: pid, name, parentPid },
          "Self-referential parent detected in procedure_start",
        );
      }

      // If this is an execution boundary, emit execution_start first
      if (isExecutionBoundary) {
        // Get parentExecutionId from payload (Phase 3) or context (legacy/component_tool)
        const parentExecutionId = payloadParentExecutionId ?? ctx.parentExecutionId;

        log.debug(
          {
            executionId,
            name,
            parentExecutionId,
            executionType,
          },
          "Execution boundary detected",
        );

        // Determine execution type:
        // - Use executionType from payload if provided (fork, spawn, engine, etc.)
        // - Only fall back to "component_tool" if parentExecutionId exists AND no specific type
        const resolvedExecutionType =
          executionType || (parentExecutionId ? "component_tool" : "unknown");

        events.push({
          type: "execution_start",
          executionId,
          ...baseFields,
          executionType: resolvedExecutionType,
          rootProcedureId: pid,
          agentName: name, // Use procedure name as agent name for boundaries
          parentExecutionId, // Link to parent execution
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
        tick,
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

      // Get current tick for this execution
      const tick = currentTickByExecution.get(executionId);

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
        tick,
      } as DevToolsEvent);

      // If this was an execution boundary, emit execution_end and clean up tick tracking
      if (node?.isExecutionBoundary) {
        // Clean up tick tracking for this execution
        currentTickByExecution.delete(executionId);

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

      // Get current tick for this execution
      const tick = currentTickByExecution.get(executionId);

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
        tick,
      } as DevToolsEvent);

      // If this was an execution boundary, emit execution_end with error status and clean up
      if (node?.isExecutionBoundary) {
        // Clean up tick tracking for this execution
        currentTickByExecution.delete(executionId);

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
      // Stream chunks contain engine events directly (no wrapper)
      // Only extract content_delta - other events (tool_call, tool_result, tick_start, etc.)
      // are emitted directly by the engine to DevTools, so we skip them to avoid duplicates
      const streamEvent = event.payload;
      if (!streamEvent || typeof streamEvent !== "object") break;

      const executionId = ctx.procedureNode?.executionId || ctx.requestId || "unknown";
      const eventType = (streamEvent as any).type;

      if (eventType === "content_delta") {
        // Streaming text content - only this comes through stream:chunk
        // (tool_call, tool_result are emitted directly by engine)
        events.push({
          type: "content_delta",
          executionId,
          ...baseFields,
          delta: String((streamEvent as any).delta || ""),
          tick: (streamEvent as any).tick || 1,
        } as DevToolsEvent);
      }
      break;
    }

    case "tick:model:request": {
      // Engine emits this before calling the model with AIDK-format input
      const payload = event.payload as {
        tick?: number;
        input?: {
          messages?: unknown[];
          system?: string;
          tools?: unknown[];
          [key: string]: unknown;
        };
      };
      const executionId = ctx.procedureNode?.executionId || ctx.requestId || "unknown";
      const tick = payload?.tick || 1;

      // Track current tick for this execution (used to associate procedures with ticks)
      currentTickByExecution.set(executionId, tick);

      events.push({
        type: "model_request",
        executionId,
        ...baseFields,
        tick,
        input: payload?.input,
      } as DevToolsEvent);
      break;
    }

    case "model:provider_request": {
      // Model adapter emits this AFTER transforming to provider format
      // This shows the actual shape of messages sent to the provider (e.g., OpenAI/Gemini format)
      // NOTE: Use parent execution ID if available, since model executions are children
      // and don't have their own ticks - the tick data belongs to the parent
      const payload = event.payload as {
        modelId?: string;
        provider?: string;
        providerInput?: unknown;
      };
      const modelExecutionId = ctx.procedureNode?.executionId || ctx.requestId || "unknown";
      // Prefer parent execution ID so tick data goes to the right place
      const executionId = ctx.parentExecutionId || modelExecutionId;
      const tick =
        currentTickByExecution.get(executionId) ||
        currentTickByExecution.get(modelExecutionId) ||
        1;
      events.push({
        type: "provider_request",
        executionId,
        ...baseFields,
        tick,
        modelId: payload?.modelId,
        provider: payload?.provider,
        providerInput: payload?.providerInput,
      } as DevToolsEvent);
      break;
    }

    case "tick:model:provider_response":
    case "model:provider_response": {
      // Model or engine emits this after receiving the raw provider response
      // NOTE: Use parent execution ID if available, since model executions are children
      // and don't have their own ticks - the tick data belongs to the parent
      const payload = event.payload as {
        tick?: number;
        providerOutput?: unknown;
        model?: string;
        modelId?: string;
        provider?: string;
      };
      const modelExecutionId = ctx.procedureNode?.executionId || ctx.requestId || "unknown";
      // Prefer parent execution ID so tick data goes to the right place
      const executionId = ctx.parentExecutionId || modelExecutionId;
      const tick =
        payload?.tick ||
        currentTickByExecution.get(executionId) ||
        currentTickByExecution.get(modelExecutionId) ||
        1;
      events.push({
        type: "provider_response",
        executionId,
        ...baseFields,
        tick,
        providerOutput: payload?.providerOutput,
        modelId: payload?.modelId || payload?.model,
        provider: payload?.provider,
      } as DevToolsEvent);
      break;
    }

    case "tick:model:response": {
      // Engine emits this after model stream completes with the full response
      // Response contains newTimelineEntries with assistant messages
      const payload = event.payload as {
        tick?: number;
        response?: {
          newTimelineEntries?: Array<{
            kind: string;
            message?: { role: string; content: unknown };
          }>;
        };
      };
      const entries = payload?.response?.newTimelineEntries || [];
      // Find the assistant message in timeline entries
      const assistantEntry = entries.find(
        (e) => e.kind === "message" && e.message?.role === "assistant",
      );
      if (assistantEntry?.message) {
        const executionId = ctx.procedureNode?.executionId || ctx.requestId || "unknown";
        events.push({
          type: "model_response",
          executionId,
          ...baseFields,
          tick: payload?.tick || 1,
          message: assistantEntry.message,
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
