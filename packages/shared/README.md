# aidk-kernel

Low-level execution primitives for AIDK.

## Installation

```bash
pnpm add aidk-kernel
```

> **Note:** This package is typically used internally by `aidk`. Most users don't need to install it directly.

## Usage

```typescript
import { Context, Telemetry } from 'aidk-kernel';

// Access execution context
const ctx = Context.get();
console.log(ctx.metadata);

// Create telemetry spans
const span = Telemetry.startSpan('my-operation');
try {
  // ... do work
  span.setAttribute('result', 'success');
} finally {
  span.end();
}
```

## Key Exports

- `Context` - Async-local execution context
- `Telemetry` - OpenTelemetry integration
- `ExecutionHandle` - Execution lifecycle management

## Documentation

See the [full documentation](https://your-org.github.io/aidk).
