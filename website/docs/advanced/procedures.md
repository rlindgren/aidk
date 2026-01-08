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
import { context, createProcedure } from 'aidk-kernel';

const myProc = createProcedure(async (input: string) => {
  const ctx = context(); // Always available inside a procedure

  console.log('Request ID:', ctx.requestId);
  console.log('User:', ctx.user?.id);
  console.log('Trace ID:', ctx.traceId);

  return input;
});
```

## Execution Boundaries

Procedures can declare how they relate to executions via the `executionBoundary` configuration. This enables DevTools to correctly group and display procedure hierarchies.

```tsx
type ExecutionBoundaryConfig = 'always' | 'child' | 'auto' | false;
```

| Config     | Behavior                                                                |
| ---------- | ----------------------------------------------------------------------- |
| `'always'` | Always creates a new execution (for entry points like `engine:execute`) |
| `'child'`  | Creates a child execution linked to parent (for fork/spawn operations)  |
| `'auto'`   | Creates execution only if not already in one (default, for model calls) |
| `false`    | Never creates boundary, inherits from parent (for internal procedures)  |

### Example: Custom Entry Point

```tsx
const myEntryPoint = createProcedure(
  {
    name: 'myApp:execute',
    executionBoundary: 'always',  // Start new execution
    executionType: 'custom',      // Shows in DevTools as "custom" type
  },
  async (input) => {
    // This procedure starts a new execution for DevTools
    return await processInput(input);
  }
);
```

### Internal vs Public Procedures

For internal procedures that should inherit their parent's execution context:

```tsx
const internalHelper = createProcedure(
  {
    name: 'internal:helper',
    executionBoundary: false,  // Never creates boundary
  },
  async (input) => {
    // Inherits executionId from parent procedure
    return input;
  }
);
```

## Creating Execution Boundaries with `withExecution`

For user-defined operations that should appear as distinct executions in DevTools, use the `withExecution` helper. This is useful for:

- Hook operations (e.g., context summarization in `onAfterCompile`)
- Custom orchestration logic
- Any operation you want to observe and track separately

```tsx
import { withExecution } from 'aidk';

// In a hook, wrap expensive operations
async function onAfterCompile(ctx) {
  // This creates a named execution boundary visible in DevTools
  await withExecution("Summarize Context", async () => {
    const summary = await model.generate(summarizePrompt);
    ctx.updateContext(summary);
  });
}
```

### With Options

```tsx
const result = await withExecution({
  name: "Validate Response",
  type: "validation",  // Shown as badge in DevTools
  metadata: { validator: "schema" }
}, async () => {
  return validateSchema(response);
});
```

### How It Works

`withExecution` creates a child execution linked to the current parent (if any):

1. Gets the current execution context (if running inside an engine)
2. Creates a new execution with `executionBoundary: 'child'`
3. Runs your function within that boundary
4. Emits procedure events for DevTools tracking

```
Parent Engine (executionId: A)
    │
    └── withExecution("Summarize") (executionId: B, parent: A)
            │
            └── model.generate() (inherits B)
```

### When to Use

| Scenario                            | Use `withExecution`?          |
| ----------------------------------- | ----------------------------- |
| Hook performs expensive model call  | ✅ Yes                        |
| Custom orchestration between agents | ✅ Yes                        |
| Simple state update                 | ❌ No (overhead not worth it) |
| Debugging visibility needed         | ✅ Yes                        |

## Engine Procedures

The AIDK engine uses procedures internally for all operations:

| Procedure        | Purpose             | Boundary |
| ---------------- | ------------------- | -------- |
| `engine:execute` | Root execution      | `always` |
| `engine:stream`  | Streaming execution | `always` |
| `engine:tick`    | Single tick         | `false`  |
| `model:generate` | Model API call      | `auto`   |
| `model:stream`   | Streaming model     | `auto`   |
| `tool:execute`   | Tool execution      | `false`  |
| `component:*`    | Lifecycle methods   | `false`  |

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
const ctx = context();

// Bad: Context lost
setTimeout(() => {
  const ctx = context(); // THROWS
}, 100);

// Good: Context preserved
setTimeout(() => {
  Context.run(ctx, async () => {
    const ctx = context(); // Works
  });
}, 100);
```

## Related

- [Runtime Architecture](/docs/concepts/runtime-architecture) - How procedures fit in the tick loop
- [Context Object Model](/docs/concepts/context-object-model) - The shared state tree
- [Tick Lifecycle](/docs/concepts/tick-lifecycle) - When procedures execute
- [DevTools](/docs/guides/devtools) - Visualizing execution hierarchies
