# aidk-client

Browser client for connecting to AIDK backends.

## Installation

```bash
pnpm add aidk-client
```

## Usage

```typescript
import { createEngineClient } from 'aidk-client';

// Create client
const client = createEngineClient({
  baseUrl: 'http://localhost:3000',
  userId: 'user-123',
});

// Execute agent
const result = await client.execute('assistant', {
  timeline: [{
    kind: 'message',
    message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
  }]
});

// Stream agent
const stream = client.stream('assistant', { timeline: [...] });
for await (const event of stream) {
  console.log(event.type, event.data);
}

// Subscribe to channels
client.channels.subscribe('todos', (event) => {
  console.log('Todo event:', event);
});
```

## Key Exports

- `createEngineClient()` - Create a client instance
- `EngineClient` - Main client class
- `ExecutionHandler` - Stream processing utilities
- `defineChannel()` - Define typed channels

## Documentation

See the [full documentation](https://your-org.github.io/aidk).

