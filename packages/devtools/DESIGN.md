# DevTools Architecture Design

This document outlines the target architecture for AIDK DevTools, moving from an engine-specific attachment model to a global channel-based subscription model.

## Executive Summary

The current DevTools requires explicitly calling `attachDevTools(engine)` for each engine instance. This creates several problems:

1. **Forked/spawned engines are invisible** - Child engines create new instances that aren't automatically instrumented
2. **CLI is useless** - Can't start devtools standalone and have engines connect to it
3. **Tight coupling** - DevTools knows about engine internals (hooks, middleware patterns)

The proposed architecture inverts this: **engines emit events, devtools subscribes**. This enables:

- One DevTools UI showing all engines in a process
- Automatic visibility into fork/spawn hierarchies
- Cross-process support (engines POST events to remote devtools server)
- A useful CLI: `npx aidk-devtools` starts a server, engines connect via config

## Goals

1. **Engine-agnostic** - DevTools should not be coupled to specific engine instances
2. **Multi-engine support** - Multiple engines (including fork/spawn) feed into one DevTools UI
3. **Process-agnostic** - Support both in-process and cross-process scenarios
4. **Zero-config for engines** - Engines opt-in with a simple flag, no manual attachment
5. **CLI-friendly** - Enable a useful standalone CLI tool
6. **Backward compatible** - Existing `attachDevTools()` continues to work during migration

---

## Event Flow Diagrams

### In-Process Flow (v2 Target)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Application Process                              │
│                                                                          │
│   ┌──────────────┐                                                       │
│   │   Engine A   │                                                       │
│   │ devTools:true├──┐                                                    │
│   └──────────────┘  │                                                    │
│                     │  emit()                                            │
│   ┌──────────────┐  │       ┌─────────────────────┐                      │
│   │   Engine B   │  ├──────►│  DevToolsEmitter    │                      │
│   │   (forked)   ├──┤       │  (singleton)        │                      │
│   └──────────────┘  │       │                     │                      │
│                     │       │  - EventEmitter     │                      │
│   ┌──────────────┐  │       │  - Buffering        │                      │
│   │   Engine C   ├──┘       │  - Batching         │                      │
│   │   (spawned)  │          └──────────┬──────────┘                      │
│   └──────────────┘                     │                                 │
│                                        │ subscribe()                     │
│                                        ▼                                 │
│                              ┌─────────────────────┐                     │
│                              │   DevTools Server   │                     │
│                              │                     │                     │
│                              │  GET /events (SSE)──┼───► Browser UI      │
│                              │  GET /              │                     │
│                              └─────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Cross-Process Flow (v2 Future)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Process A (Main App)                             │
│                                                                          │
│   ┌──────────────┐     ┌─────────────────────┐                           │
│   │   Engine A   │────►│  DevToolsEmitter    │                           │
│   │ devTools:    │     │                     │       HTTP POST           │
│   │  remote:true │     │  remoteUrl:         ├───────────────────┐       │
│   │  remoteUrl:  │     │  localhost:3004     │                   │       │
│   │   :3004      │     └─────────────────────┘                   │       │
│   └──────────────┘                                               │       │
└──────────────────────────────────────────────────────────────────┼───────┘
                                                                   │
┌──────────────────────────────────────────────────────────────────┼───────┐
│                         Process B (Worker)                       │       │
│                                                                  │       │
│   ┌──────────────┐     ┌─────────────────────┐                   │       │
│   │   Engine B   │────►│  DevToolsEmitter    │     HTTP POST     │       │
│   │   (worker)   │     │  remoteUrl: :3004   ├───────────┐       │       │
│   └──────────────┘     └─────────────────────┘           │       │       │
└──────────────────────────────────────────────────────────┼───────┼───────┘
                                                           │       │
                                                           ▼       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    Process C (DevTools Standalone)                        │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                      DevTools Server                             │    │
│   │                                                                  │    │
│   │   POST /events ◄──── Receives events from remote emitters       │    │
│   │                                                                  │    │
│   │   GET /events  ────► SSE stream to browser                      │    │
│   │                                                                  │    │
│   │   GET /        ────► Serves React UI                            │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Event Sequence: Single Tick

```
Engine                      DevToolsEmitter              DevTools Server           Browser UI
  │                               │                            │                        │
  │  execution_start              │                            │                        │
  ├──────────────────────────────►│  emit(event)               │                        │
  │                               ├───────────────────────────►│  SSE: execution_start  │
  │                               │                            ├───────────────────────►│
  │  tick_start (tick=1)          │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│  SSE: tick_start       │
  │                               │                            ├───────────────────────►│
  │  compiled (messages, tools)   │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│  SSE: compiled         │
  │                               │                            ├───────────────────────►│
  │  model_start                  │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│                        │
  │                               │                            │                        │
  │  content_delta (streaming)    │                            │                        │
  ├──────────────────────────────►│  (batched, 10ms window)    │                        │
  ├──────────────────────────────►│                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│  SSE: content_delta[]  │
  │                               │                            ├───────────────────────►│
  │  tool_call                    │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│                        │
  │                               │                            │                        │
  │  tool_result                  │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│                        │
  │                               │                            │                        │
  │  model_output                 │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│                        │
  │  tick_end (usage, stopReason) │                            │                        │
  ├──────────────────────────────►│                            │                        │
  │                               ├───────────────────────────►│  SSE: tick_end         │
  │                               │                            ├───────────────────────►│
  │                               │                            │                        │
```

### Event Sequence: Fork/Spawn

```
Parent Engine                  DevToolsEmitter                     Browser UI
     │                               │                                  │
     │  execution_start              │                                  │
     │  (execId: "parent-001")       │                                  │
     ├──────────────────────────────►├─────────────────────────────────►│
     │                               │                                  │
     │  tick_start (tick=1)          │                                  │
     ├──────────────────────────────►├─────────────────────────────────►│
     │                               │                                  │
     │       ┌─────────────────┐     │                                  │
     │       │ Fork Component  │     │                                  │
     │       │   creates       │     │                                  │
     │       │   child engine  │     │                                  │
     │       └────────┬────────┘     │                                  │
     │                │              │                                  │
     │                ▼              │                                  │
     │         Child Engine          │                                  │
     │              │                │                                  │
     │              │ execution_start│                                  │
     │              │ (execId: "fork-002",                              │
     │              │  parentExecId: "parent-001",                      │
     │              │  rootExecId: "parent-001",                        │
     │              │  executionType: "fork")                           │
     │              ├───────────────►├─────────────────────────────────►│
     │              │                │                                  │
     │              │ tick_start     │     ┌──────────────────────────┐ │
     │              ├───────────────►├────►│ UI shows tree:           │ │
     │              │                │     │  parent-001              │ │
     │ tick_end     │ tick_end       │     │    └─ fork-002           │ │
     ├─────────────►│◄───────────────┤     └──────────────────────────┘ │
     │              │                │                                  │
```

---

## Current Architecture (v1)

```
┌─────────────────────────────────────────────────────────────┐
│  Application Process                                         │
│                                                              │
│  ┌─────────────┐                                             │
│  │   Engine    │                                             │
│  │  Instance   │                                             │
│  └──────┬──────┘                                             │
│         │                                                    │
│         │ attachDevTools(engine)                             │
│         │  - hooks into lifecycle                            │
│         │  - registers stream middleware                     │
│         ▼                                                    │
│  ┌─────────────┐          SSE           ┌─────────────┐     │
│  │  DevTools   │ ◄────────────────────► │   Browser   │     │
│  │   Server    │                         │     UI      │     │
│  └─────────────┘                         └─────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. User calls `attachDevTools(engine, options)`
2. DevTools registers lifecycle hooks on that specific engine:
   - `onExecutionStart`, `onExecutionEnd`
   - `onTickStart`, `onTickEnd`
   - `onAfterRender`
3. DevTools registers stream middleware via `engine.engineHooks`
4. DevTools server starts, serves UI, accepts SSE connections
5. When hooks fire, events are emitted to connected SSE clients

### Limitations

1. **Single engine** - Must call `attachDevTools()` per engine instance
2. **Fork/spawn blind** - Forked engines create new instances, not automatically instrumented
3. **In-process only** - Can't instrument engines in other processes
4. **Tight coupling** - DevTools knows about engine internals (lifecycle hooks, middleware)
5. **CLI useless** - Starting server standalone does nothing without `attachDevTools()`

## Proposed Architecture (v2)

```
┌─────────────────────────────────────────────────────────────┐
│  Application Process                                         │
│                                                              │
│  ┌─────────────┐     emit      ┌──────────────────────┐     │
│  │   Engine 1  │ ─────────────►│                      │     │
│  │ devTools:t  │               │   __devtools__       │     │
│  └─────────────┘               │      Channel         │     │
│                                │                      │     │
│  ┌─────────────┐     emit      │   (in-process        │     │
│  │   Engine 2  │ ─────────────►│    pub/sub)          │     │
│  │ (forked)    │               │                      │     │
│  └─────────────┘               └──────────┬───────────┘     │
│                                           │                  │
│                                           │ subscribe        │
│                                           ▼                  │
│                                    ┌─────────────┐          │
│                                    │  DevTools   │          │
│                                    │  Collector  │          │
│                                    └──────┬──────┘          │
│                                           │                  │
└───────────────────────────────────────────┼──────────────────┘
                                            │ SSE
                                            ▼
                                     ┌─────────────┐
                                     │   Browser   │
                                     │     UI      │
                                     └─────────────┘
```

### Cross-Process Architecture (Future)

```
┌─────────────────────────────────────────────────────────────┐
│  Process A (Main App)                                        │
│                                                              │
│  ┌─────────────┐                                             │
│  │   Engine 1  │ ────┐                                       │
│  │ devTools:t  │     │                                       │
│  └─────────────┘     │ emit to channel                       │
│                      ▼                                       │
│              ┌───────────────┐        HTTP POST              │
│              │ DevTools      │ ─────────────────────────┐    │
│              │ Emitter       │   (when remote: true)    │    │
│              └───────────────┘                          │    │
└─────────────────────────────────────────────────────────┼────┘
                                                          │
┌─────────────────────────────────────────────────────────┼────┐
│  Process B (Worker)                                     │    │
│                                                         │    │
│  ┌─────────────┐                                        │    │
│  │   Engine 2  │ ────┐                                  │    │
│  │ devTools:t  │     │ emit to channel                  │    │
│  └─────────────┘     ▼                                  │    │
│              ┌───────────────┐        HTTP POST         │    │
│              │ DevTools      │ ────────────────────┐    │    │
│              │ Emitter       │                     │    │    │
│              └───────────────┘                     │    │    │
└────────────────────────────────────────────────────┼────┼────┘
                                                     │    │
                                                     ▼    ▼
┌─────────────────────────────────────────────────────────────┐
│  Process C (DevTools - could be same as A)                   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  DevTools Server                                     │    │
│  │                                                      │    │
│  │  POST /events ◄─── receives events from emitters    │    │
│  │                                                      │    │
│  │  GET /events  ───► SSE to browser                   │    │
│  │                                                      │    │
│  │  GET /        ───► serves UI                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Design Details

### 1. Engine Configuration

Engines opt into devtools emission via configuration:

```typescript
const engine = createEngine({
  devTools: true,  // Enable with defaults
  // or
  devTools: {
    enabled: true,
    channel: '__devtools__',  // Default channel name
    remote: false,            // Future: POST to remote server
    remoteUrl: undefined,     // Future: URL for remote server
  }
});
```

When `devTools` is enabled, the engine automatically emits events at key lifecycle points. No external attachment required.

### 2. DevTools Channel

A dedicated channel `__devtools__` is used for all devtools events. This is NOT a user-configured channel - it's a built-in internal channel.

```typescript
// In aidk-shared or aidk-kernel
export const DEVTOOLS_CHANNEL = '__devtools__';
```

#### Channel Implementation Options

**Option A: Singleton Event Emitter (Recommended for v2)**

A simple global event emitter that engines publish to and devtools subscribes to:

```typescript
// packages/core/src/devtools/emitter.ts
import { EventEmitter } from 'events';

class DevToolsEmitter extends EventEmitter {
  private static instance: DevToolsEmitter;

  static getInstance(): DevToolsEmitter {
    if (!this.instance) {
      this.instance = new DevToolsEmitter();
    }
    return this.instance;
  }

  emit(event: DevToolsEvent): boolean {
    return super.emit('event', event);
  }

  subscribe(handler: (event: DevToolsEvent) => void): () => void {
    this.on('event', handler);
    return () => this.off('event', handler);
  }
}

export const devToolsEmitter = DevToolsEmitter.getInstance();
```

**Option B: Use Existing Channel Infrastructure**

Piggyback on the existing channel service, but with a special built-in channel:

```typescript
// Engine automatically publishes to __devtools__ channel
// DevTools subscribes like any other channel consumer
```

This is cleaner architecturally but requires channel service to be available, which may not always be the case.

**Recommendation**: Start with Option A (simple singleton) for in-process. It's lightweight, always available, and doesn't require channel service configuration. Add Option B as an enhancement later if cross-process via channels becomes valuable.

### 3. Engine Event Emission

The engine emits events internally at lifecycle points:

```typescript
// packages/core/src/engine/engine.ts

class Engine {
  private devToolsConfig: DevToolsConfig | false;

  constructor(config: EngineConfig) {
    this.devToolsConfig = this.normalizeDevToolsConfig(config.devTools);
  }

  private emitDevToolsEvent(event: Omit<DevToolsEvent, 'timestamp'>): void {
    if (!this.devToolsConfig) return;

    const fullEvent = {
      ...event,
      timestamp: Date.now(),
    };

    if (this.devToolsConfig.remote && this.devToolsConfig.remoteUrl) {
      // Future: POST to remote server
      this.postToRemoteDevTools(fullEvent);
    } else {
      // In-process: emit to singleton
      devToolsEmitter.emit(fullEvent);
    }
  }

  // Called at appropriate lifecycle points:
  private onExecutionStartInternal(input, agent, handle) {
    this.emitDevToolsEvent({
      type: 'execution_start',
      executionId: handle?.pid || this.id,
      agentName: agent?.type?.name || 'Agent',
      sessionId: input?.metadata?.sessionId,
    });
  }

  // ... similar for other lifecycle points
}
```

### 4. Fork/Spawn Inheritance

When an engine forks or spawns a child engine, the `devTools` config should propagate:

```typescript
// In fork/spawn logic
const childEngine = createEngine({
  ...childConfig,
  devTools: parentEngine.devToolsConfig,  // Inherit from parent
});
```

Each engine has its own `executionId`, so DevTools can distinguish them:

```
Parent Engine (exec-001)
├── Fork Branch A (exec-002)
├── Fork Branch B (exec-003)
└── Spawned Agent (exec-004)
```

The UI can show these as a tree or flat list, filtering by `parentExecutionId` and `rootExecutionId` fields already in events.

### 5. DevTools Server & Collector

DevTools has two modes:

**Mode 1: In-Process (default)**

```typescript
import { initDevTools } from 'aidk-devtools';

// Subscribe to singleton emitter, start server
initDevTools({
  port: 3004,
  open: true,
});
```

**Mode 2: Standalone Server (CLI)**

```bash
npx aidk-devtools --port 3004 --open
```

Starts server that:

- Exposes `POST /events` for remote event ingestion
- Exposes `GET /events` for SSE to browser
- Serves UI at `/`

Engines configured with `devTools: { remote: true, remoteUrl: 'http://localhost:3004' }` POST events to this server.

### 6. Event Protocol (Full Specification)

All events share a common base structure and are serialized as JSON for SSE/HTTP transport.

#### Base Event Fields

Every event MUST include:

```typescript
interface DevToolsEventBase {
  type: string;           // Discriminator for event type
  executionId: string;    // UUID of the execution context
  timestamp: number;      // Unix timestamp in milliseconds
}
```

#### Execution Context Fields

Events within an execution tree include additional context:

```typescript
interface ExecutionContextFields {
  parentExecutionId?: string;   // Parent execution (for fork/spawn)
  rootExecutionId?: string;     // Root of the execution tree
  engineId: string;             // Engine instance ID (constant across executions)
  traceId?: string;             // OpenTelemetry trace ID if available
}
```

#### Full Event Schema

```typescript
// ============ Execution Lifecycle ============

interface ExecutionStartEvent extends DevToolsEventBase {
  type: "execution_start";
  agentName: string;              // Component name (e.g., "MyAgent")
  sessionId?: string;             // User session ID if available
  executionType: "root" | "fork" | "spawn";
  parentExecutionId?: string;     // Set for fork/spawn
  rootExecutionId?: string;       // Set for fork/spawn
  engineId: string;
  traceId?: string;
}

interface ExecutionEndEvent extends DevToolsEventBase {
  type: "execution_end";
  totalUsage: TokenUsage;         // Cumulative usage across all ticks
  finalState?: "completed" | "cancelled" | "error";
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ============ Tick Lifecycle ============

interface TickStartEvent extends DevToolsEventBase {
  type: "tick_start";
  tick: number;                   // 1-indexed tick number
}

interface TickEndEvent extends DevToolsEventBase {
  type: "tick_end";
  tick: number;
  usage?: TokenUsage;             // This tick's token usage
  stopReason?: string;            // "end_turn", "tool_use", "max_tokens", etc.
  model?: string;                 // Model ID used this tick
}

// ============ Compilation ============

interface CompiledEvent extends DevToolsEventBase {
  type: "compiled";
  tick: number;
  messages: Message[];            // Full conversation history
  tools: ToolDefinition[];        // Available tools
  system?: string;                // System prompt
}

// ============ Model Interaction ============

interface ModelStartEvent extends DevToolsEventBase {
  type: "model_start";
  tick: number;
  modelId: string;                // e.g., "claude-3-5-sonnet-20241022"
  provider?: string;              // e.g., "anthropic", "openai"
}

interface ModelOutputEvent extends DevToolsEventBase {
  type: "model_output";
  tick: number;
  message: Message;               // Complete assistant message
  raw?: unknown;                  // Raw provider response (for debugging)
}

// ============ Streaming ============

interface ContentDeltaEvent extends DevToolsEventBase {
  type: "content_delta";
  tick: number;
  delta: string;                  // Incremental text content
  blockIndex?: number;            // Which content block (for multi-block responses)
}

interface ReasoningDeltaEvent extends DevToolsEventBase {
  type: "reasoning_delta";
  tick: number;
  delta: string;                  // Incremental reasoning/thinking content
}

// ============ Tool Execution ============

interface ToolCallEvent extends DevToolsEventBase {
  type: "tool_call";
  tick: number;
  toolName: string;
  toolUseId: string;              // Unique ID for this tool invocation
  input: unknown;                 // Tool input (JSON-serializable)
  executionType?: "server" | "client" | "provider" | "mcp";
}

interface ToolResultEvent extends DevToolsEventBase {
  type: "tool_result";
  tick: number;
  toolUseId: string;              // Matches the tool_call
  result: unknown;                // Tool output (JSON-serializable)
  isError?: boolean;              // True if tool threw an error
  durationMs?: number;            // Execution time
}

interface ToolConfirmationEvent extends DevToolsEventBase {
  type: "tool_confirmation";
  tick: number;
  toolUseId: string;
  toolName: string;
  input: unknown;
  confirmationMessage?: string;   // Message shown to user
  status: "pending" | "approved" | "denied";
}

// ============ State ============

interface StateChangeEvent extends DevToolsEventBase {
  type: "state_change";
  tick: number;
  key: string;                    // Signal/state key
  oldValue: unknown;
  newValue: unknown;
  source?: "signal" | "reducer" | "effect";
}

// ============ Union Type ============

type DevToolsEvent =
  | ExecutionStartEvent
  | ExecutionEndEvent
  | TickStartEvent
  | TickEndEvent
  | CompiledEvent
  | ModelStartEvent
  | ModelOutputEvent
  | ContentDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolConfirmationEvent
  | StateChangeEvent;
```

#### Token Usage Schema

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;       // For models with reasoning (o1, etc.)
  cachedInputTokens?: number;     // Anthropic prompt caching
  cachedCreationInputTokens?: number;
}
```

Key fields for multi-engine support:

- `executionId` - Unique identifier for this execution
- `parentExecutionId` - Parent execution (for fork/spawn)
- `rootExecutionId` - Root of the execution tree
- `engineId` - The engine instance (constant)
- `tick` - Current tick number
- `timestamp` - When event occurred

### 7. API Surface

#### Engine (aidk)

```typescript
interface EngineConfig {
  devTools?: boolean | DevToolsConfig;
}

interface DevToolsConfig {
  enabled?: boolean;           // Default: true
  channel?: string;            // Default: '__devtools__'
  remote?: boolean;            // Default: false
  remoteUrl?: string;          // Required if remote: true
  inheritOnFork?: boolean;     // Default: true
  inheritOnSpawn?: boolean;    // Default: true
}
```

#### DevTools (aidk-devtools)

```typescript
// Initialize devtools (subscribes to events, starts server)
function initDevTools(options?: DevToolsOptions): DevToolsHandle;

interface DevToolsOptions {
  port?: number;              // Default: 3004
  open?: boolean;             // Default: true
  debug?: boolean;            // Default: false
  // Future:
  acceptRemote?: boolean;     // Enable POST /events endpoint
}

interface DevToolsHandle {
  stop(): void;
  readonly port: number;
  readonly url: string;
}

// For programmatic event emission (testing, custom integrations)
function emitDevToolsEvent(event: DevToolsEvent): void;
```

## Migration Path

### Phase 1: Add Engine-Side Emission (Breaking: None)

1. Add `devTools` config option to Engine
2. Engine emits to singleton emitter when enabled
3. Keep `attachDevTools()` working (subscribes to emitter internally)
4. Both approaches work simultaneously

### Phase 2: Deprecate attachDevTools (Breaking: Soft)

1. Mark `attachDevTools()` as deprecated
2. Update docs to recommend `devTools: true` + `initDevTools()`
3. `attachDevTools()` internally just enables devTools on engine

### Phase 3: Add Remote Support (Breaking: None)

1. Add `POST /events` endpoint to DevTools server
2. Add `remote: true` option to engine devTools config
3. CLI becomes useful for cross-process scenarios

### Phase 4: Remove attachDevTools (Breaking: Yes)

1. Remove `attachDevTools()` function
2. Remove lifecycle hook approach entirely
3. All event emission is internal to engine

## Answering Open Questions

### Q: Channel service singleton?

**A**: No, don't require the channel service. Use a dedicated lightweight singleton (`devToolsEmitter`) that's always available. The channel service is for user-facing pub/sub; devtools is internal infrastructure. Keeping them separate means:

- DevTools works even without channels configured
- No risk of devtools events leaking to user channel subscribers
- Simpler implementation

### Q: Fork/spawn inheritance?

**A**: Yes, `devTools` config should automatically propagate to forked/spawned engines by default. Add `inheritOnFork` and `inheritOnSpawn` options (defaulting to `true`) for users who want to disable this.

### Q: Cross-process - worth designing for now?

**A**: Design for it, but implement later. The architecture should support it:

- Events have all necessary context (executionId, timestamps, etc.)
- Server can accept HTTP POST
- Engine can POST instead of emit locally

But implement in-process first (Phase 1-2), add remote in Phase 3 when there's a clear use case.

## CLI Tool

With this architecture, the CLI becomes useful:

```bash
# Start devtools server (accepts remote events)
npx aidk-devtools --port 3004

# In your app, configure engine to POST events
const engine = createEngine({
  devTools: {
    remote: true,
    remoteUrl: 'http://localhost:3004',
  }
});
```

Or for in-process, the CLI could be a convenience wrapper:

```bash
# Start your app with devtools
npx aidk-devtools -- node server.js
```

This would:

1. Set `DEVTOOLS=true` environment variable
2. Start the app as a child process
3. Start devtools server
4. App reads env var, enables devTools on engines

## File Structure

```
packages/devtools/
├── src/
│   ├── index.ts              # Main exports
│   ├── events.ts             # Event type definitions
│   ├── emitter.ts            # Singleton event emitter (NEW)
│   ├── server.ts             # HTTP/SSE server
│   ├── collector.ts          # Subscribes to emitter, feeds server (NEW)
│   ├── cli.ts                # CLI entry point
│   └── integration/
│       └── index.ts          # attachDevTools (deprecated path)
├── ui/
│   └── ...                   # React UI
├── DESIGN.md                 # This document
└── README.md
```

```
packages/core/
├── src/
│   ├── engine/
│   │   ├── engine.ts         # Add devTools config, emit events
│   │   └── ...
│   └── devtools/
│       └── emitter.ts        # Singleton emitter (or in aidk-shared)
```

---

## Implementation Details

### Engine-Side Event Emission

The engine emits devtools events at specific points in the execution lifecycle. This is **internal to the engine** - no external hooks required.

#### Emission Points in Engine

```typescript
// packages/core/src/engine/engine.ts

class Engine {
  private devToolsConfig: DevToolsConfig | false;

  constructor(config: EngineConfig) {
    // Normalize devTools config: true → defaults, false/undefined → disabled
    this.devToolsConfig = this.normalizeDevToolsConfig(config.devTools);
  }

  private normalizeDevToolsConfig(
    config: boolean | DevToolsConfig | undefined
  ): DevToolsConfig | false {
    if (!config) return false;
    if (config === true) {
      return {
        enabled: true,
        inheritOnFork: true,
        inheritOnSpawn: true,
      };
    }
    return {
      enabled: config.enabled !== false,
      channel: config.channel || DEVTOOLS_CHANNEL,
      remote: config.remote || false,
      remoteUrl: config.remoteUrl,
      inheritOnFork: config.inheritOnFork !== false,
      inheritOnSpawn: config.inheritOnSpawn !== false,
    };
  }

  // Central emission method
  private emitDevToolsEvent(event: Omit<DevToolsEvent, 'timestamp'>): void {
    if (!this.devToolsConfig) return;

    const fullEvent = {
      ...event,
      timestamp: Date.now(),
      engineId: this.id,
    };

    if (this.devToolsConfig.remote && this.devToolsConfig.remoteUrl) {
      // Cross-process: POST to remote server
      this.postToRemoteDevTools(fullEvent);
    } else {
      // In-process: emit to singleton
      devToolsEmitter.emit(fullEvent);
    }
  }

  private async postToRemoteDevTools(event: DevToolsEvent): Promise<void> {
    try {
      await fetch(`${this.devToolsConfig.remoteUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (error) {
      // Silent failure - devtools is optional, don't break execution
      if (this.devToolsConfig.debug) {
        console.warn('[DevTools] Failed to POST event:', error);
      }
    }
  }
}
```

#### Emission Points by Lifecycle Stage

```typescript
// In execute() method
private async executeImpl(input: EngineInput, agent: ComponentDefinition, handle: ExecutionHandle) {
  // 1. EXECUTION START
  this.emitDevToolsEvent({
    type: 'execution_start',
    executionId: handle.pid,
    agentName: agent?.type?.name || 'Agent',
    sessionId: input?.metadata?.sessionId,
    executionType: handle.parentPid ? (handle.type === 'fork' ? 'fork' : 'spawn') : 'root',
    parentExecutionId: handle.parentPid,
    rootExecutionId: handle.rootPid,
  });

  try {
    while (shouldContinue) {
      // 2. TICK START
      this.emitDevToolsEvent({
        type: 'tick_start',
        executionId: handle.pid,
        tick: state.tick,
      });

      // 3. COMPILED (after JSX compilation + rendering)
      const compiled = await this.compileJSX(agent, state);
      const formatted = await this.structureRenderer.apply(compiled);
      this.emitDevToolsEvent({
        type: 'compiled',
        executionId: handle.pid,
        tick: state.tick,
        messages: formatted.timeline,
        tools: formatted.tools,
        system: formatted.system,
      });

      // 4. MODEL START
      this.emitDevToolsEvent({
        type: 'model_start',
        executionId: handle.pid,
        tick: state.tick,
        modelId: model.id,
        provider: model.provider,
      });

      // 5. STREAMING EVENTS (content_delta, reasoning_delta)
      // These are emitted from within the model call loop
      for await (const chunk of modelStream) {
        if (chunk.type === 'content_delta') {
          this.emitDevToolsEvent({
            type: 'content_delta',
            executionId: handle.pid,
            tick: state.tick,
            delta: chunk.delta,
          });
        }
        // ... etc
      }

      // 6. MODEL OUTPUT
      this.emitDevToolsEvent({
        type: 'model_output',
        executionId: handle.pid,
        tick: state.tick,
        message: response.message,
        raw: response.raw,
      });

      // 7. TOOL EVENTS (during tool execution)
      for (const toolCall of toolCalls) {
        this.emitDevToolsEvent({
          type: 'tool_call',
          executionId: handle.pid,
          tick: state.tick,
          toolName: toolCall.name,
          toolUseId: toolCall.id,
          input: toolCall.input,
        });

        const result = await this.executeTool(toolCall);

        this.emitDevToolsEvent({
          type: 'tool_result',
          executionId: handle.pid,
          tick: state.tick,
          toolUseId: toolCall.id,
          result: result.output,
          isError: result.isError,
          durationMs: result.durationMs,
        });
      }

      // 8. TICK END
      this.emitDevToolsEvent({
        type: 'tick_end',
        executionId: handle.pid,
        tick: state.tick,
        usage: response.usage,
        stopReason: response.stopReason,
        model: model.id,
      });
    }

    // 9. EXECUTION END
    this.emitDevToolsEvent({
      type: 'execution_end',
      executionId: handle.pid,
      totalUsage: accumulatedUsage,
      finalState: 'completed',
    });
  } catch (error) {
    this.emitDevToolsEvent({
      type: 'execution_end',
      executionId: handle.pid,
      totalUsage: accumulatedUsage,
      finalState: 'error',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
    throw error;
  }
}
```

### Fork/Spawn Config Propagation

```typescript
// In fork() method
fork(agent: ComponentDefinition, input: EngineInput, options?: ForkOptions): ExecutionHandle {
  const childConfig = {
    ...this.config,
    // Propagate devTools config if inheritance is enabled
    devTools: this.shouldInheritDevTools('fork')
      ? this.devToolsConfig
      : false,
  };

  const childEngine = new Engine(childConfig);
  // ...
}

private shouldInheritDevTools(type: 'fork' | 'spawn'): boolean {
  if (!this.devToolsConfig) return false;
  if (type === 'fork') return this.devToolsConfig.inheritOnFork !== false;
  return this.devToolsConfig.inheritOnSpawn !== false;
}
```

---

## Environment Variable Auto-Detection

Engines can automatically enable devtools based on environment variables. This enables zero-config activation.

### Supported Environment Variables

```bash
# Enable devtools
DEVTOOLS=true
AIDK_DEVTOOLS=true

# Configuration
DEVTOOLS_PORT=3004
DEVTOOLS_REMOTE_URL=http://localhost:3004
DEVTOOLS_DEBUG=true
```

### Engine Auto-Detection

```typescript
// packages/core/src/engine/engine.ts

class Engine {
  constructor(config: EngineConfig) {
    // Auto-enable devtools from environment if not explicitly configured
    const devToolsConfig = config.devTools ?? this.getDevToolsFromEnv();
    this.devToolsConfig = this.normalizeDevToolsConfig(devToolsConfig);
  }

  private getDevToolsFromEnv(): boolean | DevToolsConfig | undefined {
    const enabled = process.env.DEVTOOLS === 'true' ||
                    process.env.AIDK_DEVTOOLS === 'true';

    if (!enabled) return undefined;

    const remoteUrl = process.env.DEVTOOLS_REMOTE_URL;

    return {
      enabled: true,
      remote: !!remoteUrl,
      remoteUrl,
      debug: process.env.DEVTOOLS_DEBUG === 'true',
    };
  }
}
```

### CLI Wrapper Mode

The CLI can wrap application execution, setting environment variables:

```typescript
// packages/devtools/src/cli.ts

import { spawn } from 'node:child_process';
import { startServer } from './server';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--')) {
    // Wrapper mode: npx aidk-devtools -- node server.js
    const appIndex = args.indexOf('--') + 1;
    const appArgs = args.slice(appIndex);

    // Start devtools server first
    const server = await startServer({ port: 3004 });

    // Then start the app with DEVTOOLS env var
    const child = spawn(appArgs[0], appArgs.slice(1), {
      stdio: 'inherit',
      env: {
        ...process.env,
        DEVTOOLS: 'true',
        DEVTOOLS_REMOTE_URL: `http://localhost:${server.port}`,
      },
    });

    child.on('exit', (code) => {
      server.stop();
      process.exit(code ?? 0);
    });
  } else {
    // Server mode: npx aidk-devtools --port 3004
    const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3004');
    await startServer({ port, open: !args.includes('--no-open') });
  }
}
```

---

## Performance Considerations

### Event Batching

Content deltas arrive frequently during streaming. Batch them to reduce overhead:

```typescript
// packages/core/src/devtools/emitter.ts

class DevToolsEmitter extends EventEmitter {
  private batchBuffer: DevToolsEvent[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly BATCH_WINDOW_MS = 10;

  emit(event: DevToolsEvent): void {
    // High-frequency events get batched
    if (event.type === 'content_delta' || event.type === 'reasoning_delta') {
      this.batchBuffer.push(event);
      this.scheduleBatchFlush();
    } else {
      // Low-frequency events emit immediately
      this.flushBatch();
      super.emit('event', event);
    }
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimeout) return;
    this.batchTimeout = setTimeout(() => {
      this.flushBatch();
    }, this.BATCH_WINDOW_MS);
  }

  private flushBatch(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batchBuffer.length === 0) return;

    // Emit batched events as an array
    super.emit('batch', this.batchBuffer);
    this.batchBuffer = [];
  }
}
```

### Memory Management

```typescript
// Limit history retention in the emitter
class DevToolsEmitter {
  private readonly MAX_HISTORY_SIZE = 1000;
  private eventHistory: DevToolsEvent[] = [];

  emit(event: DevToolsEvent): void {
    // ... emit logic

    // Maintain history for late-joining subscribers
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.MAX_HISTORY_SIZE) {
      this.eventHistory.shift();
    }
  }

  // New subscribers can get recent history
  getHistory(executionId?: string): DevToolsEvent[] {
    if (!executionId) return [...this.eventHistory];
    return this.eventHistory.filter(e => e.executionId === executionId);
  }
}
```

### Backpressure for Remote Mode

```typescript
class DevToolsEmitter {
  private pendingPosts = 0;
  private readonly MAX_PENDING = 50;
  private dropBuffer: DevToolsEvent[] = [];

  private async postToRemote(event: DevToolsEvent): Promise<void> {
    if (this.pendingPosts >= this.MAX_PENDING) {
      // Drop old events if backlogged
      if (this.dropBuffer.length >= 100) {
        this.dropBuffer.shift();
      }
      this.dropBuffer.push(event);
      return;
    }

    this.pendingPosts++;
    try {
      await fetch(this.remoteUrl, {
        method: 'POST',
        body: JSON.stringify(event),
      });
    } finally {
      this.pendingPosts--;
      this.drainDropBuffer();
    }
  }
}
```

---

## Error Handling & Reliability

### No-Throw Guarantee

DevTools must never break application execution:

```typescript
class DevToolsEmitter {
  emit(event: DevToolsEvent): void {
    try {
      // All emission logic wrapped
    } catch (error) {
      // Log but never throw
      if (this.debug) {
        console.warn('[DevTools] Emission error:', error);
      }
    }
  }
}
```

### SSE Reconnection

The browser client should auto-reconnect:

```typescript
// packages/devtools/ui/src/hooks/useEventSource.ts

function useDevToolsEvents() {
  const [events, setEvents] = useState<DevToolsEvent[]>([]);

  useEffect(() => {
    let eventSource: EventSource;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      eventSource = new EventSource('/events');

      eventSource.onmessage = (e) => {
        const event = JSON.parse(e.data);
        setEvents(prev => [...prev, event]);
      };

      eventSource.onerror = () => {
        eventSource.close();
        // Exponential backoff reconnect
        reconnectTimeout = setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  return events;
}
```

### HTTP POST Retry

```typescript
async function postWithRetry(
  url: string,
  event: DevToolsEvent,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) return;

      // 4xx errors - don't retry
      if (response.status >= 400 && response.status < 500) return;
    } catch (error) {
      // Network error - retry
    }

    // Exponential backoff
    await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));
  }
}
```

---

## Security Considerations

### Remote Mode Authentication

When devtools runs on a separate port/process, protect against unauthorized access:

```typescript
// packages/devtools/src/server.ts

interface DevToolsServerOptions {
  port: number;
  // Security options
  secret?: string;           // Shared secret for POST /events
  allowedOrigins?: string[]; // CORS origins for browser UI
  localhostOnly?: boolean;   // Bind to 127.0.0.1 only (default: true)
}

function createServer(options: DevToolsServerOptions) {
  const app = express();

  // Only bind to localhost by default
  const host = options.localhostOnly !== false ? '127.0.0.1' : '0.0.0.0';

  // Verify secret on POST /events
  app.post('/events', (req, res) => {
    if (options.secret) {
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${options.secret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    // ... handle event
  });

  // CORS for browser UI
  app.use(cors({
    origin: options.allowedOrigins || ['http://localhost:*'],
  }));

  app.listen(options.port, host);
}
```

### Engine-Side Secret

```typescript
const engine = createEngine({
  devTools: {
    remote: true,
    remoteUrl: 'http://localhost:3004',
    secret: process.env.DEVTOOLS_SECRET,
  }
});
```

---

## UI State Management

### Execution Tree Reconstruction

The UI reconstructs the execution hierarchy from events:

```typescript
// packages/devtools/ui/src/hooks/useExecutionTree.ts

interface ExecutionNode {
  executionId: string;
  agentName: string;
  executionType: 'root' | 'fork' | 'spawn';
  parentExecutionId?: string;
  status: 'running' | 'completed' | 'error';
  ticks: Tick[];
  children: ExecutionNode[];
}

function buildExecutionTree(events: DevToolsEvent[]): ExecutionNode[] {
  const executions = new Map<string, ExecutionNode>();
  const roots: ExecutionNode[] = [];

  for (const event of events) {
    if (event.type === 'execution_start') {
      const node: ExecutionNode = {
        executionId: event.executionId,
        agentName: event.agentName,
        executionType: event.executionType,
        parentExecutionId: event.parentExecutionId,
        status: 'running',
        ticks: [],
        children: [],
      };
      executions.set(event.executionId, node);

      if (event.parentExecutionId) {
        const parent = executions.get(event.parentExecutionId);
        parent?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    if (event.type === 'execution_end') {
      const node = executions.get(event.executionId);
      if (node) {
        node.status = event.finalState === 'error' ? 'error' : 'completed';
      }
    }

    // Build tick data...
  }

  return roots;
}
```

### Filtering

```typescript
// Filter by execution, status, or search
interface FilterState {
  selectedExecutionId?: string;  // Focus on single execution
  showCompleted: boolean;
  showErrors: boolean;
  searchQuery?: string;          // Search tool names, content
}

function filterExecutions(
  nodes: ExecutionNode[],
  filter: FilterState
): ExecutionNode[] {
  return nodes.filter(node => {
    if (filter.selectedExecutionId && node.executionId !== filter.selectedExecutionId) {
      return false;
    }
    if (!filter.showCompleted && node.status === 'completed') {
      return false;
    }
    // ... etc
  });
}
```

---

## Testing Strategy

### Unit Testing the Emitter

```typescript
// packages/core/src/devtools/__tests__/emitter.test.ts

describe('DevToolsEmitter', () => {
  let emitter: DevToolsEmitter;

  beforeEach(() => {
    emitter = DevToolsEmitter.getInstance();
    emitter.clear(); // Reset between tests
  });

  it('should emit events to subscribers', () => {
    const events: DevToolsEvent[] = [];
    emitter.subscribe((event) => events.push(event));

    emitter.emit({
      type: 'execution_start',
      executionId: 'test-1',
      agentName: 'TestAgent',
      timestamp: Date.now(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('execution_start');
  });

  it('should batch content_delta events', async () => {
    const batches: DevToolsEvent[][] = [];
    emitter.onBatch((batch) => batches.push(batch));

    emitter.emit({ type: 'content_delta', delta: 'Hello', ... });
    emitter.emit({ type: 'content_delta', delta: ' world', ... });
    emitter.emit({ type: 'content_delta', delta: '!', ... });

    // Wait for batch window
    await new Promise(r => setTimeout(r, 15));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('should maintain history for late subscribers', () => {
    emitter.emit({ type: 'execution_start', ... });
    emitter.emit({ type: 'tick_start', ... });

    const history = emitter.getHistory();
    expect(history).toHaveLength(2);
  });
});
```

### Integration Testing with Engine

```typescript
// packages/core/src/engine/__tests__/devtools-integration.test.ts

describe('Engine DevTools Integration', () => {
  it('should emit events when devTools is enabled', async () => {
    const events: DevToolsEvent[] = [];
    const emitter = DevToolsEmitter.getInstance();
    emitter.subscribe((event) => events.push(event));

    const engine = createEngine({
      devTools: true,
      model: createMockModel(),
    });

    await engine.execute(
      { timeline: [createUserMessage('Hello')] },
      <SimpleAgent />
    );

    // Verify expected events
    expect(events.some(e => e.type === 'execution_start')).toBe(true);
    expect(events.some(e => e.type === 'tick_start')).toBe(true);
    expect(events.some(e => e.type === 'compiled')).toBe(true);
    expect(events.some(e => e.type === 'model_output')).toBe(true);
    expect(events.some(e => e.type === 'tick_end')).toBe(true);
    expect(events.some(e => e.type === 'execution_end')).toBe(true);
  });

  it('should propagate devTools config to forked engines', async () => {
    const events: DevToolsEvent[] = [];
    const emitter = DevToolsEmitter.getInstance();
    emitter.subscribe((event) => events.push(event));

    const engine = createEngine({
      devTools: { enabled: true, inheritOnFork: true },
      model: createMockModel(),
    });

    await engine.execute(
      { timeline: [createUserMessage('Fork test')] },
      <AgentWithFork />
    );

    // Should see events from both parent and child
    const execStarts = events.filter(e => e.type === 'execution_start');
    expect(execStarts).toHaveLength(2); // parent + fork

    const forkStart = execStarts.find(e => e.executionType === 'fork');
    expect(forkStart?.parentExecutionId).toBe(execStarts[0].executionId);
  });

  it('should not emit events when devTools is disabled', async () => {
    const events: DevToolsEvent[] = [];
    const emitter = DevToolsEmitter.getInstance();
    emitter.subscribe((event) => events.push(event));

    const engine = createEngine({
      devTools: false,
      model: createMockModel(),
    });

    await engine.execute(...);

    expect(events).toHaveLength(0);
  });
});
```

### E2E Testing DevTools Server

```typescript
// packages/devtools/src/__tests__/server.e2e.test.ts

describe('DevTools Server E2E', () => {
  let server: DevToolsHandle;

  beforeAll(async () => {
    server = await startServer({ port: 0, open: false }); // Random port
  });

  afterAll(() => {
    server.stop();
  });

  it('should accept SSE connections', async () => {
    const events: DevToolsEvent[] = [];

    const eventSource = new EventSource(`http://localhost:${server.port}/events`);
    eventSource.onmessage = (e) => events.push(JSON.parse(e.data));

    // Emit a test event
    emitDevToolsEvent({
      type: 'execution_start',
      executionId: 'test-1',
      agentName: 'TestAgent',
      timestamp: Date.now(),
    });

    await waitFor(() => events.length > 0);

    expect(events[0].type).toBe('execution_start');
    eventSource.close();
  });

  it('should accept POST /events in remote mode', async () => {
    const response = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'execution_start',
        executionId: 'remote-1',
        agentName: 'RemoteAgent',
        timestamp: Date.now(),
      }),
    });

    expect(response.ok).toBe(true);
  });
});
```

---

## Summary

The key insight is that **engines should emit events, not have DevTools hook into them**. This inverts the dependency:

- **Current**: DevTools knows about Engine internals (hooks, middleware)
- **Proposed**: Engine knows about DevTools protocol (event types)

This is better because:

1. Engine is the source of truth for what happened
2. DevTools is just a consumer of that information
3. Multiple consumers could subscribe (DevTools, logging, metrics)
4. Works across process boundaries with minimal changes

### Implementation Checklist

- [x] **Phase 1: Engine-Side Emission** ✅ Complete
  - [x] Add `devTools` config option to EngineConfig
  - [x] Create DevToolsEmitter singleton in aidk-shared
  - [x] Add emission points throughout engine lifecycle
  - [x] Implement config inheritance for fork/spawn (`inheritOnFork`, `inheritOnSpawn`)
  - [x] Add environment variable auto-detection (in aidk core)
  - [x] Keep `attachDevTools()` working (stream middleware only, lifecycle events from engine)
  - [x] UI shows fork/spawn hierarchy with badges and aggregate token counts

- [ ] **Phase 2: Enhanced DevTools**
  - [ ] Deprecate `attachDevTools()` with console warning
  - [ ] Add `initDevTools()` as primary API
  - [x] Implement event batching in emitter (content_delta, reasoning_delta)
  - [x] Add memory management (history limits)
  - [ ] Update all documentation

- [ ] **Phase 3: Remote Support**
  - [ ] Add `POST /events` endpoint to server
  - [ ] Implement remote posting in emitter
  - [ ] Add authentication (secret token)
  - [ ] Implement backpressure/retry logic
  - [ ] Create CLI wrapper mode

- [ ] **Phase 4: Cleanup**
  - [ ] Remove `attachDevTools()` completely
  - [ ] Remove lifecycle hook approach from devtools
  - [ ] All event emission is engine-internal
