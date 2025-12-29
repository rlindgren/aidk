# Procedures & Middleware

Procedures are AIDK's foundational abstraction for trackable, middleware-enabled units of work. Every engine tick, model call, and tool execution is a procedure under the hood.

## What is a Procedure?

A procedure wraps any async function with:

- **Middleware pipeline** - Transform inputs, intercept results, handle errors
- **Schema validation** - Zod-based input validation
- **Automatic tracking** - Every call is tracked in a graph with parent-child relationships
- **Cancellation** - Cooperative cancellation via AbortSignal
- **Metrics** - Automatic metric collection and propagation

```tsx
import { createProcedure } from 'aidk-kernel';

const greet = createProcedure(async (name: string) => {
  return `Hello, ${name}!`;
});

// Call it directly
const result = await greet('World'); // "Hello, World!"
```

## Creating Procedures

### Simple Procedure

```tsx
const uppercase = createProcedure(async (input: string) => {
  return input.toUpperCase();
});
```

### With Options

```tsx
import { z } from 'zod';

const validated = createProcedure(
  {
    name: 'processUser',
    schema: z.object({
      name: z.string(),
      age: z.number().min(0),
    }),
    timeout: 5000, // Throws AbortError.timeout() if exceeded
  },
  async (input) => {
    // input is typed as { name: string; age: number }
    return `${input.name} is ${input.age} years old`;
  }
);
```

## Middleware

Middleware intercepts procedure execution. It can transform inputs, modify outputs, handle errors, or short-circuit execution entirely.

### Middleware Signature

```tsx
type Middleware<TArgs> = (
  args: TArgs,
  envelope: ProcedureEnvelope,
  next: (transformedArgs?: TArgs) => Promise<any>
) => Promise<any>;
```

### Example: Logging Middleware

```tsx
const loggingMiddleware: Middleware<[string]> = async (args, envelope, next) => {
  console.log(`${envelope.operationName} called with:`, args);
  const start = Date.now();

  try {
    const result = await next();
    console.log(`${envelope.operationName} completed in ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.error(`${envelope.operationName} failed:`, error);
    throw error;
  }
};

const myProc = createProcedure(
  async (input: string) => input.toUpperCase()
).use(loggingMiddleware);
```

### Example: Retry Middleware

```tsx
const retryMiddleware: Middleware<any[]> = async (args, envelope, next) => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await next();
    } catch (error) {
      lastError = error as Error;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
};
```

### Chaining Middleware

```tsx
const proc = createProcedure(handler)
  .use(loggingMiddleware)
  .use(retryMiddleware)
  .use(validationMiddleware);

// Execution order: logging → retry → validation → handler
```

### Creating Reusable Pipelines

```tsx
import { createPipeline } from 'aidk-kernel';

const commonPipeline = createPipeline()
  .use(loggingMiddleware)
  .use(retryMiddleware);

// Apply to multiple procedures
const proc1 = createProcedure(handler1).use(commonPipeline);
const proc2 = createProcedure(handler2).use(commonPipeline);
```

## Procedure Graph

Procedures automatically track parent-child relationships. When a procedure calls another procedure, the child is registered under the parent.

```
                engine:execute (root)
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     model:generate  tool:run   tool:run
          │
          ▼
     (nested call)
```

### Metric Propagation

When a child procedure completes, its metrics are automatically merged into the parent:

```tsx
const parent = createProcedure(async () => {
  // These children's metrics will propagate up
  await childProc1();
  await childProc2();
});

// After execution, parent has aggregated metrics from all children
```

This is how the engine collects total token usage across all model calls in an execution.

## Timeouts

Procedures can have timeouts:

```tsx
// Via options
const apiCall = createProcedure(
  { name: 'api', timeout: 5000 },
  async (url: string) => fetch(url).then(r => r.json())
);

// Via withTimeout()
const quickCheck = existingProc.withTimeout(1000);

// Handle timeout errors
try {
  await apiCall('https://slow-api.example.com');
} catch (error) {
  if (error instanceof AbortError && error.code === 'ABORT_TIMEOUT') {
    console.log('Request timed out');
  }
}
```

## Procedure Composition

### Pipe

Chain procedures where output flows to input:

```tsx
import { pipe, createProcedure } from 'aidk-kernel';

const parse = createProcedure(async (json: string) => JSON.parse(json));
const validate = createProcedure(async (obj: unknown) => schema.parse(obj));
const transform = createProcedure(async (data: Data) => processData(data));

// Static function (2-5 procedures)
const pipeline = pipe(parse, validate, transform);
const result = await pipeline('{"name": "test"}');

// Or instance method chaining
const samePipeline = parse.pipe(validate).pipe(transform);
```

### withHandle

Get an event handle for long-running procedures:

```tsx
const { handle, result } = myProc.withHandle()('input');

// Subscribe to events
handle.events.on('stream:chunk', (e) => {
  console.log('Progress:', e.payload);
});

// Wait for final result
const output = await result;
```

## Context Integration

Procedures automatically integrate with AIDK's context system:

```tsx
import { Context, createProcedure } from 'aidk-kernel';

const myProc = createProcedure(async (input: string) => {
  const ctx = Context.get(); // Always available inside a procedure

  console.log('Request ID:', ctx.requestId);
  console.log('User:', ctx.user?.id);
  console.log('Trace ID:', ctx.traceId);

  return input;
});
```

## Engine Procedures

The AIDK engine uses procedures internally for all operations:

| Procedure | Purpose |
|-----------|---------|
| `engine:execute` | Root execution |
| `engine:stream` | Streaming execution |
| `engine:tick` | Single tick |
| `model:generate` | Model API call |
| `tool:execute` | Tool execution |
| `fork:execute` | Forked agent |
| `spawn:execute` | Spawned agent |

You can hook into these via engine hooks:

```tsx
engine.hooks.on('model.generate', async (args, envelope, next) => {
  console.log('Model call starting');
  const result = await next();
  console.log('Model call complete');
  return result;
});
```

## Best Practices

### 1. Name Your Procedures

Names make debugging and telemetry clearer:

```tsx
// Good
const fetchUser = createProcedure(
  { name: 'user:fetch' },
  async (id: string) => { /* ... */ }
);

// Less good
const fetchUser = createProcedure(async (id: string) => { /* ... */ });
```

### 2. Use Middleware for Cross-Cutting Concerns

Don't repeat logging, retry, or validation logic:

```tsx
// Good: Middleware handles cross-cutting
const proc = createProcedure(handler).use(loggingMiddleware);

// Less good: Logic repeated in every handler
const proc = createProcedure(async (input) => {
  console.log('Starting...');
  try {
    const result = await doWork(input);
    console.log('Done');
    return result;
  } catch (e) {
    console.error('Failed');
    throw e;
  }
});
```

### 3. Keep Middleware Focused

Each middleware should do one thing:

```tsx
// Good: Single responsibility
const loggingMiddleware = /* ... */;
const retryMiddleware = /* ... */;
const validationMiddleware = /* ... */;

const proc = createProcedure(handler)
  .use(loggingMiddleware)
  .use(retryMiddleware)
  .use(validationMiddleware);

// Less good: One middleware doing everything
const doEverythingMiddleware = async (args, envelope, next) => {
  // logging + retry + validation all mixed together
};
```

### 4. Propagate Context in Async Boundaries

When scheduling work outside the normal flow:

```tsx
const ctx = Context.get();

// Bad: Context lost
setTimeout(() => {
  const ctx = Context.get(); // THROWS
}, 100);

// Good: Context preserved
setTimeout(() => {
  Context.run(ctx, async () => {
    const ctx = Context.get(); // Works
  });
}, 100);
```

## Related

- [Runtime Architecture](/docs/concepts/runtime-architecture) - How procedures fit in the tick loop
- [Context Object Model](/docs/concepts/context-object-model) - The shared state tree
- [Tick Lifecycle](/docs/concepts/tick-lifecycle) - When procedures execute
