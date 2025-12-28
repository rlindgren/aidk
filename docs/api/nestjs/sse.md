# SSE Transport for NestJS

Server-Sent Events (SSE) transport for real-time communication with AIDK channels.

## Overview

The `SSETransport` bridges HTTP Server-Sent Events with AIDK's channel system, enabling real-time updates to connected clients.

## Installation

```bash
pnpm add aidk-nestjs
```

## Basic Usage

### Creating a Transport Instance

```typescript
import { Injectable } from '@nestjs/common';
import { SSETransport } from 'aidk-nestjs';

@Injectable()
export class StreamService {
  private transport = new SSETransport({ 
    debug: true,
    heartbeatInterval: 30000,
  });
}
```

### Connecting Clients

```typescript
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { SSETransport } from 'aidk-nestjs';

@Controller('api/stream')
export class StreamController {
  private transport = new SSETransport({ debug: true });

  @Get('sse')
  async sse(
    @Query('connectionId') connectionId: string,
    @Res() res: Response,
  ) {
    await this.transport.connect(connectionId, {
      res,
      metadata: {
        userId: 'user-123',
        threadId: 'thread-456',
      },
      channels: ['updates', 'notifications'],
    });
  }
}
```

## Configuration

### SSETransportConfig

```typescript
interface SSETransportConfig {
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  
  /** Enable debug logging */
  debug?: boolean;
  
  /** Auto-join rooms based on metadata */
  autoJoinRooms?: (metadata: ConnectionMetadata) => string[];
}
```

## Room-Based Routing

Connections can join/leave rooms for targeted messaging:

```typescript
// Join a room
await transport.join(connectionId, 'room-name');

// Leave a room
await transport.leave(connectionId, 'room-name');

// Get rooms for a connection
const rooms = transport.getConnectionRooms(connectionId);

// Get connections in a room
const connections = transport.getRoomConnections('room-name');
```

## Sending Events

```typescript
import { ChannelService } from 'aidk';

// Via ChannelService
channelService.send({
  channel: 'updates',
  type: 'message',
  payload: { text: 'Hello!' },
  target: {
    rooms: ['room-name'],
  },
});

// Directly via transport
await transport.send({
  channel: 'updates',
  type: 'message',
  payload: { text: 'Hello!' },
  target: {
    connectionId: 'conn-123',
  },
});
```

## Event Targeting

Events can target:

- **All connections:** No `target` specified
- **Specific connection:** `target.connectionId`
- **Room members:** `target.rooms`
- **Exclude sender:** `target.excludeSender`

```typescript
// Send to all connections
await transport.send({
  channel: 'broadcast',
  type: 'announcement',
  payload: { message: 'Server restarting' },
});

// Send to specific room
await transport.send({
  channel: 'updates',
  type: 'notification',
  payload: { text: 'New message' },
  target: {
    rooms: ['thread-123'],
  },
});

// Broadcast excluding sender
await transport.send({
  channel: 'chat',
  type: 'message',
  payload: { text: 'Hello!' },
  metadata: {
    sourceConnectionId: 'conn-123',
  },
  target: {
    excludeSender: true,
  },
});
```

## Disconnecting Clients

```typescript
// Disconnect specific client
await transport.disconnect(connectionId);

// Disconnect all clients
await transport.disconnect();

// Graceful shutdown
transport.closeAll();
```

## Integration with ChannelService

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { SSETransport } from 'aidk-nestjs';
import { ChannelService } from 'aidk';

@Injectable()
export class ChannelService implements OnModuleInit {
  private transport = new SSETransport();

  onModuleInit() {
    // Register transport with channel service
    const channelService = new ChannelService({
      transports: [this.transport],
    });
  }
}
```

## Example: Complete SSE Endpoint

```typescript
import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import { Request, Response } from 'express';
import { SSETransport } from 'aidk-nestjs';

@Controller('api/stream')
export class StreamController {
  private transport = new SSETransport({ debug: true });

  @Get('sse')
  async sse(
    @Query('connectionId') connectionId: string,
    @Query('channels') channels?: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const channelList = channels?.split(',') || [];
    
    await this.transport.connect(connectionId, {
      res,
      channels: channelList,
      metadata: {
        userId: req.headers['x-user-id'] as string,
        threadId: req.query.threadId as string,
        ip: req.ip,
      },
    });

    // Auto-join room based on threadId
    if (req.query.threadId) {
      await this.transport.join(connectionId, `thread:${req.query.threadId}`);
    }
  }
}
```

## Lifecycle Hooks

The transport automatically handles:

- **Heartbeat:** Sends periodic heartbeat messages to keep connection alive
- **Cleanup:** Removes connections when they disconnect
- **Error handling:** Closes connections on write errors

## Best Practices

1. **Use connection IDs:** Generate unique IDs per client session
2. **Set metadata:** Include user/thread IDs for room auto-joining
3. **Handle disconnects:** Clean up resources when clients disconnect
4. **Use rooms:** Organize connections by thread, user, or feature
5. **Monitor connections:** Track active connections for debugging

