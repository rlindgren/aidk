import type { ContentBlock } from 'aidk-client';

interface Props {
  block: ContentBlock;
  className?: string;
}

export function PlaceholderBlock({ block, className }: Props) {
  return (
    <div
      className={className}
      style={{
        padding: '8px 12px',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        fontSize: '0.875rem',
        color: '#666',
        fontStyle: 'italic',
      }}
    >
      [{block.type} block]
    </div>
  );
}

