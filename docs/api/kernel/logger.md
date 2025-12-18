# Logger

Structured, context-aware logging built on [Pino](https://getpino.io/).

Every log entry automatically includes execution context—request IDs, trace IDs, procedure info—without manual effort.

## Quick Start

```typescript
import { Logger } from 'aidk';

// Get the global logger
const log = Logger.get();
log.info('Server started');

// Create a component-scoped logger
class OrderService {
  private log = Logger.for(this);
  
  async createOrder(items: Item[]) {
    this.log.info({ items }, 'Creating order');
    // ...
    this.log.info({ orderId }, 'Order created');
  }
}
```

## Configuration

Configure once at startup:

```typescript
import { Logger } from 'aidk';

Logger.configure({
  level: 'debug',
  contextFields: (ctx) => ({
    // Add your application-specific fields
    tenant_id: ctx.user?.tenantId,
    thread_id: ctx.metadata?.thread_id,
    execution_id: ctx.metadata?.execution_id,
    tick: ctx.metadata?.tick,
  }),
});
```

The `contextFields` extractor is **automatically composed with the defaults**—you don't need to re-specify `request_id`, `trace_id`, etc.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LogLevel` | `'info'` | Minimum log level |
| `contextFields` | `(ctx) => Record<string, unknown>` | Core fields only | Custom context extractor |
| `transport` | Pino transport config | `pino-pretty` in dev | Custom log transport |
| `base` | `Record<string, unknown>` | `{}` | Static fields for every log |
| `prettyPrint` | `boolean` | `true` in dev | Human-readable output |

### Log Levels

From most to least verbose: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`

## Usage Patterns

### Basic Logging

```typescript
const log = Logger.get();

// String message
log.info('User logged in');

// With object (merged into log entry)
log.info({ userId: '123', action: 'login' }, 'User logged in');

// Object only (no message)
log.debug({ query, results });

// Error with stack trace
log.error({ err }, 'Failed to process request');
```

### Component Loggers

Create loggers scoped to a component:

```typescript
class MyAgent extends Component {
  private log = Logger.for(this);  // Adds { component: 'MyAgent' }
  
  onMount(com: ContextObjectModel) {
    this.log.info('Agent mounted');
  }
}

// Or with a string name
const log = Logger.for('OrderProcessor');
```

### Child Loggers

Add bindings that persist across all calls:

```typescript
const log = Logger.get();

const requestLog = log.child({ requestId: req.id });
requestLog.info('Processing request');  // Includes requestId

const userLog = requestLog.child({ userId: user.id });
userLog.info('User action');  // Includes requestId AND userId
```

### Conditional Logging

Avoid expensive computations when level is disabled:

```typescript
if (Logger.isLevelEnabled('debug')) {
  const expensive = computeDebugInfo();
  Logger.get().debug({ expensive }, 'Debug details');
}
```

### Runtime Level Changes

```typescript
// In development, enable debug temporarily
Logger.setLevel('debug');

// In production, reduce noise
Logger.setLevel('warn');
```

## Automatic Context Injection

When running inside a `Context.run()` block (which AIDK does automatically), logs include execution context:

```typescript
// This happens automatically for every agent execution
Context.run(ctx, async () => {
  const log = Logger.get();
  log.info('Processing');
  // Output includes: request_id, trace_id, procedure_id, etc.
});
```

### Default Fields

By default, these `KernelContext` fields are included:

| Field | Source |
|-------|--------|
| `request_id` | `ctx.requestId` |
| `trace_id` | `ctx.traceId` |
| `procedure_id` | `ctx.procedurePid` |
| `procedure_name` | `ctx.procedureNode?.name` |
| `origin_procedure` | `ctx.origin?.name` |

### Adding Custom Fields

Your `contextFields` extractor is composed with defaults:

```typescript
Logger.configure({
  contextFields: (ctx) => ({
    // These are ADDED to defaults, not replacing them
    tenant_id: ctx.user?.tenantId,
    user_id: ctx.user?.id,
    thread_id: ctx.metadata?.thread_id,
    agent: ctx.metadata?.agent,
  }),
});
```

### Full Control

Use `composeContextFields` for explicit control:

```typescript
import { Logger, composeContextFields, defaultContextFields } from 'aidk';

Logger.configure({
  contextFields: composeContextFields(
    // Start fresh (don't include defaults)
    (ctx) => ({
      req: ctx.requestId,
      tid: ctx.user?.tenantId,
    }),
  ),
});
```

## Transports

Configure where logs go:

```typescript
// JSON to stdout (production)
Logger.configure({
  transport: undefined,  // No transport = raw JSON
});

// Pretty print (development)
Logger.configure({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

// Multiple destinations
Logger.configure({
  transport: {
    targets: [
      { target: 'pino-pretty', level: 'info' },
      { target: 'pino/file', options: { destination: '/var/log/app.log' } },
    ],
  },
});

// Custom transport (e.g., to logging service)
Logger.configure({
  transport: {
    target: './my-transport.js',
    options: { apiKey: process.env.LOG_API_KEY },
  },
});
```

## Standalone Loggers

Create loggers that don't share global config:

```typescript
const isolatedLog = Logger.create({
  level: 'trace',
  transport: { target: 'pino/file', options: { destination: './debug.log' } },
});
```

## OpenTelemetry Integration

When OTel tracing is enabled, logs automatically include span context for correlation:

```typescript
// Logs within a traced operation include trace_id and span_id
engine.execute(input, <Agent />);  // Creates spans
// Inside agent:
Logger.get().info('Processing');  // Includes trace_id, span_id
```

## API Reference

### `Logger.get()`

Returns the global logger instance.

### `Logger.for(nameOrComponent)`

Creates a child logger with `{ component: name }` binding.

### `Logger.child(bindings)`

Creates a child logger with custom bindings.

### `Logger.create(config)`

Creates an isolated logger with its own config.

### `Logger.configure(config)`

Configures the global logger. Call once at startup.

### `Logger.setLevel(level)`

Changes log level at runtime.

### `Logger.isLevelEnabled(level)`

Checks if a level would produce output.

### `Logger.level`

Gets the current log level.

### `Logger.reset()`

Resets to defaults (mainly for testing).

## Types

```typescript
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

type ContextFieldsExtractor = (ctx: KernelContext) => Record<string, unknown>;

interface LoggerConfig {
  level?: LogLevel;
  contextFields?: ContextFieldsExtractor;
  transport?: TransportSingleOptions | TransportMultiOptions;
  base?: Record<string, unknown>;
  prettyPrint?: boolean;
}

interface AidkLogger {
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  child(bindings: Record<string, unknown>): AidkLogger;
  level: LogLevel;
  isLevelEnabled(level: LogLevel): boolean;
}
```

