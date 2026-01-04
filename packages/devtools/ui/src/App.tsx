import { useState } from "react";
import { marked } from "marked";
import {
  useDevToolsEvents,
  type Execution,
  type Tick,
  type TickEvent,
  type TokenUsage,
} from "./hooks/useDevToolsEvents";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

export function App() {
  const { executions, isConnected, clearExecutions } = useDevToolsEvents();
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [expandedTicks, setExpandedTicks] = useState<Set<number>>(new Set());

  const selectedExecution = executions.find((e) => e.id === selectedExecutionId);

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
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>
            <span className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
            AIDK DevTools
          </h1>
          {executions.length > 0 && (
            <button onClick={clearExecutions} className="clear-btn">
              Clear
            </button>
          )}
        </div>
        <div className="execution-list">
          {executions.length === 0 ? (
            <div className="empty-sidebar">No executions yet</div>
          ) : (
            executions.map((exec) => {
              const isChild = exec.executionType === "fork" || exec.executionType === "spawn";
              return (
                <div
                  key={exec.id}
                  className={`execution-item ${exec.id === selectedExecutionId ? "selected" : ""} ${exec.isRunning ? "running" : ""} ${isChild ? "child-execution" : ""}`}
                  onClick={() => setSelectedExecutionId(exec.id)}
                >
                  <div className="execution-name">
                    {isChild && <span className="indent-marker">↳ </span>}
                    {exec.executionType && exec.executionType !== "root" && (
                      <span className={`exec-type-badge ${exec.executionType}`}>
                        {exec.executionType}
                      </span>
                    )}
                    {exec.agentName}
                  </div>
                  <div className="execution-meta">
                    <span>{exec.ticks.length} ticks</span>
                    <span> · </span>
                    <span>{formatDuration(exec.startTime, exec.endTime)}</span>
                    <span> · </span>
                    <span>{formatTokenDisplay(exec)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="main">
        {!selectedExecution ? (
          <div className="empty-state">
            <h2>Select an execution</h2>
            <p>Choose an execution from the sidebar to view its timeline</p>
          </div>
        ) : (
          <>
            <div className="main-header">
              <h2>
                {selectedExecution.executionType && selectedExecution.executionType !== "root" && (
                  <span className={`exec-type-badge large ${selectedExecution.executionType}`}>
                    {selectedExecution.executionType}
                  </span>
                )}
                {selectedExecution.agentName}
              </h2>
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
            <div className="timeline">
              {selectedExecution.ticks.map((tick) => (
                <TickView
                  key={tick.number}
                  tick={tick}
                  isExpanded={expandedTicks.has(tick.number)}
                  onToggle={() => toggleTick(tick.number)}
                  formatDuration={formatDuration}
                />
              ))}
            </div>
          </>
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
}

function TickView({ tick, isExpanded, onToggle, formatDuration }: TickViewProps) {
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
          {tick.stopReason && (
            <span className="tick-stop-reason"> · {formatStopReason(tick.stopReason)}</span>
          )}
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

          {tick.compiled && (
            <div className="compiled-section">
              <h4>Compiled Context</h4>
              {tick.compiled.system && <SystemPromptView system={tick.compiled.system} />}
              <MessagesView messages={tick.compiled.messages} />
              <ToolsView tools={tick.compiled.tools} />
            </div>
          )}

          {tick.modelOutput && (
            <ModelOutputView output={tick.modelOutput} raw={tick.modelOutputRaw} />
          )}

          <EventsView events={tick.events} />

          {tick.content && <StreamedOutputView content={tick.content} />}
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
            {data.provider}/{data.modelId}
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
                  {tool.input && Object.keys(tool.input as object).length > 0 && (
                    <details className="tool-schema">
                      <summary>Schema</summary>
                      <pre className="code-block small">{JSON.stringify(tool.input, null, 2)}</pre>
                    </details>
                  )}
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
