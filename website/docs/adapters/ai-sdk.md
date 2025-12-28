# Vercel AI SDK Adapter

The AI SDK adapter is the recommended way to use AIDK. It wraps the Vercel AI SDK, giving you access to all supported models with AIDK's component model.

## Installation

```bash
npm install aidk aidk-ai-sdk ai @ai-sdk/openai
```

For other providers:

```bash
npm install @ai-sdk/anthropic  # Claude
npm install @ai-sdk/google     # Gemini
npm install @ai-sdk/mistral    # Mistral
```

## Basic Usage

### Level 1: Just Compile

Use AIDK to build context, then call `generateText` yourself:

```typescript
import { compile } from 'aidk-ai-sdk';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Define your agent as JSX
function ChatAgent({ userMessage }: { userMessage: string }) {
  return (
    <>
      <System>You are a helpful assistant.</System>
      <User>{userMessage}</User>
    </>
  );
}

// Compile to AI SDK format
const { messages, tools, system } = await compile(
  <ChatAgent userMessage="Hello!" />
);

// Call the model yourself
const result = await generateText({
  model: openai('gpt-4o'),
  messages,
  tools,
  system,
});

console.log(result.text);
```

### Level 2: Use the Compiler

Let the compiler manage multi-turn execution:

```typescript
import { createCompiler } from 'aidk-ai-sdk';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const compiler = createCompiler();

const result = await compiler.run(
  <ChatAgent userMessage="Hello!" />,
  async (input) => {
    return generateText({
      model: openai('gpt-4o'),
      ...input,
    });
  }
);

console.log(result.text);
```

### Level 3: Managed Model

Configure the model in the compiler:

```typescript
import { createCompiler } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

const compiler = createCompiler({
  model: openai('gpt-4o'),
});

// Simple execution
const result = await compiler.run(<ChatAgent userMessage="Hello!" />);

// Streaming
for await (const event of compiler.stream(<ChatAgent userMessage="Hello!" />)) {
  if (event.type === 'content_delta') {
    process.stdout.write(event.delta);
  }
}
```

## Creating Models

### Using `aisdk()` Helper

The `aisdk()` function wraps any AI SDK model for use with AIDK:

```typescript
import { aisdk } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

// OpenAI
const gpt4 = aisdk({ model: openai("gpt-4o") });

// Anthropic
const claude = aisdk({ model: anthropic("claude-3-5-sonnet-20241022") });

// With options
const gpt4Turbo = aisdk({
  model: openai("gpt-4-turbo"),
  temperature: 0.7,
  maxTokens: 4096,
});
```

### In Components

Use models in your agent:

```tsx
import { aisdk } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";

class MyAgent extends Component {
  render() {
    return (
      <>
        <Model model={aisdk({ model: openai("gpt-4o") })} />
        <System>You are a helpful assistant.</System>
        <Timeline messages={state.timeline} />
      </>
    );
  }
}
```

### Dynamic Model Selection

Switch models based on context:

```tsx
class AdaptiveAgent extends Component {
  render(com, state) {
    const needsPower = this.shouldUpgrade(state);

    const model = needsPower
      ? aisdk({ model: openai("gpt-4o") })
      : aisdk({ model: openai("gpt-4o-mini") });

    return (
      <>
        <Model model={model} />
        <System>You are a helpful assistant.</System>
        <Timeline messages={state.timeline} />
      </>
    );
  }

  shouldUpgrade(state) {
    // Upgrade if the model seems confused
    return state.tick > 2 && !state.hasToolCalls;
  }
}
```

## Provider Options

### OpenAI

```typescript
import { openai } from "@ai-sdk/openai";

const model = aisdk({
  model: openai("gpt-4o"),
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.9,
  frequencyPenalty: 0.5,
  presencePenalty: 0.5,
});
```

### Anthropic

```typescript
import { anthropic } from "@ai-sdk/anthropic";

const model = aisdk({
  model: anthropic("claude-3-5-sonnet-20241022"),
  temperature: 0.7,
  maxTokens: 4096,
});
```

Claude models automatically receive XML-formatted context.

### Google

```typescript
import { google } from "@ai-sdk/google";

const model = aisdk({
  model: google("gemini-1.5-pro"),
  temperature: 0.7,
});
```

## Streaming

### With Compiler

```typescript
const compiler = createCompiler({ model: openai('gpt-4o') });

for await (const event of compiler.stream(<MyAgent />)) {
  switch (event.type) {
    case 'message_start':
      console.log('Starting message...');
      break;
    case 'content_delta':
      process.stdout.write(event.delta);
      break;
    case 'tool_call':
      console.log('Tool called:', event.toolName);
      break;
    case 'message_end':
      console.log('\nDone. Reason:', event.stopReason);
      break;
  }
}
```

### With Engine

```typescript
import { createEngine } from 'aidk';
import { aisdk } from 'aidk-ai-sdk';

const engine = createEngine({
  model: aisdk({ model: openai('gpt-4o') }),
});

for await (const event of engine.stream(input, <MyAgent />)) {
  // Same event types
}
```

## Tools

Tools work automatically with the AI SDK adapter:

```typescript
const Calculator = createTool({
  name: 'calculator',
  description: 'Perform arithmetic',
  parameters: z.object({
    expression: z.string(),
  }),
  handler: async ({ expression }) => {
    const result = eval(expression);
    return [{ type: 'text', text: String(result) }];
  },
});

function MathAgent() {
  return (
    <>
      <Model model={aisdk({ model: openai('gpt-4o') })} />
      <Calculator />
      <User>What is 2 + 2?</User>
    </>
  );
}

const result = await compiler.run(<MathAgent />);
// Model will call the calculator tool and respond with "4"
```

## Reasoning Models

For models with extended thinking (o1, o3, etc.):

```typescript
const reasoningModel = aisdk({
  model: openai('o1-preview'),
  // Reasoning models have specific constraints
  temperature: 1, // Required for o1
});

// Reasoning tokens are tracked separately
for await (const event of compiler.stream(<MyAgent />)) {
  if (event.type === 'reasoning_delta') {
    console.log('Thinking:', event.reasoning);
  }
  if (event.type === 'content_delta') {
    console.log('Response:', event.delta);
  }
}
```

## Auto-Format Selection

The adapter automatically selects the right format for each model:

| Provider           | Format             |
| ------------------ | ------------------ |
| Anthropic (Claude) | XML                |
| OpenAI             | Markdown           |
| Google             | Markdown           |
| Others             | Markdown (default) |

You can override this:

```typescript
const model = aisdk({
  model: openai("gpt-4o"),
  renderer: "xml", // Force XML format
});
```

## Full Example

```typescript
import { createCompiler, aisdk } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';
import { Component, System, Timeline, createTool, Grounding } from 'aidk';
import { z } from 'zod';

// Define a tool
const Weather = createTool({
  name: 'weather',
  description: 'Get current weather',
  parameters: z.object({
    city: z.string(),
  }),
  handler: async ({ city }) => {
    const data = await fetchWeather(city);
    return [{ type: 'text', text: `${city}: ${data.temp}°F, ${data.conditions}` }];
  },
});

// Define the agent
class WeatherAgent extends Component {
  static tools = [Weather];

  render(com, state) {
    return (
      <>
        <Model model={aisdk({ model: openai('gpt-4o') })} />
        <System>
          You help users check the weather.
          Use the weather tool to get current conditions.
        </System>
        <Weather />
        <Timeline messages={state.timeline} />
      </>
    );
  }
}

// Run it
const compiler = createCompiler();

for await (const event of compiler.stream(<WeatherAgent />, {
  timeline: [{ role: 'user', content: "What's the weather in Tokyo?" }],
})) {
  if (event.type === 'content_delta') {
    process.stdout.write(event.delta);
  }
}
```

## Next Steps

- [Creating Tools](/docs/guides/tools) - Build tools that render context
- [State Management](/docs/state-management) - Manage state across ticks
- [Express Integration](/docs/frameworks/express) - Add HTTP endpoints
