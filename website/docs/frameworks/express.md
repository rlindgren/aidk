# Express Integration

Add AIDK agents to your Express app with streaming, channels, and middleware.

## Installation

```bash
npm install aidk aidk-express aidk-ai-sdk ai @ai-sdk/openai
```

## Basic Setup

``` tsx
import express from "express";
import { createEngine } from "aidk";
import { createExpressMiddleware } from "aidk-express";
import { aisdk } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";

const app = express();
app.use(express.json());

// Create the engine
const engine = createEngine({
  model: aisdk({ model: openai("gpt-4o") }),
});

// Mount the middleware
app.use(
  "/api/chat",
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
  }),
);

app.listen(3000);
```

## The Middleware

`createExpressMiddleware` creates routes for:

| Route          | Method | Purpose                              |
| -------------- | ------ | ------------------------------------ |
| `/`            | POST   | Execute agent, return result         |
| `/stream`      | POST   | Execute agent, stream response (SSE) |
| `/tool-result` | POST   | Submit client tool results           |

### POST /

Execute the agent and return the final result:

``` tsx
// Request
POST /api/chat
{
  "input": {
    "timeline": [
      { "role": "user", "content": [{ "type": "text", "text": "Hello!" }] }
    ]
  }
}

// Response
{
  "success": true,
  "data": {
    "messages": [...],
    "stopReason": "stop",
    "usage": { "inputTokens": 10, "outputTokens": 50 }
  }
}
```

### POST /stream

Stream the response using Server-Sent Events:

``` tsx
// Request
POST /api/chat/stream
{
  "input": {
    "timeline": [
      { "role": "user", "content": [{ "type": "text", "text": "Hello!" }] }
    ]
  }
}

// Response (SSE)
data: {"type":"message_start","id":"msg_123"}

data: {"type":"content_delta","delta":"Hello"}

data: {"type":"content_delta","delta":"!"}

data: {"type":"message_end","stopReason":"stop"}
```

## Context Extraction

Extract user info, thread IDs, etc. from the request:

``` tsx
app.use(
  "/api/chat",
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
    context: (req) => ({
      user: {
        id: req.headers["x-user-id"] as string,
        name: req.headers["x-user-name"] as string,
      },
      metadata: {
        threadId: req.body.threadId,
        sessionId: req.cookies.sessionId,
      },
    }),
  }),
);
```

Access this in your agent:

```tsx
class ChatAgent extends Component {
  render() {
    const ctx = context();

    return (
      <>
        <System>You are helping {ctx.user.name}.</System>
        <Timeline messages={state.timeline} />
      </>
    );
  }
}
```

## Real-time Channels

Enable bidirectional communication:

``` tsx
import { createExpressMiddleware, SSETransport } from "aidk-express";
import { ChannelRouter } from "aidk";

// Create transport
const transport = new SSETransport();

// Define channel routers
const todoChannel = new ChannelRouter("todo", {
  scope: { user: "userId" },
}).on("sync", async (event, ctx) => {
  const tasks = await TodoService.getTasks(ctx.userId);
  return { type: "sync_response", payload: { tasks } };
});

// Mount middleware with channels
app.use(
  "/api/chat",
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
    channels: {
      transport,
      routers: [todoChannel],
    },
  }),
);

// SSE endpoint for channel subscriptions
app.get("/api/channels", transport.handler());
```

### Client Connection

``` tsx
import { createEngineClient } from "aidk-client";
import { SSETransport } from "aidk-client/transports";

const client = createEngineClient({
  baseUrl: "/api/chat",
  channels: {
    transport: new SSETransport("/api/channels"),
  },
});
```

## Authentication Middleware

Add authentication before the AIDK middleware:

``` tsx
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

app.use(
  "/api/chat",
  requireAuth,
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
    context: (req) => ({
      user: req.user,
    }),
  }),
);
```

## Error Handling

Errors are automatically caught and returned:

``` tsx
// If an error occurs during execution
{
  "success": false,
  "error": {
    "code": "VALIDATION_REQUIRED",
    "message": "Input is required",
    "details": { "field": "timeline" }
  }
}
```

Custom error handling:

``` tsx
app.use(
  "/api/chat",
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
    onError: (error, req, res) => {
      console.error("Agent error:", error);

      // Custom error response
      res.status(500).json({
        error: "Something went wrong",
        requestId: req.headers["x-request-id"],
      });
    },
  }),
);
```

## Multiple Agents

Mount different agents at different paths:

``` tsx
app.use(
  "/api/chat",
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
  }),
);

app.use(
  "/api/support",
  createExpressMiddleware({
    engine,
    agent: SupportAgent,
    context: (req) => ({
      metadata: { department: "support" },
    }),
  }),
);

app.use(
  "/api/sales",
  createExpressMiddleware({
    engine,
    agent: SalesAgent,
    context: (req) => ({
      metadata: { department: "sales" },
    }),
  }),
);
```

## Client Tool Results

When tools execute on the client, they post results back:

``` tsx
// Client calls this after executing a client tool
POST /api/chat/tool-result
{
  "executionId": "exec_123",
  "toolUseId": "tool_456",
  "result": {
    "success": true,
    "content": [{ "type": "text", "text": "User confirmed" }]
  }
}
```

This is handled automatically by `aidk-client` and `aidk-react`.

## CORS Configuration

For cross-origin requests:

``` tsx
import cors from "cors";

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

app.use(
  "/api/chat",
  createExpressMiddleware({
    engine,
    agent: ChatAgent,
  }),
);
```

## Full Example

``` tsx
import express from 'express';
import cors from 'cors';
import { createEngine, Component, System, Timeline, createTool } from 'aidk';
import { createExpressMiddleware, SSETransport } from 'aidk-express';
import { aisdk } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// Define a tool
const Echo = createTool({
  name: 'echo',
  description: 'Echo back a message',
  parameters: z.object({ message: z.string() }),
  handler: async ({ message }) => [{ type: 'text', text: message }],
});

// Define the agent
class EchoAgent extends Component {
  render(com, state) {
    const ctx = context();

    return (
      <>
        <Model model={aisdk({ model: openai('gpt-4o') })} />
        <System>
          You are a helpful assistant for {ctx.user?.name || 'anonymous'}.
          You can use the echo tool to repeat messages.
        </System>
        <Echo />
        <Timeline messages={state.timeline} />
      </>
    );
  }
}

// Create app
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Create engine
const engine = createEngine();
const transport = new SSETransport();

// Mount middleware
app.use('/api/agent', createExpressMiddleware({
  engine,
  agent: EchoAgent,
  channels: { transport, routers: [] },
  context: (req) => ({
    user: {
      id: req.headers['x-user-id'] as string || 'anonymous',
      name: req.headers['x-user-name'] as string || 'Anonymous User',
    },
  }),
}));

// Channel endpoint
app.get('/api/channels', transport.handler());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

## Next Steps

- [React Integration](/docs/frameworks/react) - Connect your React frontend
- [Real-time Channels](/docs/guides/channels) - Add real-time updates
- [Creating Tools](/docs/guides/tools) - Build tools with lifecycle hooks
