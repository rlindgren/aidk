# aidk-nestjs

NestJS integration for AIDK.

## Installation

```bash
pnpm add aidk-nestjs aidk @nestjs/common @nestjs/core rxjs
```

## Usage

### Basic Setup

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { EngineModule } from 'aidk-nestjs';
import { createEngine } from 'aidk';

@Module({
  imports: [
    EngineModule.forRoot({
      engine: createEngine(),
    }),
  ],
})
export class AppModule {}
```

### Controller with Streaming

```typescript
// agent.controller.ts
import { Controller, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { StreamAgent } from 'aidk-nestjs';
import { EngineInput } from 'aidk';
import { TaskAssistant } from './agents/task-assistant';

@Controller('api/agent')
export class AgentController {
  @Post('stream')
  @StreamAgent(<TaskAssistant />)
  async stream(@Body() input: EngineInput, @Res() res: Response) {
    // Handler will be wrapped by interceptor
    return input;
  }
}
```

### Using SSE Transport

```typescript
// agent.controller.ts
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { SSETransport } from 'aidk-nestjs';

@Controller('api/stream')
export class StreamController {
  private transport = new SSETransport({ debug: true });

  @Get('sse')
  async sse(@Query('connectionId') connectionId: string, @Res() res: Response) {
    await this.transport.connect(connectionId, {
      res,
      metadata: {
        user_id: 'user-123',
        thread_id: 'thread-456',
      },
    });
  }
}
```

## Key Exports

- `EngineModule` - NestJS module for engine integration
- `StreamAgent()` - Decorator for streaming agent execution
- `ExecuteAgent()` - Decorator for non-streaming agent execution
- `EngineContextInterceptor` - Interceptor that sets up execution context
- `EngineContextGuard` - Guard that verifies context is available
- `SSETransport` - SSE transport for real-time communication

## Documentation

See the [full documentation](https://your-org.github.io/aidk).

