# Engine API Reference

The `Engine` class is the core runtime that manages agent execution, tool coordination, and lifecycle management.

## Constructor

```tsx
import { Engine } from 'aidk';

const engine = new Engine(config?: EngineConfig);
```

### EngineConfig

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Optional unique identifier (auto-generated if not provided) |
| `name` | `string` | Human-readable name for the engine |
| `model` | `ModelInstance \| string` | Default model adapter or registry key |
| `tools` | `(ToolClass \| ExecutableTool \| string)[]` | Tools available to the engine |
| `maxTicks` | `number` | Maximum ticks before stopping (default: 10) |
| `mcpServers` | `Record<string, MCPServerConfig>` | MCP server configurations |
| `channels` | `ChannelServiceConfig \| ChannelService` | Channel service for real-time communication |
| `root` | `JSX.Element \| ComponentDefinition` | Default root component |
| `lifecycleHooks` | `EngineLifecycleHooks` | Lifecycle hook configuration |
| `hooks` | `EngineStaticHooks` | Static hook configuration |
| `toolExecution` | `ToolExecutionOptions` | Tool execution configuration |
| `renderers` | `Record<string, Renderer>` | Custom renderers |
| `persistExecutionState` | `(state) => Promise<void>` | Persistence callback |
| `loadExecutionState` | `(pid) => Promise<ExecutionState>` | State loading callback |

## Methods

### execute()

Execute an agent and return the final result.

```tsx
const result = await engine.execute(input, agent?);
```

**Parameters:**
- `input: EngineInput` - Input data including timeline, messages, etc.
- `agent?: ComponentDefinition` - Optional agent component (uses config root if not provided)

**Returns:** `Promise<COMInput>` - The final context object model state

### stream()

Execute an agent and stream events in real-time.

```tsx
const handle = await engine.stream(input, agent?);
for await (const event of handle) {
  switch (event.type) {
    case 'tick_start': // Tick beginning
    case 'model_chunk': // Streaming model output
    case 'tool_call': // Tool being called
    case 'tool_result': // Tool execution result
    case 'tick_end': // Tick completed
    case 'agent_end': // Execution finished
    case 'error': // Error occurred
  }
}
```

**Returns:** `AsyncIterable<EngineStreamEvent>`

### fork()

Create a child execution with inherited state.

```tsx
const handle = engine.fork(agent, input, options?);
```

**Parameters:**
- `agent: JSX.Element | ComponentDefinition` - Agent to execute
- `input: EngineInput` - Input data
- `options?: ForkOptions` - Fork configuration

**ForkOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `parentPid` | `string` | Explicit parent PID (auto-detected if in execution context) |
| `inherit` | `ForkInheritanceOptions` | What to inherit from parent |
| `engineConfig` | `Partial<EngineConfig>` | Override engine config for fork |
| `hooks` | `EngineStaticHooks` | Additional hooks for fork |

**ForkInheritanceOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `timeline` | `"copy" \| "reference"` | How to inherit timeline |
| `sections` | `"copy" \| "reference"` | How to inherit sections |
| `tools` | `"share"` | Share parent's tools |
| `channels` | `boolean` | Inherit channel service |
| `traceId` | `boolean` | Inherit trace ID |
| `context` | `boolean` | Inherit context properties |
| `hooks` | `boolean` | Inherit hooks (default: true) |

**Returns:** `ExecutionHandle`

### spawn()

Create an independent child execution (no inherited state).

```tsx
const handle = engine.spawn(agent, input, options?);
```

**Parameters:**
- `agent: JSX.Element | ComponentDefinition` - Agent to execute
- `input: EngineInput` - Input data
- `options?: SpawnOptions` - Spawn configuration

**Returns:** `ExecutionHandle`

### shutdown()

Gracefully shutdown the engine.

```tsx
await engine.shutdown(reason?);
```

- Calls `onShutdown` lifecycle hooks
- Aborts all running executions
- Emits shutdown signal

### destroy()

Clean up engine resources.

```tsx
engine.destroy();
```

- Calls `onDestroy` lifecycle hooks
- Destroys channel service
- Clears execution graph

## Lifecycle Hooks

Register hooks for engine lifecycle events:

```tsx
// Via constructor
const engine = new Engine({
  lifecycleHooks: {
    onInit: [(engine) => console.log('Engine initialized')],
    onShutdown: [(engine, reason) => console.log('Shutting down:', reason)],
  }
});

// Via methods
const unsubscribe = engine.onInit((engine) => { ... });
const unsubscribe = engine.onShutdown((engine, reason) => { ... });
const unsubscribe = engine.onDestroy((engine) => { ... });
const unsubscribe = engine.onExecutionStart((input, agent, handle) => { ... });
const unsubscribe = engine.onExecutionEnd((output, handle) => { ... });
const unsubscribe = engine.onExecutionError((error, handle) => { ... });
const unsubscribe = engine.onTickStart((tick, state, handle) => { ... });
const unsubscribe = engine.onTickEnd((tick, state, response, handle) => { ... });
const unsubscribe = engine.onAfterCompile((compiled, state, handle) => { ... });
```

### Hook Types

| Hook | Parameters | When Called |
|------|------------|-------------|
| `onInit` | `(engine)` | After engine construction |
| `onShutdown` | `(engine, reason?)` | During graceful shutdown |
| `onDestroy` | `(engine)` | When engine is destroyed |
| `onExecutionStart` | `(input, agent?, handle?)` | Before first tick |
| `onExecutionEnd` | `(output, handle?)` | After successful completion |
| `onExecutionError` | `(error, handle?)` | On execution error |
| `onTickStart` | `(tick, state, handle?)` | At start of each tick |
| `onTickEnd` | `(tick, state, response, handle?)` | At end of each tick |
| `onAfterCompile` | `(compiled, state, handle?)` | After component compilation |

## Properties

### model

Get the current model instance.

```tsx
const model = engine.model; // ModelInstance | undefined
```

### tools

Get registered tools.

```tsx
const tools = engine.tools; // (ToolClass | ExecutableTool)[]
```

### channels

Get the channel service (if configured).

```tsx
const channelService = engine.channels; // ChannelService | undefined
```

### hooks

Access hook registries.

```tsx
engine.hooks.components  // ComponentHookRegistry
engine.hooks.models      // ModelHookRegistry
engine.hooks.tools       // ToolHookRegistry
```

## Metrics & Introspection

### getMetrics()

Get engine-level metrics.

```tsx
const metrics = engine.getMetrics();
// {
//   activeExecutions: number,
//   totalExecutions: number,
//   executionsByStatus: { running, completed, failed, cancelled },
//   executionsByType: { root, spawn, fork },
//   averageExecutionTime: number,
//   memoryUsage: NodeJS.MemoryUsage,
//   timestamp: Date
// }
```

### getExecutionTree()

Get execution hierarchy starting from a root PID.

```tsx
const tree = engine.getExecutionTree(rootPid);
// ExecutionTreeNode: { handle, children: ExecutionTreeNode[] }
```

### getOutstandingForks()

Get active child executions for a parent.

```tsx
const forks = engine.getOutstandingForks(parentPid);
// ExecutionHandle[]
```

### getOrphanedForks()

Get forks whose parent has completed but are still running.

```tsx
const orphans = engine.getOrphanedForks();
// ExecutionHandle[]
```

### getExecutionHandle()

Get an execution handle by PID.

```tsx
const handle = engine.getExecutionHandle(pid);
// ExecutionHandle | undefined
```

## Execution Persistence

### resumeExecution()

Resume an execution from persisted state.

```tsx
const handle = await engine.resumeExecution(state);
```

**Note:** Requires `loadExecutionState` to be configured.

## Signals

Listen for engine-level signals.

```tsx
engine.onSignal('shutdown', (event) => {
  console.log('Shutdown signal:', event.reason);
});
```

**Signal Types:**
- `shutdown` - Engine shutting down
- `abort` - Execution aborted
- `interrupt` - Execution interrupted

## Static Hooks

Define hooks at the class level:

```tsx
class MyEngine extends Engine {
  static hooks = {
    execute: [loggingMiddleware],
    stream: [metricsMiddleware],
    component: {
      onMount: [componentLoggingMiddleware],
    },
    model: {
      generate: [modelLoggingMiddleware],
    },
  };
}
```

## Related

- [ExecutionHandle](/docs/api/execution-handle) - Manage individual executions
- [COM](/docs/api/com) - Context Object Model API
- [Fork & Spawn](/docs/guides/fork-spawn) - Parallel execution guide
