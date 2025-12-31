# Progressive Adoption Guide

AIDK is designed for progressive adoption. Start with your existing AI SDK code and add features incrementally.

## The Adoption Path

```
Your Code → Level 1 → Level 2 → Level 3 → Level 4
   ↓         ↓          ↓          ↓          ↓
 0% aidk  20% aidk   40% aidk   60% aidk   100% aidk
```

You can stop at any level. Each provides value independently.

---

## Level 1: compile() - Just JSX Compilation

**Best for:** Teams that want JSX for context building but aren't ready to change execution logic.

**What you get:**

- JSX-based agent definitions
- Dynamic context building
- Type-safe components
- **Zero changes to your model execution code**

### Example

```tsx
import { compile } from 'aidk-ai-sdk';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Define your agent in JSX
function MyAgent() {
  return (
    <>
      <System>You are a helpful assistant.</System>
      <User>What is 2+2?</User>
    </>
  );
}

// Compile to AI SDK format
const { messages, tools, system, model } = await compile(<MyAgent />);

// YOU control the execution - use your existing code
const result = await generateText({
  model: model ?? openai('gpt-4o'),
  messages,
  tools,
  system,
  temperature: 0.7,
});

console.log(result.text);
```

### When to use this level

- You have existing `generateText`/`streamText` code you don't want to change
- You want JSX for cleaner context building
- You're evaluating AIDK without commitment
- You need to integrate with existing infrastructure

---

## Level 2: run() with Executor - Multi-Tick Loop

**Best for:** Teams ready to adopt multi-tick execution but want to control model calls.

**What you get:**

- Automatic multi-tick loop until completion
- Tools automatically executed between ticks
- Component lifecycle hooks (`onTickStart`, `onTickEnd`, etc.)
- **You still control the model execution**

### Example

```tsx
import { createCompiler } from 'aidk-ai-sdk';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const compiler = createCompiler();

// AIDK handles the tick loop, you provide the executor
const result = await compiler.run(<MyAgent />, async (input) => {
  // input = { messages, tools, system, tick }
  // You control the model call
  return await generateText({
    model: openai('gpt-4o'),
    messages: input.messages,
    tools: input.tools,
    system: input.system,
    temperature: 0.7,
  });
});
```

### With Streaming

```tsx
for await (const event of compiler.stream(
  <MyAgent />,
  async (input) => {
    return aiSdkStreamText({
      model: openai('gpt-4o'),
      ...input,
    });
  }
)) {
  if (event.type === 'chunk') {
    process.stdout.write(event.chunk.textDelta ?? '');
  }

  if (event.type === 'tick_end') {
    console.log(`\n[Tick ${event.tick} complete]`);
  }
}
```

### Adding State

Use signals for reactive state management:

```tsx
import { Component, comState } from 'aidk';

class SearchAgent extends Component {
  // State persists across ticks
  private query = comState<string>('query', '');
  private results = comState<any[]>('results', []);

  onTickStart(com, state) {
    // Extract query from user message
    const lastMessage = state.current?.timeline?.at(-1);
    if (lastMessage?.role === 'user') {
      this.query.set(extractQuery(lastMessage.content));
    }
  }

  render(com, state) {
    return (
      <>
        <System>You are a search assistant.</System>

        {this.results().length > 0 && (
          <User>
            Search results for "{this.query()}":
            {JSON.stringify(this.results(), null, 2)}
          </User>
        )}
      </>
    );
  }
}

// Use with your executor
const result = await compiler.run(<SearchAgent />, async (input) => {
  return await generateText({
    model: openai('gpt-4o'),
    ...input,
  });
});
```

### When to use this level

- You want multi-tick execution with tool calling
- You need to customize model parameters per call
- You want to add observability around model calls
- You're using multiple models and want to control routing

---

## Level 3: run() - Managed Execution

**Best for:** Teams ready to let AIDK manage model execution.

**What you get:**

- Fully managed execution
- Default model configuration
- Streaming support
- Tools automatically integrated
- **No executor function needed**

### Example

```tsx
import { createCompiler } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

// Configure default model
const compiler = createCompiler({
  model: openai('gpt-4o'),
  temperature: 0.7,
  maxTokens: 4096,
});

// No executor needed
const result = await compiler.run(<MyAgent />);

console.log(result.text);
```

### Streaming

```tsx
for await (const event of compiler.stream(<MyAgent />)) {
  if (event.type === 'chunk') {
    process.stdout.write(event.chunk.textDelta ?? '');
  }
}
```

### Dynamic Model Selection

You can still override the model per agent using the `<Model>` component:

```tsx
import { Model } from 'aidk-ai-sdk';

class AdaptiveAgent extends Component {
  render(com, state) {
    const needsPower = analyzePreviousResponse(state);

    return (
      <>
        {needsPower ? (
          <Model model={openai('gpt-4o')} />
        ) : (
          <Model model={openai('gpt-4o-mini')} />
        )}

        <Timeline>{/* ... */}</Timeline>
      </>
    );
  }
}
```

### When to use this level

- You're comfortable with AIDK managing execution
- You want less boilerplate
- You don't need custom model call logic
- You're building new projects from scratch

---

## Level 4: generateText() / streamText() - Drop-in Replacement

**Best for:** Teams that want the simplest possible API.

**What you get:**

- API that mirrors `ai` SDK exactly
- JSX as the first argument
- Same return types as AI SDK
- Full compatibility with existing code patterns

### Example

```tsx
import { generateText, streamText } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

// Drop-in replacement for ai.generateText()
const result = await generateText(<MyAgent />, {
  model: openai('gpt-4o'),
  temperature: 0.8,
});

console.log(result.text);

// Drop-in replacement for ai.streamText()
const { fullStream, text } = streamText(<MyAgent />, {
  model: openai('gpt-4o'),
});

for await (const chunk of fullStream) {
  process.stdout.write(chunk.textDelta ?? '');
}

const finalText = await text;
```

### When to use this level

- You want minimal API surface
- You're migrating from direct AI SDK usage
- You prefer function calls over compiler instances
- You're building simple single-agent systems

---

## Level 5: Full Engine - Maximum Power

**Best for:** Teams building production applications with complex requirements.

**What you get:**

- Full AIDK Engine with all features
- Persistence and recovery
- Execution handles with event streams
- Global and per-call middleware
- OpenTelemetry integration
- Fork and spawn for multi-agent systems
- Channels for real-time updates
- Context management and optimization

### Example

```tsx
import { createEngine } from 'aidk';
import { createAiSdkModel } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

const engine = createEngine({
  middleware: {
    execute: [loggingMiddleware, authMiddleware],
    model: [tokenCountingMiddleware, retryMiddleware],
    tool: [auditMiddleware],
  },
});

// Execute with full control
const { handle, result } = await engine.execute
  .withContext({
    userId: user.id,
    tenantId: tenant.id,
    threadId: thread.id,
  })
  .withHandle()
  .run(input, <MyAgent />);

// Subscribe to events
handle.on('tick_start', (e) => console.log(`Tick ${e.tick}`));
handle.on('content_delta', (e) => stream.write(e.delta));
handle.on('tool_call', (e) => console.log(`Tool: ${e.name}`));

// Await final result
const output = await result;
```

### Multi-Agent Coordination

```tsx
class CoordinatorAgent extends Component {
  private marketData = comState<any>('market', null);
  private competitorData = comState<any>('competitors', null);

  render(com, state) {
    return (
      <>
        <Model model={openai('gpt-4o')} />

        {/* Parallel execution */}
        <Fork
          root={<ResearchAgent topic="market" />}
          waitUntilComplete={true}
          onComplete={(r) => this.marketData.set(r)}
        />
        <Fork
          root={<ResearchAgent topic="competitors" />}
          waitUntilComplete={true}
          onComplete={(r) => this.competitorData.set(r)}
        />

        {/* Use results when ready */}
        {this.marketData() && this.competitorData() && (
          <Section audience="model">
            <H2>Research Complete</H2>
            <Paragraph>Market: {JSON.stringify(this.marketData())}</Paragraph>
            <Paragraph>Competitors: {JSON.stringify(this.competitorData())}</Paragraph>
          </Section>
        )}
      </>
    );
  }
}
```

### When to use this level

- You're building production applications
- You need persistence and recovery
- You want detailed telemetry and monitoring
- You're building multi-agent systems
- You need real-time updates to clients
- You want global middleware and hooks

---

## Migration Strategy

### Start Small

Pick the simplest level that provides value:

1. **Just trying it out?** → Start with Level 1 (`compile()`)
2. **Need multi-tick?** → Jump to Level 2 (`run()` with executor)
3. **Building from scratch?** → Start at Level 3 or 4
4. **Production app?** → Go straight to Level 5 (Full Engine)

### Gradual Migration

You can migrate one agent at a time:

```tsx
// Old code - keep running
const legacyResult = await generateText({
  model: openai('gpt-4o'),
  messages: buildMessages(),
});

// New code - side by side
const newResult = await generateText(<NewAgent />, {
  model: openai('gpt-4o'),
});
```

### Feature Flags

Use feature flags to test AIDK in production:

```tsx
const useAIDK = await featureFlags.isEnabled('use-aidk', userId);

const result = useAIDK
  ? await generateText(<NewAgent />, { model })
  : await generateText({ model, messages: buildMessages() });
```

## Component Portability

**Important:** All levels use the same component format. Write components once, use them anywhere:

```tsx
// This component works at ALL levels
class UserProfile extends Component {
  render(com) {
    const user = context().user;
    return (
      <Section audience="model">
        <Paragraph>User: {user.name}</Paragraph>
        <Paragraph>Tier: {user.tier}</Paragraph>
      </Section>
    );
  }
}

// Use at Level 1
const { messages } = await compile(<UserProfile />);

// Use at Level 2
await compiler.run(<UserProfile />, executor);

// Use at Level 3
await compiler.run(<UserProfile />);

// Use at Level 5
await engine.execute.run(input, <UserProfile />);
```

## Next Steps

- [Getting Started](/docs/getting-started) - Build your first agent
- [Examples](/examples/progressive-adoption) - See each level in action
- [Core Concepts](/docs/concepts) - Understand the architecture
- [State Management](/docs/state-management) - Use signals effectively
