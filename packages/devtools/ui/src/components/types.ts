/**
 * Shared types for DevTools components
 */

import type { Execution, Tick, Procedure } from "../hooks/useDevToolsEvents";

/**
 * Common props passed to execution detail views
 */
export interface ExecutionViewProps {
  execution: Execution;
  executions: Execution[];
  proceduresMap: Map<string, Procedure>;
  getProceduresForExecution: (executionId: string) => Procedure[];
  onSelectExecution: (id: string) => void;
  onSelectProcedure: (id: string) => void;
  formatDuration: (start: number, end?: number) => string;
  formatTime: (timestamp: number) => string;
}

/**
 * Display info for an execution (name and optional badge)
 */
export interface ExecutionDisplayInfo {
  name: string;
  badge?: string;
  badgeClass?: string;
}

/**
 * Check if an agent name is generic/internal (should be refined with better info)
 */
function isGenericName(name: string): boolean {
  const genericPatterns = [
    "engine:execute",
    "engine:stream",
    "Engine",
    "Unknown",
    "engine",
    "model:generate",
    "model:stream",
    "tool:run",
    "compile:run",
    "compile:runStream",
  ];
  return genericPatterns.includes(name);
}

/**
 * Determine display info for an execution.
 *
 * Badge Strategy (by execution type):
 * - [TOOL] tool-name
 * - [MODEL] model-name
 * - [FORK] ComponentName
 * - [SPAWN] ComponentName
 * - [ENGINE] ComponentName (for root/component_tool)
 *
 * The badge represents the EXECUTION TYPE.
 * The name is the specific thing being executed.
 */
export function getExecutionDisplayInfo(
  exec: Execution,
  proceduresMap: Map<string, Procedure>,
): ExecutionDisplayInfo {
  const agentName = exec.agentName;
  const rootProc = exec.rootProcedureId ? proceduresMap.get(exec.rootProcedureId) : undefined;
  const procName = rootProc?.name || agentName;
  const metadata = rootProc?.metadata as Record<string, unknown> | undefined;
  const execType = exec.executionType;

  // 1. Fork executions → [FORK] ComponentName
  if (execType === "fork") {
    const displayName = !isGenericName(agentName)
      ? agentName
      : (metadata?.component as string) || (metadata?.name as string) || "Fork";
    return {
      name: displayName,
      badge: "FORK",
      badgeClass: "fork",
    };
  }

  // 2. Spawn executions → [SPAWN] ComponentName
  if (execType === "spawn") {
    const displayName = !isGenericName(agentName)
      ? agentName
      : (metadata?.component as string) || (metadata?.name as string) || "Spawn";
    return {
      name: displayName,
      badge: "SPAWN",
      badgeClass: "spawn",
    };
  }

  // 3. Model executions (procedure name starts with "model:")
  // Show model name directly (e.g., "ai-sdk:gemini-2.5-flash") - no badge needed
  if (procName.startsWith("model:") || agentName.startsWith("model:")) {
    // Prefer runtime metadata (from withMetadata) over exec.model
    const modelId = (metadata?.modelId as string) || exec.model;
    // If we have a model ID, show it as the name (no badge)
    if (modelId && !isGenericName(modelId)) {
      return {
        name: modelId,
        badge: "MODEL",
        badgeClass: "model",
      };
    }
    // Fallback: show with MODEL badge if we don't have the model name yet
    return {
      name: procName,
      badge: "MODEL",
      badgeClass: "model",
    };
  }

  // 4. Tool executions (procedure name starts with "tool:")
  // → [TOOL] tool-name (always show TOOL badge)
  if (procName.startsWith("tool:") || agentName.startsWith("tool:")) {
    // Prefer runtime metadata (from withMetadata) over static metadata
    const toolName = (metadata?.toolName as string) || metadata?.id || metadata?.name || agentName;
    const displayName = String(toolName);
    // Clean up tool:run prefix if present
    const cleanName = displayName === "tool:run" ? "tool" : displayName;
    return {
      name: cleanName,
      badge: "TOOL",
      badgeClass: "tool",
    };
  }

  // 5. Component-tool executions (engine executing a component from a tool)
  // Show just the component name (tool wrapper already shows tool name)
  if (execType === "component_tool") {
    const displayName = !isGenericName(agentName)
      ? agentName
      : (metadata?.component as string) || (metadata?.name as string) || agentName;
    return { name: displayName };
  }

  // 6. Root/engine executions
  // If it's a named component, show just the name (no badge needed for roots)
  if (!isGenericName(agentName)) {
    return { name: agentName };
  }

  // 7. Fallback for generic engine executions → [ENGINE] with procedure name
  if (procName.startsWith("engine:")) {
    return {
      name: agentName,
      badge: "ENGINE",
      badgeClass: "engine",
    };
  }

  // 8. Default fallback
  return { name: agentName };
}

/**
 * Detect execution type for routing to appropriate view
 */
export type ExecutionViewType = "ticks" | "model" | "tool" | "fork" | "default";

export function detectExecutionViewType(execution: Execution): ExecutionViewType {
  const agentName = execution.agentName;
  const hasTicks = execution.ticks.length > 0;

  // Executions with ticks always use tick view
  if (hasTicks) {
    return "ticks";
  }

  // Model executions
  if (agentName.startsWith("model:")) {
    return "model";
  }

  // Tool executions (either tool:run or resolved tool name)
  if (agentName.startsWith("tool:")) {
    return "tool";
  }

  // Engine executions (fork/spawn/component_tool)
  if (agentName.startsWith("engine:")) {
    return "fork";
  }

  return "default";
}

/**
 * Find related data from parent execution
 * This is useful for model/tool executions that need parent tick data.
 * Recursively searches up the parent chain until it finds an execution with ticks.
 */
export function findParentTickData(
  execution: Execution,
  executions: Execution[],
  maxDepth = 10,
): { parentExecution: Execution; parentTick: Tick } | null {
  if (maxDepth <= 0) {
    return null;
  }

  if (!execution.parentExecutionId) {
    return null;
  }

  const parent = executions.find((e) => e.id === execution.parentExecutionId);
  if (!parent) {
    return null;
  }

  // If parent has ticks, find the matching tick
  if (parent.ticks.length > 0) {
    // Find the tick that contains this execution (by timestamp)
    const tick = parent.ticks.find((t) => {
      if (execution.startTime < t.startTime) return false;
      if (t.endTime && execution.startTime > t.endTime) return false;
      return true;
    });

    if (tick) {
      return { parentExecution: parent, parentTick: tick };
    }
    // Fallback to last tick
    return { parentExecution: parent, parentTick: parent.ticks[parent.ticks.length - 1] };
  }

  // Parent has no ticks, recursively search up the chain
  return findParentTickData(parent, executions, maxDepth - 1);
}
