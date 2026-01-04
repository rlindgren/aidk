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
const detach = attachDevTools(engine, {
  port: 3004,      // Server port (default: 3004)
  open: true,      // Auto-open browser (default: true)
  debug: false,    // Enable debug logging
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
  attachDevTools(engine, {
    port: +(process.env.DEVTOOLS_PORT || 3004),
    open: process.env.DEVTOOLS_OPEN !== 'false',
    debug: process.env.DEVTOOLS_DEBUG === 'true',
  });
}
```

## UI Overview

The devtools UI is organized into three main areas:

### Sidebar - Execution List

Shows all agent executions with:

- Agent name
- Tick count and duration
- Token usage (with aggregate totals for parents)
- Running/completed status
- **Fork/Spawn badges** - Visual indicators for child executions

Executions are displayed hierarchically: parent executions appear first, with their forked/spawned children indented below. Token counts show both own usage and aggregate (including children), e.g., "0 (352) tokens".

Click an execution to view its details. For child executions, click the parent link to navigate to the parent.

### Main Panel - Timeline View

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
attachDevTools(engine, { port: 3004, open: true });
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
  attachDevTools(engine, { port: devToolsPort, open: true });
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

DevTools includes several security measures for the `POST /events` endpoint:

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
attachDevTools(engine, { debug: true });
```

This logs every event as it's emitted, helping identify where data might be lost.
