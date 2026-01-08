/**
 * ToolExecutionView - Shows tool execution details
 *
 * For tool:run executions, this view shows:
 * - Tool metadata (name, type)
 * - Tool call input from parent tick
 * - Tool result from parent tick
 * - Aggregated usage (if tool calls models internally)
 * - Procedures executed within the tool
 */

import { useState } from "react";
import type { ExecutionViewProps } from "../types";
import { findParentTickData } from "../types";
import { ProceduresSection } from "../shared/ProceduresSection";
import { ModelIOSection } from "../shared/ModelIOSection";

export function ToolExecutionView({
  execution,
  executions,
  proceduresMap,
  getProceduresForExecution,
  onSelectExecution,
  onSelectProcedure,
  formatDuration,
}: ExecutionViewProps) {
  const procedures = getProceduresForExecution(execution.id);

  // Extract tool info from procedure metadata
  const toolProcedure = procedures.find((p) => p.name.startsWith("tool:"));
  const toolMetadata = toolProcedure?.metadata as
    | {
        type?: string;
        id?: string;
        operation?: string;
      }
    | undefined;

  const toolName = toolMetadata?.id || execution.agentName;

  // Try to find parent tick with tool call data
  const parentData = findParentTickData(execution, executions);
  const parentTick = parentData?.parentTick;

  // Find the tool call event for this tool in parent tick
  const toolCallEvent = parentTick?.events.find(
    (e) => e.type === "tool_call" && (e.data as any)?.name === toolMetadata?.id,
  );
  const toolResultEvent = parentTick?.events.find(
    (e) => e.type === "tool_result" && (e.data as any)?.id === (toolCallEvent?.data as any)?.id,
  );

  // Extract input and result
  const toolInput = (toolCallEvent?.data as any)?.input;
  const toolResult = (toolResultEvent?.data as any)?.result;
  const isError = (toolResultEvent?.data as any)?.isError;

  // Extract metrics from procedure
  const metrics = toolProcedure?.metrics || {};

  // Compute aggregate usage from child executions (if tool called models)
  const computeAggregateTokens = (exec: typeof execution): number => {
    const ownTokens =
      exec.totalUsage?.totalTokens ??
      exec.ticks.reduce((sum, t) => sum + (t.usage?.totalTokens ?? 0), 0);
    const children = executions.filter((e) => e.parentExecutionId === exec.id);
    return ownTokens + children.reduce((sum, child) => sum + computeAggregateTokens(child), 0);
  };
  const aggregateTokens = computeAggregateTokens(execution);

  // Get child executions (model calls, nested tools, etc.)
  const childExecutions = executions.filter((e) => e.parentExecutionId === execution.id);

  return (
    <div className="tool-execution-view">
      {/* Tool header with name and status */}
      <div className="tick-style-header">
        <div className="tick-header-info">
          <span className="tool-name">{toolName}</span>
          <span className={`status-indicator ${isError ? "error" : "success"}`}>
            {isError ? " · Error" : " · Success"}
          </span>
        </div>
        <div className="tick-header-stats">
          <span>{formatDuration(execution.startTime, execution.endTime)}</span>
          {aggregateTokens > 0 && (
            <>
              <span> · </span>
              <span>{aggregateTokens} tokens</span>
            </>
          )}
        </div>
      </div>

      {/* Tool Input */}
      {toolInput !== undefined && <ModelIOSection title="Tool Input" data={toolInput} />}

      {/* Tool Result */}
      {toolResult !== undefined && (
        <div className={`info-card ${isError ? "error-card" : ""}`}>
          <ToolResultSection result={toolResult} isError={isError} />
        </div>
      )}

      {/* Metrics from procedure */}
      {Object.keys(metrics).length > 0 && (
        <div className="info-card">
          <div className="info-card-header">Procedure Metrics</div>
          <div className="info-card-body">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="info-row">
                <span className="info-label">{key}</span>
                <span className="info-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Child Executions (model calls from within tool) */}
      {childExecutions.length > 0 && (
        <div className="info-card">
          <div className="info-card-header">Child Executions ({childExecutions.length})</div>
          <div className="info-card-body">
            <div className="child-list">
              {childExecutions.map((child) => (
                <div
                  key={child.id}
                  className="child-item clickable"
                  onClick={() => onSelectExecution(child.id)}
                >
                  <span className="child-name">{child.agentName}</span>
                  <span className="child-stats">
                    {child.totalUsage?.totalTokens || 0} tok ·{" "}
                    {formatDuration(child.startTime, child.endTime)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Link to parent */}
      {parentData && (
        <div className="parent-link-section">
          <span>Called from tick in: </span>
          <button
            className="link-btn"
            onClick={() => onSelectExecution(parentData.parentExecution.id)}
          >
            {parentData.parentExecution.agentName}
          </button>
        </div>
      )}

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

/**
 * Tool Result Section - Shows tool result with formatting
 */
function ToolResultSection({ result, isError }: { result: unknown; isError?: boolean }) {
  const [showRaw, setShowRaw] = useState(false);

  const formatResult = (r: unknown): string => {
    if (typeof r === "string") return r;
    if (r === null || r === undefined) return "null";
    return JSON.stringify(r, null, 2);
  };

  const resultStr = formatResult(result);
  const isLong = resultStr.length > 500;

  return (
    <>
      <div className="info-card-header">
        <span>Tool Result {isError && <span className="error-badge">Error</span>}</span>
        {isLong && (
          <button className="toggle-btn small" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
      <div className="info-card-body">
        {typeof result === "string" ? (
          <pre
            className={`tool-result-content ${isError ? "error" : ""} ${showRaw ? "" : "truncated"}`}
          >
            {showRaw || !isLong ? resultStr : resultStr.slice(0, 500) + "..."}
          </pre>
        ) : (
          <pre className={`json-view ${isError ? "error" : ""} ${showRaw ? "" : "truncated"}`}>
            {showRaw || !isLong ? resultStr : resultStr.slice(0, 500) + "..."}
          </pre>
        )}
      </div>
    </>
  );
}

export default ToolExecutionView;
