# Agent Decorators

Decorators for marking route handlers as agent execution endpoints.

## StreamAgent

Marks a route handler for streaming agent execution.

```typescript
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
    // Handler implementation
    return input;
  }
}
```

**Usage:**

- `@StreamAgent(agent?)` - Optional JSX element representing the agent component

**Note:** The agent JSX can also be provided via metadata or resolved dynamically in the handler.

## ExecuteAgent

Marks a route handler for non-streaming agent execution.

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { ExecuteAgent } from 'aidk-nestjs';
import { EngineInput } from 'aidk';
import { TaskAssistant } from './agents/task-assistant';

@Controller('api/agent')
export class AgentController {
  @Post('execute')
  @ExecuteAgent(<TaskAssistant />)
  async execute(@Body() input: EngineInput) {
    // Handler implementation
    return input;
  }
}
```

**Usage:**

- `@ExecuteAgent(agent?)` - Optional JSX element representing the agent component

## Metadata

Both decorators store metadata that can be accessed via `Reflector`:

```typescript
import { Reflector } from '@nestjs/core';
import { AGENT_TOKEN } from 'aidk-nestjs';

const agentMetadata = this.reflector.get(AGENT_TOKEN, handler);
// { type: 'stream' | 'execute', agent?: JSX.Element }
```

## Example

```typescript
import { Controller, Post, Body, Res, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { StreamAgent, EngineContextInterceptor } from 'aidk-nestjs';
import { EngineInput } from 'aidk';
import { TaskAssistant } from './agents/task-assistant';

@Controller('api/agent')
@UseInterceptors(EngineContextInterceptor)
export class AgentController {
  @Post('stream')
  @StreamAgent(<TaskAssistant />)
  async stream(@Body() input: EngineInput, @Res() res: Response) {
    // Context is automatically set up by EngineContextInterceptor
    // Agent is available via metadata
    return input;
  }
}
```

