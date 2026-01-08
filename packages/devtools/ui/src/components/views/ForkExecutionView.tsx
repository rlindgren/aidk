/**
 * ForkExecutionView - Shows fork/spawn execution details
 *
 * For engine:execute (fork/spawn) executions, this view shows:
 * - Fork/spawn metadata
 * - List of child executions
 * - Aggregate metrics
 * - Procedures executed
 */

import type { ExecutionViewProps } from "../types";
import { getExecutionDisplayInfo } from "../types";
import { ProceduresSection } from "../shared/ProceduresSection";

export function ForkExecutionView({
  execution,
  executions,
  proceduresMap,
  getProceduresForExecution,
  onSelectExecution,
  onSelectProcedure,
  formatDuration,
}: ExecutionViewProps) {
  const procedures = getProceduresForExecution(execution.id);

  // Get child executions (sorted oldest to newest for chronological display)
  const childExecutions = executions
    .filter((e) => e.parentExecutionId === execution.id)
    .sort((a, b) => a.startTime - b.startTime);

  // Compute aggregate metrics from children
  const computeAggregateTokens = (exec: typeof execution): number => {
    const ownTokens =
      exec.totalUsage?.totalTokens ??
      exec.ticks.reduce((sum, t) => sum + (t.usage?.totalTokens ?? 0), 0);
    const children = executions.filter((e) => e.parentExecutionId === exec.id);
    return ownTokens + children.reduce((sum, child) => sum + computeAggregateTokens(child), 0);
  };

  const totalTokens = computeAggregateTokens(execution);
  const executionType = execution.executionType || "engine";
  const typeLabel =
    executionType === "fork" ? "fork" : executionType === "spawn" ? "spawn" : "sub-engine";

  return (
    <div className="fork-execution-view">
      {/* Fork/spawn header */}
      <div className="tick-style-header">
        <div className="tick-header-info">
          <span className="execution-type">{typeLabel}</span>
          {childExecutions.length > 0 && (
            <span className="child-count"> · {childExecutions.length} children</span>
          )}
        </div>
        <div className="tick-header-stats">
          <span>{formatDuration(execution.startTime, execution.endTime)}</span>
          {totalTokens > 0 && (
            <>
              <span> · </span>
              <span>{totalTokens} tokens</span>
            </>
          )}
        </div>
      </div>

      {/* Child Executions */}
      {childExecutions.length > 0 && (
        <div className="child-executions-summary">
          <div className="summary-label">Child Executions ({childExecutions.length})</div>
          <div className="child-list">
            {childExecutions.map((child) => {
              const childDisplay = getExecutionDisplayInfo(child, proceduresMap);
              const childTokens = computeAggregateTokens(child);
              return (
                <div
                  key={child.id}
                  className="child-item clickable"
                  onClick={() => onSelectExecution(child.id)}
                >
                  {childDisplay.badge && (
                    <span
                      className={`exec-type-badge small ${childDisplay.badgeClass || childDisplay.badge}`}
                    >
                      {childDisplay.badge}
                    </span>
                  )}
                  <span className="child-name">{childDisplay.name}</span>
                  <span className="child-stats">
                    {childTokens > 0 && <span>{childTokens} tok</span>}
                    <span> · </span>
                    <span>{formatDuration(child.startTime, child.endTime)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Link to parent if exists */}
      {execution.parentExecutionId && (
        <div className="parent-link-section">
          <span>Forked from: </span>
          <button
            className="link-btn"
            onClick={() => {
              const parent = executions.find((e) => e.id === execution.parentExecutionId);
              if (parent) onSelectExecution(parent.id);
            }}
          >
            {executions.find((e) => e.id === execution.parentExecutionId)?.agentName ||
              execution.parentExecutionId.slice(0, 8) + "..."}
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

export default ForkExecutionView;
