# React Integration

Connect your React app to AIDK agents with hooks for streaming, state, and channels.

## Installation

```bash
npm install aidk-react aidk-client
```

## Setup

Wrap your app with `EngineProvider`:

```tsx
import { EngineProvider, createEngineClient } from "aidk-react";

const client = createEngineClient({
  baseUrl: "/api/agent",
});

function App() {
  return (
    <EngineProvider client={client}>
      <Chat />
    </EngineProvider>
  );
}
```

## useExecution

The main hook for interacting with agents:

```tsx
import { useExecution } from "aidk-react";

function Chat() {
  const {
    messages, // Message[] - conversation history
    isStreaming, // boolean - currently streaming?
    error, // Error | null
    sendMessage, // (content: string) => Promise<void>
    stop, // () => void - stop streaming
  } = useExecution();

  const handleSubmit = async (text: string) => {
    await sendMessage(text);
  };

  return (
    <div>
      <MessageList messages={messages} />
      {isStreaming && <LoadingIndicator />}
      <MessageInput onSubmit={handleSubmit} disabled={isStreaming} />
    </div>
  );
}
```

## Message Rendering

Use `ContentBlockRenderer` to render message content:

```tsx
import { ContentBlockRenderer } from "aidk-react";

function MessageList({ messages }) {
  return (
    <div className="messages">
      {messages.map((message) => (
        <div key={message.id} className={`message ${message.role}`}>
          {message.content.map((block, i) => (
            <ContentBlockRenderer key={i} block={block} />
          ))}
        </div>
      ))}
    </div>
  );
}
```

### Custom Block Renderers

Override how specific blocks render:

```tsx
<ContentBlockRenderer
  block={block}
  renderers={{
    text: ({ block }) => <p className="custom-text">{block.text}</p>,
    code: ({ block }) => (
      <SyntaxHighlighter language={block.language}>
        {block.text}
      </SyntaxHighlighter>
    ),
    tool_use: ({ block }) => (
      <div className="tool-call">Calling {block.name}...</div>
    ),
  }}
/>
```

## Streaming Text

For real-time text display during streaming:

```tsx
import { useExecution, useStreamingText } from "aidk-react";

function Chat() {
  const { messages, isStreaming, sendMessage } = useExecution();
  const streamingText = useStreamingText();

  return (
    <div>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}

      {isStreaming && streamingText && (
        <div className="message assistant streaming">
          {streamingText}
          <Cursor />
        </div>
      )}
    </div>
  );
}
```

## Channels

Subscribe to real-time updates from tools:

```tsx
import { useChannel } from "aidk-react";
import { defineChannel } from "aidk-client";

// Define the channel's type
const TodoChannel = defineChannel<
  | { type: "task_added"; payload: Task }
  | { type: "task_completed"; payload: { id: string } },
  { type: "sync" }
>("todo");

function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const channel = useChannel(TodoChannel);

  useEffect(() => {
    // Request initial sync
    channel.send("sync");

    // Subscribe to updates
    const unsub1 = channel.on("task_added", (task) => {
      setTasks((prev) => [...prev, task]);
    });

    const unsub2 = channel.on("task_completed", ({ id }) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, done: true } : t)),
      );
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [channel]);

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id} className={task.done ? "done" : ""}>
          {task.text}
        </li>
      ))}
    </ul>
  );
}
```

## Client Configuration

### With Channels

```tsx
import { createEngineClient } from "aidk-client";
import { SSETransport } from "aidk-client/transports";

const client = createEngineClient({
  baseUrl: "/api/agent",
  channels: {
    transport: new SSETransport("/api/channels"),
  },
});
```

### With Authentication

```tsx
const client = createEngineClient({
  baseUrl: "/api/agent",
  headers: () => ({
    Authorization: `Bearer ${getAccessToken()}`,
  }),
});
```

### With Custom Fetch

```tsx
const client = createEngineClient({
  baseUrl: "/api/agent",
  fetch: async (url, options) => {
    // Add request tracking, retries, etc.
    return fetch(url, options);
  },
});
```

## Tool Confirmations

When tools require user confirmation:

```tsx
import { useToolConfirmation } from "aidk-react";

function Chat() {
  const { pendingConfirmation, confirm, deny } = useToolConfirmation();

  return (
    <div>
      <MessageList />

      {pendingConfirmation && (
        <ConfirmationDialog
          tool={pendingConfirmation.toolName}
          input={pendingConfirmation.input}
          message={pendingConfirmation.confirmationMessage}
          onConfirm={() => confirm(pendingConfirmation.toolUseId)}
          onDeny={() => deny(pendingConfirmation.toolUseId)}
        />
      )}
    </div>
  );
}
```

## Error Handling

```tsx
function Chat() {
  const { error, sendMessage, retry } = useExecution();

  if (error) {
    return (
      <div className="error">
        <p>Something went wrong: {error.message}</p>
        <button onClick={retry}>Retry</button>
      </div>
    );
  }

  return <ChatUI />;
}
```

## Multiple Conversations

Use multiple execution contexts:

```tsx
function MultiChat() {
  const [activeThread, setActiveThread] = useState("thread-1");

  return (
    <div className="multi-chat">
      <ThreadList active={activeThread} onSelect={setActiveThread} />

      {/* Each thread gets its own execution context */}
      <EngineProvider
        key={activeThread}
        client={client}
        executionId={activeThread}
      >
        <Chat />
      </EngineProvider>
    </div>
  );
}
```

## Hooks Reference

| Hook                    | Purpose                           |
| ----------------------- | --------------------------------- |
| `useExecution()`        | Main execution state and controls |
| `useStreamingText()`    | Current streaming text            |
| `useChannel(channel)`   | Subscribe to a channel            |
| `useToolConfirmation()` | Handle tool confirmations         |
| `useEngineClient()`     | Access the client directly        |

## Full Example

```tsx
import React, { useState, useEffect } from "react";
import {
  EngineProvider,
  createEngineClient,
  useExecution,
  useStreamingText,
  useChannel,
  ContentBlockRenderer,
} from "aidk-react";
import { defineChannel } from "aidk-client";
import { SSETransport } from "aidk-client/transports";

// Setup client
const client = createEngineClient({
  baseUrl: "/api/agent",
  channels: {
    transport: new SSETransport("/api/channels"),
  },
});

// Define channel
const NotificationChannel = defineChannel<{
  type: "notification";
  payload: { message: string };
}>("notifications");

function Chat() {
  const { messages, isStreaming, sendMessage } = useExecution();
  const streamingText = useStreamingText();
  const [input, setInput] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const message = input;
    setInput("");
    await sendMessage(message);
  };

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            {msg.content.map((block, i) => (
              <ContentBlockRenderer key={i} block={block} />
            ))}
          </div>
        ))}

        {isStreaming && streamingText && (
          <div className="message assistant streaming">{streamingText}</div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
        />
        <button type="submit" disabled={isStreaming || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function Notifications() {
  const [notifications, setNotifications] = useState<string[]>([]);
  const channel = useChannel(NotificationChannel);

  useEffect(() => {
    return channel.on("notification", ({ message }) => {
      setNotifications((prev) => [...prev, message]);
    });
  }, [channel]);

  return (
    <div className="notifications">
      {notifications.map((msg, i) => (
        <div key={i} className="notification">
          {msg}
        </div>
      ))}
    </div>
  );
}

function App() {
  return (
    <EngineProvider client={client}>
      <div className="app">
        <Notifications />
        <Chat />
      </div>
    </EngineProvider>
  );
}

export default App;
```

## Styling

AIDK provides optional CSS for common patterns:

```tsx
import "aidk-react/styles.css";
```

Or style components yourself - all components accept `className` props.

## Next Steps

- [Express Integration](/docs/frameworks/express) - Set up the backend
- [Real-time Channels](/docs/guides/channels) - Add real-time features
- [Task Assistant Example](/examples/task-assistant) - Full working example
