# Task Assistant Example

A full-stack task management app with an AI assistant. Demonstrates tools with state, real-time channels, and React integration.

## What You'll Build

- An agent that manages todo lists
- Tools that render context and sync in real-time
- A React frontend with live updates
- Express backend with SSE channels

## Project Structure

```
task-assistant/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   └── task-assistant.tsx
│   │   ├── tools/
│   │   │   └── todo-tool.tsx
│   │   ├── channels/
│   │   │   └── todo.channel.ts
│   │   └── index.ts
│   └── package.json
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Chat.tsx
    │   │   └── TodoList.tsx
    │   └── App.tsx
    └── package.json
```

## Backend

### Agent Definition

```tsx
// backend/src/agents/task-assistant.tsx
import {
  Component,
  Model,
  System,
  Timeline,
  Message,
  Context,
  comState,
} from "aidk";
import { aisdk } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";
import { TodoTool } from "../tools/todo-tool";
import type { COMTimelineEntry } from "aidk";

export class TaskAssistant extends Component {
  // Signal-based state that accumulates timeline entries
  private timeline = comState<COMTimelineEntry[]>("timeline", []);

  onTickStart(com, state) {
    // Accumulate entries from model responses
    if (state.current?.timeline) {
      this.timeline.update((t) => [...t, ...state.current.timeline]);
    }
  }

  render(com, state) {
    const ctx = Context.get();

    return (
      <>
        <Model model={aisdk({ model: openai("gpt-4o") })} />

        <System>
          You are a task assistant for {ctx.user.name}. Help them manage their
          todo list. You can: - Add new tasks - Mark tasks complete - List all
          tasks Be concise. Confirm actions you take.
        </System>

        <TodoTool />

        <Timeline>
          {this.timeline().map((entry) => (
            <Message key={entry.id} {...entry.message} />
          ))}
        </Timeline>
      </>
    );
  }
}
```

### Todo Tool

```tsx
// backend/src/tools/todo-tool.tsx
import { createTool, Context, Grounding, List, ListItem } from "aidk";
import { z } from "zod";
import { TodoService } from "../services/todo.service";
import { todoChannel } from "../channels/todo.channel";

// Tool with full lifecycle - handles execution AND renders context
export const TodoTool = createTool({
  name: "todo",
  description: "Manage the todo list. Actions: add, complete, list",
  input: z.object({
    action: z.enum(["add", "complete", "list"]),
    task: z.string().optional().describe("Task text for add"),
    taskId: z.string().optional().describe("Task ID for complete"),
  }),

  // Load initial state when tool mounts
  async onMount(com) {
    const ctx = Context.get();
    const tasks = await TodoService.list(ctx.user.id);
    com.setState("tasks", tasks);
  },

  // Execute when the model calls the tool
  handler: async (input) => {
    const ctx = Context.get();
    const userId = ctx.user.id;

    switch (input.action) {
      case "add": {
        const task = await TodoService.add(userId, input.task!);

        // Broadcast via channel router
        todoChannel
          .publisher()
          .to(userId)
          .broadcast({ type: "task_added", payload: task });

        return [{ type: "text", text: `Added task: ${task.text}` }];
      }

      case "complete": {
        const task = await TodoService.complete(userId, input.taskId!);

        todoChannel
          .publisher()
          .to(userId)
          .broadcast({ type: "task_completed", payload: { id: task.id } });

        return [{ type: "text", text: `Completed: ${task.text}` }];
      }

      case "list": {
        const tasks = await TodoService.list(userId);

        if (tasks.length === 0) {
          return [{ type: "text", text: "No tasks yet." }];
        }

        const list = tasks
          .map((t) => `${t.done ? "✓" : "○"} ${t.text}`)
          .join("\n");

        return [{ type: "text", text: list }];
      }
    }
  },

  // Render current state as context for the model
  render(com) {
    const tasks = com.getState("tasks") || [];

    if (tasks.length === 0) {
      return null;
    }

    return (
      <Grounding title="Current Tasks">
        <List>
          {tasks.map((task) => (
            <ListItem key={task.id}>
              [{task.done ? "x" : " "}] {task.text} (id: {task.id})
            </ListItem>
          ))}
        </List>
      </Grounding>
    );
  },
});
```

### Channel Router

```tsx
// backend/src/channels/todo.channel.ts
import { ChannelRouter } from "aidk";
import { TodoService } from "../services/todo.service";

export const todoChannel = new ChannelRouter<{
  userId: string;
}>("todo", {
  scope: { user: "userId" },
}).on("sync", async (event, ctx) => {
  const tasks = await TodoService.list(ctx.userId);
  return { type: "sync_response", payload: { tasks } };
});
```

### Server Setup

```tsx
// backend/src/index.ts
import express from "express";
import cors from "cors";
import { createEngine } from "aidk";
import { createExpressMiddleware } from "aidk-express";
import { StreamableHTTPTransport } from "aidk/channels/transports";
import { TaskAssistant } from "./agents/task-assistant";
import { todoChannel } from "./channels/todo.channel";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const transport = new StreamableHTTPTransport();

const engine = createEngine({
  channels: {
    transport,
    routers: [todoChannel],
  },
});

app.use(
  "/api/agent",
  createExpressMiddleware({
    engine,
    agent: TaskAssistant,
    context: (req) => ({
      user: {
        id: (req.headers["x-user-id"] as string) || "default",
        name: (req.headers["x-user-name"] as string) || "User",
      },
    }),
  }),
);

app.listen(3001, () => {
  console.log("Backend running on http://localhost:3001");
});
```

## Frontend

### App Setup

```tsx
// frontend/src/App.tsx
import { EngineProvider } from "aidk-react";
import { EngineClient } from "aidk-client";
import { Chat } from "./components/Chat";
import { TodoList } from "./components/TodoList";

const client = new EngineClient({
  baseUrl: "http://localhost:3001/api/agent",
  headers: () => ({
    "x-user-id": "user-1",
    "x-user-name": "Alice",
  }),
});

function App() {
  return (
    <EngineProvider client={client}>
      <div className="app">
        <aside>
          <TodoList />
        </aside>
        <main>
          <Chat />
        </main>
      </div>
    </EngineProvider>
  );
}

export default App;
```

### Chat Component

```tsx
// frontend/src/components/Chat.tsx
import { useState } from "react";
import {
  useExecution,
  useStreamingText,
  ContentBlockRenderer,
} from "aidk-react";

export function Chat() {
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
          <div className="message assistant streaming">
            {streamingText}
            <span className="cursor" />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your tasks..."
          disabled={isStreaming}
        />
        <button type="submit" disabled={isStreaming || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
```

### TodoList Component

```tsx
// frontend/src/components/TodoList.tsx
import { useState, useEffect } from "react";
import { useExecution } from "aidk-react";

type Task = {
  id: string;
  text: string;
  done: boolean;
};

export function TodoList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const { subscribe } = useExecution();

  useEffect(() => {
    // Subscribe to channel events from the execution stream
    const unsubscribe = subscribe((event) => {
      if (event.type === "channel" && event.channel === "todo") {
        const { type, payload } = event.payload;

        if (type === "task_added") {
          setTasks((prev) => [...prev, payload as Task]);
        }

        if (type === "task_completed") {
          setTasks((prev) =>
            prev.map((t) => (t.id === payload.id ? { ...t, done: true } : t)),
          );
        }
      }
    });

    return unsubscribe;
  }, [subscribe]);

  const pending = tasks.filter((t) => !t.done);
  const completed = tasks.filter((t) => t.done);

  return (
    <div className="todo-list">
      <h2>Tasks</h2>

      {pending.length > 0 && (
        <section>
          <h3>To Do</h3>
          <ul>
            {pending.map((task) => (
              <li key={task.id}>
                <span className="checkbox">○</span>
                {task.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h3>Done</h3>
          <ul className="completed">
            {completed.map((task) => (
              <li key={task.id}>
                <span className="checkbox">✓</span>
                {task.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tasks.length === 0 && (
        <p className="empty">No tasks yet. Ask the assistant to add some!</p>
      )}
    </div>
  );
}
```

## Running the Example

1. **Start the backend:**

```bash
cd backend
npm install
npm run dev
```

2. **Start the frontend:**

```bash
cd frontend
npm install
npm run dev
```

3. **Try it out:**

Open http://localhost:5173 and chat with the assistant:

- "Add a task to buy groceries"
- "Add another task to call mom"
- "What's on my list?"
- "Mark the groceries task as done"

Watch the sidebar update in real-time as tasks are added and completed.

## Key Concepts Demonstrated

### Tools with Full Lifecycle

The `TodoTool` uses `createTool` with `onMount` and `render` hooks. It loads initial state, handles execution, and renders context - all in one definition. Tools created with `createTool` are full components when used in JSX.

### Real-Time Channels

When the tool handler modifies data, it broadcasts via the `ChannelRouter`. The React frontend subscribes to execution events and updates immediately.

### COM State

Tools use `com.setState()`/`com.getState()` to manage state that persists across ticks. For class components, you can use `comState()` signals instead.

### User Context

The backend extracts user info from headers and makes it available via `Context.get()`. Both the agent and tools can access it.

## Next Steps

- Add task priorities and due dates
- Add multiple lists per user
- Add task sharing between users
- Persist data to a real database

See the full source in the [example directory](https://github.com/rlindgren/aidk/tree/master/example).
