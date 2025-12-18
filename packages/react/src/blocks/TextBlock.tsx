import { marked } from 'marked';
import type { TextBlock as TextBlockType, ReasoningBlock as ReasoningBlockType } from 'aidk-client';

interface Props {
  block: TextBlockType | ReasoningBlockType;
  className?: string;
}

/**
 * TextBlock component - renders markdown text content.
 * 
 * This is a style-less component. To add styling, either:
 * 1. Import the provided CSS: `import 'aidk-react/dist/markdown.css'`
 * 2. Add your own styles targeting `.aidk-markdown` class
 * 3. Pass a className prop to override styles
 */
export function TextBlock({ block, className }: Props) {
  const html = marked(block.text, {
    breaks: true,
    gfm: true,
  });

  return (
    <div 
      className={`aidk-markdown ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

