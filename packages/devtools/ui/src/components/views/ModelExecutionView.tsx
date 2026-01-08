/**
 * ModelExecutionView - Shows model execution details
 *
 * A model execution is essentially a "tick" from the parent's perspective.
 * We reuse TickView to show the same information, since they are conceptually
 * the same thing - the model execution IS the tick.
 *
 * NOTE: The header (name, tokens, ticks, procedures, duration) is rendered
 * by App.tsx's main-header - this view shows the body content.
 */

import { useState } from "react";
import type { ExecutionViewProps } from "../types";
import { findParentTickData } from "../types";
import { TickView, ProceduresSection } from "../shared";
import { UsageDisplay } from "../shared";

export function ModelExecutionView({
  execution,
  executions,
  proceduresMap,
  getProceduresForExecution,
  onSelectExecution,
  onSelectProcedure,
  formatDuration,
}: ExecutionViewProps) {
  const procedures = getProceduresForExecution(execution.id);
  const [isTickExpanded] = useState(true);

  // Try to find parent tick data for model I/O
  const parentData = findParentTickData(execution, executions);
  const parentTick = parentData?.parentTick;

  // If we have the parent tick, show it using TickView (since a model execution IS a tick)
  if (parentTick) {
    return (
      <div className="model-execution-view">
        {/* Use TickView since a model execution is essentially a tick */}
        <TickView
          tick={parentTick}
          isExpanded={isTickExpanded}
          onToggle={() => {}} // Always expanded, no toggle needed
          formatDuration={formatDuration}
          procedures={procedures}
          proceduresMap={proceduresMap}
          onSelectProcedure={onSelectProcedure}
          hideHeader={false} // Show the tick header with model/stop reason
        />

        {/* Link to parent execution */}
        {parentData && (
          <div className="parent-link-section">
            <span>Part of tick in: </span>
            <button
              className="link-btn"
              onClick={() => onSelectExecution(parentData.parentExecution.id)}
            >
              {parentData.parentExecution.agentName}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Fallback: no parent tick found - show minimal info from procedures
  const modelProcedure = procedures.find((p) => p.name.startsWith("model:"));
  const metrics = modelProcedure?.metrics || {};
  const usage = {
    inputTokens: metrics.inputTokens || metrics.input_tokens || metrics["usage.inputTokens"] || 0,
    outputTokens:
      metrics.outputTokens || metrics.output_tokens || metrics["usage.outputTokens"] || 0,
    totalTokens:
      (metrics.inputTokens || metrics["usage.inputTokens"] || 0) +
      (metrics.outputTokens || metrics["usage.outputTokens"] || 0),
    cachedInputTokens: metrics.cachedInputTokens || metrics["usage.cachedInputTokens"] || 0,
    reasoningTokens: metrics.reasoningTokens || metrics["usage.reasoningTokens"] || 0,
  };

  return (
    <div className="model-execution-view">
      <div className="tick-style-header">
        <div className="tick-header-info">
          <span className="model-name">{execution.agentName}</span>
        </div>
        <div className="tick-header-stats">
          <span>{formatDuration(execution.startTime, execution.endTime)}</span>
          <span> · </span>
          <UsageDisplay usage={usage} compact />
        </div>
      </div>

      <div className="empty-state-small">
        No parent tick data found. This model execution may have incomplete telemetry.
      </div>

      {/* Procedures */}
      {procedures.length > 0 && (
        <ProceduresSection
          procedures={procedures}
          proceduresMap={proceduresMap}
          onSelectProcedure={onSelectProcedure}
          defaultExpanded={true}
        />
      )}
    </div>
  );
}

export default ModelExecutionView;
