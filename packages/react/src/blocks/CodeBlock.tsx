import type { CodeBlock as CodeBlockType } from "aidk-client";

interface Props {
  block: CodeBlockType;
  className?: string;
}

export function CodeBlock({ block, className }: Props) {
  return (
    <div className={className}>
      {block.language && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "#666",
            marginBottom: "4px",
            fontFamily: "monospace",
          }}
        >
          {block.language}
        </div>
      )}
      <pre
        style={{
          backgroundColor: "#1e1e1e",
          color: "#d4d4d4",
          padding: "12px",
          borderRadius: "4px",
          overflow: "auto",
          fontSize: "0.875rem",
          margin: 0,
        }}
      >
        <code>{block.text}</code>
      </pre>
    </div>
  );
}
