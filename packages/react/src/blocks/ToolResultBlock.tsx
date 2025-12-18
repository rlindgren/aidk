import type { ToolResultBlock as ToolResultBlockType } from 'aidk-client';

interface Props {
  block: ToolResultBlockType;
  className?: string;
}

export function ToolResultBlock({ block, className }: Props) {
  const statusIcon = block.is_error ? '❌' : '✅';
  const executedBy = block.executed_by ? ` (${block.executed_by})` : '';

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        backgroundColor: block.is_error ? '#fff0f0' : '#f0fff0',
        borderRadius: '4px',
        fontSize: '0.875rem',
        color: block.is_error ? '#c00' : '#080',
      }}
    >
      <span>{statusIcon}</span>
      <span>Tool result{executedBy}</span>
    </div>
  );
}

