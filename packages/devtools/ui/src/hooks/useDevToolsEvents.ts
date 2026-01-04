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
  // Execution tree fields
  executionType?: "root" | "fork" | "spawn";
  parentExecutionId?: string;
  rootExecutionId?: string;
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

export function useDevToolsEvents() {
  const [executions, setExecutions] = useState<Map<string, Execution>>(new Map());
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

  // Process a single event and update state
  const processEvent = useCallback(
    (event: DevToolsEvent) => {
      switch (event.type) {
        case "execution_start": {
          const execStartEvent = event as {
            executionType?: "root" | "fork" | "spawn";
            parentExecutionId?: string;
            rootExecutionId?: string;
          };
          setExecutions((prev) => {
            const next = new Map(prev);
            next.set(event.executionId, {
              id: event.executionId,
              sessionId: event.sessionId,
              agentName: event.agentName,
              ticks: [],
              startTime: event.timestamp,
              isRunning: true,
              executionType: execStartEvent.executionType,
              parentExecutionId: execStartEvent.parentExecutionId,
              rootExecutionId: execStartEvent.rootExecutionId,
            });
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
          updateExecution(event.executionId, (exec) => ({
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
          }));
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

        case "model_start":
          updateCurrentTick(event.executionId, event.tick, (tick) => ({
            ...tick,
            events: [
              ...tick.events,
              {
                type: "model_start",
                timestamp: event.timestamp,
                data: { modelId: event.modelId, provider: event.provider },
              },
            ],
          }));
          break;

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
      }
    },
    [updateExecution, updateCurrentTick],
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

  return {
    executions: buildHierarchicalList(executions),
    isConnected,
    clearExecutions,
  };
}
