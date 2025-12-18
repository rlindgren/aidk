# EngineContextInterceptor

An interceptor that automatically sets up execution context for engine operations.

## Overview

The `EngineContextInterceptor` extracts user/tenant/thread IDs from incoming requests and sets them in async-local storage, making them available throughout the request lifecycle.

## Usage

### Global Interceptor

Apply globally in your module:

```typescript
import { Module } from '@nestjs/common';
import { EngineModule, EngineContextInterceptor } from 'aidk-nestjs';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [EngineModule.forRoot({ engine })],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: EngineContextInterceptor,
    },
  ],
})
export class AppModule {}
```

### Controller-Level Interceptor

Apply to specific controllers:

```typescript
import { Controller, UseInterceptors } from '@nestjs/common';
import { EngineContextInterceptor } from 'aidk-nestjs';

@Controller('api/agent')
@UseInterceptors(EngineContextInterceptor)
export class AgentController {}
```

### Route-Level Interceptor

Apply to specific routes:

```typescript
import { Controller, Post, UseInterceptors } from '@nestjs/common';
import { EngineContextInterceptor } from 'aidk-nestjs';

@Controller('api/agent')
export class AgentController {
  @Post('stream')
  @UseInterceptors(EngineContextInterceptor)
  async stream() {}
}
```

## Context Extraction

The interceptor extracts context from:

1. **Request Body:**
   - `body.thread_id`
   - `body.user_id`
   - `body.tenant_id`
   - `body.session_id`

2. **Request Headers:**
   - `x-thread-id` or `thread-id`
   - `x-user-id` or `user-id`
   - `x-tenant-id` or `tenant-id`
   - `x-session-id` or `session-id`

## Accessing Context

Once the interceptor is applied, context is available via `Context.get()`:

```typescript
import { Context } from 'aidk';

@Injectable()
export class MyService {
  async doSomething() {
    const ctx = Context.get();
    const threadId = ctx.metadata.thread_id;
    const userId = ctx.metadata.user_id;
    // ...
  }
}
```

## Example

```typescript
import { Module } from '@nestjs/common';
import { EngineModule, EngineContextInterceptor } from 'aidk-nestjs';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { createEngine } from 'aidk';

@Module({
  imports: [
    EngineModule.forRoot({
      engine: createEngine(),
    }),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: EngineContextInterceptor,
    },
  ],
})
export class AppModule {}
```

## Custom Context Extraction

To customize context extraction, you can extend the interceptor:

```typescript
import { Injectable } from '@nestjs/common';
import { EngineContextInterceptor } from 'aidk-nestjs';
import { Context } from 'aidk';

@Injectable()
export class CustomContextInterceptor extends EngineContextInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    // Custom extraction logic
    const customContext = Context.create({
      metadata: {
        thread_id: request.headers['custom-thread-id'],
        user_id: request.user?.id, // From auth guard
        // ...
      },
    });
    
    return new Observable((subscriber) => {
      Context.run(customContext, async () => {
        const source$ = next.handle();
        source$.subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
```

