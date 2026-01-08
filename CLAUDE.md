# AIDK - AI Agent Guide

This document helps AI agents understand and work with the AIDK codebase.

## Design Philosophy

### The Core Insight

**The JSX tree IS the application.** It's not configuration for an engine - it IS the app. The tree:

- Defines what the model sees (context/prompt)
- Defines how the model can act (tools)
- Controls when execution stops (via hooks and state)
- Runs across multiple ticks, maintaining state between model calls

**Context = f(state).** Just like React's UI = f(state), the prompt sent to the LLM is a function of reactive state. Describe what the model should see, not how to build the prompt.

### The Bigger Idea: Model Interface (MI)

**We're not just building AI apps. We're building Model Interfaces.**

| UI (User Interface)           | MI (Model Interface)            |
| ----------------------------- | ------------------------------- |
| Visual hierarchy              | Context structure               |
| Colors, spacing               | Token efficiency                |
| Information architecture      | Information relevance/recency   |
| Responsive to clicks          | Responsive to model "attention" |
| Optimized for human cognition | Optimized for inference         |

HTML/CSS/JS is for building interfaces humans consume. JSX components are for building interfaces models consume.

The components ARE MI primitives:

- `<System>` = header/nav (persistent instructions)
- `<Section>` = cards (organized content)
- `<Messages>` = feed (conversation history)
- `<Tool>` = buttons/forms (available actions)

**Two framings:**

- **AI app**: Agent is the engine, humans are users. `Human → AI App → Response`
- **App for agents**: Agent is the user, app is the interface. `Agent → MI → Structured Output`

AIDK supports both. The context compiled each tick IS an interface the model "uses". The model "sees" the MI, "clicks" tools, "reads" sections. We're building what HTML is for humans, but for models.

```
┌─────────────────────────────────────┐
│            Human User               │
│                 │                   │
│                 ▼                   │
│         ┌─────────────┐             │
│         │   AI App    │             │
│         │             │             │
│         │  ┌───────┐  │             │
│         │  │  MI   │◄─── Model consumes this
│         │  │Context│  │             │
│         │  └───────┘  │             │
│         │      │      │             │
│         │      ▼      │             │
│         │   Model     │             │
│         └─────────────┘             │
└─────────────────────────────────────┘
```

This is bigger than "agent framework" - it's a paradigm for model-consumable interfaces.

### Who This Is For

**Target audience: People building production agent systems.**

If you've only written `openai.chat.completions.create()` in a script, you won't feel the pain this solves. But if you've built:

- Jinja/Handlebars template inheritance for prompts
- Manual conversation state tracking across agent hand-offs
- Routing logic with if/else spaghetti
- Same agent with different formatting for different mediums (web vs SMS)
- Context compaction/summarization for long conversations
- Multi-agent orchestration

Then you see this and go "oh, it's just React for AI apps."

### Pain Points Solved

1. **Template composition hell** - JSX components compose naturally
2. **Dynamic context** - Conditional rendering, reactive state, hooks
3. **Same agent, different mediums** - Props change the output format
4. **Model-aware formatting** - XML for Claude, Markdown for GPT, automatic
5. **Agent hand-offs** - Just setState and render a different component
6. **Multi-agent orchestration** - Component tree with state
7. **Context compaction** - Map old messages to summarized versions
8. **Mid-execution model swapping** - Change `<Model>` based on task complexity
9. **Lifecycle hooks** - onAfterCompile for context transformation

### The Runtime Model

```
run(<MyAgent />, input)
    │
    ├── createRuntime(options)  ← Like React's createRoot()
    │
    └── runtime.run(jsx, input)  ← Like root.render()
            │
            ├── Compile JSX → context (system, messages, tools)
            ├── Call model
            ├── Execute tools
            ├── Ingest results (update state)
            └── Loop until shouldContinue() === false
```

The runtime is NOT the application. It's the execution environment. The JSX IS the application.

### Architecture Layers

```
┌─────────────────────────────────────────┐
│           App (JSX components)          │  ← User code
├─────────────────────────────────────────┤
│         Runtime (session, tick loop)    │  ← JSX compilation, state, hooks
├─────────────────────────────────────────┤
│         Executor (pluggable)            │  ← Model calls, tool execution
│    ┌─────────┬─────────┬─────────┐      │
│    │ AI SDK  │ OpenAI  │ Custom  │      │
│    └─────────┴─────────┴─────────┘      │
├─────────────────────────────────────────┤
│         Kernel (procedures, context)    │  ← Platform primitives
├─────────────────────────────────────────┤
│         LLM APIs (external)             │  ← OpenAI, Anthropic, etc.
└─────────────────────────────────────────┘
```

- **Runtime** owns: compile, ingest, shouldContinue, tick management
- **Executor** owns: model execution, tool execution, format translation
- **Kernel** owns: procedures, context propagation, tracking

This mirrors React: App → React (reconciler) → ReactDOM (renderer) → Browser → OS

### Terminology

- **App** - The JSX tree. Not "agent" (overloaded buzzword). Just an app.
- **Components** - JSX pieces that compose into an app
- **Runtime** - The execution environment (like React's createRoot)
- **Executor** - Pluggable model/tool execution (like ReactDOM is to React)
- **Session** - Holds compilation state across ticks

Avoid "agent" where possible. It's just an AI app.

### API Direction

```typescript
// Create runtime once
const app = createRuntime(<App />, { executor, ...opts });

// Run multiple times with different inputs
for await (const event of app.stream({ messages })) { }
const result = await app.run({ messages });
```

Lifecycle as events, not timeline mutation:

```typescript
const App = () => {
  onMessage((msg) => { /* incoming */ });
  onGenerated((response) => { /* model output */ });
  return <>{/* ... */}</>;
};
```

### Design Decisions & Open Questions

**Decided:**

1. **Procedures are the hook system** - Middleware on procedures, not 5 separate registries
2. **Session owns the tick loop** - Runtime is just orchestration
3. **Executor is pluggable** - AI SDK, OpenAI direct, Anthropic direct, custom, mock
4. **Progressive adoption** - compile() → run(jsx, executor) → run(jsx) → full framework

**Open questions:**

- **Timeline vs Messages**: "Timeline" was over-abstraction for hypothetical non-LLM models. Should probably just be `messages` until there's a real use case for something more generic.
- **ttlTicks/ttlMs/visibility/audience**: Likely unused cruft. Delete or repurpose for DevTools only.
- **Sections**: Keep - useful for organizing system prompts. But strip the unnecessary fields.

---

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

## Common Gotchas

### Middleware for Async Iterable Procedures

When writing middleware for `engine.stream` or other async iterable procedures, the signature is `(args, envelope, next)` - NOT `(next, args)`:

```typescript
// ❌ WRONG - causes "next is not a function"
const middleware = async (next, input) => { ... };

// ✅ CORRECT - args, envelope, next (in that order!)
const middleware = async (args, envelope, next) => {
  const stream = await next();  // Get the stream first
  return (async function* () {
    for await (const event of stream) {
      yield event;  // Pass through (or transform) events
    }
  })();
};
```

See `packages/kernel/ARCHITECTURE.md` section "Middleware for Async Iterable Procedures" for full details.

### Procedure Immutability and Option Preservation (CRITICAL)

**Procedures are immutable** - methods like `.use()`, `setHandler()`, `withContext()`, `withTimeout()`, and `pipe()` return **new** `ProcedureImpl` instances. When adding new options to `ProcedureOptions`, you MUST ensure they are copied in ALL methods that create new procedures.

**Options that must be preserved:**

- `executionBoundary` - Controls execution boundary behavior (`'always'`, `'child'`, `'auto'`, `false`)
- `executionType` - Type identifier for DevTools (e.g., `'engine'`, `'model'`)
- `skipTracking` - Bypasses `ExecutionTracker.track()` for wrapper procedures
- `timeout` - Procedure timeout in milliseconds
- `metadata` - Telemetry span attributes
- `handleFactory`, `schema`, `name`, `sourceType`, `sourceId`

**Example bug (fixed):** Engine procedures had `executionBoundary: "always"` set, but `.use()` was called to add middleware. The old `.use()` didn't copy `executionBoundary`, so tracking options were lost and DevTools couldn't link child executions.

**Key file:** `packages/kernel/src/procedure.ts` - search for `createProcedureFromImpl` calls to find all places where options must be copied.

**`withContext()` special case:** This method intentionally sets `skipTracking: true` because the wrapper delegates to the original procedure's `execute()`, which does the actual tracking. This prevents double-tracking.

## DevTools for AI Agents

DevTools provides real-time observability and has an LLM-friendly API for AI agent consumption.

### Starting DevTools CLI

```bash
npx aidk-devtools --port 3001 --open
```

### LLM-Friendly Endpoints

**Get markdown summary** (recommended starting point):

```bash
curl http://localhost:3001/api/summary
```

Returns a structured markdown document with executions, procedures, errors, and token usage.

**Query events with filtering**:

```bash
# All events (newest first, limit 100)
curl http://localhost:3001/api/events

# Filter by type
curl "http://localhost:3001/api/events?type=tool_call"
curl "http://localhost:3001/api/events?type=procedure_error"

# Filter by execution/procedure/session
curl "http://localhost:3001/api/events?executionId=<id>"
curl "http://localhost:3001/api/events?procedureId=<id>"

# Pagination
curl "http://localhost:3001/api/events?limit=50&offset=100&order=asc"
```

### Useful Queries for Debugging

```bash
# See all errors
curl "http://localhost:3001/api/events?type=procedure_error"

# See all tool calls
curl "http://localhost:3001/api/events?type=tool_call"

# Trace a specific execution
curl "http://localhost:3001/api/events?executionId=<id>&order=asc"
```

See `website/docs/guides/devtools.md` for complete documentation.

## Questions?

- Check ARCHITECTURE.md files for design decisions
- Check CONVENTIONS.md for coding standards
- Check existing tests for usage patterns
