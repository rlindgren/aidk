# EngineContextGuard

A guard that verifies execution context is available before allowing route access.

## Overview

The `EngineContextGuard` ensures that execution context has been set up (typically by `EngineContextInterceptor`) before allowing the route handler to execute.

## Usage

### Controller-Level Guard

```typescript
import { Controller, UseGuards } from '@nestjs/common';
import { EngineContextGuard } from 'aidk-nestjs';

@Controller('api/agent')
@UseGuards(EngineContextGuard)
export class AgentController {}
```

### Route-Level Guard

```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { EngineContextGuard } from 'aidk-nestjs';

@Controller('api/agent')
export class AgentController {
  @Post('stream')
  @UseGuards(EngineContextGuard)
  async stream() {}
}
```

## Behavior

- **If context exists:** Guard passes, route handler executes
- **If context is missing:** Guard fails, route handler is not executed

## Example

```typescript
import { Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { EngineContextGuard, EngineContextInterceptor } from 'aidk-nestjs';

@Controller('api/agent')
@UseInterceptors(EngineContextInterceptor)
@UseGuards(EngineContextGuard)
export class AgentController {
  @Post('stream')
  async stream() {
    // Context is guaranteed to be available here
    const ctx = Context.get();
    // ...
  }
}
```

## When to Use

Use `EngineContextGuard` when:

- You need to ensure context is set before handler execution
- You want to fail fast if context setup failed
- You're building middleware that requires context

## Custom Guards

You can create custom guards that check for specific context values:

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Context } from 'aidk';

@Injectable()
export class RequireUserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = Context.tryGet();
    if (!ctx) return false;
    
    const userId = ctx.metadata.userId;
    return !!userId;
  }
}
```

