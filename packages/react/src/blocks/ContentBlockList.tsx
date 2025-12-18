import type { ContentBlock } from 'aidk-client';
import { ContentBlockRenderer } from './ContentBlockRenderer.js';

export interface ContentBlockListProps {
  blocks: ContentBlock[];
  className?: string;
  blockClassName?: string;
  gap?: string | number;
}

/**
 * Renders a list of content blocks
 */
export function ContentBlockList({ 
  blocks, 
  className, 
  blockClassName,
  gap = '8px' 
}: ContentBlockListProps) {
  return (
    <div 
      className={className} 
      style={{ display: 'flex', flexDirection: 'column', gap }}
    >
      {blocks.map((block, index) => (
        <ContentBlockRenderer 
          key={block.id || index} 
          block={block} 
          className={blockClassName}
        />
      ))}
    </div>
  );
}

