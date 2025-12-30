import { useState } from "react";
import type { ReasoningBlock as ReasoningBlockType } from "aidk-client";
import { TextBlock } from "..";

interface Props {
  block: ReasoningBlockType;
  className?: string;
  defaultExpanded?: boolean;
}

export function ReasoningBlock({ block, className, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (block.isRedacted) {
    return (
      <div className={className} style={{ color: "#666", fontStyle: "italic" }}>
        [Reasoning redacted]
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          color: "#666",
          fontSize: "0.875rem",
        }}
      >
        <span
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 0.2s",
          }}
        >
          ▶
        </span>
        <span>Thinking...</span>
      </button>
      {expanded && (
        <div
          style={{
            marginTop: "8px",
            padding: "12px",
            backgroundColor: "rgba(0, 0, 0, 0.25)",
            borderRadius: "4px",
            fontSize: "0.875rem",
            color: "rgba(255, 255, 255, 0.42)",
          }}
        >
          <TextBlock block={block} />
        </div>
      )}
    </div>
  );
}
