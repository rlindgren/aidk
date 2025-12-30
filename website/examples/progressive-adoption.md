# Progressive Adoption Examples

See each adoption level in action with complete, runnable examples.

## Level 1: Just Compilation

The minimal starting point. Use JSX for context, keep your existing code.

::: code-group

```tsx [agent.tsx]
import { System, User, Assistant, Section } from '@aidk/ai-sdk';

export function SimpleAgent() {
  return (
    <>
      <System>You are a helpful math tutor.</System>

      <User>What is 2 + 2?</User>

      <Section audience="model">
        Show your work step by step.
      </Section>
    </>
  );
}
```

```tsx [main.ts]
import { compile } from '@aidk/ai-sdk';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { SimpleAgent } from './agent';

async function main() {
  // Compile JSX to AI SDK format
  const compiled = await compile(<SimpleAgent />);

  // Use your existing generateText code
  const result = await generateText({
    model: compiled.model ?? openai('gpt-4o'),
    messages: compiled.messages,
    tools: compiled.tools,
    system: compiled.system,
  });

  console.log(result.text);
}

main();
```

:::

**Key Points:**

- No changes to your `generateText` call
- JSX provides cleaner context building
- You control everything about model execution

---

## Level 2: Executor Pattern

Add multi-tick execution while keeping control of model calls.

::: code-group

```tsx [agent.tsx]
import { Component, comState, Timeline, Message } from 'aidk';
import { Model, Tool } from '@aidk/ai-sdk';
import { openai } from '@ai-sdk/openai';
import { calculatorTool } from './tools';

export class MathAgent extends Component {
  private timeline = comState<any[]>('timeline', []);

  onTickStart(com, state) {
    if (state.current?.timeline) {
      this.timeline.update(t => [...t, ...state.current.timeline]);
    }
  }

  render() {
    return (
      <>
        <Model model={openai('gpt-4o-mini')} />

        <Timeline>
          {this.timeline().map((entry, i) => (
            <Message key={i} {...entry.message} />
          ))}
        </Timeline>

        <Tool definition={calculatorTool} />
      </>
    );
  }
}
```

```tsx [main.ts]
import { createCompiler } from '@aidk/ai-sdk';
import { generateText } from 'ai';
import { MathAgent } from './agent';

async function main() {
  const compiler = createCompiler();

  // You provide the executor
  const result = await compiler.run(
    <MathAgent />,
    [{ role: 'user', content: 'What is 15 * 23?' }],
    async (input) => {
      console.log(`Tick ${input.tick}: Calling model...`);

      return await generateText({
        model: input.model ?? openai('gpt-4o'),
        messages: input.messages,
        tools: input.tools,
        system: input.system,
      });
    }
  );

  console.log(result.text);
}

main();
```

```tsx [tools.ts]
import { createTool } from 'aidk';
import { z } from 'zod';

export const calculatorTool = createTool({
  name: 'calculate',
  description: 'Perform mathematical calculations',
  parameters: z.object({
    expression: z.string(),
  }),
  execute: async ({ expression }) => {
    const result = Function(`"use strict"; return (${expression})`)();
    return { result };
  },
});
```

:::

**Key Points:**

- AIDK handles multi-tick loop
- Tools automatically executed
- You control each model call
- Add logging, caching, retries in your executor

---

## Level 3: Managed Execution

Let AIDK handle everything.

::: code-group

```tsx [agent.tsx]
import { Component, comState, Timeline, Message, Section } from 'aidk';
import { Model, Tool } from '@aidk/ai-sdk';
import { openai } from '@ai-sdk/openai';

export class TaskAgent extends Component {
  private timeline = comState<any[]>('timeline', []);
  private taskCount = comState<number>('tasks', 0);

  onTickStart(com, state) {
    if (state.current?.timeline) {
      this.timeline.update(t => [...t, ...state.current.timeline]);
    }
  }

  render(com, state) {
    return (
      <>
        <Model
          model={openai('gpt-4o-mini')}
          temperature={0.7}
        />

        <Timeline>
          {this.timeline().map((entry, i) => (
            <Message key={i} {...entry.message} />
          ))}
        </Timeline>

        <Section audience="model">
          <H2>Task Management</H2>
          <Paragraph>Total tasks: {this.taskCount()}</Paragraph>
        </Section>
      </>
    );
  }
}
```

```tsx [main.ts]
import { createCompiler } from '@aidk/ai-sdk';
import { openai } from '@ai-sdk/openai';
import { TaskAgent } from './agent';

async function main() {
  const compiler = createCompiler({
    model: openai('gpt-4o-mini'),
    temperature: 0.7,
  });

  // No executor needed
  const result = await compiler.run(
    <TaskAgent />,
    [{ role: 'user', content: 'Add a task: Buy groceries' }]
  );

  console.log(result.text);
}

main();
```

:::

**Key Points:**

- Minimal boilerplate
- Model configured once
- Components can override model per-tick
- Great for new projects

---

## Level 4: Drop-in Replacement

Simplest API - mirrors AI SDK exactly.

```tsx
import { generateText, streamText } from '@aidk/ai-sdk';
import { openai } from '@ai-sdk/openai';

// Just like ai.generateText(), but with JSX
const result = await generateText(
  <>
    <System>You are helpful.</System>
    <User>Hello!</User>
    <Model model={openai('gpt-4o')} temperature={0.8} />
  </>
);

console.log(result.text);

// Streaming works the same way
const { fullStream } = streamText(
  <>
    <System>You are helpful.</System>
    <User>Tell me a story.</User>
  </>,
  {
    model: openai('gpt-4o'), // override or explicit options
  }
);

for await (const chunk of fullStream) {
  process.stdout.write(chunk.textDelta ?? '');
}
```

**Key Points:**

- Exact same API as AI SDK
- JSX is just the first argument
- Works with all AI SDK options
- Perfect for simple use cases

---

## Level 5: Full Engine with Express

Production-ready backend with full features.

::: code-group

```tsx [agent.tsx]
import { Component, comState, Context } from 'aidk';
import { Model, Tool } from '@aidk/ai-sdk';
import { openai } from '@ai-sdk/openai';

export class CustomerAgent extends Component {
  private timeline = comState<any[]>('timeline', []);
  private customer = comState<any>('customer', null);

  async onMount(com) {
    const ctx = Context.get();
    const customer = await db.customers.findById(ctx.user.id);
    this.customer.set(customer);
  }

  onTickStart(com, state) {
    if (state.current?.timeline) {
      this.timeline.update(t => [...t, ...state.current.timeline]);
    }
  }

  render() {
    const ctx = Context.get();
    const customer = this.customer();

    return (
      <>
        <Model model={openai('gpt-4o')} />

        <Section audience="model">
          <H2>Customer Context</H2>
          <Paragraph>Name: {customer?.name}</Paragraph>
          <Paragraph>Tier: {customer?.tier}</Paragraph>
          <Paragraph>Support level: {ctx.metadata.support_tier}</Paragraph>
        </Section>

        <Timeline>
          {this.timeline().map((entry, i) => (
            <Message key={i} {...entry.message} />
          ))}
        </Timeline>

        {customer?.tier === 'premium' && <RefundTool />}
        <SearchOrdersTool />
      </>
    );
  }
}
```

```tsx [server.ts]
import express from 'express';
import { createEngine } from 'aidk';
import { createSSEHandler } from 'aidk-express';
import { CustomerAgent } from './agents/customer';
import { loggingMiddleware, authMiddleware } from './middleware';

const app = express();

const engine = createEngine({
  middleware: {
    execute: [loggingMiddleware, authMiddleware],
    model: [tokenCountingMiddleware],
    tool: [auditMiddleware],
  },
});

app.post('/api/agent/stream', createSSEHandler({
  engine,
  getAgent: () => <CustomerAgent />,
  getContext: (req) => ({
    user: req.user,
    metadata: {
      tenantId: req.user.tenantId,
      support_tier: req.user.supportTier,
      sessionId: req.sessionID,
    },
  }),
}));

app.listen(3000);
```

```tsx [middleware.ts]
import { Context } from 'aidk';

export const loggingMiddleware = async (args, envelope, next) => {
  const ctx = Context.get();
  console.log(`[${ctx.user.id}] Execution starting`);

  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;

  console.log(`[${ctx.user.id}] Completed in ${duration}ms`);
  return result;
};

export const tokenCountingMiddleware = async (args, envelope, next) => {
  const result = await next();

  await db.metrics.create({
    userId: Context.get().user.id,
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens,
  });

  return result;
};
```

:::

**Key Points:**

- Full production features
- Middleware at every level
- Context available everywhere
- Real-time streaming to clients
- Persistence and recovery
- OpenTelemetry support

---

## Choosing Your Level

| Level               | Use When                       | Complexity | Features            |
| ------------------- | ------------------------------ | ---------- | ------------------- |
| 1: compile()        | Trying it out, minimal changes | ⭐         | JSX only            |
| 2: run() + executor | Need control + multi-tick      | ⭐⭐       | + State, tools      |
| 3: run() managed    | Building from scratch          | ⭐⭐       | + Auto-execution    |
| 4: generateText()   | Want simplest API              | ⭐         | Drop-in replacement |
| 5: Full Engine      | Production apps                | ⭐⭐⭐⭐   | Everything          |

## Next Steps

- [Progressive Adoption Guide](/docs/progressive-adoption) - Detailed guide
- [Getting Started](/docs/getting-started) - Build your first agent
- [Full Stack Example](/examples/fullstack) - Complete application
