import type {
  TextBlock as TextBlockType,
  ReasoningBlock as ReasoningBlockType,
} from "aidk-client";
import type { ReactNode } from "react";

interface Props {
  block: TextBlockType | ReasoningBlockType;
  className?: string;
  /**
   * Custom render function for the text content.
   * If not provided, renders plain text.
   *
   * @example Markdown rendering with react-markdown
   * ```tsx
   * import ReactMarkdown from 'react-markdown';
   *
   * <TextBlock
   *   block={block}
   *   renderText={(text) => <ReactMarkdown>{text}</ReactMarkdown>}
   * />
   * ```
   *
   * @example Markdown with sanitization
   * ```tsx
   * import { marked } from 'marked';
   * import DOMPurify from 'dompurify';
   *
   * <TextBlock
   *   block={block}
   *   renderText={(text) => (
   *     <div dangerouslySetInnerHTML={{
   *       __html: DOMPurify.sanitize(marked(text))
   *     }} />
   *   )}
   * />
   * ```
   */
  renderText?: (text: string) => ReactNode;
  /**
   * Content to render instead of using renderText.
   * Useful for pre-rendered markdown or custom content.
   */
  children?: ReactNode;
}

/**
 * TextBlock component - displays text content from AI responses.
 *
 * By default, renders plain text. For markdown rendering, provide a `renderText`
 * function or `children`. This decoupled approach gives you control over:
 * - Which markdown library to use (react-markdown, marked, etc.)
 * - Sanitization (DOMPurify, etc.)
 * - Custom styling and components
 *
 * @example Plain text (default)
 * ```tsx
 * <TextBlock block={block} />
 * ```
 *
 * @example With react-markdown
 * ```tsx
 * <TextBlock
 *   block={block}
 *   renderText={(text) => <ReactMarkdown>{text}</ReactMarkdown>}
 * />
 * ```
 *
 * @example With children
 * ```tsx
 * <TextBlock block={block}>
 *   <MyCustomMarkdown text={block.text} />
 * </TextBlock>
 * ```
 */
export function TextBlock({ block, className, renderText, children }: Props) {
  // If children provided, use them directly
  if (children) {
    return <div className={className}>{children}</div>;
  }

  // If renderText provided, use it
  if (renderText) {
    return <div className={className}>{renderText(block.text)}</div>;
  }

  // Default: plain text
  return <div className={className}>{block.text}</div>;
}
