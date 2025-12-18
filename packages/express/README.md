# aidk-express

Express.js middleware for AIDK.

## Installation

```bash
pnpm add aidk-express aidk express
```

## Usage

```typescript
import express from 'express';
import { createEngine } from 'aidk';
import { createSSEHandler, createExpressMiddleware } from 'aidk-express';

const app = express();
const engine = createEngine();

// SSE streaming endpoint
app.post('/api/agent/stream', createSSEHandler({
  engine,
  getAgent: (req) => <MyAgent />,
}));

// Or use the full middleware
app.use('/api/agent', createExpressMiddleware({
  engine,
  agent: <MyAgent />,
}));

app.listen(3000);
```

## Key Exports

- `createSSEHandler()` - Create SSE streaming handler
- `createExpressMiddleware()` - Create full middleware

## Documentation

See the [full documentation](https://your-org.github.io/aidk).

