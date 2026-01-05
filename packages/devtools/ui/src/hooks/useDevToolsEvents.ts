import { useState, useEffect, useRef, useCallback } from "react";
import type { DevToolsEvent } from "../../../src/events";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface Execution {
  id: string;
  sessionId?: string;
  agentName: string;
  ticks: Tick[];
  totalUsage?: TokenUsage;
  startTime: number;
  endTime?: number;
  isRunning: boolean;
  // Execution type - unified from Engine (root/fork/spawn) and kernel (engine/model/tool/etc.)
  executionType?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  // Model info (set from first model_start event)
  model?: string;
  modelsUsed: Set<string>;
  // Procedure integration - procedures belonging to this execution
  procedures: string[];
  rootProcedureId?: string;
}

export interface Tick {
  number: number;
  compiled?: {
    messages: unknown[];
    tools: unknown[];
    system?: string;
  };
  events: TickEvent[];
  content: string;
  usage?: TokenUsage;
  stopReason?: unknown;
  model?: string;
  modelOutput?: unknown;
  modelOutputRaw?: unknown;
  startTime: number;
  endTime?: number;
}

export interface TickEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

/**
 * Procedure node in the call tree.
 * Captures kernel-level procedure executions (model calls, tool handlers, etc.)
 */
export interface Procedure {
  id: string;
  name: string;
  type?: string;
  parentId?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metrics?: Record<string, number>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
  children: string[]; // Child procedure IDs
  // Execution boundary fields
  executionId?: string;
  isExecutionBoundary?: boolean;
}

export function useDevToolsEvents() {
  const [executions, setExecutions] = useState<Map<string, Execution>>(new Map());
  const [procedures, setProcedures] = useState<Map<string, Procedure>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const updateExecution = useCallback(
    (executionId: string, updater: (exec: Execution) => Execution) => {
      setExecutions((prev) => {
        const next = new Map(prev);
        const existing = next.get(executionId);
        if (existing) {
          next.set(executionId, updater(existing));
        }
        return next;
      });
    },
    [],
  );

  const updateCurrentTick = useCallback(
    (executionId: string, tickNumber: number, updater: (tick: Tick) => Tick) => {
      updateExecution(executionId, (exec) => ({
        ...exec,
        ticks: exec.ticks.map((t) => (t.number === tickNumber ? updater(t) : t)),
      }));
    },
    [updateExecution],
  );

  const updateProcedure = useCallback(
    (procedureId: string, updater: (proc: Procedure) => Procedure) => {
      setProcedures((prev) => {
        const next = new Map(prev);
        const existing = next.get(procedureId);
        if (existing) {
          next.set(procedureId, updater(existing));
        }
        return next;
      });
    },
    [],
  );

  // Process a single event and update state
  const processEvent = useCallback(
    (event: DevToolsEvent) => {
      switch (event.type) {
        case "execution_start": {
          // Handle both Engine events and kernel boundary events
          // They may arrive separately but should merge into one execution
          const execStartEvent = event as {
            executionType?: string;
            parentExecutionId?: string;
            rootExecutionId?: string;
            rootProcedureId?: string;
          };
          setExecutions((prev) => {
            const next = new Map(prev);
            const existing = next.get(event.executionId);
            if (existing) {
              // Merge: another execution_start for same ID (Engine + kernel events)
              next.set(event.executionId, {
                ...existing,
                // Prefer more specific values over existing
                agentName: event.agentName || existing.agentName,
                sessionId: event.sessionId || existing.sessionId,
                executionType: execStartEvent.executionType || existing.executionType,
                parentExecutionId: execStartEvent.parentExecutionId || existing.parentExecutionId,
                rootExecutionId: execStartEvent.rootExecutionId || existing.rootExecutionId,
                rootProcedureId: execStartEvent.rootProcedureId || existing.rootProcedureId,
                // Use earliest timestamp
                startTime: Math.min(event.timestamp, existing.startTime),
              });
            } else {
              // Create new execution
              next.set(event.executionId, {
                id: event.executionId,
                sessionId: event.sessionId,
                agentName: event.agentName || "Unknown",
                ticks: [],
                startTime: event.timestamp,
                isRunning: true,
                executionType: execStartEvent.executionType,
                parentExecutionId: execStartEvent.parentExecutionId,
                rootExecutionId: execStartEvent.rootExecutionId,
                modelsUsed: new Set<string>(),
                procedures: [],
                rootProcedureId: execStartEvent.rootProcedureId,
              });
            }
            return next;
          });
          break;
        }

        case "execution_end":
          updateExecution(event.executionId, (exec) => ({
            ...exec,
            totalUsage: event.totalUsage,
            endTime: event.timestamp,
            isRunning: false,
          }));
          break;

        case "tick_start":
          updateExecution(event.executionId, (exec) => {
            // Check if tick already exists (deduplication for history + SSE overlap)
            if (exec.ticks.some((t) => t.number === event.tick)) {
              return exec;
            }
            return {
              ...exec,
              ticks: [
                ...exec.ticks,
                {
                  number: event.tick,
                  events: [],
                  content: "",
                  startTime: event.timestamp,
                },
              ],
            };
          });
          break;

        case "tick_end": {
          const tickEndModel = (event as { model?: string }).model;
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            usage: event.usage || tick.usage,
            stopReason: event.stopReason || tick.stopReason,
            // Only update model if we have one (don't overwrite with undefined)
            model: tickEndModel || tick.model,
            endTime: event.timestamp,
          }));
          break;
        }

        case "compiled":
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            compiled: {
              messages: event.messages,
              tools: event.tools,
              system: event.system,
            },
          }));
          break;

        case "content_delta":
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            content: tick.content + event.delta,
            events: [
              ...tick.events,
              { type: "content_delta", timestamp: event.timestamp, data: event.delta },
            ],
          }));
          break;

        case "tool_call":
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            events: [
              ...tick.events,
              {
                type: "tool_call",
                timestamp: event.timestamp,
                data: { name: event.toolName, id: event.toolUseId, input: event.input },
              },
            ],
          }));
          break;

        case "tool_result":
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            events: [
              ...tick.events,
              {
                type: "tool_result",
                timestamp: event.timestamp,
                data: { id: event.toolUseId, result: event.result, isError: event.isError },
              },
            ],
          }));
          break;

        case "model_start": {
          const modelStartEvent = event as { modelId?: string; provider?: string };
          const modelDisplay =
            modelStartEvent.provider && modelStartEvent.modelId
              ? `${modelStartEvent.provider}/${modelStartEvent.modelId}`
              : modelStartEvent.modelId;
          // Update tick with model info
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            // Set model immediately from model_start (tick_end may also set it)
            model: modelDisplay || tick.model,
            events: [
              ...tick.events,
              {
                type: "model_start",
                timestamp: event.timestamp,
                data: { modelId: modelStartEvent.modelId, provider: modelStartEvent.provider },
              },
            ],
          }));
          // Track model at execution level
          if (modelDisplay) {
            updateExecution(event.executionId, (exec) => {
              const modelsUsed = new Set(exec.modelsUsed);
              modelsUsed.add(modelDisplay);
              return {
                ...exec,
                // Set first model as the "primary" model for display
                model: exec.model || modelDisplay,
                modelsUsed,
              };
            });
          }
          break;
        }

        case "model_output": {
          const typedEvent = event as { message?: unknown; raw?: unknown };
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            modelOutput: typedEvent.message,
            modelOutputRaw: typedEvent.raw,
            events: [
              ...tick.events,
              {
                type: "model_output",
                timestamp: event.timestamp,
                data: { message: typedEvent.message, raw: typedEvent.raw },
              },
            ],
          }));
          break;
        }

        case "state_change":
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            events: [
              ...tick.events,
              {
                type: "state_change",
                timestamp: event.timestamp,
                data: { key: event.key, oldValue: event.oldValue, newValue: event.newValue },
              },
            ],
          }));
          break;

        // Procedure events (kernel-level observability)
        case "procedure_start": {
          const procEvent = event as {
            procedureId: string;
            procedureName: string;
            procedureType?: string;
            parentProcedureId?: string;
            metadata?: Record<string, unknown>;
            isExecutionBoundary?: boolean;
            executionType?: string;
          };
          // Detect undefined procedureId
          if (!procEvent.procedureId) {
            console.warn("[DevTools] procedure_start with undefined procedureId", {
              procedureName: procEvent.procedureName,
              timestamp: event.timestamp,
              event,
            });
            break;
          }
          setProcedures((prev) => {
            const next = new Map(prev);
            const existing = next.get(procEvent.procedureId);
            if (existing) {
              // Out-of-order: procedure_end/error arrived before procedure_start
              // Update with start info but preserve the completion status
              next.set(procEvent.procedureId, {
                ...existing,
                name: procEvent.procedureName,
                type: procEvent.procedureType,
                parentId: procEvent.parentProcedureId,
                startTime: event.timestamp,
                metadata: procEvent.metadata,
                executionId: event.executionId,
                isExecutionBoundary: procEvent.isExecutionBoundary,
                // Keep status, endTime, error, metrics from the end/error event
              });
            } else {
              // Normal case: create new procedure
              next.set(procEvent.procedureId, {
                id: procEvent.procedureId,
                name: procEvent.procedureName,
                type: procEvent.procedureType,
                parentId: procEvent.parentProcedureId,
                status: "running",
                startTime: event.timestamp,
                metadata: procEvent.metadata,
                children: [],
                executionId: event.executionId,
                isExecutionBoundary: procEvent.isExecutionBoundary,
              });
            }
            // Add to parent's children list (if not already added)
            // Guard against self-referential parent (would cause procedure to appear as its own child)
            if (
              procEvent.parentProcedureId &&
              procEvent.parentProcedureId !== procEvent.procedureId
            ) {
              const parent = next.get(procEvent.parentProcedureId);
              if (parent && !parent.children.includes(procEvent.procedureId)) {
                next.set(procEvent.parentProcedureId, {
                  ...parent,
                  children: [...parent.children, procEvent.procedureId],
                });
              }
            }
            return next;
          });
          // Add procedure to execution's procedures list
          if (event.executionId) {
            setExecutions((prev) => {
              const next = new Map(prev);
              const exec = next.get(event.executionId);
              if (exec && !exec.procedures.includes(procEvent.procedureId)) {
                next.set(event.executionId, {
                  ...exec,
                  procedures: [...exec.procedures, procEvent.procedureId],
                });
              } else if (!exec) {
                // Execution doesn't exist yet - create a placeholder
                // This handles the case where procedure events arrive before execution_start
                next.set(event.executionId, {
                  id: event.executionId,
                  agentName: procEvent.procedureName,
                  ticks: [],
                  startTime: event.timestamp,
                  isRunning: true,
                  executionType: procEvent.executionType,
                  modelsUsed: new Set<string>(),
                  procedures: [procEvent.procedureId],
                  rootProcedureId: procEvent.isExecutionBoundary
                    ? procEvent.procedureId
                    : undefined,
                });
              }
              return next;
            });
          }
          break;
        }

        case "procedure_end": {
          const procEndEvent = event as {
            procedureId: string;
            procedureName?: string;
            parentProcedureId?: string;
            metrics?: Record<string, number>;
            durationMs?: number;
          };
          // Detect undefined procedureId - indicates context loss
          if (!procEndEvent.procedureId) {
            console.warn(
              "[DevTools] procedure_end with undefined procedureId - context loss detected",
              { procedureName: procEndEvent.procedureName, timestamp: event.timestamp, event },
            );
            break;
          }
          // Handle out-of-order events: if procedure doesn't exist, create it from end event
          setProcedures((prev) => {
            const next = new Map(prev);
            const existing = next.get(procEndEvent.procedureId);
            if (existing) {
              // Normal case: update existing procedure
              next.set(procEndEvent.procedureId, {
                ...existing,
                status: "completed",
                endTime: event.timestamp,
                durationMs: procEndEvent.durationMs,
                metrics: procEndEvent.metrics,
                executionId: event.executionId || existing.executionId,
              });
            } else {
              // Out-of-order: procedure_end arrived before procedure_start
              // Create procedure from available data
              const startTime = procEndEvent.durationMs
                ? event.timestamp - procEndEvent.durationMs
                : event.timestamp;
              next.set(procEndEvent.procedureId, {
                id: procEndEvent.procedureId,
                name: procEndEvent.procedureName || "unknown",
                parentId: procEndEvent.parentProcedureId,
                status: "completed",
                startTime,
                endTime: event.timestamp,
                durationMs: procEndEvent.durationMs,
                metrics: procEndEvent.metrics,
                children: [],
                executionId: event.executionId,
              });
              // Add to parent's children list if parent exists
              // Guard against self-referential parent
              if (
                procEndEvent.parentProcedureId &&
                procEndEvent.parentProcedureId !== procEndEvent.procedureId
              ) {
                const parent = next.get(procEndEvent.parentProcedureId);
                if (parent && !parent.children.includes(procEndEvent.procedureId)) {
                  next.set(procEndEvent.parentProcedureId, {
                    ...parent,
                    children: [...parent.children, procEndEvent.procedureId],
                  });
                }
              }
            }
            return next;
          });
          // Add procedure to execution's procedures list if not already there
          if (event.executionId) {
            setExecutions((prev) => {
              const next = new Map(prev);
              const exec = next.get(event.executionId);
              if (exec && !exec.procedures.includes(procEndEvent.procedureId)) {
                next.set(event.executionId, {
                  ...exec,
                  procedures: [...exec.procedures, procEndEvent.procedureId],
                });
              }
              return next;
            });
          }
          break;
        }

        case "procedure_error": {
          const procErrorEvent = event as {
            procedureId: string;
            procedureName?: string;
            parentProcedureId?: string;
            status: "failed" | "cancelled";
            error: { name: string; message: string; stack?: string };
            metrics?: Record<string, number>;
          };
          // Handle out-of-order events: if procedure doesn't exist, create it from error event
          setProcedures((prev) => {
            const next = new Map(prev);
            const existing = next.get(procErrorEvent.procedureId);
            if (existing) {
              // Normal case: update existing procedure
              next.set(procErrorEvent.procedureId, {
                ...existing,
                status: procErrorEvent.status,
                endTime: event.timestamp,
                error: procErrorEvent.error,
                metrics: procErrorEvent.metrics,
                executionId: event.executionId || existing.executionId,
              });
            } else {
              // Out-of-order: procedure_error arrived before procedure_start
              next.set(procErrorEvent.procedureId, {
                id: procErrorEvent.procedureId,
                name: procErrorEvent.procedureName || "unknown",
                parentId: procErrorEvent.parentProcedureId,
                status: procErrorEvent.status,
                startTime: event.timestamp,
                endTime: event.timestamp,
                error: procErrorEvent.error,
                metrics: procErrorEvent.metrics,
                children: [],
                executionId: event.executionId,
              });
              // Add to parent's children list if parent exists
              // Guard against self-referential parent
              if (
                procErrorEvent.parentProcedureId &&
                procErrorEvent.parentProcedureId !== procErrorEvent.procedureId
              ) {
                const parent = next.get(procErrorEvent.parentProcedureId);
                if (parent && !parent.children.includes(procErrorEvent.procedureId)) {
                  next.set(procErrorEvent.parentProcedureId, {
                    ...parent,
                    children: [...parent.children, procErrorEvent.procedureId],
                  });
                }
              }
            }
            return next;
          });
          // Add procedure to execution's procedures list if not already there
          if (event.executionId) {
            setExecutions((prev) => {
              const next = new Map(prev);
              const exec = next.get(event.executionId);
              if (exec && !exec.procedures.includes(procErrorEvent.procedureId)) {
                next.set(event.executionId, {
                  ...exec,
                  procedures: [...exec.procedures, procErrorEvent.procedureId],
                });
              }
              return next;
            });
          }
          break;
        }
      }
    },
    [updateExecution, updateCurrentTick, updateProcedure],
  );

  // Fetch history on mount
  useEffect(() => {
    fetch("/api/history")
      .then((res) => res.json())
      .then((events: DevToolsEvent[]) => {
        // Process all historical events to rebuild state
        for (const event of events) {
          processEvent(event);
        }
      })
      .catch(() => {
        // History fetch failed, no problem - we'll get live events
      });
  }, [processEvent]);

  useEffect(() => {
    const es = new EventSource("/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onerror = () => {
      setIsConnected(false);
    };

    es.onmessage = (e) => {
      const event: DevToolsEvent | { type: "connected" } = JSON.parse(e.data);

      if (event.type === "connected") {
        setIsConnected(true);
        return;
      }

      processEvent(event as DevToolsEvent);
    };

    return () => {
      es.close();
    };
  }, [processEvent]);

  const clearExecutions = useCallback(() => {
    setExecutions(new Map());
    setProcedures(new Map());
  }, []);

  // Build hierarchical list: roots first (sorted by time desc), then their children below each parent
  const buildHierarchicalList = (execs: Map<string, Execution>): Execution[] => {
    const all = Array.from(execs.values());

    // Separate roots and children
    const roots = all.filter((e) => !e.parentExecutionId);
    const children = all.filter((e) => e.parentExecutionId);

    // Sort roots by startTime descending (most recent first)
    roots.sort((a, b) => b.startTime - a.startTime);

    // Group children by parent
    const childrenByParent = new Map<string, Execution[]>();
    for (const child of children) {
      const parentId = child.parentExecutionId!;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(child);
    }

    // Sort each parent's children by startTime descending
    for (const kids of childrenByParent.values()) {
      kids.sort((a, b) => b.startTime - a.startTime);
    }

    // Build final list: for each root, add the root then its children recursively
    const result: Execution[] = [];

    const addWithChildren = (exec: Execution) => {
      result.push(exec);
      const kids = childrenByParent.get(exec.id);
      if (kids) {
        for (const child of kids) {
          addWithChildren(child);
        }
      }
    };

    for (const root of roots) {
      addWithChildren(root);
    }

    // Add any orphaned children (parent not in our list yet)
    const addedIds = new Set(result.map((e) => e.id));
    for (const child of children) {
      if (!addedIds.has(child.id)) {
        result.push(child);
      }
    }

    return result;
  };

  // Build procedure tree for all procedures (roots only)
  const buildProcedureTree = (procs: Map<string, Procedure>): Procedure[] => {
    const all = Array.from(procs.values());
    // Find root procedures (no parent)
    const roots = all.filter((p) => !p.parentId);
    // Sort roots by start time descending
    roots.sort((a, b) => b.startTime - a.startTime);
    return roots;
  };

  // Get root procedures for a specific execution
  const getProceduresForExecution = useCallback(
    (executionId: string): Procedure[] => {
      const execProcIds = executions.get(executionId)?.procedures || [];
      // Filter to root procedures (those whose parent is not in this execution)
      const execProcSet = new Set(execProcIds);
      return execProcIds
        .map((id) => procedures.get(id))
        .filter((p): p is Procedure => p !== undefined)
        .filter((p) => !p.parentId || !execProcSet.has(p.parentId))
        .sort((a, b) => a.startTime - b.startTime);
    },
    [executions, procedures],
  );

  // Get all procedures as a flat map for lookup
  const proceduresMap = procedures;

  return {
    executions: buildHierarchicalList(executions),
    procedures: buildProcedureTree(procedures),
    proceduresMap,
    getProceduresForExecution,
    isConnected,
    clearExecutions,
  };
}
