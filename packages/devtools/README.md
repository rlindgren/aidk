# aidk-devtools

Developer tools for visualizing and debugging AIDK agent execution.

## Installation

```bash
pnpm add aidk-devtools aidk
```

## Quick Start

### Embedded Mode (Simple)

DevTools runs inside your app process:

```typescript
import { createEngine } from 'aidk';
import { attachDevTools } from 'aidk-devtools';

const engine = createEngine({ devTools: true });
attachDevTools(engine, { port: 3004, open: true });
```

### Remote Mode (Persistent)

DevTools runs as a standalone server. UI persists across app restarts.

**Terminal 1 - Start the CLI:**

```bash
npx aidk-devtools --port 3004 --open
```

**Terminal 2 - Your app sends events to the CLI:**

```typescript
const engine = createEngine({
  devTools: {
    remote: true,
    remoteUrl: 'http://localhost:3004',
  },
});
```

Or with environment variables:

```bash
DEVTOOLS=true DEVTOOLS_REMOTE=true DEVTOOLS_PORT=3004 node app.js
```

## Environment Variables

```bash
DEVTOOLS=true           # Enable devtools
DEVTOOLS_REMOTE=true    # Use remote mode (send to CLI server)
DEVTOOLS_PORT=3004      # Server port
DEVTOOLS_OPEN=false     # Disable auto-open browser
DEVTOOLS_DEBUG=true     # Enable debug logging
DEVTOOLS_SECRET=token   # Auth token for remote mode
```

## Full Setup Example

Support both embedded and remote modes via environment variables:

```typescript
import { createEngine } from 'aidk';
import { attachDevTools } from 'aidk-devtools';

const devToolsEnabled = process.env.DEVTOOLS === 'true';
const devToolsRemote = process.env.DEVTOOLS_REMOTE === 'true';
const devToolsPort = +(process.env.DEVTOOLS_PORT || 3004);

const engine = createEngine({
  devTools: devToolsEnabled ? {
    remote: devToolsRemote,
    remoteUrl: devToolsRemote ? `http://localhost:${devToolsPort}` : undefined,
    secret: process.env.DEVTOOLS_SECRET,
  } : undefined,
});

// Only start embedded server if NOT in remote mode
if (devToolsEnabled && !devToolsRemote) {
  attachDevTools(engine, {
    port: devToolsPort,
    open: process.env.DEVTOOLS_OPEN !== 'false',
  });
}
```

## CLI Options

```bash
npx aidk-devtools [options]
```

| Option         | Description                 | Default   |
| -------------- | --------------------------- | --------- |
| `--port, -p`   | Server port                 | 3001      |
| `--host`       | Host to bind to             | 127.0.0.1 |
| `--secret, -s` | Auth token for POST /events | none      |
| `--open, -o`   | Auto-open browser           | false     |
| `--debug, -d`  | Enable debug logging        | false     |

## Features

- **Real-time Streaming** - SSE-based live updates as execution progresses
- **Tick-by-tick Inspection** - View compiled context, model responses, and events
- **Token Usage Tracking** - Monitor input/output/reasoning tokens per tick and aggregate totals
- **Tool Call Visualization** - See tool inputs and results in context
- **Raw Output Access** - Inspect raw provider responses for debugging
- **Fork/Spawn Visibility** - Automatic hierarchy display with parent links and aggregate token counts
- **CLI Support** - Run standalone server with `npx aidk-devtools`
- **Security** - Token auth, rate limiting, localhost-only binding by default

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
