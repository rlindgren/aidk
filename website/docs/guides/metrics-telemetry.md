# Metrics & Telemetry

AIDK provides built-in metrics collection and telemetry integration. Track token usage, execution times, and custom metrics across your agents.

## Overview

Metrics in AIDK flow through the execution hierarchy:

```
engine:execute
├── metrics: { totalTokens: 250, ... }
│
├── model:generate
│   └── metrics: { inputTokens: 100, outputTokens: 50 }
│
├── tool:execute
│   └── metrics: { apiCalls: 1, latencyMs: 200 }
│
└── model:generate
    └── metrics: { inputTokens: 80, outputTokens: 20 }
```

When a child procedure completes, its metrics automatically propagate up to the parent. The root execution ends up with aggregated metrics from all children.

## Execution Metrics

### Getting Metrics from ExecutionHandle

```tsx
const handle = await engine.stream(input, <MyAgent />);

// Stream the response
for await (const event of handle.stream()) {
  // Process events...
}

// Get final metrics
const metrics = handle.getMetrics();
console.log(metrics);
// {
//   inputTokens: 180,
//   outputTokens: 70,
//   totalTokens: 250,
//   ticks: 3,
//   toolCalls: 2,
//   durationMs: 1234
// }
```

### Metrics Shape

```tsx
interface ExecutionMetrics {
  // Token usage
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;

  // Execution info
  ticks?: number;
  toolCalls?: number;
  durationMs?: number;

  // Custom metrics (you can add your own)
  [key: string]: number | undefined;
}
```

## Custom Metrics

### Adding Metrics in Components

```tsx
import { addMetric, setMetric, getMetric } from 'aidk-kernel';

class MyAgent extends Component {
  async onTickEnd(com, state) {
    const ctx = context();

    // Accumulate a metric (adds to existing value)
    addMetric(ctx, 'customApiCalls', 1);

    // Set a metric (overwrites)
    setMetric(ctx, 'lastResponseTime', Date.now());

    // Read a metric
    const calls = getMetric(ctx, 'customApiCalls');
  }
}
```

### Adding Metrics in Tools

```tsx
const MyTool = createTool({
  name: 'my_tool',
  description: 'A tool that tracks metrics',
  parameters: z.object({ query: z.string() }),

  handler: async (input) => {
    const ctx = context();
    const start = Date.now();

    const result = await externalApi(input.query);

    // Track custom metrics
    addMetric(ctx, 'externalApiCalls', 1);
    addMetric(ctx, 'externalApiLatencyMs', Date.now() - start);

    return [{ type: 'text', text: JSON.stringify(result) }];
  },
});
```

### Usage Metrics (Token Counting)

AIDK provides convenience functions for token usage:

```tsx
import { addUsageMetrics, getUsageMetrics } from 'aidk-kernel';

// Add token usage
addUsageMetrics(ctx, {
  inputTokens: 100,
  outputTokens: 50,
});

// Get accumulated usage
const usage = getUsageMetrics(ctx);
// { inputTokens: 100, outputTokens: 50 }
```

Model adapters call `addUsageMetrics` automatically after each model call.

## Engine Metrics

### Global Engine Metrics

```tsx
const engine = createEngine();

// Execute some agents...
await engine.execute(input1, <Agent1 />);
await engine.execute(input2, <Agent2 />);

// Get aggregated engine metrics
const engineMetrics = engine.getMetrics();
console.log(engineMetrics);
// {
//   totalExecutions: 2,
//   completedExecutions: 2,
//   failedExecutions: 0,
//   totalTicks: 7,
//   totalTokens: 500,
//   ...
// }
```

## Telemetry Integration

AIDK supports pluggable telemetry providers for distributed tracing.

### Setting Up OpenTelemetry

```tsx
import { Telemetry } from 'aidk-kernel';
import { OTelProvider } from './otel-provider'; // Your adapter

// Configure at app startup
const tracerProvider = // ... your OpenTelemetry setup
Telemetry.setProvider(new OTelProvider(tracerProvider));
```

### TelemetryProvider Interface

```tsx
interface TelemetryProvider {
  startTrace(name: string): string;
  startSpan(name: string): Span;
  recordError(error: any): void;
  endTrace(): void;
  getCounter(name: string): Counter;
  getHistogram(name: string): Histogram;
}

interface Span {
  end(): void;
  setAttribute(key: string, value: any): void;
  recordError(error: any): void;
}

interface Counter {
  add(value: number, attributes?: Record<string, any>): void;
}

interface Histogram {
  record(value: number, attributes?: Record<string, any>): void;
}
```

### Default NoOp Provider

By default, AIDK uses a `NoOpProvider` that does nothing. This means telemetry has zero overhead unless you configure a real provider.

### Example: Custom Telemetry Provider

```tsx
class DatadogProvider implements TelemetryProvider {
  private tracer: any;

  constructor(tracer: any) {
    this.tracer = tracer;
  }

  startSpan(name: string): Span {
    const ddSpan = this.tracer.startSpan(name);
    return {
      end: () => ddSpan.finish(),
      setAttribute: (key, value) => ddSpan.setTag(key, value),
      recordError: (error) => ddSpan.setTag('error', error),
    };
  }

  // ... implement other methods
}

Telemetry.setProvider(new DatadogProvider(datadogTracer));
```

## Automatic Span Names

AIDK creates spans with consistent naming:

| Operation | Span Name |
|-----------|-----------|
| Engine execute | `engine:execute` |
| Engine stream | `engine:stream` |
| Single tick | `engine:tick` |
| Model call | `model:generate` |
| Tool execution | `tool:execute:{toolName}` |
| Fork | `fork:execute` |
| Spawn | `spawn:execute` |

### Span Naming Best Practices

Span names should be **low cardinality** (not include unique IDs):

```tsx
// Good: Low cardinality
'tool:execute:calculator'
'model:generate'
'engine:tick'

// Bad: High cardinality (includes unique IDs)
'tool:execute:calculator:call-123-abc'
'model:generate:request-456'
```

Use span attributes for unique identifiers:

```tsx
const span = Telemetry.startSpan('tool:execute:calculator');
span.setAttribute('tool_call_id', 'call-123-abc');
span.setAttribute('request_id', ctx.requestId);
```

## Metrics in Fork/Spawn

### Fork: Metrics Propagate

Forked executions propagate their metrics to the parent:

```tsx
class ParentAgent extends Component {
  render() {
    return (
      <>
        <Fork
          agent={<ChildAgent />}
          waitUntilComplete={true}
          onComplete={(result) => {
            // Child's token usage is now in parent's metrics
          }}
        />
      </>
    );
  }
}

// After execution, parent handle.getMetrics() includes child's metrics
```

### Spawn: Metrics Independent

Spawned executions are independent—their metrics don't propagate to the parent:

```tsx
<Spawn agent={<BackgroundLogger />} />
// BackgroundLogger's metrics are tracked separately
```

## Structured Logging

AIDK's logger automatically includes context:

```tsx
import { Logger } from 'aidk-kernel';

const log = Logger.get();

log.info('Processing request');
// Output includes: request_id, trace_id, procedure_id, etc.

const toolLog = Logger.for('MyTool');
toolLog.debug('Executing', { expression: '2+2' });
// Output includes: component: 'MyTool' + context fields
```

### Configuring the Logger

```tsx
Logger.configure({
  level: process.env.LOG_LEVEL ?? 'info',
  contextFields: (ctx) => ({
    request_id: ctx.requestId,
    trace_id: ctx.traceId,
    user_id: ctx.user?.id,
    tenant_id: ctx.user?.tenantId,
  }),
});
```

## Best Practices

### 1. Use Meaningful Metric Names

```tsx
// Good: Descriptive, namespaced
addMetric(ctx, 'search.apiCalls', 1);
addMetric(ctx, 'search.resultsReturned', results.length);
addMetric(ctx, 'cache.hits', cacheHit ? 1 : 0);

// Less good: Generic
addMetric(ctx, 'count', 1);
addMetric(ctx, 'value', x);
```

### 2. Track Business Metrics

```tsx
// Track what matters for your application
addMetric(ctx, 'orders.processed', 1);
addMetric(ctx, 'recommendations.shown', recommendations.length);
addMetric(ctx, 'userQueries.answered', 1);
```

### 3. Use Histograms for Latency

```tsx
const histogram = Telemetry.getHistogram('tool.latency', 'ms');

const start = Date.now();
const result = await doWork();
histogram.record(Date.now() - start, { tool: 'calculator' });
```

### 4. Set Up Alerts on Key Metrics

Monitor these metrics in production:
- `totalTokens` - Cost tracking
- `failedExecutions` - Error rate
- `durationMs` - Latency
- `toolCalls` - Tool usage patterns

## Related

- [Procedures & Middleware](/docs/advanced/procedures) - How metrics propagate through procedures
- [Runtime Architecture](/docs/concepts/runtime-architecture) - The execution model
- [Error Handling](/docs/guides/error-handling) - Error tracking and recovery
