import type { ToolResultBlock as ToolResultBlockType } from 'aidk-client';

interface Props {
  block: ToolResultBlockType;
  className?: string;
}

export function ToolResultBlock({ block, className }: Props) {
  const statusIcon = block.isError ? '❌' : '✅';
  const executedBy = block.executedBy ? ` (${block.executedBy})` : '';

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        backgroundColor: block.isError ? '#fff0f0' : '#f0fff0',
        borderRadius: '4px',
        fontSize: '0.875rem',
        color: block.isError ? '#c00' : '#080',
      }}
    >
      <span>{statusIcon}</span>
      <span>Tool result{executedBy}</span>
    </div>
  );
}

