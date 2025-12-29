# Creating Tools

**Tools are components.**

This is the key insight. In AIDK, tools aren't just functions that execute when called—they're **full components** with lifecycle hooks, state management, and the ability to render context for the model.

A tool can:
- **Load data on mount** — Initialize state when the agent starts
- **Render context** — Show the model its current state on every tick
- **React to lifecycle events** — onTickStart, onTickEnd, onComplete
- **Manage state** — Persist data across ticks via COM state
- **Subscribe to channels** — Update in real-time

This means your tools don't just execute—they **participate in the render cycle** just like any other component. See [Runtime Architecture](/docs/concepts/runtime-architecture) and [Tick Lifecycle](/docs/concepts/tick-lifecycle) for how this fits into the execution model.

## The Difference

### Other Frameworks: Functions

```python
# Just a function that executes
@tool
def calculator(expression: str) -> str:
    result = eval(expression)
    return f"Result: {result}"
```

### AIDK: Components

```tsx
// A component with lifecycle, state, and context
export const CalculatorTool = createTool({
  name: 'calculator',
  description: 'Performs calculations',
  parameters: z.object({ expression: z.string() }),
  handler: async (input) => {
    const result = eval(input.expression);
    return [{ type: 'text', text: `${result}` }];
  },
  
  // Tools can have lifecycle hooks
  onMount(com) {
    console.log('Calculator tool mounted');
  },
  
  // Tools can render context
  render(com, state) {
    const history = com.getState('calc_history') || [];
    return (
      <Section audience="model">
        <H3>Calculator History</H3>
        <List>
          {history.map(calc => (
            <ListItem>{calc.expression} = {calc.result}</ListItem>
          ))}
        </List>
      </Section>
    );
  }
});
```

## Simple Tools (Function Style)

For basic tools, just define handler and schema:

``` tsx
import { createTool } from 'aidk';
import { z } from 'zod';

export const CalculatorTool = createTool({
  name: 'calculator',
  description: 'Performs mathematical calculations',
  parameters: z.object({
    expression: z.string().describe('Math expression to evaluate'),
  }),
  handler: async (input) => {
    try {
      const result = Function(`"use strict"; return (${input.expression})`)();
      return [{ type: 'text', text: `${input.expression} = ${result}` }];
    } catch (error: any) {
      return [{ type: 'text', text: `Error: ${error.message}` }];
    }
  },
});
```

**Use in agent:**

```tsx
import { CalculatorTool } from './tools/calculator';

class MyAgent extends Component {
  render() {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <Tool definition={CalculatorTool} />
      </>
    );
  }
}
```

## Component-Style Tools

Tools can be full components with lifecycle and rendering:

```tsx
import { 
  createTool, 
  Context, 
  COM, 
  TickState,
  Section, 
  Paragraph, 
  List, 
  ListItem,
  Grounding
} from 'aidk';
import { z } from 'zod';

export const ScratchpadTool = createTool({
  name: 'scratchpad',
  description: 'Take notes during the conversation',
  parameters: z.object({
    action: z.enum(['add', 'remove', 'clear', 'list']),
    note_id: z.string().optional(),
    text: z.string().optional(),
  }),
  
  // Handler - executes when tool is called
  handler: async (input) => {
    const ctx = Context.get();
    const notes = await NotesService.perform(
      input.action, 
      input.text, 
      ctx.metadata.threadId
    );
    return [{ type: 'text', text: `Note ${input.action} successful` }];
  },
  
  // Lifecycle: Called when tool is added to agent
  async onMount(com: COM) {
    const ctx = Context.get();
    const threadId = ctx.metadata.threadId;
    
    // Load initial state
    const notes = await NotesService.getNotes(threadId);
    com.setState('scratchpad_notes', notes);
    
    // Subscribe to real-time updates
    NotesChannel.registerContext(ctx, { threadId }, (event, result) => {
      if (result?.notes) {
        com.setState('scratchpad_notes', result.notes);
      }
    });
  },
  
  // Lifecycle: Called when tool is removed
  async onUnmount() {
    NotesChannel.unregisterContext(Context.get());
  },
  
  // Render: Contributes context to the model
  render(com: COM, state: TickState) {
    const notes = com.getState('scratchpad_notes') || [];
    
    return (
      <>
        {/* Instructions for the model */}
        <Section id="scratchpad-instructions" audience="model">
          <Paragraph>
            You have a <inlineCode>scratchpad</inlineCode> tool for taking notes.
          </Paragraph>
          <Paragraph>Actions: add, remove, clear, list</Paragraph>
        </Section>
        
        {/* Current state */}
        <Grounding position="after-system" audience="model">
          {notes.length === 0 ? (
            <Paragraph>
              <strong>Scratchpad:</strong> Empty
            </Paragraph>
          ) : (
            <>
              <Paragraph>
                <strong>Scratchpad:</strong> {notes.length} note(s)
              </Paragraph>
              <List ordered>
                {notes.map((note, i) => (
                  <ListItem key={note.id}>
                    {note.text} (ID: {note.id})
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Grounding>
      </>
    );
  }
});
```

**What this enables:**

1. **State Management**: Tools maintain their own state via `com.setState`
2. **Context Rendering**: Tools show their state to the model
3. **Real-time Updates**: Tools can subscribe to channels and update
4. **Lifecycle Hooks**: Initialize and cleanup resources
5. **Dynamic Context**: Context updates every tick based on tool state

## Static Tool Members

Attach tools directly to components:

```tsx
import { Component, COM, TickState } from 'aidk';
import { CalculatorTool } from './tools/calculator';
import { ScratchpadTool } from './tools/scratchpad';

class MathAgent extends Component {
  // Static tool member - automatically registered
  static tool = CalculatorTool;
  
  render(com: COM, state: TickState) {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <Timeline>{/* ... */}</Timeline>
        
        {/* Tool is automatically available - no need to declare it */}
        <Section audience="model">
          You can use the calculator tool to perform calculations.
        </Section>
      </>
    );
  }
}

// Or multiple tools
class MultiToolAgent extends Component {
  static tools = [CalculatorTool, ScratchpadTool];
  
  render() { /* ... */ }
}
```

**Benefits:**
- Tools declared alongside the component that uses them
- Automatic registration - no manual `<Tool>` component needed
- Clear dependencies - tools are part of the component definition
- Reusable - move the component, tools come with it

## Tool Lifecycle Hooks

Tools support the same lifecycle hooks as components:

``` tsx
export const MyTool = createTool({
  name: 'my_tool',
  description: 'Example tool',
  parameters: z.object({ /* ... */ }),
  handler: async (input) => { /* ... */ },
  
  // Called when tool is added to agent
  async onMount(com: COM) {
    console.log('Tool mounted');
    // Initialize resources
    await loadInitialState(com);
  },
  
  // Called before each tick
  onTickStart(com: COM, state: TickState) {
    console.log(`Tick ${state.tick} starting`);
    // Update state before render
  },
  
  // Called on each tick to render context
  render(com: COM, state: TickState) {
    return <Section>{/* Tool-specific context */}</Section>;
  },
  
  // Called after each tick
  onTickEnd(com: COM, state: TickState) {
    console.log(`Tick ${state.tick} complete`);
  },
  
  // Called when execution completes
  onComplete(com: COM, finalState: any) {
    console.log('Execution complete');
    // Save final state
  },
  
  // Called when tool is removed
  async onUnmount() {
    console.log('Tool unmounting');
    // Cleanup resources
  },
  
  // Called on errors
  onError(com: COM, error: Error, state: TickState) {
    console.error('Tool error:', error);
    // Handle or recover
  }
});
```

## Real-World Example: Todo List Tool

A complete tool with state, lifecycle, and rendering:

```tsx
import { 
  createTool, 
  Context, 
  COM, 
  TickState,
  Section, 
  Table,
  Paragraph 
} from 'aidk';
import { z } from 'zod';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

export const TodoListTool = createTool({
  name: 'todo_list',
  description: 'Manage a todo list during the conversation',
  parameters: z.object({
    action: z.enum(['add', 'complete', 'remove', 'list']),
    todo_id: z.string().optional(),
    text: z.string().optional(),
  }),
  
  handler: async (input) => {
    const ctx = Context.get();
    const threadId = ctx.metadata.threadId;
    
    let result;
    switch (input.action) {
      case 'add':
        result = await TodoService.add(threadId, input.text!);
        break;
      case 'complete':
        result = await TodoService.complete(threadId, input.todo_id!);
        break;
      case 'remove':
        result = await TodoService.remove(threadId, input.todo_id!);
        break;
      case 'list':
        result = await TodoService.list(threadId);
        break;
    }
    
    return [{ 
      type: 'text', 
      text: `Todo ${input.action}: ${result.message}` 
    }];
  },
  
  async onMount(com: COM) {
    const ctx = Context.get();
    const threadId = ctx.metadata.threadId;
    
    // Load todos
    const todos = await TodoService.list(threadId);
    com.setState('todos', todos.items);
    
    // Subscribe to real-time updates
    TodoChannel.registerContext(ctx, { threadId }, (event, result) => {
      if (result?.todos) {
        com.setState('todos', result.todos);
      }
    });
  },
  
  async onUnmount() {
    TodoChannel.unregisterContext(Context.get());
  },
  
  render(com: COM, state: TickState) {
    const todos = com.getState<Todo[]>('todos') || [];
    const pending = todos.filter(t => !t.completed);
    const completed = todos.filter(t => t.completed);
    
    return (
      <>
        {/* Tool instructions */}
        <Section id="todo-instructions" audience="model">
          <Paragraph>
            You have a <inlineCode>todo_list</inlineCode> tool for managing tasks.
          </Paragraph>
        </Section>
        
        {/* Current state */}
        <Section id="todo-state" audience="model">
          <Paragraph>
            <strong>Current Todo List:</strong>
          </Paragraph>
          
          {pending.length > 0 && (
            <>
              <Paragraph><strong>Pending ({pending.length}):</strong></Paragraph>
              <Table
                headers={['ID', 'Task', 'Created']}
                rows={pending.map(t => [
                  t.id.slice(0, 8),
                  t.text,
                  t.createdAt.toLocaleDateString()
                ])}
              />
            </>
          )}
          
          {completed.length > 0 && (
            <>
              <Paragraph><strong>Completed ({completed.length}):</strong></Paragraph>
              <Table
                headers={['ID', 'Task']}
                rows={completed.map(t => [
                  t.id.slice(0, 8),
                  t.text
                ])}
              />
            </>
          )}
          
          {todos.length === 0 && (
            <Paragraph><em>No todos yet. Add one to get started.</em></Paragraph>
          )}
        </Section>
      </>
    );
  }
});
```

**What makes this powerful:**

1. **State persists across ticks**: Todos loaded once, updated via channels
2. **Dynamic context**: Model sees current todo state every tick
3. **Real-time sync**: User and model see same data
4. **Lifecycle managed**: Cleanup happens automatically
5. **One source of truth**: State in COM, rendered to both audiences

## Using Tools in Agents

### Method 1: Direct JSX Component (Recommended)

Tools created with `createTool` can be used directly as JSX components:

```tsx
import { CalculatorTool, ScratchpadTool, TodoListTool } from './tools';

class TaskAssistant extends Component {
  render() {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <Timeline>{/* ... */}</Timeline>
        
        {/* Use tools as JSX components */}
        <TodoListTool />
        <ScratchpadTool />
        <CalculatorTool />
      </>
    );
  }
}
```

**Why this is clean:**
- Tools are components, so use them like components
- Clear, declarative syntax
- Easy to see what tools are available
- Works with conditional rendering

### Method 2: Static Member

Attach tools to the component class:

```tsx
class MyAgent extends Component {
  static tool = CalculatorTool;
  
  render() {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        {/* Tool automatically registered */}
      </>
    );
  }
}
```

**When to use:**
- Tool is tightly coupled to the component
- You want automatic registration
- Tool doesn't need to be conditionally rendered

### Method 3: Multiple Static Tools

```tsx
class MyAgent extends Component {
  static tools = [CalculatorTool, ScratchpadTool, TodoListTool];
  
  render() { /* ... */ }
}
```

### Method 4: `<Tool>` Component Wrapper

For backward compatibility or explicit control:

```tsx
class MyAgent extends Component {
  render() {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <Tool definition={CalculatorTool} />
      </>
    );
  }
}
```

### Method 5: Conditional Tools

```tsx
class MyAgent extends Component {
  render(com, state) {
    const ctx = Context.get();
    
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        
        {/* Always available */}
        <CalculatorTool />
        
        {/* Conditional on user tier */}
        {ctx.user.isPremium && <AdvancedAnalyticsTool />}
        
        {/* Conditional on state */}
        {state.tick > 5 && <DeepAnalysisTool />}
      </>
    );
  }
}
```

## Tool State Management

Tools manage state via lifecycle hooks, not in the handler:

``` tsx
export const StatefulTool = createTool({
  name: 'stateful',
  parameters: z.object({ action: z.string() }),

  // Initialize state on mount
  async onMount(com) {
    com.setState('tool_usage_count', 0);
  },

  // Increment count on each tick that follows tool usage
  // (tracked by a flag set in render or via external service)
  async onTickStart(com) {
    // Refresh count from external tracking if needed
    const count = await ToolAnalytics.getUsageCount();
    com.setState('tool_usage_count', count);
  },

  // Handler only receives input
  handler: async (input) => {
    // Track usage externally (handler can call services)
    await ToolAnalytics.recordUsage(input.action);

    return [{
      type: 'text',
      text: `Action "${input.action}" completed`
    }];
  },

  render(com) {
    const count = com.getState<number>('tool_usage_count') || 0;

    return (
      <Section audience="model">
        <Paragraph>
          This tool has been used <strong>{count}</strong> times.
        </Paragraph>
      </Section>
    );
  }
});
```

Note: The handler only receives `input` and returns `ContentBlock[]`. State updates happen in lifecycle hooks like `onMount`, `onTickStart`, or `onTickEnd`.

## Context Access

Tools have full access to execution context:

``` tsx
import { Context } from 'aidk';

export const ContextAwareTool = createTool({
  name: 'context_aware',
  parameters: z.object({ /* ... */ }),
  
  handler: async (input) => {
    // Access execution context
    const ctx = Context.get();
    
    // User information
    const userId = ctx.user.id;
    const userName = ctx.user.name;
    
    // Metadata
    const threadId = ctx.metadata.threadId;
    const sessionId = ctx.metadata.sessionId;
    
    // Perform action with context
    await logAction(userId, input);
    
    return [{ type: 'text', text: 'Action completed' }];
  },
  
  render(com) {
    const ctx = Context.get();
    
    return (
      <Section audience="model">
        <Paragraph>
          Current user: {ctx.user.name} (ID: {ctx.user.id})
        </Paragraph>
      </Section>
    );
  }
});
```

## Tool Composition

Tools can use other tools:

``` tsx
export const CompositeTool = createTool({
  name: 'composite',
  parameters: z.object({ /* ... */ }),
  
  async onMount(com) {
    // Ensure dependencies are mounted
    const calculator = com.getState('calculator_tool');
    if (!calculator) {
      throw new Error('CompositeTool requires CalculatorTool');
    }
  },
  
  handler: async (input) => {
    // Use another tool's functionality
    const calcResult = await CalculatorTool.handler({ 
      expression: input.calculation 
    });
    
    // Build on top of it
    return [{ 
      type: 'text', 
      text: `Composite result: ${calcResult}` 
    }];
  }
});
```

## Testing Tools

Test tools like components:

``` tsx
import { CalculatorTool } from './calculator';

describe('CalculatorTool', () => {
  it('evaluates expressions', async () => {
    const result = await CalculatorTool.handler({ expression: '2 + 2' });
    expect(result[0].text).toContain('4');
  });
  
  it('renders context', () => {
    const com = createMockCOM();
    const rendered = CalculatorTool.render?.(com, createMockState());
    expect(rendered).toBeDefined();
  });
  
  it('initializes on mount', async () => {
    const com = createMockCOM();
    await CalculatorTool.onMount?.(com);
    expect(com.getState('initialized')).toBe(true);
  });
});
```

## Best Practices

### 1. Keep Handler Logic Separate

```tsx
// ✅ Good: Business logic in service
export const MyTool = createTool({
  handler: async (input) => {
    return await MyService.performAction(input);
  }
});

// ❌ Less good: Business logic in handler
export const MyTool = createTool({
  handler: async (input) => {
    // 50 lines of business logic...
  }
});
```

### 2. Use State for Tool Data

```tsx
// ✅ Good: State in COM
onMount(com) {
  const data = await loadData();
  com.setState('tool_data', data);
},
render(com) {
  const data = com.getState('tool_data');
  return <Section>{/* use data */}</Section>;
}
```

### 3. Clean Up Resources

```tsx
// ✅ Good: Cleanup in onUnmount
async onMount(com) {
  this.subscription = Channel.subscribe(/* ... */);
},
async onUnmount() {
  this.subscription?.unsubscribe();
}
```

### 4. Provide Clear Instructions

```tsx
// ✅ Good: Clear tool usage instructions
render(com) {
  return (
    <Section audience="model">
      <H3>Calculator Tool</H3>
      <Paragraph>Use this tool to evaluate math expressions.</Paragraph>
      <Paragraph>Example: <inlineCode>{'{"expression": "2 + 2"}'}</inlineCode></Paragraph>
    </Section>
  );
}
```

## Related

- [Semantic Primitives](/docs/semantic-primitives) - Components for context
- [State Management](/docs/state-management) - Managing tool state
- [Channels](/docs/guides/channels) - Real-time tool updates
- [Context](/docs/concepts#context) - Accessing execution context

---

**Next:** [Real-time Channels](/docs/guides/channels)

