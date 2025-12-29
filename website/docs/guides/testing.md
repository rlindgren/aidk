# Testing

This guide covers testing strategies for AIDK agents, from unit tests to integration tests with mock models.

## Testing Utilities

AIDK provides testing utilities in `aidk-shared/testing`:

```typescript
import {
  createUserMessage,
  createAssistantMessage,
  createToolUseBlock,
  createToolResultBlock,
  createTextBlock,
  createTextStreamSequence,
  captureAsyncGenerator,
  waitFor,
} from "aidk-shared/testing";
```

## Unit Testing Components

### Testing Render Output

Test that components render the expected context:

```typescript
import { compile } from "aidk-ai-sdk";
import { describe, it, expect } from "vitest";

describe("GreetingAgent", () => {
  it("renders system prompt with user name", async () => {
    const result = await compile(
      <GreetingAgent userName="Alice" />
    );

    expect(result.system).toContain("Alice");
    expect(result.system).toContain("helpful assistant");
  });

  it("includes tools in compilation", async () => {
    const result = await compile(<TaskAgent />);

    expect(result.tools).toHaveProperty("add_task");
    expect(result.tools).toHaveProperty("complete_task");
  });
});
```

### Testing with Initial State

Pass initial COM state to test different scenarios:

```typescript
import { compile } from "aidk-ai-sdk";

describe("TaskAgent", () => {
  it("renders tasks when present", async () => {
    const initialState = {
      tasks: [
        { id: "1", text: "Buy milk", done: false },
        { id: "2", text: "Walk dog", done: true },
      ],
    };

    const result = await compile(
      <TaskAgent />,
      { initialState }
    );

    expect(result.system).toContain("Buy milk");
    expect(result.system).toContain("Walk dog");
  });

  it("shows empty state message when no tasks", async () => {
    const result = await compile(
      <TaskAgent />,
      { initialState: { tasks: [] } }
    );

    expect(result.system).toContain("No tasks yet");
  });
});
```

### Testing Conditional Rendering

```typescript
describe("AdaptiveAgent", () => {
  it("uses detailed prompt after 5 ticks", async () => {
    const result = await compile(
      <AdaptiveAgent />,
      { tickState: { tick: 6 } }
    );

    expect(result.system).toContain("detailed");
  });

  it("uses concise prompt on early ticks", async () => {
    const result = await compile(
      <AdaptiveAgent />,
      { tickState: { tick: 2 } }
    );

    expect(result.system).not.toContain("detailed");
  });
});
```

## Testing Tools

### Testing Tool Handlers

Test tool handlers in isolation:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("SearchTool", () => {
  it("returns search results", async () => {
    const mockService = {
      query: vi.fn().mockResolvedValue([
        { title: "Result 1", url: "https://example.com/1" },
        { title: "Result 2", url: "https://example.com/2" },
      ]),
    };

    const tool = createSearchTool({ service: mockService });
    const result = await tool.handler({ query: "test query" });

    expect(mockService.query).toHaveBeenCalledWith("test query");
    expect(result).toHaveLength(2);
  });

  it("handles empty results", async () => {
    const mockService = {
      query: vi.fn().mockResolvedValue([]),
    };

    const tool = createSearchTool({ service: mockService });
    const result = await tool.handler({ query: "no results" });

    expect(result).toEqual([]);
  });
});
```

### Testing Tool Lifecycle

Test tool lifecycle hooks:

```typescript
describe("DatabaseTool", () => {
  it("connects on mount", async () => {
    const mockDb = {
      connect: vi.fn().mockResolvedValue({ connected: true }),
    };

    const com = createMockCOM();
    const tool = createDatabaseTool({ db: mockDb });

    await tool.onMount?.(com);

    expect(mockDb.connect).toHaveBeenCalled();
    expect(com.setState).toHaveBeenCalledWith(
      "connection",
      expect.objectContaining({ connected: true })
    );
  });

  it("disconnects on unmount", async () => {
    const mockConnection = { close: vi.fn() };
    const com = createMockCOM({
      getState: () => mockConnection,
    });

    const tool = createDatabaseTool({});
    await tool.onUnmount?.(com);

    expect(mockConnection.close).toHaveBeenCalled();
  });
});

// Helper to create mock COM
function createMockCOM(overrides = {}) {
  return {
    setState: vi.fn(),
    getState: vi.fn(),
    ...overrides,
  };
}
```

### Testing Tool Rendering

```typescript
describe("InventoryTool", () => {
  it("renders current inventory", async () => {
    const com = createMockCOM({
      getState: (key) => {
        if (key === "inventory") {
          return [
            { id: "1", name: "Widget", quantity: 10 },
            { id: "2", name: "Gadget", quantity: 5 },
          ];
        }
      },
    });

    const tool = createInventoryTool();
    const rendered = tool.render?.(com, {});

    // Compile the rendered JSX
    const result = await compile(rendered);

    expect(result.system).toContain("Widget");
    expect(result.system).toContain("10");
  });
});
```

## Integration Testing

### Testing with Mock Models

Create a mock model adapter for deterministic testing:

```typescript
import { createCompiler } from "aidk-ai-sdk";

function createMockModel(responses: string[]) {
  let callIndex = 0;

  return async function mockModel(input) {
    const response = responses[callIndex] || "Default response";
    callIndex++;

    return {
      text: response,
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 50 },
    };
  };
}

describe("ChatAgent integration", () => {
  it("handles multi-turn conversation", async () => {
    const mockModel = createMockModel([
      "Hello! How can I help you today?",
      "I'd be happy to help with that.",
    ]);

    const compiler = createCompiler();
    const events: any[] = [];

    for await (const event of compiler.stream(
      <ChatAgent />,
      mockModel,
      { timeline: [createUserMessage("Hi there")] }
    )) {
      events.push(event);
    }

    const textEvents = events.filter(e => e.type === "text");
    expect(textEvents[0].content).toContain("Hello");
  });
});
```

### Testing Tool Execution Flow

```typescript
describe("TaskAgent integration", () => {
  it("executes tool and updates state", async () => {
    // Mock model that calls the add_task tool
    const mockModel = createMockModelWithToolCall({
      name: "add_task",
      arguments: { text: "New task" },
    });

    const compiler = createCompiler();
    const finalState = await runToCompletion(
      compiler,
      <TaskAgent />,
      mockModel,
      { timeline: [createUserMessage("Add a task")] }
    );

    expect(finalState.tasks).toContainEqual(
      expect.objectContaining({ text: "New task" })
    );
  });
});

async function runToCompletion(compiler, agent, model, input) {
  let state = {};

  for await (const event of compiler.stream(agent, model, input)) {
    if (event.type === "state_update") {
      state = { ...state, ...event.state };
    }
  }

  return state;
}
```

### Testing Streaming

```typescript
import { captureAsyncGenerator } from "aidk-shared/testing";

describe("streaming", () => {
  it("emits chunks in order", async () => {
    const mockModel = createStreamingMockModel([
      { type: "text_delta", content: "Hello" },
      { type: "text_delta", content: " world" },
      { type: "finish", reason: "stop" },
    ]);

    const compiler = createCompiler();
    const events = await captureAsyncGenerator(
      compiler.stream(<ChatAgent />, mockModel)
    );

    const textDeltas = events
      .filter(e => e.type === "text_delta")
      .map(e => e.content);

    expect(textDeltas).toEqual(["Hello", " world"]);
  });
});
```

## Testing Patterns

### Snapshot Testing

Capture and compare compiled output:

```typescript
describe("ComplexAgent", () => {
  it("matches snapshot", async () => {
    const result = await compile(
      <ComplexAgent config={defaultConfig} />,
      { initialState: defaultState }
    );

    expect(result).toMatchSnapshot();
  });
});
```

### Testing Hooks

Test that hooks fire correctly:

```typescript
describe("lifecycle hooks", () => {
  it("calls onMount once", async () => {
    const onMountSpy = vi.fn();

    class TestAgent extends Component {
      async onMount(com) {
        onMountSpy(com);
      }
      render() {
        return <System>Test</System>;
      }
    }

    const engine = createEngine();
    await engine.run(<TestAgent />);

    expect(onMountSpy).toHaveBeenCalledTimes(1);
  });

  it("calls onTickStart on each tick", async () => {
    const onTickStartSpy = vi.fn();

    class TestAgent extends Component {
      async onTickStart(com, state) {
        onTickStartSpy(state.tick);
        if (state.tick >= 3) {
          return { stop: true };
        }
      }
      render() {
        return <System>Test</System>;
      }
    }

    const engine = createEngine();
    await engine.run(<TestAgent />, mockModel);

    expect(onTickStartSpy).toHaveBeenCalledTimes(3);
    expect(onTickStartSpy).toHaveBeenCalledWith(1);
    expect(onTickStartSpy).toHaveBeenCalledWith(2);
    expect(onTickStartSpy).toHaveBeenCalledWith(3);
  });
});
```

### Testing Error Handling

```typescript
describe("error handling", () => {
  it("recovers from tool errors", async () => {
    const failingTool = createTool({
      name: "failing_tool",
      handler: async () => {
        throw new Error("Tool failed");
      },
    });

    class RecoveringAgent extends Component {
      private error = signal<string | null>(null);

      async onError(error) {
        this.error.set(error.message);
        return { retry: false, continue: true };
      }

      render() {
        return (
          <>
            {this.error() && <System>Error occurred: {this.error()}</System>}
            {failingTool}
          </>
        );
      }
    }

    const engine = createEngine();
    // Should not throw
    await expect(engine.run(<RecoveringAgent />)).resolves.toBeDefined();
  });
});
```

## Best Practices

1. **Test at multiple levels**: Unit test handlers, integration test flows
2. **Use deterministic mocks**: Avoid flaky tests with predictable mock models
3. **Test edge cases**: Empty states, error conditions, boundary values
4. **Snapshot sparingly**: Only for complex outputs that are hard to assert
5. **Isolate side effects**: Mock external services and databases
6. **Test the contract**: Focus on inputs/outputs, not implementation details

## Test Setup

Example Vitest configuration:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.spec.ts", "**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/*.spec.ts"],
    },
  },
});
```

## Next Steps

- [Error Handling](./error-handling) - Testing error recovery patterns
- [API Reference](/api/) - Complete testing utility documentation
