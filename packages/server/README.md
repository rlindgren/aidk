# aidk-server

Server utilities for AIDK.

## Installation

```bash
pnpm add aidk-server
```

## Usage

```typescript
import { ChannelBroadcaster, RedisAdapter } from 'aidk-server';

// Create a broadcaster
const broadcaster = new ChannelBroadcaster();

// With Redis for multi-server deployments
const broadcaster = new ChannelBroadcaster({
  adapter: new RedisAdapter({ url: 'redis://localhost:6379' }),
});

// Broadcast events
broadcaster.publish('todos', {
  type: 'created',
  payload: { id: '1', title: 'New task' },
});
```

## Key Exports

- `ChannelBroadcaster` - Pub/sub for channels
- `RedisAdapter` - Redis adapter for scaling
- `InMemoryAdapter` - Simple in-memory adapter

## Documentation

See the [full documentation](https://rlindgren.github.io/aidk).
