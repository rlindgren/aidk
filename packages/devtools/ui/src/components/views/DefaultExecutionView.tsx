/**
 * DefaultExecutionView - Fallback view for executions without ticks
 *
 * Shows basic info and procedures for executions that don't fit
 * into model/tool/fork categories.
 */

import type { ExecutionViewProps } from "../types";
import { ProceduresSection } from "../shared/ProceduresSection";

export function DefaultExecutionView({
  execution,
  executions,
  proceduresMap,
  getProceduresForExecution,
  onSelectExecution,
  onSelectProcedure,
  formatDuration,
}: ExecutionViewProps) {
  const procedures = getProceduresForExecution(execution.id);

  return (
    <div className="internal-execution-view">
      <div className="no-ticks-message">
        <p>No ticks recorded for this execution.</p>
      </div>

      {/* Basic Info Card */}
      <div className="info-card">
        <div className="info-card-header">Execution Details</div>
        <div className="info-card-body">
          <div className="info-row">
            <span className="info-label">Name</span>
            <span className="info-value">{execution.agentName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Type</span>
            <span className="info-value">{execution.executionType || "unknown"}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Duration</span>
            <span className="info-value">
              {formatDuration(execution.startTime, execution.endTime)}
            </span>
          </div>
        </div>
      </div>

      {/* Link to parent if exists */}
      {execution.parentExecutionId && (
        <div className="parent-link-section">
          <span>Parent: </span>
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

export default DefaultExecutionView;
