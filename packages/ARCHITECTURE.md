# AIDK Package Architecture

This document explains how all AIDK packages fit together as a complete system.

## Package Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AIDK PACKAGES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐    │
│  │   kernel    │     │   shared    │     │          adapters/          │    │
│  │ ─────────── │     │ ─────────── │     │  ┌───────┐ ┌──────┐ ┌────┐  │    │
│  │ Procedures  │     │ Types       │     │  │ai-sdk │ │openai│ │goog│  │    │
│  │ Context     │     │ Blocks      │     │  └───────┘ └──────┘ └────┘  │    │
│  │ Channels    │     │ Messages    │     └─────────────────────────────┘    │
│  │ Telemetry   │     │ Errors      │                   │                    │
│  └──────┬──────┘     └──────┬──────┘                   │                    │
│         │                   │                          │                    │
│         └─────────┬─────────┘                          │                    │
│                   │                                    │                    │
│                   ▼                                    │                    │
│  ┌─────────────────────────────────────────────────────┴───────────────┐    │
│  │                              core                                   │    │
│  │  ─────────────────────────────────────────────────────────────────  │    │
│  │  Engine │ JSX Runtime │ Hooks │ Compiler │ Tools │ Signals │ COM    │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                           │
│         ┌───────────────────────┼───────────────────────┐                   │
│         │                       │                       │                   │
│         ▼                       ▼                       ▼                   │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐            │
│  │   server    │         │   client    │         │    react    │            │
│  │ ─────────── │         │ ─────────── │         │ ─────────── │            │
│  │ Execution   │         │ EngineClient│         │ useEngine   │            │
│  │ Context     │         │ Channels    │         │ useMessages │            │
│  │ Middleware  │         │ SSE         │         │ Blocks      │            │
│  └──────┬──────┘         └─────────────┘         └─────────────┘            │
│         │                                                                   │
│    ┌────┴────┐                                   ┌─────────────┐            │
│    │         │                                   │   angular   │            │
│    ▼         ▼                                   │ ─────────── │            │
│ ┌───────┐ ┌───────┐                              │ EngineModule│            │
│ │express│ │nestjs │                              │ Services    │            │
│ └───────┘ └───────┘                              └─────────────┘            │
│                                                                             │
└──────────────────────────────────────────────────────────────────────-──────┘
```

## Dependency Graph

```
kernel ──────────────────────────────────────┐
   │                                         │
   │  shared ────────────────────────────────┤
   │     │                                   │
   │     │                                   ▼
   └─────┴──────────────────────────────▶  core
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    │                       │                       │
                    ▼                       ▼                       ▼
                 server                  client               adapters/*
                    │                       │
              ┌─────┴─────┐           ┌─────┴─────┐
              │           │           │           │
              ▼           ▼           ▼           ▼
           express     nestjs      react      angular
```

**Key principle**: Dependencies only flow downward. Lower packages never import from higher packages.

## Package Responsibilities

### Foundation Layer

| Package    | Purpose                    | Key Exports                                           |
| ---------- | -------------------------- | ----------------------------------------------------- |
| **kernel** | Execution primitives       | `createProcedure`, `Context`, `Channel`, `Telemetry`  |
| **shared** | Platform-independent types | `ContentBlock`, `Message`, `StreamChunk`, `AIDKError` |

### Core Layer

| Package         | Purpose                 | Key Exports                                                                  |
| --------------- | ----------------------- | ---------------------------------------------------------------------------- |
| **core**        | Main framework          | `Engine`, `createEngine`, `createTool`, `useState`, `useEffect`, JSX runtime |
| **adapters/\*** | AI provider integration | `createAiSdkAdapter`, `createOpenAIAdapter`, `createGoogleAdapter`           |

### Integration Layer

| Package     | Purpose            | Key Exports                                              |
| ----------- | ------------------ | -------------------------------------------------------- |
| **server**  | Server utilities   | `ExecutionContext`, `defaultContextExtractor`            |
| **client**  | Browser client     | `EngineClient`, `createEngineClient`, `ExecutionHandler` |
| **express** | Express middleware | `createEngineMiddleware`, `SSETransport`                 |
| **nestjs**  | NestJS module      | `EngineModule`, `EngineContextInterceptor`               |

### Frontend Layer

| Package     | Purpose          | Key Exports                                               |
| ----------- | ---------------- | --------------------------------------------------------- |
| **react**   | React bindings   | `useEngineClient`, `useExecution`, `ContentBlockRenderer` |
| **angular** | Angular bindings | `EngineModule`, `EngineService`, `ContentBlockRenderer`   |

## Data Flow

### Complete Request Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE REQUEST LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BROWSER                          SERVER                         AI MODEL   │
│  ───────                          ──────                         ────────   │
│                                                                             │
│  ┌─────────────┐                  ┌─────────────┐                           │
│  │ React/Angular│                  │  Express/   │                          │
│  │ Application │                  │   NestJS    │                           │
│  └──────┬──────┘                  └──────┬──────┘                           │
│         │                                │                                  │
│         │ 1. User sends message          │                                  │
│         ▼                                │                                  │
│  ┌─────────────┐                         │                                  │
│  │ useExecution│                         │                                  │
│  │ sendMessage │                         │                                  │
│  └──────┬──────┘                         │                                  │
│         │                                │                                  │
│         │ 2. HTTP POST                   │                                  │
│         ▼                                ▼                                  │
│  ┌─────────────┐                  ┌─────────────┐                           │
│  │EngineClient │ ──────────────▶  │  Middleware │                           │
│  │  stream()   │                  │  (context)  │                           │
│  └──────┬──────┘                  └──────┬──────┘                           │
│         │                                │                                  │
│         │                                │ 3. Create Engine                 │
│         │                                ▼                                  │
│         │                         ┌─────────────┐                           │
│         │                         │   Engine    │                           │
│         │                         │  stream()   │                           │
│         │                         └──────┬──────┘                           │
│         │                                │                                  │
│         │                                │ 4. Compile JSX                   │
│         │                                ▼                                  │
│         │                         ┌─────────────┐                           │
│         │                         │  Compiler   │                           │
│         │                         │  (Fiber)    │                           │
│         │                         └──────┬──────┘                           │
│         │                                │                                  │
│         │                                │ 5. Call Model                    │
│         │                                ▼                                  │
│         │                         ┌─────────────┐      ┌─────────────┐      │
│         │                         │   Adapter   │ ───▶ │  OpenAI/    │      │
│         │                         │             │ ◀─── │  Google/etc │      │
│         │                         └──────┬──────┘      └─────────────┘      │
│         │                                │                                  │
│         │ 6. SSE Stream                  │                                  │
│         ◀────────────────────────────────┤                                  │
│         │                                │                                  │
│         │ 7. Process Events              │                                  │
│         ▼                                │                                  │
│  ┌─────────────┐                         │                                  │
│  │StreamProcess│                         │                                  │
│  │   or        │                         │                                  │
│  └──────┬──────┘                         │                                  │
│         │                                │                                  │
│         │ 8. Update UI                   │                                  │
│         ▼                                │                                  │
│  ┌─────────────┐                         │                                  │
│  │ Messages[]  │                         │                                  │
│  │ displayed   │                         │                                  │
│  └─────────────┘                         │                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tool Execution Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           TOOL EXECUTION FLOW                              │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Model Response                                                            │
│       │                                                                    │
│       ▼                                                                    │
│  ┌─────────────┐                                                           │
│  │ Tool Calls  │                                                           │
│  └──────┬──────┘                                                           │
│         │                                                                  │
│         ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        ToolExecutor                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │   Check Tool Type                                                   │   │
│  │         │                                                           │   │
│  │    ┌────┴────┬────────────┬────────────┐                            │   │
│  │    │         │            │            │                            │   │
│  │    ▼         ▼            ▼            ▼                            │   │
│  │ ┌──────┐ ┌──────┐    ┌────────┐   ┌────────┐                        │   │
│  │ │SERVER│ │CLIENT│    │PROVIDER│   │  MCP   │                        │   │
│  │ └──┬───┘ └──┬───┘    └───┬────┘   └───┬────┘                        │   │
│  │    │        │            │            │                             │   │
│  │    │        │            │            │                             │   │
│  │    ▼        ▼            ▼            ▼                             │   │
│  │ Execute  Send to     Let adapter   Route to                         │   │
│  │ handler  client      handle it     MCP server                       │   │
│  │ on server(wait)                                                     │   │
│  │    │        │            │            │                             │   │
│  │    └────────┴────────────┴────────────┘                             │   │
│  │                     │                                               │   │
│  │                     ▼                                               │   │
│  │              Tool Results                                           │   │
│  │                     │                                               │   │
│  └─────────────────────┼───────────────────────────────────────────────┘   │
│                        │                                                   │
│                        ▼                                                   │
│                 Next Tick (or complete)                                    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Channel Communication

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CHANNEL COMMUNICATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Browser                              Server                               │
│   ───────                              ──────                               │
│                                                                             │
│   ┌─────────────┐                      ┌─────────────┐                      │
│   │ChannelClient│◀──-──── SSE ─────────│SSETransport │                      │
│   └──────┬──────┘                      └──────┬──────┘                      │
│          │                                    │                             │
│          │                                    │                             │
│   ┌──────▼──────┐                      ┌──────▼─────-─┐                     │
│   │  subscribe  │                      │ChannelService│                     │
│   │  publish    │                      │  (kernel)    │                     │
│   └─────────────┘                      └──────┬────-──┘                     │
│                                               │                             │
│                                        ┌──────▼──────┐                      │
│                                        │   Engine    │                      │
│                                        │  (tools)    │                      │
│                                        └─────────────┘                      │
│                                                                             │
│   Use cases:                                                                │
│   - Real-time UI updates from tools                                         │
│   - Progress notifications                                                  │
│   - Multi-user collaboration                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tick-Based Execution

The Engine operates in "ticks" - each tick is one compile → model → tools cycle:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              ENGINE TICK LOOP                              │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   while (!shouldStop) {                                                    │
│                                                                            │
│     ┌─────────────────────────────────────────────────────────────────┐    │
│     │ TICK N                                                          │    │
│     ├─────────────────────────────────────────────────────────────────┤    │
│     │                                                                 │    │
│     │  1. COMPILE                                                     │    │
│     │     ├─ Clear COM (Context Object Model)                         │    │
│     │     ├─ Run component hooks (useState, useEffect, etc.)          │    │
│     │     ├─ Render JSX to CompiledStructure                          │    │
│     │     └─ Format for model input                                   │    │
│     │                                                                 │    │
│     │  2. MODEL CALL                                                  │    │
│     │     ├─ Send to AI model (via adapter)                           │    │
│     │     ├─ Stream response chunks                                   │    │
│     │     └─ Collect tool calls                                       │    │
│     │                                                                 │    │
│     │  3. TOOL EXECUTION                                              │    │
│     │     ├─ Check confirmation (if required)                         │    │
│     │     ├─ Execute tools in parallel                                │    │
│     │     └─ Collect results                                          │    │
│     │                                                                 │    │
│     │  4. CHECK STOP                                                  │    │
│     │     ├─ Model said stop_reason: "stop"?                          │    │
│     │     ├─ No more tool calls?                                      │    │
│     │     └─ Max ticks reached?                                       │    │
│     │                                                                 │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│     tick++                                                                 │
│   }                                                                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## When to Modify Which Package

| If you need to...             | Modify...                          |
| ----------------------------- | ---------------------------------- |
| Add a new content block type  | `shared/src/blocks.ts`             |
| Change how procedures execute | `kernel/src/procedure.ts`          |
| Add a new hook (like useX)    | `core/src/compiler/hooks.ts`       |
| Change JSX compilation        | `core/src/compiler/`               |
| Add engine features           | `core/src/engine/engine.ts`        |
| Add tool execution types      | `core/src/tool/tool.ts`            |
| Change streaming behavior     | `core/src/engine/` + `client/src/` |
| Add HTTP endpoints            | `express/` or `nestjs/`            |
| Add React hooks               | `react/src/hooks/`                 |
| Add Angular services          | `angular/src/services/`            |
| Support a new AI provider     | `adapters/` (new package)          |

## Cross-Package Communication

### Shared Types

All packages import types from `shared`:

```typescript
// In any package
import type { Message, ContentBlock, StreamChunk } from "aidk-shared";
```

### Procedure-Based Execution

The kernel's `Procedure` abstraction is used throughout:

```typescript
// In core (model calls)
const modelProcedure = createProcedure(
  { name: "model.generate" },
  async (input) => {
    return await adapter.generate(input);
  },
);

// In express (request handling)
const requestProcedure = createProcedure(
  { name: "http.request" },
  async (req) => {
    return await engine.stream(agent, req.body);
  },
);
```

### Context Propagation

Context flows through all layers via AsyncLocalStorage:

```typescript
// Set in express/nestjs middleware
Context.run({ userId: "user-123", threadId: "thread-456" }, async () => {
  // Available anywhere in the call stack
  const ctx = Context.get();
  console.log(ctx.userId); // 'user-123'
});
```

## Testing Across Packages

Use `aidk-shared/testing` for consistent test fixtures:

```typescript
import {
  createUserMessage,
  createAssistantMessage,
  createToolUseBlock,
  captureAsyncGenerator,
} from "aidk-shared/testing";
```

See `packages/shared/ARCHITECTURE.md` for complete testing utilities documentation.

---

## Further Reading

Each package has its own `ARCHITECTURE.md` with detailed internals:

- [kernel/ARCHITECTURE.md](./kernel/ARCHITECTURE.md) - Procedures, context, channels
- [shared/ARCHITECTURE.md](./shared/ARCHITECTURE.md) - Types, blocks, errors, testing
- [core/ARCHITECTURE.md](./core/ARCHITECTURE.md) - Engine, JSX, hooks, tools
- [client/ARCHITECTURE.md](./client/ARCHITECTURE.md) - Browser client, SSE
- [server/ARCHITECTURE.md](./server/ARCHITECTURE.md) - Server utilities
- [express/ARCHITECTURE.md](./express/ARCHITECTURE.md) - Express middleware
- [nestjs/ARCHITECTURE.md](./nestjs/ARCHITECTURE.md) - NestJS module
- [react/ARCHITECTURE.md](./react/ARCHITECTURE.md) - React bindings
- [angular/ARCHITECTURE.md](./angular/ARCHITECTURE.md) - Angular bindings
