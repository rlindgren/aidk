import { useState, useRef, useCallback, useEffect } from "react";
import {
  useDevToolsEvents,
  type Execution,
  type Tick,
  type TickEvent,
  type TokenUsage,
  type Procedure,
} from "./hooks/useDevToolsEvents";
import {
  getExecutionDisplayInfo,
  detectExecutionViewType,
  type ExecutionViewProps,
} from "./components/types";
import { ExecutionDetailView } from "./components/views";
import {
  TickView,
  ProceduresSection,
  UsageDisplay,
  StatsGrid,
  SectionGroup,
  SystemPromptView,
  ToolsView,
  MessagesView,
  ModelRequestView,
  ModelResponseView,
} from "./components/shared";
import { estimateCost, formatCostEstimate } from "./utils/cost-estimation";
import {
  findParentTick as _findParentTick,
  getExecutionModel as _getExecutionModel,
} from "./utils/helpters";

export function App() {
  const { executions, proceduresMap, getProceduresForExecution, isConnected, clearExecutions } =
    useDevToolsEvents();
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [selectedProcedureId, setSelectedProcedureId] = useState<string | null>(null);
  const [expandedTicks, setExpandedTicks] = useState<Set<number>>(new Set());
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "root" | "fork" | "model" | "tool">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "completed" | "error">(
    "all",
  );
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);

  const selectedExecution = executions.find((e) => e.id === selectedExecutionId);
  const selectedProcedure = selectedProcedureId ? proceduresMap.get(selectedProcedureId) : null;

  // Sidebar resize handlers
  const startResizing = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(600, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Check if execution has errors (in procedures)
  const hasExecutionError = useCallback(
    (exec: Execution): boolean => {
      const procs = getProceduresForExecution(exec.id);
      return procs.some((p) => p.status === "failed" || p.error);
    },
    [getProceduresForExecution],
  );

  // Get execution category for filtering
  const getExecutionCategory = (exec: Execution): "root" | "fork" | "model" | "tool" | "other" => {
    if (exec.executionType === "fork" || exec.executionType === "spawn") return "fork";
    if (exec.agentName.startsWith("model:")) return "model";
    if (exec.agentName.startsWith("tool:")) return "tool";
    if (!exec.parentExecutionId) return "root";
    return "other";
  };

  // Filter executions by search term, type, and status
  const filterExecution = (exec: Execution, filter: string): boolean => {
    // Type filter
    if (typeFilter !== "all") {
      const category = getExecutionCategory(exec);
      if (typeFilter === "root" && category !== "root") return false;
      if (typeFilter === "fork" && category !== "fork") return false;
      if (typeFilter === "model" && category !== "model") return false;
      if (typeFilter === "tool" && category !== "tool") return false;
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "running" && !exec.isRunning) return false;
      if (statusFilter === "completed" && (exec.isRunning || hasExecutionError(exec))) return false;
      if (statusFilter === "error" && !hasExecutionError(exec)) return false;
    }

    // Text filter
    if (!filter) return true;
    const lowerFilter = filter.toLowerCase();
    // Match against agent name, model, session ID
    if (exec.agentName.toLowerCase().includes(lowerFilter)) return true;
    if (exec.model?.toLowerCase().includes(lowerFilter)) return true;
    if (exec.sessionId?.toLowerCase().includes(lowerFilter)) return true;
    if (exec.id.toLowerCase().includes(lowerFilter)) return true;
    // Check if any model used matches
    for (const model of exec.modelsUsed) {
      if (model.toLowerCase().includes(lowerFilter)) return true;
    }
    return false;
  };

  // Check if an execution should appear in the tree
  // Show all executions to build the full hierarchical graph
  const isPrimaryExecution = (exec: Execution): boolean => {
    // Only filter out internal lifecycle hooks that aren't meaningful executions
    const internalPatterns = [
      "render",
      "compile:",
      "onMount",
      "onUnmount",
      "onTickEnd",
      "onComplete",
      "onError",
      "onAfterCompile",
      "lifecycle:",
    ];
    if (internalPatterns.some((p) => exec.agentName === p || exec.agentName.startsWith(p))) {
      return false;
    }

    // Show all other executions - engine, model, tool, component_tool, fork, spawn
    // The tree view organizes them hierarchically by parentExecutionId
    return true;
  };

  // Get filtered executions (includes children if parent matches)
  const getFilteredExecutions = (): Execution[] => {
    // First filter to primary executions only
    const primaryExecs = executions.filter(isPrimaryExecution);

    if (!searchFilter) return primaryExecs;

    // Find all executions that match or have matching ancestors
    const matchingIds = new Set<string>();

    for (const exec of primaryExecs) {
      if (filterExecution(exec, searchFilter)) {
        // Add this execution and all its ancestors
        matchingIds.add(exec.id);
        let parentId = exec.parentExecutionId;
        while (parentId) {
          matchingIds.add(parentId);
          const parent = primaryExecs.find((e) => e.id === parentId);
          parentId = parent?.parentExecutionId;
        }
      }
    }

    return primaryExecs.filter((e) => matchingIds.has(e.id));
  };

  const filteredExecutions = getFilteredExecutions();

  // Execution tree expand/collapse
  const toggleExecution = (executionId: string) => {
    setExpandedExecutions((prev) => {
      const next = new Set(prev);
      if (next.has(executionId)) {
        next.delete(executionId);
      } else {
        next.add(executionId);
      }
      return next;
    });
  };

  const expandAllExecutions = () => {
    // Get all execution IDs that have children
    const parentIds = new Set<string>();
    for (const exec of executions) {
      if (exec.parentExecutionId) {
        parentIds.add(exec.parentExecutionId);
      }
    }
    setExpandedExecutions(parentIds);
  };

  const collapseAllExecutions = () => {
    setExpandedExecutions(new Set());
  };

  const toggleTick = (tickNumber: number) => {
    setExpandedTicks((prev) => {
      const next = new Set(prev);
      if (next.has(tickNumber)) {
        next.delete(tickNumber);
      } else {
        next.add(tickNumber);
      }
      return next;
    });
  };

  const formatDuration = (start: number, end?: number) => {
    if (!end) return "...";
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Find parent tick for a child execution (model, tool, fork)
  const findParentTick = (exec: Execution): Tick | null => {
    return _findParentTick(exec, executions);
  };

  // Get model ID for an execution (from various sources)
  const getExecutionModel = (exec: Execution): string | undefined => {
    return _getExecutionModel(exec, executions);
  };

  // Compute total tokens from ticks if totalUsage isn't set
  const getExecutionTokens = (exec: Execution): number => {
    if (exec.totalUsage?.totalTokens) {
      return exec.totalUsage.totalTokens;
    }
    // Sum up tick usages
    const tickTokens = exec.ticks.reduce((sum, tick) => sum + (tick.usage?.totalTokens ?? 0), 0);
    if (tickTokens > 0) {
      return tickTokens;
    }
    // For model executions without ticks, get tokens from parent tick
    if (exec.agentName.startsWith("model:")) {
      const parentTick = findParentTick(exec);
      if (parentTick?.usage?.totalTokens) {
        return parentTick.usage.totalTokens;
      }
    }
    // Fallback: check procedure metrics
    const procs = getProceduresForExecution(exec.id);
    const procTokens = procs.reduce((sum, p) => {
      const m = p.metrics || {};
      const input = m.inputTokens || m.input_tokens || m["usage.inputTokens"] || 0;
      const output = m.outputTokens || m.output_tokens || m["usage.outputTokens"] || 0;
      return sum + input + output;
    }, 0);
    return procTokens;
  };

  // Compute aggregate tokens including all children (forks/spawns)
  const getAggregateTokens = (exec: Execution): number => {
    const ownTokens = getExecutionTokens(exec);
    // Find all direct children and sum their aggregate tokens recursively
    const children = executions.filter((e) => e.parentExecutionId === exec.id);
    const childTokens = children.reduce((sum, child) => sum + getAggregateTokens(child), 0);
    return ownTokens + childTokens;
  };

  // Format token display: "own (aggregate)" if has children with tokens
  const formatTokenDisplay = (exec: Execution): string => {
    const ownTokens = getExecutionTokens(exec);
    const aggregateTokens = getAggregateTokens(exec);
    if (aggregateTokens > ownTokens) {
      return `${ownTokens} (${aggregateTokens}) tokens`;
    }
    return `${ownTokens} tokens`;
  };

  // Compute cost for an execution
  const getExecutionCost = (exec: Execution): number => {
    // Get model from execution or first tick
    const modelId = exec.model || Array.from(exec.modelsUsed)[0] || "default";
    const usage =
      exec.totalUsage ||
      exec.ticks.reduce(
        (acc, t) => ({
          inputTokens: (acc.inputTokens || 0) + (t.usage?.inputTokens || 0),
          outputTokens: (acc.outputTokens || 0) + (t.usage?.outputTokens || 0),
          cachedInputTokens: (acc.cachedInputTokens || 0) + (t.usage?.cachedInputTokens || 0),
        }),
        { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      );
    return estimateCost(modelId, usage).totalCost;
  };

  // Compute aggregate cost including children
  const getAggregateCost = (exec: Execution): number => {
    const ownCost = getExecutionCost(exec);
    const children = executions.filter((e) => e.parentExecutionId === exec.id);
    const childCost = children.reduce((sum, child) => sum + getAggregateCost(child), 0);
    return ownCost + childCost;
  };

  // Compute total cost for all root executions
  const getTotalCost = (): { cost: number; tokens: number } => {
    const rootExecs = executions.filter((e) => !e.parentExecutionId);
    const cost = rootExecs.reduce((sum, exec) => sum + getAggregateCost(exec), 0);
    const tokens = rootExecs.reduce((sum, exec) => sum + getAggregateTokens(exec), 0);
    return { cost, tokens };
  };

  const totals = getTotalCost();

  return (
    <div className="app">
      <aside className="sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <div className="header-top">
            <h1>
              <span className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
              AIDK DevTools
            </h1>
            <div className="header-actions">
              <input
                type="file"
                id="import-file"
                accept=".json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const data = JSON.parse(event.target?.result as string);
                        if (data.executions && data.procedures) {
                          // This would need a hook to set state - for now just log
                          console.log("Imported trace:", data);
                          alert(
                            `Imported ${data.executions.length} executions. (Feature requires hook support)`,
                          );
                        }
                      } catch (err) {
                        alert("Failed to parse file");
                      }
                    };
                    reader.readAsText(file);
                  }
                  e.target.value = ""; // Reset
                }}
              />
              <button
                onClick={() => document.getElementById("import-file")?.click()}
                className="action-btn"
                title="Import trace"
              >
                Import
              </button>
              {executions.length > 0 && (
                <>
                  <button
                    onClick={() => {
                      const data = {
                        exportedAt: new Date().toISOString(),
                        version: "1.0",
                        executions: executions,
                        procedures: Array.from(proceduresMap.entries()),
                      };
                      const blob = new Blob([JSON.stringify(data, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `aidk-trace-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="action-btn"
                    title="Export trace"
                  >
                    Export
                  </button>
                  <button onClick={clearExecutions} className="clear-btn">
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
          {totals.tokens > 0 && (
            <div className="header-stats">
              <span className="stat-item">
                <span className="stat-label">Tokens:</span>
                <span className="stat-value">{totals.tokens.toLocaleString()}</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">Est. Cost:</span>
                <span className="stat-value cost">~${totals.cost.toFixed(4)}</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">Executions:</span>
                <span className="stat-value">
                  {executions.filter((e) => !e.parentExecutionId).length}
                </span>
              </span>
            </div>
          )}
        </div>
        {/* Search and filter controls */}
        <div className="filter-controls">
          <div className="search-container">
            <input
              type="text"
              className="search-input"
              placeholder="Search..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            {searchFilter && (
              <button className="search-clear" onClick={() => setSearchFilter("")}>
                ×
              </button>
            )}
          </div>
          <div className="filter-chips">
            <div className="filter-group">
              <span className="filter-label">Type:</span>
              {(["all", "root", "fork", "model", "tool"] as const).map((type) => (
                <button
                  key={type}
                  className={`filter-chip ${typeFilter === type ? "active" : ""}`}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <span className="filter-label">Status:</span>
              {(["all", "running", "completed", "error"] as const).map((status) => (
                <button
                  key={status}
                  className={`filter-chip ${status === "error" ? "error" : ""} ${statusFilter === status ? "active" : ""}`}
                  onClick={() => setStatusFilter(status)}
                >
                  {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="execution-list">
          {filteredExecutions.length === 0 ? (
            <div className="empty-sidebar">
              {executions.length === 0 ? "No executions yet" : "No matching executions"}
            </div>
          ) : (
            <>
              <div className="tree-controls">
                <button onClick={expandAllExecutions} className="tree-btn" title="Expand all">
                  +
                </button>
                <button onClick={collapseAllExecutions} className="tree-btn" title="Collapse all">
                  −
                </button>
              </div>
              <ExecutionTree
                executions={filteredExecutions}
                selectedExecutionId={selectedExecutionId}
                onSelectExecution={(id) => {
                  setSelectedExecutionId(id);
                  setSelectedProcedureId(null); // Clear procedure selection
                }}
                expandedExecutions={expandedExecutions}
                onToggleExpand={toggleExecution}
                formatDuration={formatDuration}
                formatTokenDisplay={formatTokenDisplay}
                getExecutionModel={getExecutionModel}
                proceduresMap={proceduresMap}
                hasExecutionError={hasExecutionError}
              />
            </>
          )}
        </div>
      </aside>

      <div className="resize-handle" onMouseDown={startResizing} />

      <main className="main">
        {/* Show procedure details if a procedure is selected */}
        {selectedProcedure ? (
          <div className="main-content scrollable">
            <div className="back-nav">
              <button className="back-btn" onClick={() => setSelectedProcedureId(null)}>
                ← Back to Execution
              </button>
            </div>
            <ProcedureDetailsView
              procedure={selectedProcedure}
              proceduresMap={proceduresMap}
              formatDuration={formatDuration}
              formatTime={formatTime}
              onSelectProcedure={setSelectedProcedureId}
            />
          </div>
        ) : !selectedExecution ? (
          <div className="empty-state">
            <h2>Select an execution</h2>
            <p>Choose an execution from the sidebar to view its timeline</p>
          </div>
        ) : (
          <div className="main-content scrollable">
            <div className="main-header">
              {(() => {
                const displayInfo = getExecutionDisplayInfo(selectedExecution, proceduresMap);
                return (
                  <h2>
                    {displayInfo.badge && (
                      <span
                        className={`exec-type-badge large ${displayInfo.badgeClass || displayInfo.badge}`}
                      >
                        {displayInfo.badge}
                      </span>
                    )}
                    {displayInfo.name}
                  </h2>
                );
              })()}
              {/* Model and usage summary */}
              <div className="execution-summary">
                {selectedExecution.executionType === "model" &&
                  (() => {
                    const modelId = getExecutionModel(selectedExecution);
                    return modelId ? <span className="model-badge large">{modelId}</span> : null;
                  })()}
                <span className="usage-summary">
                  {getExecutionTokens(selectedExecution)} tokens
                  {selectedExecution.totalUsage?.cachedInputTokens ? (
                    <span className="cached">
                      {" "}
                      ({selectedExecution.totalUsage.cachedInputTokens} cached)
                    </span>
                  ) : null}
                </span>
                <span className="ticks-count">{selectedExecution.ticks.length} ticks</span>
                <span className="procedures-count">
                  {selectedExecution.procedures.length} procedures
                </span>
                <span className="duration">
                  {formatDuration(selectedExecution.startTime, selectedExecution.endTime)}
                </span>
              </div>
              <div className="execution-info">
                <span>ID: {selectedExecution.id.slice(0, 8)}...</span>
                {selectedExecution.sessionId && (
                  <span> · Session: {selectedExecution.sessionId.slice(0, 8)}...</span>
                )}
                <span> · Started: {formatTime(selectedExecution.startTime)}</span>
                {selectedExecution.parentExecutionId && (
                  <span className="parent-link">
                    {" "}
                    · Parent:{" "}
                    <button
                      className="link-btn"
                      onClick={() => setSelectedExecutionId(selectedExecution.parentExecutionId!)}
                    >
                      {selectedExecution.parentExecutionId.slice(0, 8)}...
                    </button>
                  </span>
                )}
              </div>
            </div>

            {/* Tick Timeline */}
            {(() => {
              const executionProcedures = getProceduresForExecution(selectedExecution.id);
              // Filter procedures by tick - each tick shows procedures that ran during it
              // Procedures without tick info are shown in the last tick (legacy behavior)
              const lastTickNumber =
                selectedExecution.ticks.length > 0
                  ? selectedExecution.ticks[selectedExecution.ticks.length - 1].number
                  : -1;
              const getProceduresForTick = (tickNumber: number) =>
                executionProcedures.filter(
                  (p) =>
                    p.tick === tickNumber ||
                    // Fallback: show procedures without tick in last tick
                    (p.tick === undefined && tickNumber === lastTickNumber),
                );

              // Get direct child executions for this execution
              const childExecutionsForExecution = executions.filter(
                (e) => e.parentExecutionId === selectedExecution.id,
              );

              // Group child executions by tick (based on start time falling within tick)
              // Sorted oldest to newest for chronological display
              const getChildExecutionsForTick = (tick: Tick) => {
                return childExecutionsForExecution
                  .filter((childExec) => {
                    // Child started during or after this tick
                    if (childExec.startTime < tick.startTime) return false;
                    // If tick has end time, child must have started before tick ended
                    if (tick.endTime && childExec.startTime > tick.endTime) return false;
                    return true;
                  })
                  .sort((a, b) => a.startTime - b.startTime);
              };

              // Determine the view type based on execution characteristics
              const agentName = selectedExecution.agentName;
              const isModelExecution = agentName.startsWith("model:");
              const isToolExecution =
                agentName.startsWith("tool:") ||
                (agentName === selectedExecution.agentName && !agentName.includes(":"));
              const isEngineExecution = agentName.startsWith("engine:");
              const hasTicks = selectedExecution.ticks.length > 0;

              // Show tick timeline for executions with ticks (root/streaming)
              if (hasTicks) {
                return (
                  <div className="timeline">
                    {selectedExecution.ticks.map((tick) => (
                      <TickView
                        key={tick.number}
                        tick={tick}
                        isExpanded={expandedTicks.has(tick.number)}
                        onToggle={() => toggleTick(tick.number)}
                        formatDuration={formatDuration}
                        procedures={getProceduresForTick(tick.number)}
                        proceduresMap={proceduresMap}
                        onSelectProcedure={setSelectedProcedureId}
                        childExecutions={getChildExecutionsForTick(tick)}
                        allExecutions={executions}
                        onSelectExecution={(id) => {
                          setSelectedExecutionId(id);
                          // Expand parent so child is visible in sidebar
                          setExpandedExecutions((prev) => new Set([...prev, selectedExecution.id]));
                        }}
                      />
                    ))}
                  </div>
                );
              }

              // For executions without ticks - use type-specific view components
              return (
                <ExecutionDetailView
                  execution={selectedExecution}
                  executions={executions}
                  proceduresMap={proceduresMap}
                  getProceduresForExecution={getProceduresForExecution}
                  onSelectExecution={setSelectedExecutionId}
                  onSelectProcedure={setSelectedProcedureId}
                  formatDuration={formatDuration}
                  formatTime={formatTime}
                />
              );
            })()}
          </div>
        )}
      </main>
    </div>
  );
}

// Execution Tree - shows hierarchical execution view (no procedures in sidebar)
interface ExecutionTreeProps {
  executions: Execution[];
  selectedExecutionId: string | null;
  onSelectExecution: (id: string) => void;
  expandedExecutions: Set<string>;
  onToggleExpand: (id: string) => void;
  formatDuration: (start: number, end?: number) => string;
  formatTokenDisplay: (exec: Execution) => string;
  getExecutionModel: (exec: Execution) => string | undefined;
  proceduresMap: Map<string, Procedure>;
  hasExecutionError: (exec: Execution) => boolean;
}

function ExecutionTree({
  executions,
  selectedExecutionId,
  onSelectExecution,
  expandedExecutions,
  onToggleExpand,
  formatDuration,
  formatTokenDisplay,
  getExecutionModel,
  proceduresMap,
  hasExecutionError,
}: ExecutionTreeProps) {
  // Build a map of parent -> children
  const childrenMap = new Map<string, Execution[]>();
  const rootExecutions: Execution[] = [];

  for (const exec of executions) {
    if (exec.parentExecutionId) {
      const siblings = childrenMap.get(exec.parentExecutionId) || [];
      siblings.push(exec);
      childrenMap.set(exec.parentExecutionId, siblings);
    } else {
      rootExecutions.push(exec);
    }
  }

  // Sort roots by start time descending
  rootExecutions.sort((a, b) => b.startTime - a.startTime);

  // Sort children by start time ascending (oldest to newest for chronological display)
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.startTime - b.startTime);
  }

  const renderExecution = (exec: Execution, depth: number): React.ReactNode => {
    const isSelected = exec.id === selectedExecutionId;
    const isExpanded = expandedExecutions.has(exec.id);
    const children = childrenMap.get(exec.id) || [];
    // Has expandable content: only child executions (forks/spawns)
    const hasExpandableContent = children.length > 0;
    const hasError = hasExecutionError(exec);

    // Get smart display info (name, badge) based on execution type
    const displayInfo = getExecutionDisplayInfo(exec, proceduresMap);

    return (
      <div key={exec.id} className="execution-node">
        <div
          className={`execution-item ${isSelected ? "selected" : ""} ${exec.isRunning ? "running" : ""} ${hasError ? "has-error" : ""}`}
          onClick={() => onSelectExecution(exec.id)}
        >
          <div className="execution-header">
            {hasExpandableContent ? (
              <span
                className="expand-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(exec.id);
                }}
              >
                {isExpanded ? "▼" : "▶"}
              </span>
            ) : (
              <span className="no-expand" />
            )}
            {hasError && (
              <span className="error-indicator" title="Has errors">
                !
              </span>
            )}
            {displayInfo.badge && (
              <span className={`exec-type-badge ${displayInfo.badgeClass || displayInfo.badge}`}>
                {displayInfo.badge}
              </span>
            )}
            <span className="execution-name-text">{displayInfo.name}</span>
          </div>
          {/* Model badge removed - model name is now shown as the execution name */}
          <div className="execution-meta">
            <span>{exec.ticks.length} ticks</span>
            <span> · </span>
            <span>{formatDuration(exec.startTime, exec.endTime)}</span>
            <span> · </span>
            <span>{formatTokenDisplay(exec)}</span>
          </div>
        </div>
        {isExpanded && hasExpandableContent && (
          <div className="execution-children">
            {children.map((child) => renderExecution(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="execution-tree">{rootExecutions.map((exec) => renderExecution(exec, 0))}</div>
  );
}

// Procedure Details View - shows full information about a selected procedure
interface ProcedureDetailsViewProps {
  procedure: Procedure;
  proceduresMap: Map<string, Procedure>;
  formatDuration: (start: number, end?: number) => string;
  formatTime: (timestamp: number) => string;
  onSelectProcedure: (id: string) => void;
}

function ProcedureDetailsView({
  procedure,
  proceduresMap,
  formatDuration,
  formatTime,
  onSelectProcedure,
}: ProcedureDetailsViewProps) {
  const parent = procedure.parentId ? proceduresMap.get(procedure.parentId) : null;
  const children = procedure.children
    .map((id) => proceduresMap.get(id))
    .filter((p): p is Procedure => p !== undefined);

  // Get component info from metadata if available
  const metadata = procedure.metadata as { component?: string; hook?: string } | undefined;
  const componentName = metadata?.component;
  const hookName = procedure.name || metadata?.hook;

  // Helper to get display name for any procedure
  const getProcedureDisplayName = (proc: Procedure): { name: string; component?: string } => {
    const meta = proc.metadata as { component?: string; hook?: string } | undefined;
    if (meta?.component && meta?.hook) {
      return { name: meta.hook, component: meta.component };
    }
    return { name: proc.name };
  };

  return (
    <>
      <div className="main-header">
        <h2>
          <span className={`procedure-status-badge ${procedure.status}`}>{procedure.status}</span>
          {hookName}
          {componentName && <span className="component-name-large">({componentName})</span>}
        </h2>
        <div className="execution-summary">
          {procedure.type && <span className="procedure-type-badge">{procedure.type}</span>}
          <span className="duration">{formatDuration(procedure.startTime, procedure.endTime)}</span>
          {procedure.durationMs && <span className="duration-ms">{procedure.durationMs}ms</span>}
        </div>
        <div className="execution-info">
          <span>ID: {procedure.id.slice(0, 12)}...</span>
          <span> · Started: {formatTime(procedure.startTime)}</span>
          {procedure.endTime && <span> · Ended: {formatTime(procedure.endTime)}</span>}
        </div>
      </div>

      <div className="procedure-details">
        {/* Parent link */}
        {parent &&
          (() => {
            const parentDisplay = getProcedureDisplayName(parent);
            return (
              <div className="detail-section">
                <h4>Parent Procedure</h4>
                <button
                  className="link-btn procedure-link"
                  onClick={() => onSelectProcedure(parent.id)}
                >
                  <span className={`procedure-status ${parent.status}`}>
                    {parent.status === "running"
                      ? "●"
                      : parent.status === "completed"
                        ? "✓"
                        : parent.status === "failed"
                          ? "✗"
                          : "○"}
                  </span>
                  {parentDisplay.name}
                  {parentDisplay.component && (
                    <span className="component-name">({parentDisplay.component})</span>
                  )}
                  {parent.type && <span className="procedure-type">{parent.type}</span>}
                </button>
              </div>
            );
          })()}

        {/* Error display */}
        {procedure.error && (
          <div className="detail-section error-section">
            <h4>Error</h4>
            <div className="error-display">
              <div className="error-header">
                <span className="error-name">{procedure.error.name}</span>
              </div>
              <div className="error-message">{procedure.error.message}</div>
              {procedure.error.stack && <pre className="error-stack">{procedure.error.stack}</pre>}
            </div>
          </div>
        )}

        {/* Metrics */}
        {procedure.metrics && Object.keys(procedure.metrics).length > 0 && (
          <div className="detail-section">
            <h4>Metrics</h4>
            <div className="metrics-grid">
              {Object.entries(procedure.metrics).map(([key, value]) => (
                <div key={key} className="metric-item">
                  <span className="metric-key">{key}</span>
                  <span className="metric-value">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {procedure.metadata && Object.keys(procedure.metadata).length > 0 && (
          <div className="detail-section">
            <h4>Metadata</h4>
            <pre className="code-block">{JSON.stringify(procedure.metadata, null, 2)}</pre>
          </div>
        )}

        {/* Children */}
        {children.length > 0 && (
          <div className="detail-section">
            <h4>Child Procedures ({children.length})</h4>
            <div className="children-list">
              {children.map((child) => {
                const childDisplay = getProcedureDisplayName(child);
                return (
                  <button
                    key={child.id}
                    className="link-btn procedure-link"
                    onClick={() => onSelectProcedure(child.id)}
                  >
                    <span className={`procedure-status ${child.status}`}>
                      {child.status === "running"
                        ? "●"
                        : child.status === "completed"
                          ? "✓"
                          : child.status === "failed"
                            ? "✗"
                            : "○"}
                    </span>
                    {childDisplay.name}
                    {childDisplay.component && (
                      <span className="component-name">({childDisplay.component})</span>
                    )}
                    {child.type && <span className="procedure-type">{child.type}</span>}
                    <span className="child-duration">
                      {formatDuration(child.startTime, child.endTime)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
