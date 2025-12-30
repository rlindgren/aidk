# ExecutionHandle API Reference

`ExecutionHandle` represents a single agent execution. It provides control over the execution lifecycle, access to results, and metrics.

## Getting an ExecutionHandle

Handles are returned from `engine.execute()`, `engine.stream()`, `engine.fork()`, and `engine.spawn()`:

```tsx
// From stream
const handle = await engine.stream(input, agent);
for await (const event of handle) { ... }

// From fork/spawn
const handle = engine.fork(agent, input);
await handle.waitForCompletion();
```

## Properties

### pid

Unique process identifier for this execution.

```tsx
const pid = handle.pid; // e.g., "fork_abc123"
```

### parentPid

Parent execution's PID (for forks).

```tsx
const parentPid = handle.parentPid; // string | undefined
```

### rootPid

Root execution's PID (top of the execution tree).

```tsx
const rootPid = handle.rootPid;
```

### type

Type of execution.

```tsx
const type = handle.type; // "root" | "fork" | "spawn"
```

### status

Current execution status.

```tsx
const status = handle.status;
// "pending" | "running" | "completed" | "failed" | "cancelled"
```

### startedAt

When the execution started.

```tsx
const startedAt = handle.startedAt; // Date
```

### completedAt

When the execution completed (if finished).

```tsx
const completedAt = handle.completedAt; // Date | undefined
```

## Methods

### waitForCompletion()

Wait for the execution to complete.

```tsx
// Wait indefinitely
const result = await handle.waitForCompletion();

// With timeout
try {
  const result = await handle.waitForCompletion({ timeout: 5000 });
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Timed out');
  }
}
```

**Parameters:**

- `options.timeout?: number` - Maximum wait time in milliseconds

**Returns:** `Promise<COMInput>` - The final context state

**Throws:** `AbortError` if timeout exceeded or execution was cancelled

### cancel()

Cancel the execution.

```tsx
handle.cancel('User requested cancellation');
```

**Parameters:**

- `reason?: string` - Optional cancellation reason

**Behavior:**

1. Sets status to `"cancelled"`
2. Emits abort signal to children
3. Aborts the internal abort controller
4. Rejects the completion promise

### stream()

Get an async iterator of stream events.

```tsx
for await (const event of handle.stream()) {
  if (event.type === 'content_delta') {
    process.stdout.write(event.delta);
  }
}
```

**Returns:** `AsyncIterable<EngineStreamEvent>`

**Note:** Only available if the execution was started with `engine.stream()`.

### send()

Send a message to the running execution.

```tsx
await handle.send({
  type: 'user_input',
  content: 'Stop processing',
});
```

**Parameters:**

- `message: Omit<ExecutionMessage, 'id' | 'timestamp'>` - Message to send

**Behavior:**

1. Message is delivered immediately to component `onMessage` hooks
2. Message is queued for `TickState.queuedMessages` in the next tick

**Throws:** `StateError` if execution is not running or no active session

### emitSignal()

Emit a signal to this execution and its children.

```tsx
handle.emitSignal('abort', 'Operation cancelled');
handle.emitSignal('interrupt', 'Pausing for user input');
```

**Parameters:**

- `signal: SignalType` - Signal type (`'abort'`, `'interrupt'`, `'pause'`, `'resume'`, `'shutdown'`)
- `reason?: string` - Optional reason
- `metadata?: Record<string, any>` - Optional metadata

**Behavior:**

- Signal is emitted on this handle
- Signal propagates to all fork children (not spawns)
- Abort signals trigger the cancel controller

### getResult()

Get the execution result (if completed).

```tsx
const result = handle.getResult(); // COMInput | undefined
```

### getMetrics()

Get execution metrics.

```tsx
const metrics = handle.getMetrics();
// {
//   pid: string,
//   parentPid?: string,
//   rootPid: string,
//   type: ExecutionType,
//   status: ExecutionStatus,
//   startedAt: Date,
//   completedAt?: Date,
//   duration: number,        // milliseconds
//   tickCount: number,
//   error?: { message, phase? }
// }
```

### getDuration()

Get execution duration in milliseconds.

```tsx
const duration = handle.getDuration(); // number (ms)
```

### onShutdown()

Register a shutdown hook for this execution.

```tsx
const unsubscribe = handle.onShutdown(async () => {
  await cleanup();
});
```

## Events

ExecutionHandle extends EventEmitter and emits the following events:

### completed

Emitted when execution completes successfully.

```tsx
handle.on('completed', (result: COMInput) => {
  console.log('Completed with result:', result);
});
```

### failed

Emitted when execution fails.

```tsx
handle.on('failed', (error: Error) => {
  console.error('Execution failed:', error);
});
```

### abort

Emitted when abort signal is received.

```tsx
handle.on('abort', (event: SignalEvent) => {
  console.log('Aborted:', event.reason);
});
```

### Signal Events

Listen for any signal type:

```tsx
handle.on('interrupt', (event: SignalEvent) => { ... });
handle.on('pause', (event: SignalEvent) => { ... });
handle.on('resume', (event: SignalEvent) => { ... });
handle.on('shutdown', (event: SignalEvent) => { ... });
```

## SignalEvent

```tsx
interface SignalEvent {
  type: SignalType;           // 'abort' | 'interrupt' | 'pause' | 'resume' | 'shutdown'
  source: 'engine' | 'execution';
  pid?: string;               // Source execution PID
  parentPid?: string;
  reason?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}
```

## Procedure Metrics

Access metrics from procedures executed within this execution:

```tsx
// Get aggregated metrics from all procedures
const metrics = handle.getProcedureMetrics();
// { input_tokens: 1500, output_tokens: 500, tool_calls: 3, ... }

// Get all procedure nodes
const nodes = handle.getProcedureNodes();

// Get root procedure node
const root = handle.getRootProcedureNode();
```

## Execution State

Create a serializable state object for persistence:

```tsx
const state = handle.toState(agent, input, currentTick, previous);
// {
//   pid, parentPid, rootPid, type, status,
//   input, component, currentTick, previous,
//   startedAt, completedAt, error?
// }
```

## Usage Patterns

### Waiting for Fork Results

```tsx
const forks = [
  engine.fork(ResearchAgent, { topic: 'AI' }),
  engine.fork(ResearchAgent, { topic: 'ML' }),
];

const results = await Promise.all(
  forks.map(f => f.waitForCompletion())
);
```

### Timeout with Fallback

```tsx
try {
  const result = await handle.waitForCompletion({ timeout: 30000 });
} catch (error) {
  if (error.name === 'AbortError') {
    handle.cancel('Timeout');
    // Use partial result or fallback
  }
}
```

### Graceful Cancellation

```tsx
// Listen for user cancellation
userCancelButton.onclick = () => {
  handle.cancel('User cancelled');
};

// Handle cancellation in the execution
handle.on('abort', async (event) => {
  await savePartialProgress();
});
```

### Real-time Progress

```tsx
const handle = await engine.stream(input, agent);

for await (const event of handle.stream()) {
  switch (event.type) {
    case 'tick_start':
      updateProgress(`Starting tick ${event.tick}`);
      break;
    case 'content_delta':
      appendOutput(event.delta);
      break;
    case 'tool_call':
      showToolCall(event.name, event.input);
      break;
    case 'execution_end':
      showFinalResult(event.output);
      break;
  }
}
```

## Related

- [Engine](/docs/api/engine) - Engine API reference
- [Fork & Spawn](/docs/guides/fork-spawn) - Parallel execution guide
- [Metrics & Telemetry](/docs/guides/metrics-telemetry) - Metrics guide
