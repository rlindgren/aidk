import type { Execution, Tick } from "../hooks/useDevToolsEvents";

// Find parent tick for a child execution (model, tool, fork)
export const findParentTick = (exec: Execution, executions: Execution[]): Tick | null => {
  if (!exec.parentExecutionId) return null;
  const parent = executions.find((e) => e.id === exec.parentExecutionId);
  if (!parent || parent.ticks.length === 0) return null;
  // Find tick that contains this execution by timestamp
  const tick = parent.ticks.find((t) => {
    if (exec.startTime < t.startTime) return false;
    if (t.endTime && exec.startTime > t.endTime) return false;
    return true;
  });
  return tick || parent.ticks[parent.ticks.length - 1];
};

// Get model ID for an execution (from various sources)
export const getExecutionModel = (exec: Execution, executions: Execution[]): string | undefined => {
  // Direct model property
  if (exec.model) return exec.model;
  // From modelsUsed array
  if (exec.modelsUsed?.size > 0) return Array.from(exec.modelsUsed)[0];
  // For model executions, look at parent tick
  if (exec.agentName.startsWith("model:")) {
    const parentTick = findParentTick(exec, executions);
    if (parentTick?.providerRequest?.modelId) return parentTick.providerRequest.modelId;
    if (parentTick?.model) return parentTick.model;
  }
  return undefined;
};
