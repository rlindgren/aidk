# aidk

Core framework for building AI agents with JSX.

## Installation

```bash
pnpm add aidk
```

## Usage

```tsx
import {
  EngineComponent,
  ContextObjectModel,
  TickState,
  Section,
  Message,
  Timeline,
  createEngine,
  createTool
} from 'aidk';
import { z } from 'zod';

// Define a tool
const greetTool = createTool({
  name: 'greet',
  description: 'Greet someone',
  input: z.object({ name: z.string() }),
  execute: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
});

// Define an agent
class MyAgent extends Component {
  render(com: COM, state: TickState) {
    return (
      <>
        <Timeline>
          {state.current?.timeline?.map((entry, i) => (
            <Message key={i} role={entry.message?.role} content={entry.message?.content} />
          ))}
        </Timeline>
        <Section id="instructions" audience="model">
          You are a helpful assistant.
        </Section>
        <Tool definition={greetTool} />
      </>
    );
  }
}

// Execute
const engine = createEngine();
const result = await engine.execute(
  { timeline: [{ kind: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Hi' }] } }] },
  <MyAgent />
);
```

## Key Exports

- `createEngine()` - Create an execution engine
- `EngineComponent` - Base class for agent components
- `createTool()` - Create a typed tool definition
- `Section` - Content section component
- `Message` - Message component
- `Timeline` - Conversation history component
- `Context` - Execution context access

## Documentation

See the [full documentation](https://rlindgren.github.io/aidk).
