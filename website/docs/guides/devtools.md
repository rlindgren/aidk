# DevTools

AIDK DevTools provides a real-time browser UI for visualizing and debugging agent execution. It streams execution events via SSE, letting you inspect each tick, tool call, and model response as they happen.

## Installation

```bash
pnpm add aidk-devtools
```

## Quick Start

### Option 1: Engine Config (Recommended)

Enable devtools directly in your engine configuration:

```typescript
import { createEngine } from 'aidk';
import { initDevTools } from 'aidk-devtools';

// Initialize devtools server
initDevTools({ port: 3004, open: true });

// Enable devtools on the engine
const engine = createEngine({
  devTools: true,  // Events are automatically emitted
});
```

This approach automatically captures all events including fork/spawn executions.

### Option 2: Attach to Engine

Attach devtools to an existing engine:

```typescript
import { createEngine } from 'aidk';
import { attachDevTools } from 'aidk-devtools/integration';

const engine = createEngine();

// Attach devtools - starts server and opens browser
const detach = attachDevTools({
  instance: engine, // Engine to attach to
  port: 3004,       // Server port (default: 3004)
  open: true,       // Auto-open browser (default: true)
  debug: false,     // Enable debug logging
});

// Your agent code...

// Later, to stop devtools:
detach();
```

## Environment Variables

Configure devtools via environment variables for easy toggling:

```bash
DEVTOOLS=true           # Enable devtools
DEVTOOLS_PORT=3004      # Server port
DEVTOOLS_OPEN=false     # Disable auto-open browser
DEVTOOLS_DEBUG=true     # Enable debug logging
```

Example setup with environment variables:

```typescript
import { createEngine } from 'aidk';
import { attachDevTools } from 'aidk-devtools/integration';

const engine = createEngine();

if (process.env.DEVTOOLS === 'true') {
  attachDevTools({
    instance: engine,
    port: +(process.env.DEVTOOLS_PORT || 3004),
    open: process.env.DEVTOOLS_OPEN !== 'false',
    debug: process.env.DEVTOOLS_DEBUG === 'true',
  });
}
```

## UI Overview

The devtools UI is organized into two main areas:

### Sidebar - Execution List

Shows all agent executions with:

- Agent name and execution type badge (engine, model, tool, fork, spawn)
- Tick count and total duration
- Procedure count per execution
- Token usage (with aggregate totals for parents)
- Running/completed status

Executions are displayed hierarchically: parent executions appear first, with their forked/spawned children indented below. Click an execution to view its details.

### Main Panel - Execution Details

Each execution shows a tick-by-tick breakdown:

#### Stats Grid

At the top of each tick, a stats grid shows:

- **Tokens** - Total token usage (with input/output/cached breakdown)
- **Tool Calls** - Number of tool calls made
- **Messages** - Number of messages in context
- **Events** - Number of events (excluding content deltas)

#### Compiled Context

Expandable sections showing what was sent to the model:

- **System Prompt** - With markdown/XML rendering toggle
- **Messages** - Conversation history with role badges
- **Tools** - Available tool definitions

#### Model Response

The model's output with three view modes:

- **Formatted** - Rendered content blocks (text, reasoning, tool calls)
- **Message** - Raw message JSON
- **Raw** - Raw provider response (all stream events)

#### Events

A timeline of events within the tick:

- Tool calls with inputs
- Tool results
- State changes

#### Procedures

An expandable tree showing all kernel-level procedure calls within the execution:

- **Engine procedures** - `engine:stream`, `engine:execute`
- **Model calls** - `model:generate`, `model:stream`
- **Tool handlers** - Individual tool executions
- **Component lifecycle** - `render`, `onMount`, `onUnmount` hooks

Each procedure shows its name, component context (if applicable), and duration. Click a procedure name to see full details including parent/child relationships, metrics, metadata, and error stack traces.

The first two levels of the tree are auto-expanded for easy navigation.

### Header

Shows connection status and provides a "Clear All" button to reset.

## Two Modes: Embedded vs Remote

DevTools can run in two modes:

| Mode         | Use Case                          | How It Works                                   |
| ------------ | --------------------------------- | ---------------------------------------------- |
| **Embedded** | Single process, quick setup       | Server runs inside your app process            |
| **Remote**   | Multiple processes, persistent UI | Standalone CLI server receives events via HTTP |

### Embedded Mode (Default)

The DevTools server runs inside your application. Simple setup, but the UI resets when your app restarts.

```typescript
import { createEngine } from 'aidk';
import { attachDevTools } from 'aidk-devtools';

const engine = createEngine({ devTools: true });
attachDevTools({ instance: engine, port: 3004, open: true });
```

### Remote Mode (CLI)

Run DevTools as a standalone server. Your app sends events to it via HTTP POST. The UI persists across app restarts.

**Step 1: Start the CLI server**

```bash
# Terminal 1
npx aidk-devtools --port 3004 --open
```

**Step 2: Configure your app to send events to the CLI**

```typescript
// Terminal 2 - Your application
const engine = createEngine({
  devTools: {
    remote: true,
    remoteUrl: 'http://localhost:3004',
  },
});
```

Or use environment variables:

```bash
# Terminal 2
DEVTOOLS=true DEVTOOLS_REMOTE=true DEVTOOLS_PORT=3004 node app.js
```

With this setup in your app:

```typescript
const devToolsEnabled = process.env.DEVTOOLS === 'true';
const devToolsRemote = process.env.DEVTOOLS_REMOTE === 'true';
const devToolsPort = +(process.env.DEVTOOLS_PORT || 3004);

const engine = createEngine({
  devTools: devToolsEnabled ? {
    remote: devToolsRemote,
    remoteUrl: devToolsRemote ? `http://localhost:${devToolsPort}` : undefined,
  } : undefined,
});

// Only attach embedded server if NOT in remote mode
if (devToolsEnabled && !devToolsRemote) {
  attachDevTools({ instance: engine, port: devToolsPort, open: true });
}
```

## CLI Reference

```bash
npx aidk-devtools [options]
```

### CLI Options

| Option         | Description                          | Default   |
| -------------- | ------------------------------------ | --------- |
| `--port, -p`   | Server port                          | 3001      |
| `--host`       | Host to bind to                      | 127.0.0.1 |
| `--secret, -s` | Secret token for POST authentication | none      |
| `--open, -o`   | Auto-open browser                    | false     |
| `--debug, -d`  | Enable debug logging                 | false     |

### Examples

```bash
# Basic local development
npx aidk-devtools --port 3004 --open

# With authentication (for network access)
npx aidk-devtools --host 0.0.0.0 --secret my-secret-token

# Debug mode to see all events logged
npx aidk-devtools --port 3004 --open --debug
```

## Security

DevTools includes several security measures:

### Localhost Binding (Default)

By default, the server only binds to `127.0.0.1`, making it inaccessible from the network. This is the safest option for local development.

### Token Authentication

When exposing DevTools to the network, always use a secret token:

```bash
# Start server with authentication
npx aidk-devtools --host 0.0.0.0 --secret my-secure-token
```

Engines must include the secret in their config:

```typescript
devTools: {
  remote: true,
  remoteUrl: 'http://your-server:3001',
  secret: 'my-secure-token',
}
```

When a secret is configured, **all API endpoints** require authentication via Bearer token:

```bash
# API calls require Authorization header when secret is set
curl -H "Authorization: Bearer my-secure-token" http://localhost:3001/api/executions
```

### Additional Security Measures

- **Rate limiting**: 1000 requests per minute per IP (configurable)
- **Payload size limit**: 1MB max request body
- **Event validation**: Only known event types are accepted
- **CORS restrictions**: Only localhost origins allowed by default

## Fork/Spawn Visibility

When using `devTools: true` in engine config, forked and spawned executions are automatically captured with full context:

- **Execution Type** - Shows "fork" or "spawn" badge
- **Parent Link** - Navigate to parent execution
- **Hierarchy** - Children appear below their parent in the sidebar
- **Aggregate Tokens** - Parents show combined token usage of all descendants

This works automatically because `devTools` config is inherited by child engines (controlled via `inheritOnFork` and `inheritOnSpawn` options).

```typescript
const engine = createEngine({
  devTools: {
    enabled: true,
    inheritOnFork: true,   // default: true
    inheritOnSpawn: true,  // default: true
  },
});
```

## Execution Boundaries

The DevTools execution hierarchy is powered by **execution boundaries** - a declarative configuration on procedures that determines when new executions start and how they relate to each other.

### How It Works

Every procedure in AIDK can declare its `executionBoundary` behavior:

| Config     | DevTools Behavior                                            |
| ---------- | ------------------------------------------------------------ |
| `'always'` | Creates a new execution (shows as top-level in sidebar)      |
| `'child'`  | Creates child execution linked to parent (shows nested)      |
| `'auto'`   | Creates execution only if not already in one (smart default) |
| `false`    | Inherits parent's execution (groups procedures together)     |

### Built-in Execution Types

The following execution types appear in DevTools:

| Type     | Badge Color | Created By                      |
| -------- | ----------- | ------------------------------- |
| `engine` | Purple      | `engine.execute()`, `.stream()` |
| `model`  | Blue        | Direct `model.generate()` calls |
| `tool`   | Green       | Component tool invocations      |
| `fork`   | Orange      | `<Fork>` component              |
| `spawn`  | Red         | `<Spawn>` component             |

### Execution Hierarchy Example

When you run a complex agent with fork/spawn:

```
engine:stream (execution: abc-123, type: engine)
├── compile:tick (inherits abc-123)
├── model:generate (inherits abc-123)
└── fork execution (execution: def-456, type: fork, parent: abc-123)
    ├── engine:stream (inherits def-456)
    ├── model:generate (inherits def-456)
    └── ...
```

DevTools shows this as:

```
Sidebar:
┌─────────────────────────────────┐
│ ▸ MyAgent          [engine]    │  ← abc-123
│   ├─ ForkedAgent   [fork]      │  ← def-456 (child of abc-123)
└─────────────────────────────────┘
```

This automatic linking ensures you can trace the full execution tree, see aggregate token usage at each level, and navigate between related executions.

### User-Defined Execution Boundaries

For custom operations that should appear as distinct executions in DevTools, use the `withExecution` helper:

```typescript
import { withExecution } from 'aidk';

// In a hook, wrap expensive operations
async function onAfterCompile(ctx) {
  await withExecution("Summarize Context", async () => {
    const summary = await model.generate(summarizePrompt);
    ctx.updateContext(summary);
  });
}
```

This creates a child execution linked to the parent, visible in the execution tree:

```
Sidebar:
┌─────────────────────────────────────┐
│ ▸ MyAgent              [engine]     │
│   ├─ Summarize Context [custom]     │  ← withExecution
└─────────────────────────────────────┘
```

See [Procedures & Middleware](/docs/advanced/procedures#creating-execution-boundaries-with-withexecution) for more details.

## How It Works

The engine emits events internally at key lifecycle points when `devTools` is enabled:

1. **`execution_start`** - Tracks when an execution begins (with parent/root IDs for fork/spawn)
2. **`tick_start/tick_end`** - Marks tick boundaries and captures usage
3. **`compiled`** - Captures compiled context (system, messages, tools)
4. **`content_delta`** - Streams text content in real-time
5. **`tool_call/tool_result`** - Tracks tool execution
6. **`model_output`** - Captures complete model response

Events are streamed via Server-Sent Events (SSE) to connected browser clients.

## Architecture

### Embedded Mode

Server runs inside your app process. Events flow via in-process emitter.

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Process                       │
│                                                              │
│  ┌──────────────┐                                            │
│  │  Engine A    │ ──┐                                        │
│  │ devTools:true│   │                                        │
│  └──────────────┘   │  emit()   ┌─────────────────────┐     │
│                     ├──────────►│  DevToolsEmitter    │     │
│  ┌──────────────┐   │           │  (singleton)        │     │
│  │  Engine B    │ ──┤           │                     │     │
│  │  (forked)    │   │           └──────────┬──────────┘     │
│  └──────────────┘   │                      │                 │
│                     │                      │ subscribe()     │
│  ┌──────────────┐   │                      ▼                 │
│  │  Engine C    │ ──┘           ┌─────────────────────┐     │
│  │  (spawned)   │               │  DevTools Server    │     │
│  └──────────────┘               │  (embedded)         │     │
│                                 │  GET /events (SSE)──┼───► Browser UI
│                                 └─────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Remote Mode

Server runs as standalone CLI. Events sent via HTTP POST across processes.

```
┌─────────────────────────┐         ┌─────────────────────────┐
│   Application Process   │         │   CLI Process           │
│                         │         │   (npx aidk-devtools)   │
│  ┌──────────────┐       │         │                         │
│  │  Engine      │       │  POST   │  ┌─────────────────┐    │
│  │  remote:true ├───────┼────────►│  │ DevTools Server │    │
│  └──────────────┘       │ /events │  │                 │    │
│        │                │         │  │ GET /events ────┼───►│ Browser
│        ▼                │         │  │ (SSE)           │    │
│  ┌──────────────┐       │         │  └─────────────────┘    │
│  │  Fork/Spawn  │       │  POST   │                         │
│  │  (inherits)  ├───────┼────────►│                         │
│  └──────────────┘       │ /events │                         │
└─────────────────────────┘         └─────────────────────────┘
```

**Benefits of Remote Mode:**

- UI persists across app restarts
- Collect events from multiple app instances
- Keep DevTools running during development
- Useful for debugging microservices

## Manual Event Emission

For advanced use cases, you can manually emit events:

```typescript
import { devtools } from 'aidk-devtools/integration';

// Emit custom events
devtools.executionStart(executionId, 'MyAgent');
devtools.tickStart(executionId, 1);
devtools.compiled(executionId, 1, messages, tools, system);
devtools.contentDelta(executionId, 1, 'Hello...');
devtools.toolCall(executionId, 1, 'myTool', callId, { input: 'data' });
devtools.toolResult(executionId, 1, callId, { result: 'value' });
devtools.tickEnd(executionId, 1, usage, stopReason, model);
devtools.executionEnd(executionId, totalUsage);
```

## LLM-Friendly API

DevTools provides structured API endpoints optimized for AI agent consumption. When the CLI server starts, it prints curl examples for these endpoints.

### Structured Endpoints (Recommended)

These endpoints return hierarchical data that's easier to understand than raw events.

#### List Executions

```bash
curl http://localhost:3001/api/executions

# Filter by status
curl "http://localhost:3001/api/executions?status=running"

# Filter by agent name (substring match)
curl "http://localhost:3001/api/executions?agentName=MyAgent"

# Filter by session
curl "http://localhost:3001/api/executions?sessionId=sess-123"

# Filter by execution type
curl "http://localhost:3001/api/executions?executionType=engine"
curl "http://localhost:3001/api/executions?executionType=fork"

# Pagination
curl "http://localhost:3001/api/executions?limit=10&offset=0"
```

Query params: `status` (running/completed/error), `agentName`, `sessionId`, `executionType` (engine/model/tool/fork/spawn), `limit`, `offset`

Returns executions with summary info and pagination:

```json
{
  "executions": [{
    "id": "exec-123",
    "agentName": "MyAgent",
    "executionType": "engine",
    "status": "completed",
    "ticks": 3,
    "totalTokens": 1500,
    "toolCalls": 2,
    "errors": 0,
    "durationMs": 2500
  }],
  "pagination": { "total": 50, "limit": 100, "offset": 0, "hasMore": false }
}
```

#### Execution with Procedure Tree

Get a full execution with its procedure call hierarchy:

```bash
curl http://localhost:3001/api/executions/{id}/tree

# Filter procedures by status
curl "http://localhost:3001/api/executions/{id}/tree?procedureStatus=error"

# Filter procedures by type (model, tool, component, etc.)
curl "http://localhost:3001/api/executions/{id}/tree?procedureType=tool"

# Filter procedures by name (substring match)
curl "http://localhost:3001/api/executions/{id}/tree?procedureName=search"
```

Query params: `procedureStatus` (running/completed/error), `procedureType`, `procedureName`

Returns:

```json
{
  "execution": { ... },
  "procedureCount": 15,
  "procedureTree": [{
    "id": "proc-1",
    "name": "engine:stream",
    "status": "completed",
    "durationMs": 2400,
    "children": [{
      "id": "proc-2",
      "name": "model:generate",
      "status": "completed",
      "durationMs": 1200,
      "children": [...]
    }]
  }],
  "filters": { "procedureStatus": null, "procedureType": null, "procedureName": null }
}
```

#### Procedure Subtree

Drill into a specific procedure and see what it called:

```bash
curl http://localhost:3001/api/procedures/{id}/tree

# Filter descendants by status
curl "http://localhost:3001/api/procedures/{id}/tree?status=error"

# Filter descendants by type
curl "http://localhost:3001/api/procedures/{id}/tree?type=tool"

# Filter descendants by name
curl "http://localhost:3001/api/procedures/{id}/tree?name=search"

# Limit tree depth
curl "http://localhost:3001/api/procedures/{id}/tree?maxDepth=2"
```

Query params: `status` (running/completed/error), `type`, `name`, `maxDepth`

Returns the procedure, its ancestry (path from root), and all descendants:

```json
{
  "procedure": {
    "id": "proc-5",
    "name": "tool:searchDocs",
    "status": "completed",
    "durationMs": 150
  },
  "ancestry": ["engine:stream (abc12...)", "model:generate (def34...)"],
  "children": [...],
  "filters": { "status": null, "type": null, "name": null, "maxDepth": null }
}
```

#### Errors with Context

Get all errors with their procedure ancestry for debugging:

```bash
curl http://localhost:3001/api/errors

# Filter by execution
curl "http://localhost:3001/api/errors?executionId=exec-123"

# Filter by procedure name
curl "http://localhost:3001/api/errors?procedureName=myTool"

# Pagination
curl "http://localhost:3001/api/errors?limit=10&offset=0"
```

Query params: `executionId`, `procedureName`, `limit`, `offset`

Returns:

```json
{
  "count": 2,
  "errors": [{
    "timestamp": 1704380400000,
    "executionId": "exec-123",
    "procedureId": "proc-5",
    "procedureName": "tool:myTool",
    "error": {
      "name": "Error",
      "message": "Connection timeout",
      "stack": "..."
    },
    "ancestry": ["engine:stream (abc...)", "model:generate (def...)"]
  }],
  "pagination": { "total": 2, "limit": 100, "offset": 0, "hasMore": false }
}
```

#### Tool Calls with Results

Get tool calls paired with their results:

```bash
curl http://localhost:3001/api/tools

# Filter by execution
curl "http://localhost:3001/api/tools?executionId=exec-123"

# Filter by tool name
curl "http://localhost:3001/api/tools?toolName=search"

# Filter by status
curl "http://localhost:3001/api/tools?status=failed"

# Pagination
curl "http://localhost:3001/api/tools?limit=10&offset=0"
```

Query params: `executionId`, `toolName`, `status` (succeeded/failed/pending), `limit`, `offset`

Returns:

```json
{
  "summary": {
    "total": 5,
    "succeeded": 4,
    "failed": 1,
    "pending": 0
  },
  "tools": [{
    "callId": "call-123",
    "toolName": "searchDocs",
    "input": { "query": "authentication" },
    "timestamp": 1704380400000,
    "result": {
      "timestamp": 1704380400150,
      "output": { "results": [...] },
      "isError": false
    }
  }],
  "pagination": { "total": 5, "limit": 100, "offset": 0, "hasMore": false }
}
```

#### Markdown Summary

Get a human/LLM-readable markdown overview:

```bash
curl http://localhost:3001/api/summary
```

### Raw Event Filtering

For lower-level access, query raw events with filtering:

```bash
# Filter by event type
curl "http://localhost:3001/api/events?type=tool_call"

# Filter by execution ID
curl "http://localhost:3001/api/events?executionId=abc123&order=asc"

# Pagination
curl "http://localhost:3001/api/events?limit=50&offset=100"
```

Query parameters: `type`, `executionId`, `procedureId`, `sessionId`, `limit` (max 1000), `offset`, `order` (asc/desc)

## Debugging Tips

### Token Usage Shows 0

If token usage shows 0, check that your model adapter is correctly mapping usage fields. Different providers use different field names:

- OpenAI: `promptTokens`, `completionTokens`
- Anthropic/Google: `inputTokens`, `outputTokens`

The AI SDK adapter handles both naming conventions as of v0.1.8.

### Events Not Appearing

Ensure:

1. DevTools is attached before executions start
2. The engine has `engineHooks` enabled (stream middleware requires this)
3. Check browser console for connection errors

### Debug Logging

Enable debug mode to see detailed event logging:

```typescript
attachDevTools({ instance: engine, debug: true });
```

This logs every event as it's emitted, helping identify where data might be lost.
