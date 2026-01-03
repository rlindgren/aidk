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
   - createComponentTool() factory
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
3. **Update documentation** - see Documentation Requirements below
4. **Use existing patterns** - check similar code in the codebase

## Documentation Requirements

**Documentation is not optional.** All documentation must be kept comprehensive and up-to-date. This is imperative—documentation serves three critical audiences:

1. **Developers** using AIDK as a library
2. **AI agents** working on the codebase (including you)
3. **Contributors** understanding design decisions

### What Must Be Updated

When changing code, you MUST update all relevant documentation:

| Change Type                                | Documentation to Update                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| API changes (types, interfaces, functions) | JSDoc/TSDoc comments, ARCHITECTURE.md, website docs     |
| New features                               | ARCHITECTURE.md, website docs, CLAUDE.md if significant |
| Behavior changes                           | ARCHITECTURE.md, relevant website guides                |
| Event types, enums, constants              | Type comments, CONVENTIONS.md, website API docs         |
| Bug fixes affecting documented behavior    | Correct any inaccurate docs                             |

### JSDoc/TSDoc Standards

All exported types, interfaces, functions, and classes MUST have comprehensive JSDoc comments:

````typescript
/**
 * Executes an agent component and streams events in real-time.
 *
 * The engine compiles JSX components each tick, calls the model,
 * executes tools, and yields events throughout the process.
 *
 * @param input - Engine input containing timeline, sections, and metadata
 * @param agent - Optional agent component (uses config root if not provided)
 * @returns Async iterable of EngineStreamEvent for real-time consumption
 *
 * @example
 * ```typescript
 * for await (const event of engine.stream(input, <MyAgent />)) {
 *   if (event.type === 'content_delta') {
 *     process.stdout.write(event.delta);
 *   }
 * }
 * ```
 */
stream(input: EngineInput, agent?: ComponentDefinition): AsyncIterable<EngineStreamEvent>
````

### ARCHITECTURE.md Files

Each package and major subsystem has an ARCHITECTURE.md that must document:

- **Purpose** - What the module does and why it exists
- **Key concepts** - Core abstractions and their relationships
- **Data flow** - How data moves through the system
- **API surface** - Public types, functions, and their contracts
- **Examples** - Code showing typical usage patterns

### Website Documentation

The `website/docs/` directory contains user-facing documentation:

- `api/` - API reference (engine.md, execution-handle.md, com.md)
- `concepts/` - Conceptual guides (runtime-architecture.md, tick-lifecycle.md)
- `guides/` - How-to guides (tools.md, fork-spawn.md, etc.)

**These docs are the primary resource for developers using AIDK.** They must be accurate, comprehensive, and include working code examples.

### Documentation Checklist

Before completing any change:

- [ ] All new/modified exports have JSDoc comments
- [ ] ARCHITECTURE.md reflects current behavior
- [ ] Website docs are updated if user-facing
- [ ] Code examples in docs actually work
- [ ] Type definitions match documentation

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
    case "execution_start": // Execution started
    case "tick_start": // New tick starting
    case "content_delta": // Incremental text content
    case "reasoning_delta": // Incremental reasoning/thinking
    case "tool_call": // Tool being called
    case "tool_result": // Tool result
    case "tick_end": // Tick completed
    case "execution_end": // Execution finished
    case "engine_error": // Error occurred
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
