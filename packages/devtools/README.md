# aidk-devtools

Developer tools for visualizing and debugging AIDK agent execution.

## Installation

```bash
pnpm add aidk-devtools aidk
```

## Usage

### Recommended: Engine Config

Enable devtools directly in your engine configuration for automatic fork/spawn visibility:

```typescript
import { createEngine } from 'aidk';
import { initDevTools } from 'aidk-devtools';

// Initialize devtools server
initDevTools({ port: 3004, open: true });

// Enable devtools on the engine - events are emitted automatically
const engine = createEngine({
  devTools: true,
});
```

### Alternative: Attach to Engine

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

### Environment Variables

You can also configure devtools via environment variables:

```bash
DEVTOOLS=true           # Enable devtools
DEVTOOLS_PORT=3004      # Server port
DEVTOOLS_OPEN=false     # Disable auto-open browser
DEVTOOLS_DEBUG=true     # Enable debug logging
```

### Express Integration

```typescript
import { createEngine } from 'aidk';
import { attachDevTools } from 'aidk-devtools/integration';

const engine = createEngine();

if (process.env.DEVTOOLS === 'true') {
  attachDevTools(engine, {
    port: +(process.env.DEVTOOLS_PORT || 3004),
    open: process.env.DEVTOOLS_OPEN !== 'false',
  });
}
```

## Features

- **Real-time Streaming** - SSE-based live updates as execution progresses
- **Tick-by-tick Inspection** - View compiled context, model responses, and events
- **Token Usage Tracking** - Monitor input/output/reasoning tokens per tick and aggregate totals
- **Tool Call Visualization** - See tool inputs and results in context
- **Raw Output Access** - Inspect raw provider responses for debugging
- **Fork/Spawn Visibility** - Automatic hierarchy display with parent links and aggregate token counts

## UI Overview

The devtools UI shows:

- **Execution List** - All agent executions in the sidebar
- **Timeline View** - Tick-by-tick breakdown of each execution
- **Stats Grid** - Token usage, tool calls, messages, events per tick
- **Compiled Context** - System prompt, messages, and available tools
- **Model Response** - Formatted output with raw/message view toggle
- **Events** - Tool calls, results, and other events

## Key Exports

- `attachDevTools(engine, options)` - Attach devtools to an engine
- `initDevTools(options)` - Initialize devtools server manually
- `devtools` - Event emitter for manual instrumentation
- `DevToolsServer` - Server class for advanced usage

## Documentation

See the [full documentation](https://rlindgren.github.io/aidk).
