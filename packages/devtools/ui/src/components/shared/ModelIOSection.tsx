/**
 * ModelIOSection - Collapsible section for model request/response data
 * Shows a summary view with toggle to raw JSON
 */

import { useState } from "react";

interface ModelIOSectionProps {
  title: string;
  data: unknown;
}

export function ModelIOSection({ title, data }: ModelIOSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const summarize = (d: unknown): string => {
    if (!d) return "Empty";
    if (typeof d === "string") return d.slice(0, 100) + (d.length > 100 ? "..." : "");
    if (Array.isArray(d)) return `Array (${d.length} items)`;
    if (typeof d === "object") {
      const keys = Object.keys(d as object);
      return keys.slice(0, 3).join(", ") + (keys.length > 3 ? "..." : "");
    }
    return String(d);
  };

  return (
    <div className="info-card collapsible">
      <div className="info-card-header clickable" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
        <span>{title}</span>
        {!isExpanded && <span className="summary-preview">{summarize(data)}</span>}
        {isExpanded && (
          <button
            className="toggle-btn small"
            onClick={(e) => {
              e.stopPropagation();
              setShowRaw(!showRaw);
            }}
          >
            {showRaw ? "Summary" : "Raw JSON"}
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="info-card-body">
          {showRaw ? (
            <pre className="json-view">{JSON.stringify(data, null, 2)}</pre>
          ) : (
            <ModelDataSummary data={data} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Summarize model data (messages, content, etc.)
 */
function ModelDataSummary({ data }: { data: unknown }) {
  const d = data as Record<string, unknown>;

  // For model request (has messages, tools, system)
  if (d.input && typeof d.input === "object") {
    const input = d.input as Record<string, unknown>;
    return (
      <div className="data-summary">
        {input.system && (
          <div className="summary-row">
            <span className="summary-label">System</span>
            <span className="summary-value truncate">{String(input.system).slice(0, 150)}...</span>
          </div>
        )}
        {Array.isArray(input.messages) && (
          <div className="summary-row">
            <span className="summary-label">Messages</span>
            <span className="summary-value">{input.messages.length} messages</span>
          </div>
        )}
        {Array.isArray(input.tools) && (
          <div className="summary-row">
            <span className="summary-label">Tools</span>
            <span className="summary-value">{input.tools.length} available</span>
          </div>
        )}
      </div>
    );
  }

  // For model response (has content array)
  if (d.content && Array.isArray(d.content)) {
    const textBlocks = d.content.filter((b: any) => b.type === "text");
    const toolBlocks = d.content.filter((b: any) => b.type === "tool_use");

    return (
      <div className="data-summary">
        {textBlocks.length > 0 && (
          <div className="summary-row">
            <span className="summary-label">Text</span>
            <span className="summary-value">
              {(textBlocks[0] as any).text?.slice(0, 200)}
              {((textBlocks[0] as any).text?.length || 0) > 200 ? "..." : ""}
            </span>
          </div>
        )}
        {toolBlocks.length > 0 && (
          <div className="summary-row">
            <span className="summary-label">Tool Calls</span>
            <span className="summary-value">{toolBlocks.map((b: any) => b.name).join(", ")}</span>
          </div>
        )}
      </div>
    );
  }

  // Fallback: show keys
  return (
    <div className="data-summary">
      <div className="summary-row">
        <span className="summary-label">Keys</span>
        <span className="summary-value">{Object.keys(d).join(", ")}</span>
      </div>
    </div>
  );
}

export default ModelIOSection;
