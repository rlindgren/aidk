# Getting Started

This guide walks you through creating your first AIDK application.

## Prerequisites

- Node.js 24+
- pnpm (recommended) or npm

## Installation

```bash
# Create a new project
mkdir my-agent && cd my-agent
pnpm init

# Install core packages
pnpm add aidk aidk-express express

# Install an AI adapter (choose one)
pnpm add aidk-ai-sdk ai @ai-sdk/openai
# or: pnpm add aidk-openai
# or: pnpm add aidk-google

# Install dev dependencies
pnpm add -D typescript @types/node @types/express tsx
```

## Project Setup

### TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "aidk"
  },
  "include": ["src"]
}
```

### Package Configuration

Update `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

## Create Your First Agent

### 1. Define the Agent

Create `src/agents/assistant.tsx`:

```tsx
import {
  EngineComponent,
  COM,
  TickState,
  Section,
  Message,
  Timeline,
  comState,
  type JSX,
  type COMTimelineEntry,
} from 'aidk';
import { AiSdkModel } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

export class AssistantAgent extends Component {
  // Use comState for timeline - shared across components, persisted across ticks
  private timeline = comState<COMTimelineEntry[]>('timeline', []);

  onTickStart(com: COM, state: TickState) {
    // Append new entries from the model response
    if (state.current?.timeline?.length) {
      this.timeline.update(t => [...t, ...state.current!.timeline]);
    }
  }

  render(com: COM, state: TickState): JSX.Element {
    return (
      <>
        {/* Configure the AI model */}
        <AiSdkModel
          model={openai('gpt-4o-mini')}
          providerOptions={{
            apiKey: process.env.OPENAI_API_KEY,
          }}
        />

        {/* Conversation history - read from signal */}
        <Timeline>
          {this.timeline().map((entry, index) => (
            <Message
              key={index}
              role={entry.message?.role || 'user'}
              content={entry.message?.content}
            />
          ))}
        </Timeline>

        {/* System instructions - automatically formatted for the model */}
        <Section id="instructions" audience="model">
          You are a helpful assistant. Be concise and friendly.
        </Section>
      </>
    );
  }
}

// Functional wrapper
export function Assistant(): JSX.Element {
  return <AssistantAgent />;
}
```

> **Note:** We use `comState()` for the timeline because it persists across ticks and is automatically cleaned up. See [State Management](./state-management.md) for more details.

> **Tip:** Your JSX content is automatically formatted in the optimal format for each model. OpenAI models get Markdown, Claude gets XML, etc. See [Renderers](/docs/guides/renderers) for details.

### 2. Create the Server

Create `src/server.ts`:

```tsx
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createEngine } from 'aidk';
import { createSSEHandler } from 'aidk-express';
import { Assistant } from './agents/assistant';

const app = express();
app.use(cors());
app.use(express.json());

// Create the engine
const engine = createEngine();

// Agent streaming endpoint
app.post('/api/agent/stream', createSSEHandler({
  engine,
  getAgent: () => <Assistant />,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 3. Run the Server

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Start the server
pnpm dev
```

### 4. Test with curl

```bash
curl -X POST http://localhost:3000/api/agent/stream \
  -H "Content-Type: application/json" \
  -d '{"timeline": [{"kind": "message", "message": {"role": "user", "content": [{"type": "text", "text": "Hello!"}]}}]}'
```

## Adding Tools

Create `src/tools/calculator.ts`:

```tsx
import { createTool } from 'aidk';
import { z } from 'zod';

export const calculatorTool = createTool({
  name: 'calculator',
  description: 'Evaluate mathematical expressions',
  input: z.object({
    expression: z.string().describe('The math expression to evaluate'),
  }),
  execute: async ({ expression }) => {
    try {
      // In production, use a proper math parser
      const result = Function(`"use strict"; return (${expression})`)();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: 'Invalid expression' };
    }
  },
});
```

Add the tool to your agent:

```tsx
import { calculatorTool } from '../tools/calculator';

// In your render method:
<>
  <AiSdkModel model={openai('gpt-4o-mini')} />
  <Timeline>{/* ... */}</Timeline>
  <Section id="instructions" audience="model">
    You are a helpful assistant with access to a calculator.
  </Section>
  <Tool definition={calculatorTool} />
</>
```

## Using NestJS Instead

If you prefer NestJS over Express, you can use `aidk-nestjs`:

### Installation

```bash
pnpm add aidk aidk-nestjs @nestjs/common @nestjs/core @nestjs/platform-express rxjs express
pnpm add -D @nestjs/cli typescript
```

### Setup

```tsx
// app.module.ts
import { Module } from '@nestjs/common';
import { EngineModule } from 'aidk-nestjs';
import { createEngine } from 'aidk';
import { AgentController } from './agent.controller';

@Module({
  imports: [
    EngineModule.forRoot({
      engine: createEngine(),
    }),
  ],
  controllers: [AgentController],
})
export class AppModule {}
```

### Controller

```tsx
// agent.controller.ts
import { Controller, Post, Body, Res, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { Stream, EngineContextInterceptor } from 'aidk-nestjs';
import { EngineInput } from 'aidk';
import { Assistant } from './agents/assistant';

@Controller('api/agent')
@UseInterceptors(EngineContextInterceptor)
export class AgentController {
  @Post('stream')
  @Stream(<Assistant />)
  async stream(@Body() input: EngineInput, @Res() res: Response) {
    return input;
  }
}
```

See the [NestJS API Documentation](./api/nestjs/module.md) for more details.

## Adding a Frontend

See the [React Integration](./integrations/react.md) or [Angular Integration](./integrations/angular.md) guides.

## Next Steps

- [Core Concepts](./concepts.md) - Understand the architecture
- [State Management](./state-management.md) - Signals and reactive state
- [Tools Guide](./guides/tools.md) - Create powerful tools
- [Channels Guide](./guides/channels.md) - Real-time updates
- [API Reference](./api/README.md) - Full API documentation
