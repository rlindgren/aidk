# Simple Chat Example

A basic chat agent with streaming responses. Perfect starting point.

## Features

- Basic chat interface
- Streaming responses
- Message history with signals
- Simple tool integration

## Code

::: code-group

```tsx [agent.tsx]
import { Component, comState, ContextObjectModel, TickState } from 'aidk';
import { Timeline, Message, Section, H2, Paragraph } from 'aidk';
import { AiSdkModel } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

export class ChatAgent extends Component {
  private timeline = comState<any[]>('timeline', []);

  onTickStart(com: ContextObjectModel, state: TickState) {
    // Accumulate messages from model responses
    if (state.current?.timeline) {
      this.timeline.update(t => [...t, ...state.current.timeline]);
    }
  }

  render(com: ContextObjectModel, state: TickState) {
    return (
      <>
        <AiSdkModel
          model={openai('gpt-4o-mini')}
          temperature={0.7}
        />

        <Timeline>
          {this.timeline().map((entry, index) => (
            <Message
              key={index}
              role={entry.message?.role}
              content={entry.message?.content}
            />
          ))}
        </Timeline>

        <Section id="instructions" audience="model">
          <H2>Your Role</H2>
          <Paragraph>
            You are a friendly and helpful AI assistant.
            Be concise but informative.
          </Paragraph>
        </Section>
      </>
    );
  }
}
```

```tsx [server.ts]
import express from 'express';
import cors from 'cors';
import { createEngine } from 'aidk';
import { createSSEHandler } from 'aidk-express';
import { ChatAgent } from './agents/chat';

const app = express();

app.use(cors());
app.use(express.json());

const engine = createEngine();

app.post('/api/chat', createSSEHandler({
  engine,
  getAgent: () => <ChatAgent />,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

```tsx [App.tsx]
import { useState } from 'react';
import { useEngineClient, useExecution } from 'aidk-react';

export function App() {
  const [input, setInput] = useState('');
  const { client } = useEngineClient({ baseUrl: 'http://localhost:3000' });
  const { messages, send, isStreaming } = useExecution({
    client,
    endpoint: '/api/chat',
  });

  const handleSend = () => {
    if (input.trim()) {
      send({
        timeline: [{
          kind: 'message',
          message: {
            role: 'user',
            content: [{ type: 'text', text: input }],
          },
        }],
      });
      setInput('');
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <h1>Simple Chat</h1>

      <div style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 16,
        minHeight: 400,
        marginBottom: 16,
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <strong>{msg.role}:</strong>
            <div>{msg.content}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          disabled={isStreaming}
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={handleSend} disabled={isStreaming}>
          {isStreaming ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

:::

## Running

```bash
# Terminal 1: Backend
cd example
pnpm dev:backend

# Terminal 2: Frontend
cd example
pnpm dev:frontend
```

Visit `http://localhost:5173`

## Key Concepts

### Signal-based State

The timeline uses `comState` to persist across ticks:

```tsx
private timeline = comState<any[]>('timeline', []);

onTickStart(com, state) {
  // Append new entries
  if (state.current?.timeline) {
    this.timeline.update(t => [...t, ...state.current.timeline]);
  }
}
```

### SSE Streaming

The server uses Server-Sent Events for real-time streaming:

```tsx
createSSEHandler({
  engine,
  getAgent: () => <ChatAgent />,
})
```

Events stream to the client as they happen:

- `tick_start` - New tick begins
- `content_delta` - Text chunks
- `tool_call` - Tool invocations
- `tick_end` - Tick complete
- `complete` - Execution finished

### React Hook

The `useExecution` hook handles:

- Connection management
- Message accumulation
- Streaming state
- Error handling

```tsx
const { messages, send, isStreaming, error } = useExecution({
  client,
  endpoint: '/api/chat',
});
```

## Extending

### Add Tools

```tsx
import { createTool } from 'aidk';
import { z } from 'zod';

const weatherTool = createTool({
  name: 'get_weather',
  description: 'Get current weather',
  parameters: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => {
    const weather = await fetchWeather(location);
    return { weather };
  },
});

// In your agent
render() {
  return (
    <>
      {/* ... */}
      <Tool definition={weatherTool} />
    </>
  );
}
```

### Add Context

```tsx
app.post('/api/chat', createSSEHandler({
  engine,
  getAgent: () => <ChatAgent />,
  getContext: (req) => ({
    user: req.user,
    metadata: {
      sessionId: req.sessionID,
    },
  }),
}));
```

Access in your agent:

```tsx
import { Context } from 'aidk';

render() {
  const ctx = Context.get();
  return (
    <Section audience="model">
      <Paragraph>User: {ctx.user.name}</Paragraph>
    </Section>
  );
}
```

## Next Steps

- [Add tools](/examples/tools-mcp) - Tool integration
- [Real-time updates](/examples/realtime) - Channels
- [Multi-agent](/examples/multi-agent) - Coordination
