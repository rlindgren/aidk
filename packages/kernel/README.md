# aidk-kernel

Low-level execution primitives for AIDK.

> **Architecture Documentation:** See [ARCHITECTURE.md](./ARCHITECTURE.md) for comprehensive technical documentation.

## Installation

```bash
pnpm add aidk-kernel
```

> **Note:** This package is typically used internally by `aidk`. Most users don't need to install it directly.

## Overview

The kernel provides foundational primitives that all AIDK packages build upon:

- **Context** - Execution context that flows automatically through async call chains
- **Procedure** - Wrap functions with middleware, validation, and tracking
- **ProcedureGraph** - Track parent-child relationships between procedures
- **ExecutionTracker** - Automatic telemetry and metrics collection
- **Channel** - Pub/sub primitives for bidirectional communication
- **Telemetry** - Pluggable observability provider
- **Logger** - Structured logging with automatic context injection

## Quick Start

```typescript
import { Context, createProcedure, Logger, Telemetry } from "aidk-kernel";

// Create a procedure (tracked, middleware-enabled)
const greet = createProcedure(async (name: string) => {
  const ctx = Context.get();
  Logger.get().info("Greeting user", { name, requestId: ctx.requestId });
  return `Hello, ${name}!`;
});

// Execute with context
const ctx = Context.create({ user: { id: "user-1" } });
const result = await Context.run(ctx, () => greet("World"));

// Add middleware
const withLogging = greet.use(async (args, envelope, next) => {
  console.log(`Calling ${envelope.operationName}`);
  return next();
});

// Get execution handle for streaming/events
const { handle, result } = greet.withHandle()("World");
handle.events.on("*", (event) => console.log(event));
await result;
```

## Key Exports

| Export             | Description                                    |
| ------------------ | ---------------------------------------------- |
| `Context`          | Async-local execution context (get, run, emit) |
| `createProcedure`  | Create tracked, middleware-enabled functions   |
| `createHook`       | Create procedures marked as hooks              |
| `ExecutionTracker` | Wrap execution with automatic telemetry        |
| `ProcedureGraph`   | Track procedure hierarchy                      |
| `Channel`          | Pub/sub communication primitive                |
| `Telemetry`        | Pluggable telemetry provider                   |
| `Logger`           | Structured logging with context injection      |

## Documentation

- [Architecture Documentation](./ARCHITECTURE.md) - Comprehensive technical details
- [Full AIDK Documentation](https://rlindgren.github.io/aidk)
