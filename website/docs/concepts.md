# Core Concepts

This guide explains the key concepts in AIDK.

## The Engine

The Engine is the orchestrator that executes agents. It manages:

- **Execution lifecycle** - Starting, running, stopping agents
- **Tick loop** - Iterative rendering until completion
- **Tool execution** - Running tools and returning results
- **Streaming** - Emitting events as execution progresses

```typescript
import { createEngine } from 'aidk';

const engine = createEngine();

// Execute an agent
const result = await engine.execute(initialState, <MyAgent />);

// Stream an agent
const stream = await engine.stream(initialState, <MyAgent />);
for await (const event of stream) {
  console.log(event);
}
```

## JSX Components

AIDK uses JSX to describe agent structure and execution logic. The custom JSX runtime transforms components into a tree that the engine interprets.

### Engine Components

Class-based components with lifecycle methods:

```tsx
class MyAgent extends Component {
  async onMount(com: ContextObjectModel) {
    // Called once when component mounts
  }
  
  render(com: ContextObjectModel, state: TickState): JSX.Element {
    // Called on each tick
    return <>{/* ... */}</>;
  }
}
```

### Functional Components

Simple function components:

```tsx
function MyAgent() {
  return (
    <>
      <Model />
      <Timeline />
      <Instructions />
    </>
  );
}
```

## Context Object Model (COM)

The COM is a structured representation of the current agent state, providing:

- **User input** - `com.getUserInput()`
- **Timeline access** - Current conversation history
- **Tool results** - Results from tool executions
- **Legacy state** - `com.setState()`, `com.getState()` (prefer signals instead)

```tsx
render(com: ContextObjectModel, state: TickState) {
  // Get user input
  const input = com.getUserInput();
  
  return <>{/* ... */}</>;
}
```

## State Management

AIDK provides a signal-based reactive state system for managing component state. There are two layers:

| Type | Function | Scope | Persisted? |
|------|----------|-------|------------|
| **Local State** | `signal()` | Single component instance | No |
| **COM State** | `comState()` | Shared across all components | Yes (across ticks) |

### Signals in Components

```tsx
import { EngineComponent, signal, comState, computed } from 'aidk';

class TimelineComponent extends Component {
  // Local state - only this component can access
  private startedAt = signal(new Date());
  
  // COM state - shared across components, persisted across ticks
  private timeline = comState<COMTimelineEntry[]>('timeline', []);
  
  // Derived state - memoized, auto-updates when dependencies change
  private messageCount = computed(() => this.timeline().length);

  onTickStart(com, state) {
    // Append new entries from the current tick
    if (state.currentState?.timeline?.length) {
      this.timeline.update(t => [...t, ...state.currentState.timeline]);
    }
  }

  render(com, state) {
    return (
      <Timeline>
        {this.timeline().map((entry, i) => (
          <Message key={i} {...entry.message} />
        ))}
      </Timeline>
    );
  }
}
```

### Understanding previousState vs currentState

- **`state.currentState`** - Output from the *last* model call (new messages, tool calls)
- **`state.previousState`** - The compiled state from the *previous* tick

**The correct pattern** is to use signals to accumulate state:

```tsx
// ✅ Correct: Use signals to accumulate
private timeline = comState<COMTimelineEntry[]>('timeline', []);

onTickStart(com, state) {
  // Append new entries from currentState
  if (state.currentState?.timeline?.length) {
    this.timeline.update(t => [...t, ...state.currentState.timeline]);
  }
}

render() {
  return <Timeline>{this.timeline().map(...)}</Timeline>;
}
```

```tsx
// ❌ Avoid: Combining previousState + currentState directly
render(com, state) {
  const timeline = [
    ...(state.previousState?.timeline || []),
    ...(state.currentState?.timeline || [])
  ];
  // This can lead to duplication issues
}
```

**Why signals are better:**
- Clear separation of accumulation logic (`onTickStart`) and rendering (`render`)
- No duplication issues
- State persists correctly across ticks
- Reactive updates with `computed()` for derived values

See [State Management Guide](./state-management.md) for full documentation.

> **Important:** Signals only work in class components (`EngineComponent`), not pure function components.

## Timeline & Messages

The timeline represents the conversation history:

```tsx
<Timeline>
  <Message role="system" content="You are helpful." />
  <Message role="user" content={[{ type: 'text', text: 'Hello' }]} />
  <Message role="assistant" content={[{ type: 'text', text: 'Hi!' }]} />
</Timeline>
```

Content is represented as blocks:

```typescript
type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image'; source: MediaSource }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; toolUseId: string; content: ContentBlock[] }
  // ... more block types
```

## Sections

Sections organize content for different audiences:

```tsx
// Visible only to the model
<Section id="instructions" audience="model">
  System prompt content here.
</Section>

// Visible to everyone
<Section id="context" audience="all">
  Shared context.
</Section>

// Visible only to users
<Section id="status" audience="user">
  Current status information.
</Section>
```

## Tools

Tools give agents capabilities to interact with the world:

```typescript
const myTool = createTool({
  name: 'tool_name',
  description: 'What the tool does',
  parameters: z.object({
    param1: z.string(),
    param2: z.number().optional(),
  }),
  execute: async (input, context) => {
    // Tool logic
    return { result: 'data' };
  },
});
```

Using tools in agents:

```tsx
<Tool definition={myTool} />
```

## Model Adapters

Adapters connect AIDK to AI providers:

```tsx
// Vercel AI SDK (supports many providers)
import { AiSdkModel } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

<AiSdkModel model={openai('gpt-4o')} />

// Direct OpenAI
import { OpenAIModel } from 'aidk-openai';

<OpenAIModel apiKey="..." model="gpt-4o" />

// Google AI
import { GoogleModel } from 'aidk-google';

<GoogleModel model="gemini-2.0-flash" />
```

### Automatic Renderer Selection

Each model adapter can broadcast its preferred renderer format. AIDK automatically uses this to format your context optimally.

```tsx
// Claude prefers XML
<AiSdkModel model={anthropic('claude-3-5-sonnet-20241022')} />
// Your JSX → XML automatically

// GPT prefers Markdown  
<AiSdkModel model={openai('gpt-4o')} />
// Your JSX → Markdown automatically
```

**You write this once:**
```tsx
<Section audience="model">
  <H2>Status</H2>
  <List ordered>
    <ListItem>Step 1 complete</ListItem>
    <ListItem>Step 2 in progress</ListItem>
  </List>
</Section>
```

**For Claude, renders as XML:**
```xml
<section>
  <h2>Status</h2>
  <ol><li>Step 1 complete</li><li>Step 2 in progress</li></ol>
</section>
```

**For GPT, renders as Markdown:**
```markdown
## Status

1. Step 1 complete
2. Step 2 in progress
```

See the [Renderers Guide](/docs/guides/renderers) for complete documentation.

## Model Adapters (continued)

## Hooks System

Hooks provide middleware-style extension points:

```typescript
// Engine-level hooks
engine.hooks.on('execute', async (args, envelope, next) => {
  console.log('Execution starting');
  const result = await next();
  console.log('Execution complete');
  return result;
});

// Model-level hooks
engine.hooks.on('model.generate', async (args, envelope, next) => {
  // Intercept model calls
  return next();
});

// Tool-level hooks
engine.hooks.on('tool.execute', async (args, envelope, next) => {
  // Intercept tool calls
  return next();
});
```

## Channels

Channels enable real-time communication between server and client:

```typescript
// Define a channel
const todoChannel = defineChannel({
  name: 'todos',
  events: {
    created: z.object({ id: z.string(), title: z.string() }),
    updated: z.object({ id: z.string(), completed: z.boolean() }),
    deleted: z.object({ id: z.string() }),
  },
});

// Publish events
channel.publish('created', { id: '1', title: 'New task' });

// Subscribe on client
client.channels.subscribe('todos', (event) => {
  console.log(event.type, event.payload);
});
```

## Execution Flow

1. **Initialize** - Engine creates execution context
2. **Mount** - Components call `onMount()` 
3. **Tick 1** - First render, compile to model input
4. **Generate** - Model produces response
5. **Process** - Handle tool calls, update state
6. **Tick N** - Re-render with updated state
7. **Complete** - No more tool calls, stop condition met

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Mount  │ ──▶ │ Render  │ ──▶ │Generate │ ──▶ │ Process │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
                     ▲                               │
                     │                               │
                     └───────── Tool Calls? ─────────┘
                                    │
                                    ▼ No
                              ┌─────────┐
                              │Complete │
                              └─────────┘
```

## Next Steps

- [State Management](./state-management.md) - Signals and reactive state
- [Tools Guide](./guides/tools.md) - Deep dive into tools
- [Hooks Guide](./guides/hooks.md) - Extend with hooks
- [Channels Guide](./guides/channels.md) - Real-time updates

