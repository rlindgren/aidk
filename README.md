# AIDK - AI Development Kit

A declarative, JSX-based framework for building AI agents and applications.

## Features

- **🎯 Declarative Agent Definition** - Define agents using JSX components
- **🔄 Streaming First** - Built-in support for streaming responses
- **🛠️ Tool System** - Type-safe tool definitions with Zod schemas
- **📡 Real-time Channels** - WebSocket/SSE channels for live updates
- **🔌 Adapter Pattern** - Swap AI providers (OpenAI, Google, AI SDK)
- **⚛️ React & Angular** - Framework bindings for frontend integration
- **🎭 Hooks System** - Extensible middleware for model, tool, and engine events

## Packages

| Package        | Description                                      |
| -------------- | ------------------------------------------------ |
| `aidk`         | Core framework - JSX runtime, engine, components |
| `aidk-kernel`  | Execution primitives, context, telemetry         |
| `aidk-client`  | Browser client for connecting to AIDK backends   |
| `aidk-express` | Express.js middleware and SSE transport          |
| `aidk-server`  | Server utilities and channel adapters            |
| `aidk-react`   | React hooks and components                       |
| `aidk-angular` | Angular services and components                  |
| `aidk-ai-sdk`  | Vercel AI SDK adapter                            |
| `aidk-openai`  | OpenAI direct adapter                            |
| `aidk-google`  | Google AI / Vertex AI adapter                    |

## Quick Start

### Installation

```bash
# Core packages
pnpm add aidk aidk-kernel

# Choose your adapter
pnpm add aidk-ai-sdk ai @ai-sdk/openai  # Vercel AI SDK
# or
pnpm add aidk-openai                     # Direct OpenAI
# or
pnpm add aidk-google                     # Google AI

# Server integration
pnpm add aidk-express express

# Frontend (pick one)
pnpm add aidk-react aidk-client          # React
pnpm add aidk-angular aidk-client        # Angular
```

### Define an Agent

```tsx
// agents/assistant.tsx
import {
  EngineComponent,
  ContextObjectModel,
  TickState,
  Section,
  Message,
  Timeline,
} from "aidk";
import { AiSdkModel } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";

export class AssistantAgent extends Component {
  render(com: COM, state: TickState) {
    return (
      <>
        <AiSdkModel model={openai("gpt-4o-mini")} />

        <Timeline>
          {state.current?.timeline?.map((entry, i) => (
            <Message
              key={i}
              role={entry.message?.role}
              content={entry.message?.content}
            />
          ))}
        </Timeline>

        <Section id="instructions" audience="model">
          You are a helpful assistant.
        </Section>
      </>
    );
  }
}
```

### Create Tools

```tsx
import { createTool } from "aidk";
import { z } from "zod";

export const calculatorTool = createTool({
  name: "calculator",
  description: "Perform mathematical calculations",
  parameters: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    const result = eval(expression); // Use a proper math parser in production
    return { result };
  },
});
```

### Set Up Server

```typescript
// server.ts
import express from 'express';
import { createEngine } from 'aidk';
import { createExpressMiddleware } from 'aidk-express';
import { AssistantAgent } from './agents/assistant';

const app = express();
const engine = createEngine();

app.use('/api/agent', createExpressMiddleware({
  engine,
  agent: <AssistantAgent />,
}));

app.listen(3000);
```

### Connect from Frontend (React)

```tsx
import { useEngineClient, useExecution } from "aidk-react";

function Chat() {
  const { client } = useEngineClient({ baseUrl: "http://localhost:3000" });
  const { messages, send, isStreaming } = useExecution({
    client,
    agentId: "assistant",
  });

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.content}</div>
      ))}
      <input onKeyDown={(e) => e.key === "Enter" && send(e.target.value)} />
    </div>
  );
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ aidk-react  │  │aidk-angular │  │    aidk-client      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/SSE/WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Server                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │aidk-express │  │ aidk-server │  │      Channels       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Core Engine                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    aidk     │  │ aidk-kernel │  │      Adapters       │  │
│  │  (engine,   │  │  (context,  │  │ (ai-sdk, openai,    │  │
│  │   jsx,      │  │   spans,    │  │  google)            │  │
│  │   tools)    │  │  telemetry) │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Documentation

- [Documentation Website](https://rlindgren.github.io/aidk/)
- [Getting Started](https://rlindgren.github.io/aidk/docs/getting-started)
- [API Reference](https://rlindgren.github.io/aidk/api/)
- [Examples](./example/)

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm typecheck

# Build all packages
pnpm build

# Run example backend
cd example && pnpm dev:backend

# Run example frontend
cd example && pnpm dev:frontend
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[LICENSE](./LICENSE)
