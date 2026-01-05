import { useState, useRef, useCallback, useEffect } from "react";
import { marked } from "marked";
import {
  useDevToolsEvents,
  type Execution,
  type Tick,
  type TickEvent,
  type TokenUsage,
  type Procedure,
} from "./hooks/useDevToolsEvents";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

export function App() {
  const { executions, proceduresMap, getProceduresForExecution, isConnected, clearExecutions } =
    useDevToolsEvents();
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [selectedProcedureId, setSelectedProcedureId] = useState<string | null>(null);
  const [expandedTicks, setExpandedTicks] = useState<Set<number>>(new Set());
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");
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

  // Filter executions by search term
  const filterExecution = (exec: Execution, filter: string): boolean => {
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

  // Check if an execution is a "real" agent execution (not internal procedure)
  // Real executions are: Engine runs with ticks, or have session IDs
  const isPrimaryExecution = (exec: Execution): boolean => {
    // Internal procedure names should always be filtered out
    // These are kernel-level procedures that shouldn't appear as top-level executions
    const internalPatterns = [
      "render",
      "compile:",
      "engine:execute",
      "engine:stream",
      "model:",
      "tool:",
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

    // Must have actual work done to show as top-level
    // Engine executions have ticks
    if (exec.ticks.length > 0) return true;
    // Has a session ID (comes from Engine)
    if (exec.sessionId) return true;

    return false;
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

  // Compute total tokens from ticks if totalUsage isn't set
  const getExecutionTokens = (exec: Execution): number => {
    if (exec.totalUsage?.totalTokens) {
      return exec.totalUsage.totalTokens;
    }
    // Sum up tick usages
    return exec.ticks.reduce((sum, tick) => sum + (tick.usage?.totalTokens ?? 0), 0);
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

  return (
    <div className="app">
      <aside className="sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <h1>
            <span className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
            AIDK DevTools
          </h1>
          <div className="header-actions">
            {executions.length > 0 && (
              <button onClick={clearExecutions} className="clear-btn">
                Clear
              </button>
            )}
          </div>
        </div>
        {/* Search filter */}
        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder="Filter by agent, model, type..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button className="search-clear" onClick={() => setSearchFilter("")}>
              ×
            </button>
          )}
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
              <h2>
                {selectedExecution.executionType && selectedExecution.executionType !== "root" && (
                  <span className={`exec-type-badge large ${selectedExecution.executionType}`}>
                    {selectedExecution.executionType}
                  </span>
                )}
                {selectedExecution.agentName}
              </h2>
              {/* Model and usage summary */}
              <div className="execution-summary">
                {selectedExecution.model && (
                  <span className="model-badge large">{selectedExecution.model}</span>
                )}
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
              return selectedExecution.ticks.length > 0 ? (
                <div className="timeline">
                  {selectedExecution.ticks.map((tick) => (
                    <TickView
                      key={tick.number}
                      tick={tick}
                      isExpanded={expandedTicks.has(tick.number)}
                      onToggle={() => toggleTick(tick.number)}
                      formatDuration={formatDuration}
                      procedures={executionProcedures}
                      proceduresMap={proceduresMap}
                      onSelectProcedure={setSelectedProcedureId}
                    />
                  ))}
                </div>
              ) : (
                <div className="no-ticks-message">
                  <p>No ticks recorded for this execution.</p>
                  {executionProcedures.length > 0 && (
                    <ProceduresSection
                      procedures={executionProcedures}
                      proceduresMap={proceduresMap}
                      onSelectProcedure={setSelectedProcedureId}
                    />
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </main>
    </div>
  );
}

interface TickViewProps {
  tick: Tick;
  isExpanded: boolean;
  onToggle: () => void;
  formatDuration: (start: number, end?: number) => string;
  procedures: Procedure[];
  proceduresMap: Map<string, Procedure>;
  onSelectProcedure: (id: string) => void;
}

function TickView({
  tick,
  isExpanded,
  onToggle,
  formatDuration,
  procedures,
  proceduresMap,
  onSelectProcedure,
}: TickViewProps) {
  const formatStopReason = (reason: unknown): string => {
    if (!reason) return "";
    if (typeof reason === "string") return reason;
    if (typeof reason === "object" && reason !== null && "reason" in reason) {
      return (reason as { reason: string }).reason;
    }
    return JSON.stringify(reason);
  };

  return (
    <div className="tick">
      <div className="tick-header" onClick={onToggle}>
        <div>
          <span className="tick-number">Tick {tick.number}</span>
          {tick.model && <span className="tick-model"> · {tick.model}</span>}
          {tick.stopReason ? (
            <span className="tick-stop-reason">
              {" "}
              · {formatStopReason(tick.stopReason as string)}
            </span>
          ) : null}
        </div>
        <div className="tick-meta">
          <span>{formatDuration(tick.startTime, tick.endTime)}</span>
          <span> · </span>
          <UsageDisplay usage={tick.usage} compact />
          <span className="expand-icon">{isExpanded ? "−" : "+"}</span>
        </div>
      </div>
      {isExpanded && (
        <div className="tick-content">
          {/* Stats Grid */}
          <StatsGrid
            usage={tick.usage}
            toolCallCount={tick.events.filter((e) => e.type === "tool_call").length}
            messageCount={tick.compiled?.messages?.length ?? 0}
            eventCount={tick.events.filter((e) => e.type !== "content_delta").length}
          />

          {
            (tick.compiled &&
              (() => {
                const compiled = tick.compiled!;
                const compiledSection = (
                  <div className="compiled-section">
                    <h4>Compiled Context</h4>
                    {compiled.system ? <SystemPromptView system={compiled.system} /> : null}
                    <MessagesView messages={(compiled.messages ?? []) as TimelineEntry[]} />
                    <ToolsView tools={(compiled.tools ?? []) as Tool[]} />
                  </div>
                );
                return compiledSection;
              })()) as any
          }

          {tick.modelOutput && (
            <ModelOutputView output={tick.modelOutput} raw={tick.modelOutputRaw} />
          )}

          <EventsView events={tick.events} />

          {tick.content && <StreamedOutputView content={tick.content} />}

          {/* Procedures for this tick */}
          {procedures.length > 0 && (
            <ProceduresSection
              procedures={procedures}
              proceduresMap={proceduresMap}
              onSelectProcedure={onSelectProcedure}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Procedures Section - shows procedure tree within a tick
interface ProceduresSectionProps {
  procedures: Procedure[];
  proceduresMap: Map<string, Procedure>;
  onSelectProcedure: (id: string) => void;
}

function ProceduresSection({
  procedures,
  proceduresMap,
  onSelectProcedure,
}: ProceduresSectionProps) {
  const [expanded, setExpanded] = useState(false);
  // Track locally expanded nodes (auto-expand first 2 levels)
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(new Set());

  // Find root procedures (those without parents in this set, or parent not in this tick)
  const procedureIds = new Set(procedures.map((p) => p.id));
  const rootProcedures = procedures.filter((p) => !p.parentId || !procedureIds.has(p.parentId));

  // Auto-expand root procedures when section is expanded
  const isNodeExpanded = (procId: string, depth: number): boolean => {
    // Auto-expand first 2 levels, or if manually expanded
    return depth < 2 || localExpanded.has(procId);
  };

  const toggleLocalExpand = (procId: string) => {
    setLocalExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(procId)) {
        next.delete(procId);
      } else {
        next.add(procId);
      }
      return next;
    });
  };

  const renderProcedureNode = (proc: Procedure, depth: number): React.ReactNode => {
    const isProcExpanded = isNodeExpanded(proc.id, depth);
    // Find children by parentId (more reliable than proc.children which depends on event order)
    const procChildren = Array.from(proceduresMap.values())
      .filter((p) => p.parentId === proc.id)
      .sort((a, b) => a.startTime - b.startTime);
    const hasProcChildren = procChildren.length > 0;

    // Get display info
    const metadata = proc.metadata as { component?: string } | undefined;
    const componentName = metadata?.component;

    return (
      <div key={proc.id} className="procedure-tree-node">
        <div
          className={`procedure-tree-item ${proc.status}`}
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          {hasProcChildren ? (
            <span className="expand-icon small" onClick={() => toggleLocalExpand(proc.id)}>
              {isProcExpanded ? "▼" : "▶"}
            </span>
          ) : (
            <span className="tree-spacer" />
          )}
          <span className="procedure-name clickable" onClick={() => onSelectProcedure(proc.id)}>
            {proc.name}
          </span>
          {componentName && <span className="component-name">({componentName})</span>}
          {proc.durationMs !== undefined && proc.durationMs > 0 && (
            <span className="procedure-duration">{proc.durationMs}ms</span>
          )}
        </div>
        {isProcExpanded && hasProcChildren && (
          <div className="procedure-tree-children">
            {procChildren.map((child) => renderProcedureNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Count total procedures by traversing from roots
  const countProcedures = (proc: Procedure): number => {
    const children = Array.from(proceduresMap.values()).filter((p) => p.parentId === proc.id);
    return 1 + children.reduce((sum, child) => sum + countProcedures(child), 0);
  };
  const totalProcedureCount = rootProcedures.reduce((sum, proc) => sum + countProcedures(proc), 0);

  return (
    <div className="procedures-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Procedures ({totalProcedureCount})
        </span>
      </div>
      {expanded && (
        <div className="section-content procedures-tree">
          {rootProcedures.map((proc) => renderProcedureNode(proc, 0))}
        </div>
      )}
    </div>
  );
}

interface UsageDisplayProps {
  usage?: TokenUsage;
  compact?: boolean;
}

function UsageDisplay({ usage, compact }: UsageDisplayProps) {
  if (!usage) return <span className="usage-none">no usage data</span>;

  if (compact) {
    return (
      <span className="usage-compact">
        {usage.totalTokens > 0 ? `${usage.totalTokens} tokens` : "0 tokens"}
        {usage.cachedInputTokens ? ` (${usage.cachedInputTokens} cached)` : ""}
      </span>
    );
  }

  return (
    <div className="usage-detail">
      <div className="usage-row">
        <span className="usage-label">Input:</span>
        <span className="usage-value">{usage.inputTokens}</span>
        {usage.cachedInputTokens ? (
          <span className="usage-cached">({usage.cachedInputTokens} cached)</span>
        ) : null}
      </div>
      <div className="usage-row">
        <span className="usage-label">Output:</span>
        <span className="usage-value">{usage.outputTokens}</span>
      </div>
      {usage.reasoningTokens ? (
        <div className="usage-row">
          <span className="usage-label">Reasoning:</span>
          <span className="usage-value">{usage.reasoningTokens}</span>
        </div>
      ) : null}
      <div className="usage-row usage-total">
        <span className="usage-label">Total:</span>
        <span className="usage-value">{usage.totalTokens}</span>
      </div>
    </div>
  );
}

// Stats Grid - shows usage, tool calls, messages in a compact grid
interface StatsGridProps {
  usage?: TokenUsage;
  toolCallCount: number;
  messageCount: number;
  eventCount: number;
}

function StatsGrid({ usage, toolCallCount, messageCount, eventCount }: StatsGridProps) {
  return (
    <div className="stats-grid">
      <div className="stat-box">
        <div className="stat-label">Tokens</div>
        <div className="stat-value">{usage?.totalTokens ?? 0}</div>
        <div className="stat-details">
          <span className="stat-detail">
            <span className="detail-label">in</span>
            <span className="detail-value">{usage?.inputTokens ?? 0}</span>
          </span>
          <span className="stat-detail">
            <span className="detail-label">out</span>
            <span className="detail-value">{usage?.outputTokens ?? 0}</span>
          </span>
          {usage?.cachedInputTokens ? (
            <span className="stat-detail cached">
              <span className="detail-label">cached</span>
              <span className="detail-value">{usage.cachedInputTokens}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="stat-box">
        <div className="stat-label">Tool Calls</div>
        <div className="stat-value">{toolCallCount}</div>
      </div>
      <div className="stat-box">
        <div className="stat-label">Messages</div>
        <div className="stat-value">{messageCount}</div>
      </div>
      <div className="stat-box">
        <div className="stat-label">Events</div>
        <div className="stat-value">{eventCount}</div>
      </div>
    </div>
  );
}

interface EventViewProps {
  event: TickEvent;
}

function EventView({ event }: EventViewProps) {
  const renderEventData = () => {
    const data = event.data as Record<string, unknown>;

    switch (event.type) {
      case "tool_call":
        return (
          <div className="event-data">
            <div className="tool-name">{data.name as string}</div>
            <pre className="code-block">{JSON.stringify(data.input, null, 2)}</pre>
          </div>
        );

      case "tool_result":
        return (
          <div className={`event-data ${data.isError ? "error" : ""}`}>
            <pre className="code-block">{JSON.stringify(data.result, null, 2)}</pre>
          </div>
        );

      case "content_delta":
        return null; // Content deltas are aggregated in the output section

      case "model_start":
        return (
          <div className="event-data">
            {String(data.provider)}/{String(data.modelId)}
          </div>
        );

      case "state_change":
        return (
          <div className="event-data">
            <span className="state-key">{data.key as string}</span>:{" "}
            <span className="state-old">{JSON.stringify(data.oldValue)}</span>
            {" → "}
            <span className="state-new">{JSON.stringify(data.newValue)}</span>
          </div>
        );

      default:
        return (
          <div className="event-data">
            <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>
          </div>
        );
    }
  };

  // Don't render content_delta events individually
  if (event.type === "content_delta") return null;

  return (
    <div className={`event ${event.type}`}>
      <div className="event-header">
        <span className="event-type">{event.type}</span>
        <span className="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
      </div>
      {renderEventData()}
    </div>
  );
}

// System Prompt View
interface SystemPromptViewProps {
  system: string | unknown;
}

function SystemPromptView({ system }: SystemPromptViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Extract text from various system prompt formats
  // TODO: Future enhancement - render multimodal content (images, video, audio, docs)
  // instead of placeholders. Could show image thumbnails, audio players, etc.
  const extractSystemText = (sys: unknown): string[] => {
    if (sys === null || sys === undefined) {
      return [];
    }
    if (typeof sys === "string") {
      // Try to parse JSON strings (common for nested structures)
      try {
        const parsed = JSON.parse(sys);
        // Only recurse if it parsed to something other than the same string
        if (typeof parsed !== "string") {
          return extractSystemText(parsed);
        }
      } catch {
        // Not JSON, use as-is
      }
      return [sys];
    }
    if (typeof sys === "number" || typeof sys === "boolean") {
      return [String(sys)];
    }
    if (Array.isArray(sys)) {
      const results = sys.flatMap((item) => extractSystemText(item));
      // If array processing returned empty, stringify the array
      if (results.length === 0 && sys.length > 0) {
        return [JSON.stringify(sys, null, 2)];
      }
      return results;
    }
    if (typeof sys === "object") {
      const obj = sys as Record<string, unknown>;

      // Handle timeline entry with message wrapper
      if (obj.kind === "message" && obj.message) {
        return extractSystemText(obj.message);
      }

      // Handle content arrays/objects
      if (obj.content !== undefined) {
        return extractSystemText(obj.content);
      }

      // Handle text blocks
      if (obj.type === "text" && typeof obj.text === "string") {
        return [obj.text];
      }

      // Handle image blocks
      if (obj.type === "image") {
        return ["[Image content]"];
      }

      // Handle tool result blocks
      if (obj.type === "tool_result") {
        return ["[Tool result]"];
      }

      // Handle message with role/content (common format)
      if (obj.role && obj.content !== undefined) {
        return extractSystemText(obj.content);
      }

      // Unknown object format - stringify it so it's visible
      return [JSON.stringify(obj, null, 2)];
    }
    // Fallback for any other type
    return [String(sys)];
  };

  const textParts = extractSystemText(system);
  const hasNonTextContent =
    typeof system === "object" && JSON.stringify(system).includes('"type":"image"');

  // Detect if content looks like XML (has XML-style tags)
  const isXmlLike = (text: string): boolean => {
    const trimmed = text.trim();
    // Check for XML-style tags like <tag> or </tag> or <tag />
    return /<[a-zA-Z_][\w-]*[\s>]/.test(trimmed) || /<\/[a-zA-Z_][\w-]*>/.test(trimmed);
  };

  const renderTextPart = (text: string, index: number) => {
    if (isXmlLike(text)) {
      // Render XML as preformatted code
      return (
        <pre key={index} className="code-block xml-content">
          {text}
        </pre>
      );
    }
    // Render as markdown
    return (
      <div
        key={index}
        className="system-text markdown-content"
        dangerouslySetInnerHTML={{ __html: marked.parse(text) as string }}
      />
    );
  };

  return (
    <div className="system-prompt-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          System Prompt
        </span>
        <span
          className="toggle-raw"
          onClick={(e) => {
            e.stopPropagation();
            setShowRaw(!showRaw);
          }}
        >
          Show {showRaw ? "Formatted" : "Raw"}
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          {showRaw ? (
            <pre className="code-block">
              {typeof system === "string" ? system : JSON.stringify(system, null, 2)}
            </pre>
          ) : (
            <div className="system-parts">
              {textParts.map((text, i) => renderTextPart(text, i))}
              {hasNonTextContent && (
                <div className="system-notice">
                  <em>Contains non-text content. Click "Raw" to see full structure.</em>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Messages View - handles timeline entries which may have { kind, message } structure
interface TimelineEntry {
  kind?: string;
  message?: {
    role: string;
    content: unknown;
  };
  role?: string;
  content?: unknown;
}

interface MessagesViewProps {
  messages: TimelineEntry[];
}

function MessagesView({ messages }: MessagesViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(false); // Collapsed by default

  if (messages.length === 0) {
    return (
      <div className="messages-section empty">
        <div className="section-header">
          <span className="section-title">Messages (0)</span>
        </div>
      </div>
    );
  }

  // Normalize timeline entries to messages
  const normalizeEntry = (entry: TimelineEntry): { role: string; content: unknown } | null => {
    // Handle { kind: "message", message: { role, content } }
    if (entry.kind === "message" && entry.message) {
      return entry.message;
    }
    // Handle direct { role, content }
    if (entry.role && entry.content !== undefined) {
      return { role: entry.role, content: entry.content };
    }
    // Handle other kinds (tool_use, tool_result, etc.)
    if (entry.kind) {
      return { role: entry.kind, content: entry };
    }
    return null;
  };

  const renderContent = (content: unknown): React.ReactNode => {
    if (typeof content === "string") {
      return <span className="message-text">{content}</span>;
    }
    if (Array.isArray(content)) {
      return content.map((block, i) => (
        <div key={i} className="content-block">
          {renderContentBlock(block)}
        </div>
      ));
    }
    return <pre className="code-block small">{JSON.stringify(content, null, 2)}</pre>;
  };

  const renderContentBlock = (block: Record<string, unknown>): React.ReactNode => {
    switch (block.type) {
      case "text":
        return <span className="message-text">{block.text as string}</span>;
      case "tool_use":
        return (
          <div className="tool-use-block">
            <span className="tool-badge">Tool: {block.name as string}</span>
            <pre className="code-block small">{JSON.stringify(block.input, null, 2)}</pre>
          </div>
        );
      case "tool_result":
        return (
          <div className="tool-result-block">
            <span className="tool-badge result">Result</span>
            <pre className="code-block small">{JSON.stringify(block.content, null, 2)}</pre>
          </div>
        );
      case "image":
        return <span className="image-badge">[Image]</span>;
      default:
        return <pre className="code-block small">{JSON.stringify(block, null, 2)}</pre>;
    }
  };

  const normalizedMessages = messages.map(normalizeEntry).filter(Boolean) as {
    role: string;
    content: unknown;
  }[];

  return (
    <div className="messages-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Messages ({normalizedMessages.length})
        </span>
        <span
          className="toggle-raw"
          onClick={(e) => {
            e.stopPropagation();
            setShowRaw(!showRaw);
          }}
        >
          {showRaw ? "Show Formatted" : "Show Raw"}
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          {showRaw ? (
            <pre className="code-block">{JSON.stringify(messages, null, 2)}</pre>
          ) : (
            <div className="messages-list">
              {normalizedMessages.map((msg, i) => (
                <div key={i} className={`message-item role-${msg.role}`}>
                  <span className={`role-badge ${msg.role}`}>{msg.role}</span>
                  <div className="message-content">{renderContent(msg.content)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tools View
interface Tool {
  name: string;
  description?: string;
  input?: unknown;
}

interface ToolsViewProps {
  tools: Tool[];
}

function ToolsView({ tools }: ToolsViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(false); // Collapsed by default

  if (tools.length === 0) {
    return (
      <div className="tools-section empty">
        <div className="section-header">
          <span className="section-title">Tools (0)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="tools-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Tools ({tools.length})
        </span>
        <span
          className="toggle-raw"
          onClick={(e) => {
            e.stopPropagation();
            setShowRaw(!showRaw);
          }}
        >
          {showRaw ? "Show Formatted" : "Show Raw"}
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          {showRaw ? (
            <pre className="code-block">{JSON.stringify(tools, null, 2)}</pre>
          ) : (
            <div className="tools-list">
              {tools.map((tool, i) => (
                <div key={i} className="tool-item">
                  <div className="tool-header">
                    <span className="tool-name">{tool.name}</span>
                  </div>
                  {tool.description && (
                    <div className="tool-description">{String(tool.description)}</div>
                  )}
                  {tool.input && Object.keys(tool.input as object).length > 0 ? (
                    <details className="tool-schema">
                      <summary>Schema</summary>
                      <pre className="code-block small">
                        {JSON.stringify(tool.input as object, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Model Output View - shows the complete model response message
interface ModelOutputViewProps {
  output: unknown;
  raw?: unknown;
}

function ModelOutputView({ output, raw }: ModelOutputViewProps) {
  const [viewMode, setViewMode] = useState<"formatted" | "message" | "raw">("formatted");
  const [expanded, setExpanded] = useState(false);

  // Parse the output message structure
  const message = output as { role?: string; content?: unknown[] } | null;
  if (!message) return null;

  const renderContentBlock = (block: Record<string, unknown>, index: number): React.ReactNode => {
    switch (block.type) {
      case "text":
        return (
          <div key={index} className="output-block text-block">
            <span className="block-type">text</span>
            <div className="block-content">{block.text as string}</div>
          </div>
        );
      case "reasoning":
        return (
          <div key={index} className="output-block reasoning-block">
            <span className="block-type">reasoning</span>
            <div className="block-content reasoning">{block.text as string}</div>
          </div>
        );
      case "tool-call":
      case "tool_use":
        return (
          <div key={index} className="output-block tool-call-block">
            <span className="block-type">tool_call</span>
            <div className="block-content">
              <span className="tool-name">{(block.toolName || block.name) as string}</span>
              <pre className="code-block small">{JSON.stringify(block.input, null, 2)}</pre>
            </div>
          </div>
        );
      default:
        return (
          <div key={index} className="output-block unknown-block">
            <span className="block-type">{block.type as string}</span>
            <pre className="code-block small">{JSON.stringify(block, null, 2)}</pre>
          </div>
        );
    }
  };

  const content = Array.isArray(message.content) ? message.content : [];

  const cycleViewMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMode === "formatted") setViewMode("message");
    else if (viewMode === "message") setViewMode(raw ? "raw" : "formatted");
    else setViewMode("formatted");
  };

  const viewModeLabel =
    viewMode === "formatted" ? "Formatted" : viewMode === "message" ? "Message" : "Raw";

  return (
    <div className="model-output-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Model Response ({content.length} blocks)
        </span>
        <span className="toggle-raw" onClick={cycleViewMode}>
          {viewModeLabel}
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          {viewMode === "formatted" ? (
            <div className="output-blocks">
              {content.map((block, i) => renderContentBlock(block as Record<string, unknown>, i))}
            </div>
          ) : viewMode === "message" ? (
            <pre className="code-block">{JSON.stringify(output, null, 2)}</pre>
          ) : (
            <pre className="code-block">{JSON.stringify(raw, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// Events View
interface EventsViewProps {
  events: TickEvent[];
}

function EventsView({ events }: EventsViewProps) {
  const [expanded, setExpanded] = useState(false);

  // Filter out content_delta events for the count (they're aggregated in output)
  const visibleEvents = events.filter((e) => e.type !== "content_delta");

  if (visibleEvents.length === 0) {
    return (
      <div className="events-section empty">
        <div className="section-header">
          <span className="section-title">Events (0)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="events-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Events ({visibleEvents.length})
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          {visibleEvents.map((event, i) => (
            <EventView key={i} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

// Streamed Output View
interface StreamedOutputViewProps {
  content: string;
}

function StreamedOutputView({ content }: StreamedOutputViewProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="output-section">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Streamed Output
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          <div className="output-content">{content}</div>
        </div>
      )}
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
}

function ExecutionTree({
  executions,
  selectedExecutionId,
  onSelectExecution,
  expandedExecutions,
  onToggleExpand,
  formatDuration,
  formatTokenDisplay,
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

  // Sort children by start time descending
  for (const children of childrenMap.values()) {
    children.sort((a, b) => b.startTime - a.startTime);
  }

  const renderExecution = (exec: Execution, depth: number): React.ReactNode => {
    const isSelected = exec.id === selectedExecutionId;
    const isExpanded = expandedExecutions.has(exec.id);
    const children = childrenMap.get(exec.id) || [];
    // Has expandable content: only child executions (forks/spawns)
    const hasExpandableContent = children.length > 0;

    return (
      <div key={exec.id} className="execution-node">
        <div
          className={`execution-item ${isSelected ? "selected" : ""} ${exec.isRunning ? "running" : ""}`}
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
            {exec.executionType && exec.executionType !== "root" && (
              <span className={`exec-type-badge ${exec.executionType}`}>{exec.executionType}</span>
            )}
            <span className="execution-name-text">{exec.agentName}</span>
          </div>
          {exec.model && (
            <div className="execution-model">
              <span className="model-badge">{exec.model}</span>
            </div>
          )}
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
