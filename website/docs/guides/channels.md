# Real-time Channels

Channels enable bidirectional communication between your agent, server, and connected clients. When a tool updates state, all subscribers see the change instantly.

## The Problem

Your agent calls a tool that modifies data. The user is watching. How does the UI update?

- **Polling?** Wasteful, laggy.
- **Return it in the response?** Only works if the agent finishes.
- **WebSockets everywhere?** Complex to wire up.

AIDK channels solve this with a unified pub/sub layer that works across the stack.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Tool      │────▶│  Channel    │────▶│   React     │
│  (Backend)  │     │  (Server)   │     │  (Frontend) │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │   publish()       │   SSE/WS          │   on()
       └───────────────────┴───────────────────┘
```

## Publishing from Handlers

When your handler modifies state, publish the update via the ChannelRouter:

```tsx
import { ChannelRouter } from "aidk";

// Define the channel router with handlers
export const todoChannel = new ChannelRouter<{ userId: string }>("todo", {
  scope: { user: "userId" },
})
  .on("add_task", async (event, ctx) => {
    const task = await TodoService.add(ctx.userId, event.payload.text);
    return { success: true, task };
  })
  .on("complete_task", async (event, ctx) => {
    const task = await TodoService.complete(event.payload.id);
    return { success: true, task };
  });
```

The router is registered with the engine:

```tsx
import { createEngine } from "aidk";

const engine = createEngine({
  channels: {
    routers: [todoChannel],
  },
});
```

To publish events, use the router's publisher:

```tsx
// Get a publisher and broadcast to a user's room
todoChannel.publisher().scope("user").to(userId).broadcast({
  type: "task_added",
  payload: task,
});
```

## Subscribing in React

Use the `useExecution` hook to subscribe to channel events:

```tsx
import { useExecution } from "aidk-react";

function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const { subscribe } = useExecution();

  useEffect(() => {
    // Subscribe to channel events
    const unsubscribe = subscribe((event) => {
      if (event.type === "channel" && event.channel === "todo") {
        if (event.payload.type === "task_added") {
          setTasks((prev) => [...prev, event.payload.task]);
        }
        if (event.payload.type === "task_completed") {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.payload.id ? { ...t, done: true } : t,
            ),
          );
        }
      }
    });

    return unsubscribe;
  }, [subscribe]);

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

## Channel Routers (Backend)

The `ChannelRouter` is the recommended way to handle channel events:

```tsx
import { ChannelRouter } from "aidk";

export const todoChannel = new ChannelRouter<{
  userId: string;
  threadId: string;
}>("todo", {
  // Scope channels to user - derives room names from context
  scope: { user: "userId" },
})
  .on("request_sync", async (event, ctx) => {
    // Client requested a sync
    const tasks = await TodoService.getTasks(ctx.userId);
    return { tasks };
  })
  .on("create_task", async (event, ctx) => {
    const task = await TodoService.add(ctx.userId, event.payload.text);
    return { success: true, task };
  });
```

The router automatically:

- Derives room names from scope config (e.g., `user:alice`)
- Routes events to the appropriate handler
- Notifies registered execution contexts after handlers return

## Registering Channels with Express

```tsx
import { createExpressMiddleware } from "aidk-express";
import { StreamableHTTPTransport } from "aidk/channels/transports";

const transport = new StreamableHTTPTransport();

// Create engine with channels configured
const engine = createEngine({
  channels: {
    transport,
    routers: [todoChannel],
  },
});

// Mount the middleware
app.use(
  "/api/agent",
  createExpressMiddleware({
    engine,
    agent: TaskAgent,
  }),
);
```

## Connecting from the Client

```tsx
import { EngineClient } from "aidk-client";
import { EngineProvider } from "aidk-react";

const client = new EngineClient({
  baseUrl: "/api/agent",
});

function App() {
  return (
    <EngineProvider client={client}>
      <TaskList />
    </EngineProvider>
  );
}
```

## Scoping Channels

Scope configuration determines how room names are derived from context:

```tsx
// Single scope - derives room from userId field
const userScopedChannel = new ChannelRouter("notifications", {
  scope: { user: "userId" },
});
// Context { userId: "alice" } → room "user:alice"

// Multiple scopes - register for all, dedupe on notify
const multiScopedChannel = new ChannelRouter("collaboration", {
  scope: [{ user: "userId" }, { thread: "threadId" }],
});
// Context { userId: "alice", threadId: "123" } → rooms "user:alice", "thread:123"

// Function scope - for complex routing
const customChannel = new ChannelRouter("custom", {
  scope: (ctx) => `org:${ctx.orgId}:team:${ctx.teamId}`,
});
```

## Handling Events via HTTP

Channel events can be triggered via HTTP endpoints:

```tsx
// HTTP route handler
app.post("/api/channels/:channel", async (req, res) => {
  const { channel } = req.params;
  const { type, payload } = req.body;
  const userId = req.user.id;

  // Delegate to the registered router
  const result = await engine.channels?.handleEvent(
    channel,
    { type, payload },
    { userId },
  );

  res.json({ success: true, ...result });
});
```

The router matches the event type and invokes the appropriate handler.

## Best Practices

1. **Keep events small** - Send IDs and deltas, not full objects
2. **Scope appropriately** - Don't broadcast user-specific data globally
3. **Handle reconnection** - The client may disconnect; sync on reconnect
4. **Type your channels** - Use `defineChannel` for type safety

## Full Example

See the [Task Assistant example](/examples/task-assistant) for a complete implementation with real-time channels.
