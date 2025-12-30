import { CodeLanguage, type ContentBlock } from "aidk-client";
import { TextBlock } from "./TextBlock.js";
import { ReasoningBlock } from "./ReasoningBlock.js";
import { ToolUseBlock } from "./ToolUseBlock.js";
import { ToolResultBlock } from "./ToolResultBlock.js";
import { ImageBlock } from "./ImageBlock.js";
import { CodeBlock } from "./CodeBlock.js";
import { PlaceholderBlock } from "./PlaceholderBlock.js";

export interface ContentBlockRendererProps {
  block: ContentBlock;
  className?: string;
}

/**
 * Renders a single content block based on its type
 */
export function ContentBlockRenderer({ block, className }: ContentBlockRendererProps) {
  switch (block.type) {
    case "text":
      return <TextBlock block={block} className={className} />;

    case "reasoning":
      return <ReasoningBlock block={block} className={className} />;

    case "tool_use":
      return <ToolUseBlock block={block} className={className} />;

    case "tool_result":
      return <ToolResultBlock block={block} className={className} />;

    case "image":
    case "generated_image":
      // Handle generated_image same as image
      return <ImageBlock block={block} className={className} />;

    case "code":
      return <CodeBlock block={block} className={className} />;

    case "json":
      // Render JSON as code block
      return (
        <CodeBlock
          block={{ ...block, type: "code", language: CodeLanguage.JSON }}
          className={className}
        />
      );

    case "executable_code":
      return (
        <CodeBlock
          block={{
            ...block,
            type: "code",
            text: block.code,
            language: (block.language as CodeLanguage) || "code",
          }}
          className={className}
        />
      );

    case "code_execution_result":
      return (
        <div className={className}>
          <div
            style={{
              fontSize: "0.75rem",
              color: block.isError ? "#c00" : "#666",
              marginBottom: "4px",
            }}
          >
            {block.isError ? "❌ Execution Error" : "✅ Output"}
          </div>
          <pre
            style={{
              backgroundColor: "#1e1e1e",
              color: block.isError ? "#f88" : "#d4d4d4",
              padding: "12px",
              borderRadius: "4px",
              overflow: "auto",
              fontSize: "0.875rem",
              margin: 0,
            }}
          >
            {block.output}
          </pre>
        </div>
      );

    default:
      return <PlaceholderBlock block={block} className={className} />;
  }
}
