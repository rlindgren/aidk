# AIDK - AI Agent Guide

This document helps AI agents understand and work with the AIDK codebase.

## What is AIDK?

AIDK is a React-inspired JSX-based framework for building AI agents. It provides:

- **JSX Components** for defining agent behavior declaratively
- **Signal-based State** for reactive state management
- **Hooks** (useState, useEffect, useComputed, etc.) familiar to React developers
- **Tool System** with SERVER, CLIENT, PROVIDER, and MCP execution types
- **Streaming** with real-time model output
- **Multi-framework Support** (Express, NestJS, React, Angular)

## Repository Structure

```
aidk/
├── packages/
│   ├── kernel/        # aidk-kernel - Low-level execution primitives
│   ├── shared/        # aidk-shared - Platform-independent types
│   ├── core/          # aidk - Main framework (JSX, hooks, engine)
│   ├── client/        # aidk-client - Browser client
│   ├── server/        # aidk-server - Server utilities
│   ├── express/       # aidk-express - Express middleware
│   ├── nestjs/        # aidk-nestjs - NestJS module
│   ├── react/         # aidk-react - React bindings
│   ├── angular/       # aidk-angular - Angular bindings
│   └── adapters/      # AI provider adapters
│       ├── ai-sdk/    # Vercel AI SDK adapter
│       ├── openai/    # OpenAI native adapter
│       └── google/    # Google AI native adapter
├── example/           # Example applications
└── website/           # Documentation website (VitePress)
```

## Key Files to Understand

### Architecture Documentation

**Start here for the big picture:**

- `packages/ARCHITECTURE.md` - How all packages fit together, data flow, tick loop

**Then dive into individual packages:**

- `packages/kernel/ARCHITECTURE.md` - Procedures, context, channels
- `packages/shared/ARCHITECTURE.md` - Types, content blocks, messages, testing utilities
- `packages/core/ARCHITECTURE.md` - Overview of core package
- `packages/core/src/engine/ARCHITECTURE.md` - Engine execution loop
- `packages/core/src/compiler/ARCHITECTURE.md` - JSX compilation
- `packages/core/src/tool/ARCHITECTURE.md` - Tool system
- `packages/client/ARCHITECTURE.md` - Browser client

### Core Concepts

1. **Engine** (`packages/core/src/engine/engine.ts`)
   - Main execution loop
   - Tick-based compilation and model calling
   - Tool execution coordination

2. **JSX Runtime** (`packages/core/src/jsx/`)
   - Custom JSX implementation
   - Component lifecycle
   - Fiber-based reconciliation

3. **Hooks** (`packages/core/src/compiler/hooks.ts`)
   - useState, useReducer, useEffect, useMemo
   - useSignal, useComputed (reactive)
   - useMessage, useTool (agent-specific)

4. **Tools** (`packages/core/src/tool/tool.ts`)
   - createTool() factory
   - Execution types: SERVER, CLIENT, PROVIDER, MCP
   - requiresConfirmation for user approval

5. **Content Blocks** (`packages/shared/src/blocks.ts`)
   - Discriminated unions for all content types
   - text, image, tool_use, tool_result, etc.

## Common Tasks

### Running Tests

```bash
pnpm test                           # All tests
pnpm --filter aidk test             # Core package only
pnpm --filter aidk test engine      # Tests matching "engine"
```

### Building

```bash
pnpm build                          # Build all packages
pnpm --filter aidk build            # Build core only
```

### Type Checking

```bash
pnpm typecheck                      # Type check all
pnpm --filter aidk tsc --noEmit     # Type check core
```

## Code Conventions

See `CONVENTIONS.md` for full details. Key points:

- **Property names**: camelCase (`toolUseId`, `isError`)
- **Type/enum values**: snake_case (`tool_use`, `tool_result`)
- **Files**: kebab-case (`engine-client.ts`)
- **Classes**: PascalCase (`EngineClient`)

## Testing Utilities

Available in `aidk-shared/testing`:

```typescript
import {
  createUserMessage,
  createToolUseBlock,
  createTextStreamSequence,
  captureAsyncGenerator,
  waitFor,
} from "aidk-shared/testing";
```

## When Making Changes

1. **Read the relevant ARCHITECTURE.md** before modifying a package
2. **Run tests** after changes: `pnpm test`
3. **Update ARCHITECTURE.md** if you change APIs or behavior
4. **Use existing patterns** - check similar code in the codebase

## Package Dependencies

```
kernel (no deps)
    ↓
shared (no deps)
    ↓
core (depends on kernel, shared)
    ↓
├── client (depends on shared)
├── server (depends on shared)
├── express (depends on server)
├── nestjs (depends on server)
├── react (depends on client)
├── angular (depends on client)
└── adapters/* (depend on core)
```

## Current Test Coverage

- 543 tests across all packages
- All tests should pass: `pnpm test`

## Error Handling

Use structured errors from `aidk-shared`:

```typescript
import { NotFoundError, ValidationError, AbortError } from "aidk-shared";

throw new NotFoundError("model", modelId);
throw ValidationError.required("messages");
throw AbortError.timeout(30000);
```

## Streaming

The engine yields events during execution:

```typescript
for await (const event of engine.stream(agent, input)) {
  switch (event.type) {
    case "model_chunk": // Incremental model output
    case "tool_call": // Tool being called
    case "tool_result": // Tool result
    case "agent_end": // Agent finished
  }
}
```

## Tool Confirmation Flow

Tools can require user confirmation:

```typescript
const DeleteFile = createTool({
  name: "delete_file",
  requiresConfirmation: true, // or (input) => input.dangerous
  confirmationMessage: "Delete this file?",
  handler: async ({ path }) => {
    /* ... */
  },
});
```

## Questions?

- Check ARCHITECTURE.md files for design decisions
- Check CONVENTIONS.md for coding standards
- Check existing tests for usage patterns
