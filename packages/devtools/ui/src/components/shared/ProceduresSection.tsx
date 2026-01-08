/**
 * ProceduresSection - Collapsible section showing procedures for an execution
 */

import { useState } from "react";
import type { Procedure } from "../../hooks/useDevToolsEvents";

interface ProceduresSectionProps {
  procedures: Procedure[];
  proceduresMap: Map<string, Procedure>;
  onSelectProcedure: (id: string) => void;
  defaultExpanded?: boolean;
}

export function ProceduresSection({
  procedures,
  proceduresMap,
  onSelectProcedure,
  defaultExpanded = false,
}: ProceduresSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (procedures.length === 0) {
    return null;
  }

  return (
    <div className="procedures-section">
      <div className="procedures-header clickable" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
        <span className="procedures-title">Procedures ({procedures.length})</span>
      </div>
      {isExpanded && (
        <div className="procedures-list">
          {procedures.map((proc) => (
            <ProcedureItem
              key={proc.id}
              procedure={proc}
              proceduresMap={proceduresMap}
              onSelectProcedure={onSelectProcedure}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProcedureItemProps {
  procedure: Procedure;
  proceduresMap: Map<string, Procedure>;
  onSelectProcedure: (id: string) => void;
  depth: number;
}

function ProcedureItem({ procedure, proceduresMap, onSelectProcedure, depth }: ProcedureItemProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 1);
  const hasChildren = procedure.children.length > 0;
  const childProcedures = procedure.children
    .map((id) => proceduresMap.get(id))
    .filter((p): p is Procedure => p !== undefined);

  const formatDuration = (ms?: number) => {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="procedure-item" style={{ marginLeft: depth * 12 }}>
      <div className="procedure-row clickable" onClick={() => onSelectProcedure(procedure.id)}>
        {hasChildren ? (
          <span
            className="expand-icon small"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? "▼" : "▶"}
          </span>
        ) : (
          <span className="no-expand small" />
        )}
        <span className={`procedure-status ${procedure.status}`}>●</span>
        <span className="procedure-name">{procedure.name}</span>
        {procedure.durationMs && (
          <span className="procedure-duration">{formatDuration(procedure.durationMs)}</span>
        )}
        {procedure.metrics && Object.keys(procedure.metrics).length > 0 && (
          <span className="procedure-metrics">
            {Object.entries(procedure.metrics)
              .slice(0, 2)
              .map(([key, value]) => `${key}: ${value}`)
              .join(", ")}
          </span>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div className="procedure-children">
          {childProcedures.map((child) => (
            <ProcedureItem
              key={child.id}
              procedure={child}
              proceduresMap={proceduresMap}
              onSelectProcedure={onSelectProcedure}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ProceduresSection;
