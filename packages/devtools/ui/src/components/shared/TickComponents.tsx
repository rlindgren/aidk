/**
 * Shared components for tick views and model execution views
 *
 * These components provide consistent UI for displaying model context,
 * request/response data, stats, and other tick-related information.
 */

import { useState } from "react";
import { marked } from "marked";
import type { TokenUsage } from "../../hooks/useDevToolsEvents";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

// ============================================================================
// Section Group
// ============================================================================

interface SectionGroupProps {
  label: string;
  children: React.ReactNode;
}

export function SectionGroup({ label, children }: SectionGroupProps) {
  return (
    <div className="section-group">
      <div className="section-group__label">{label}</div>
      {children}
    </div>
  );
}

// ============================================================================
// Stats Grid
// ============================================================================

interface StatsGridProps {
  usage?: TokenUsage;
  toolCallCount?: number;
  messageCount?: number;
  eventCount?: number;
}

export function StatsGrid({
  usage,
  toolCallCount = 0,
  messageCount = 0,
  eventCount = 0,
}: StatsGridProps) {
  const hasCache = usage?.cachedInputTokens && usage.cachedInputTokens > 0;
  const hasReasoning = usage?.reasoningTokens && usage.reasoningTokens > 0;

  return (
    <div className="stats-grid">
      <div className="stat-box">
        <div className="stat-label">Tokens</div>
        <div className="stat-value">{usage?.totalTokens ?? 0}</div>
        <div className="stat-details">
          <span className="stat-detail">
            <span className="detail-label">in</span>
            <span className="detail-value">
              {usage?.inputTokens ?? 0}
              {hasCache && (
                <span className="cached-indicator" title={`${usage!.cachedInputTokens} cached`}>
                  *
                </span>
              )}
            </span>
          </span>
          <span className="stat-detail">
            <span className="detail-label">out</span>
            <span className="detail-value">
              {usage?.outputTokens ?? 0}
              {hasReasoning && (
                <span className="reasoning-indicator" title={`${usage!.reasoningTokens} reasoning`}>
                  †
                </span>
              )}
            </span>
          </span>
        </div>
        {(hasCache || hasReasoning) && (
          <div className="stat-details breakdown">
            {hasCache && (
              <span className="stat-detail cached">
                <span className="detail-value">{usage!.cachedInputTokens}</span>
                <span className="detail-label">cached</span>
              </span>
            )}
            {hasReasoning && (
              <span className="stat-detail reasoning">
                <span className="detail-value">{usage!.reasoningTokens}</span>
                <span className="detail-label">reasoning</span>
              </span>
            )}
          </div>
        )}
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

// ============================================================================
// Usage Display (compact and detailed)
// ============================================================================

interface UsageDisplayProps {
  usage?: TokenUsage;
  compact?: boolean;
}

export function UsageDisplay({ usage, compact }: UsageDisplayProps) {
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

// ============================================================================
// Model Request View (with AIDK/Provider toggle)
// ============================================================================

interface ModelRequestViewProps {
  modelRequest?: { input?: unknown };
  providerRequest?: { providerInput?: unknown; modelId?: string; provider?: string };
}

export function ModelRequestView({ modelRequest, providerRequest }: ModelRequestViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"aidk" | "provider">(
    providerRequest ? "provider" : "aidk",
  );

  const aidkInput = modelRequest?.input as Record<string, unknown> | undefined;
  const providerInput = providerRequest?.providerInput as Record<string, unknown> | undefined;
  const aidkMessages = Array.isArray(aidkInput?.messages) ? aidkInput.messages.length : 0;
  const providerMessages = Array.isArray(providerInput?.messages)
    ? providerInput.messages.length
    : 0;
  const messagesCount = providerMessages || aidkMessages;

  const hasAidk = !!modelRequest?.input;
  const hasProvider = !!providerRequest?.providerInput;
  const hasBoth = hasAidk && hasProvider;

  const cycleViewMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasBoth) {
      setViewMode(viewMode === "aidk" ? "provider" : "aidk");
    }
  };

  const viewModeLabel = viewMode === "aidk" ? "AIDK Format" : "Provider Format";

  return (
    <div className="section section--input">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Request
          {messagesCount > 0 && <span className="message-count">{messagesCount} messages</span>}
        </span>
        {hasBoth && (
          <span className="toggle-raw" onClick={cycleViewMode}>
            {viewModeLabel}
          </span>
        )}
      </div>
      {expanded && (
        <div className="section-content">
          {viewMode === "aidk" && hasAidk ? (
            <pre className="code-block">{JSON.stringify(modelRequest?.input, null, 2)}</pre>
          ) : hasProvider ? (
            <pre className="code-block">
              {JSON.stringify(providerRequest?.providerInput, null, 2)}
            </pre>
          ) : hasAidk ? (
            <pre className="code-block">{JSON.stringify(modelRequest?.input, null, 2)}</pre>
          ) : (
            <div className="empty-state-small">No request data available</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Model Response View (with AIDK/Provider toggle)
// ============================================================================

interface ModelResponseViewProps {
  output?: unknown;
  raw?: unknown;
}

export function ModelResponseView({ output, raw }: ModelResponseViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"aidk" | "provider">(raw ? "provider" : "aidk");

  const message = output as { role?: string; content?: unknown[] } | null;
  if (!message && !raw) return null;

  const content = Array.isArray(message?.content) ? message.content : [];
  const hasAidk = !!output;
  const hasProvider = !!raw;
  const hasBoth = hasAidk && hasProvider;

  const cycleViewMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasBoth) {
      setViewMode(viewMode === "aidk" ? "provider" : "aidk");
    }
  };

  const viewModeLabel = viewMode === "aidk" ? "AIDK Format" : "Provider Format";

  return (
    <div className="section section--output">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Response
          {content.length > 0 && <span className="message-count">{content.length} blocks</span>}
        </span>
        {hasBoth && (
          <span className="toggle-raw" onClick={cycleViewMode}>
            {viewModeLabel}
          </span>
        )}
      </div>
      {expanded && (
        <div className="section-content">
          {viewMode === "aidk" && hasAidk ? (
            <pre className="code-block">{JSON.stringify(output, null, 2)}</pre>
          ) : hasProvider ? (
            <pre className="code-block">{JSON.stringify(raw, null, 2)}</pre>
          ) : hasAidk ? (
            <pre className="code-block">{JSON.stringify(output, null, 2)}</pre>
          ) : (
            <div className="empty-state-small">No response data available</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// System Prompt View (with markdown rendering and XML detection)
// ============================================================================

interface SystemPromptViewProps {
  system: string | unknown;
}

export function SystemPromptView({ system }: SystemPromptViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Extract text from various system prompt formats
  const extractSystemText = (sys: unknown): string[] => {
    if (sys === null || sys === undefined) {
      return [];
    }
    if (typeof sys === "string") {
      // Try to parse JSON strings (common for nested structures)
      try {
        const parsed = JSON.parse(sys);
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

      // Unknown object format - stringify it
      return [JSON.stringify(obj, null, 2)];
    }
    return [String(sys)];
  };

  const textParts = extractSystemText(system);
  const hasNonTextContent =
    typeof system === "object" && JSON.stringify(system).includes('"type":"image"');

  // Detect if content looks like XML
  const isXmlLike = (text: string): boolean => {
    const trimmed = text.trim();
    return /<[a-zA-Z_][\w-]*[\s>]/.test(trimmed) || /<\/[a-zA-Z_][\w-]*>/.test(trimmed);
  };

  const renderTextPart = (text: string, index: number) => {
    if (isXmlLike(text)) {
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
    <div className="section section--context">
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

// ============================================================================
// Tools View
// ============================================================================

interface Tool {
  name: string;
  description?: string;
  input?: unknown;
}

interface ToolsViewProps {
  tools: Tool[];
}

export function ToolsView({ tools }: ToolsViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (tools.length === 0) {
    return (
      <div className="section section--context empty">
        <div className="section-header">
          <span className="section-title">Tools (0)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="section section--context">
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

// ============================================================================
// Messages View (with rich block rendering)
// ============================================================================

interface TimelineEntry {
  kind?: string;
  message?: { role: string; content: unknown };
  role?: string;
  content?: unknown;
}

interface MessagesViewProps {
  messages: TimelineEntry[];
}

export function MessagesView({ messages }: MessagesViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (messages.length === 0) {
    return (
      <div className="section section--context empty">
        <div className="section-header">
          <span className="section-title">Messages (0)</span>
        </div>
      </div>
    );
  }

  // Normalize timeline entries to messages
  const normalizeEntry = (entry: TimelineEntry): { role: string; content: unknown } | null => {
    if (entry.kind === "message" && entry.message) {
      return entry.message;
    }
    if (entry.role && entry.content !== undefined) {
      return { role: entry.role, content: entry.content };
    }
    if (entry.kind) {
      return { role: entry.kind, content: entry };
    }
    return null;
  };

  const normalizedMessages = messages.map(normalizeEntry).filter(Boolean) as {
    role: string;
    content: unknown;
  }[];

  return (
    <div className="section section--context">
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
            <div className="messages-list-v2">
              {normalizedMessages.map((msg, i) => (
                <MessageItem key={i} role={msg.role} content={msg.content} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Message Item (with rich block rendering)
// ============================================================================

interface MessageItemProps {
  role: string;
  content: unknown;
}

function MessageItem({ role, content }: MessageItemProps) {
  const [expanded, setExpanded] = useState(false);

  const renderContentBlock = (block: Record<string, unknown>, index: number): React.ReactNode => {
    const blockType = (block.type as string) || "unknown";

    const getBlockClass = () => {
      switch (blockType) {
        case "text":
          return "text-block";
        case "reasoning":
          return "reasoning-block";
        case "tool_use":
        case "tool-call":
          return "tool-call-block";
        case "tool_result":
          return "tool-result-block";
        case "image":
          return "image-block";
        default:
          return "unknown-block";
      }
    };

    const renderBlockContent = () => {
      switch (blockType) {
        case "text":
          return <div className="block-content">{block.text as string}</div>;
        case "reasoning":
          return <div className="block-content reasoning">{block.text as string}</div>;
        case "tool_use":
        case "tool-call":
          return (
            <div className="block-content">
              <span className="tool-name">{(block.toolName || block.name) as string}</span>
              <pre className="code-block small">{JSON.stringify(block.input, null, 2)}</pre>
            </div>
          );
        case "tool_result":
          return (
            <div className="block-content">
              <pre className="code-block small">{JSON.stringify(block.content, null, 2)}</pre>
            </div>
          );
        case "image":
          return <div className="block-content">[Image content]</div>;
        default:
          return <pre className="code-block small">{JSON.stringify(block, null, 2)}</pre>;
      }
    };

    return (
      <div key={index} className={`message-block ${getBlockClass()}`}>
        <span className="block-type">{blockType}</span>
        {renderBlockContent()}
      </div>
    );
  };

  const renderContent = (): React.ReactNode => {
    if (typeof content === "string") {
      return (
        <div className="message-block text-block">
          <span className="block-type">text</span>
          <div className="block-content">{content}</div>
        </div>
      );
    }
    if (Array.isArray(content)) {
      return content.map((block, i) => renderContentBlock(block as Record<string, unknown>, i));
    }
    return <pre className="code-block small">{JSON.stringify(content, null, 2)}</pre>;
  };

  return (
    <div className={`message-item-v2 role-${role}`}>
      <div className="message-role-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon small">{expanded ? "▼" : "▶"}</span>
        <span className={`role-badge ${role}`}>{role}</span>
      </div>
      <div className={`message-content-area ${expanded ? "expanded" : "collapsed"}`}>
        {renderContent()}
      </div>
    </div>
  );
}
