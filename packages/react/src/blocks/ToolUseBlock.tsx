import type { ToolUseBlock as ToolUseBlockType } from "aidk-client";

interface Props {
  block: ToolUseBlockType;
  className?: string;
}

export function ToolUseBlock({ block, className }: Props) {
  const inputKeys = Object.keys(block.input || {});
  const inputSummary =
    inputKeys.length > 0
      ? `${inputKeys.length} field${inputKeys.length > 1 ? "s" : ""}`
      : "no input";

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 8px",
        backgroundColor: "#f0f0f0",
        borderRadius: "4px",
        fontSize: "0.875rem",
        color: "#555",
      }}
    >
      <span>🔧</span>
      <span style={{ fontWeight: 500 }}>{block.name}</span>
      <span style={{ color: "#888" }}>— {inputSummary}</span>
      {block.toolResult ? (
        <span style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>
          {block.toolResult.isError ? "❌" : "✅"}
        </span>
      ) : (
        <span style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>⏳</span>
      )}
    </div>
  );
}
