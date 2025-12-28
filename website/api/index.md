# API Reference

Complete API documentation for all AIDK packages.

## Core Packages

### [Engine](/api/engine)
The execution orchestrator. Manages agent lifecycle, tick loop, and streaming.

```typescript
import { createEngine } from 'aidk';

const engine = createEngine({
  middleware: { /* ... */ },
  telemetry: { /* ... */ },
});
```

### [Components](/api/components)
Base component classes and lifecycle hooks.

```typescript
import { Component, ContextObjectModel, TickState } from 'aidk';

class MyAgent extends Component {
  render(com: ContextObjectModel, state: TickState) {
    return <>{/* ... */}</>;
  }
}
```

### [Context](/api/context)
Global execution context with async local storage.

```typescript
import { Context } from 'aidk';

const ctx = Context.get();
console.log(ctx.user, ctx.metadata);
```

### [Tools](/api/tools)
Tool creation and execution.

```typescript
import { createTool } from 'aidk';
import { z } from 'zod';

const myTool = createTool({
  name: 'tool_name',
  description: 'What it does',
  parameters: z.object({ /* ... */ }),
  execute: async (input) => { /* ... */ },
});
```

### [Signals](/api/signals)
Reactive state management.

```typescript
import { signal, comState, computed } from 'aidk';

const count = signal(0);
const doubled = computed(() => count() * 2);

count.set(5);
console.log(doubled()); // 10
```

## Adapter Packages

### [@aidk/ai-sdk](/api/adapters/ai-sdk)
Vercel AI SDK adapter with progressive adoption.

```typescript
import { createCompiler, compile, generateText } from '@aidk/ai-sdk';
import { AiSdkModel } from '@aidk/ai-sdk';
import { openai } from '@ai-sdk/openai';
```

### [@aidk/openai](/api/adapters/openai)
Direct OpenAI adapter.

```typescript
import { OpenAIModel, createOpenAIModel } from '@aidk/openai';
```

### [@aidk/google](/api/adapters/google)
Google AI / Vertex AI adapter.

```typescript
import { GoogleModel, createGoogleModel } from '@aidk/google';
```

## Server Packages

### [aidk-express](/api/server/express)
Express.js middleware and SSE transport.

```typescript
import { createSSEHandler } from 'aidk-express';
```

### [aidk-nestjs](/api/server/nestjs)
NestJS module, decorators, and guards.

```typescript
import { EngineModule, StreamAgent, EngineContextInterceptor } from 'aidk-nestjs';
```

### [aidk-server](/api/server/channels)
Server utilities and channel broadcasting.

```typescript
import { defineChannel, createChannelBroadcaster } from 'aidk-server';
```

## Client Packages

### [aidk-react](/api/client/react)
React hooks and components.

```typescript
import { useEngineClient, useExecution, useChannel } from 'aidk-react';
```

### [aidk-angular](/api/client/angular)
Angular services and components.

```typescript
import { EngineService, ExecutionService, ChannelService } from 'aidk-angular';
```

## Package Overview

| Package | Description | Size |
|---------|-------------|------|
| `aidk` | Core framework | ~150KB |
| `aidk-kernel` | Execution primitives | ~50KB |
| `@aidk/ai-sdk` | AI SDK adapter | ~30KB |
| `@aidk/openai` | OpenAI adapter | ~25KB |
| `@aidk/google` | Google adapter | ~25KB |
| `aidk-express` | Express integration | ~15KB |
| `aidk-nestjs` | NestJS integration | ~20KB |
| `aidk-server` | Server utilities | ~20KB |
| `aidk-client` | Browser client | ~30KB |
| `aidk-react` | React hooks | ~15KB |
| `aidk-angular` | Angular services | ~20KB |

All packages are tree-shakeable and include TypeScript definitions.

## Quick Reference

### Component Lifecycle

```typescript
class MyComponent extends Component {
  onMount(com)              // When component mounts
  onStart(com)              // Before first tick
  onTickStart(com, state)   // Before each tick
  render(com, state)        // Build context
  onAfterCompile(com, compiled, state, ctx)  // After compilation
  onTickEnd(com, state)     // After tick
  onComplete(com, finalState)  // Execution complete
  onUnmount(com)            // Cleanup
  onError(com, state)       // Error handling
}
```

### Engine Methods

```typescript
// Execute
const result = await engine.execute(input, <Agent />);

// Stream
for await (const event of engine.stream(input, <Agent />)) {
  // handle event
}

// With handle
const { handle, result } = await engine.execute
  .withContext({ /* ... */ })
  .withHandle()
  .run(input, <Agent />);

handle.on('tick_start', (e) => { /* ... */ });
```

### Signal Operations

```typescript
// Create
const count = signal(0);
const state = comState('key', initialValue);

// Read
const value = count();

// Write
count.set(10);

// Update
count.update(n => n + 1);

// Computed
const doubled = computed(() => count() * 2);
```

## Browse by Category

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 2rem;">

<div class="feature-card">

### Core
- [Engine](/api/engine)
- [Components](/api/components)
- [Context](/api/context)
- [Tools](/api/tools)
- [Signals](/api/signals)

</div>

<div class="feature-card">

### Adapters
- [AI SDK](/api/adapters/ai-sdk)
- [OpenAI](/api/adapters/openai)
- [Google](/api/adapters/google)

</div>

<div class="feature-card">

### Server
- [Express](/api/server/express)
- [NestJS](/api/server/nestjs)
- [Channels](/api/server/channels)

</div>

<div class="feature-card">

### Client
- [React](/api/client/react)
- [Angular](/api/client/angular)

</div>

</div>











