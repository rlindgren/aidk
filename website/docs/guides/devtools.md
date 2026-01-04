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
│  └──────────────┘               │                     │     │
│                                 │  GET /events (SSE)──┼───► Browser UI
│                                 │  GET /              │     │
│                                 └─────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

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
