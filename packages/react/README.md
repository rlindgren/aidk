# aidk-react

React hooks and components for AIDK.

## Installation

```bash
pnpm add aidk-react aidk-client react
```

## Usage

```tsx
import { useEngineClient, useExecution } from 'aidk-react';

function Chat() {
  const { client, isConnected } = useEngineClient({
    baseUrl: 'http://localhost:3000',
    userId: 'user-123',
  });

  const {
    messages,
    send,
    isStreaming,
    error
  } = useExecution({
    client,
    agentId: 'assistant',
  });

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i} className={msg.role}>
          {msg.content.map((block, j) => (
            <ContentBlock key={j} block={block} />
          ))}
        </div>
      ))}

      <input
        disabled={isStreaming}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            send(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
    </div>
  );
}
```

## Key Exports

### Hooks

- `useEngineClient()` - Manage client connection
- `useExecution()` - Execute agents with streaming

### Components

- `ContentBlockRenderer` - Render content blocks
- `TextBlock` - Text content
- `ToolUseBlock` - Tool call display
- `ToolResultBlock` - Tool result display

## Documentation

See the [full documentation](https://rlindgren.github.io/aidk).
