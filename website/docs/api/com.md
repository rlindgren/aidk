# COM (Context Object Model) API Reference

The Context Object Model (COM) is the mutable state tree that components interact with during execution. Think of it as "the DOM for AI context" - components manipulate the COM, which is then compiled and sent to the model.

## Accessing COM

COM is passed to component lifecycle methods and render functions:

```tsx
class MyComponent extends Component {
  render(com: COM, state: TickState) {
    // Access COM here
  }

  onMount(com: COM) {
    // Access COM here
  }
}
```

## Timeline API

The timeline contains the conversation history.

### addMessage()

Add a message to the timeline.

```tsx
com.addMessage(
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  { tags: ['greeting'], visibility: 'visible' }
);
```

**Parameters:**
- `message: Message` - The message to add
- `options.tags?: TimelineTag[]` - Optional categorization tags
- `options.visibility?: TimelineVisibility` - `'visible'` | `'hidden'` | `'collapsed'`
- `options.metadata?: Record<string, unknown>` - Optional metadata

**Note:** System messages are automatically routed to the system messages array, not the timeline.

### addTimelineEntry()

Add a generic timeline entry (for events, etc.).

```tsx
com.addTimelineEntry({
  kind: 'event',
  event: { type: 'user_action', action: 'clicked', target: 'button' },
  metadata: { timestamp: Date.now() }
});
```

### getTimeline()

Get all timeline entries.

```tsx
const entries = com.getTimeline(); // COMTimelineEntry[]
```

## Section API

Sections organize system-level content.

### addSection()

Add or update a section.

```tsx
com.addSection({
  id: 'instructions',
  content: 'You are a helpful assistant.',
  title: 'System Instructions',
  audience: 'model', // 'model' | 'user' | 'all'
  visibility: 'visible',
});
```

Sections with the same ID are merged:
- Strings: concatenated with newline
- Arrays: concatenated
- Objects: shallow merged
- Last section's metadata wins

### getSection()

Get a section by ID.

```tsx
const section = com.getSection('instructions'); // COMSection | undefined
```

### getSections()

Get all sections.

```tsx
const sections = com.getSections(); // { [id: string]: COMSection }
```

## Tool API

Manage available tools.

### addTool()

Register a tool.

```tsx
com.addTool(myTool);
```

**Behavior:**
- Stores the executable tool for execution
- Converts Zod schemas to JSON Schema for provider compatibility
- Emits `tool:registered` event

### removeTool()

Remove a tool by name.

```tsx
com.removeTool('myTool');
```

### getTool()

Get a tool instance by name.

```tsx
const tool = com.getTool('calculator'); // ExecutableTool | undefined
```

### getTools()

Get all registered tools.

```tsx
const tools = com.getTools(); // ExecutableTool[]
```

### getToolDefinition()

Get provider-compatible tool definition (JSON Schema).

```tsx
const def = com.getToolDefinition('calculator'); // ToolDefinition | undefined
```

### addToolDefinition()

Add a client-side tool definition (no server execution).

```tsx
com.addToolDefinition({
  name: 'showChart',
  description: 'Display a chart',
  parameters: { type: 'object', properties: { ... } },
  type: 'CLIENT',
});
```

## State API

COM-level state shared across all components.

### setState()

Set a state value.

```tsx
com.setState('userPreferences', { theme: 'dark' });
```

Emits `state:changed` event.

### getState()

Get a state value.

```tsx
const prefs = com.getState<UserPrefs>('userPreferences');
```

### setStatePartial()

Update multiple state values.

```tsx
com.setStatePartial({
  count: 5,
  lastUpdated: Date.now(),
});
```

### getStateAll()

Get all state.

```tsx
const allState = com.getStateAll(); // Record<string, unknown>
```

## Ephemeral API

Ephemeral content is injected each tick but NOT persisted.

### addEphemeral()

Add ephemeral content.

```tsx
com.addEphemeral(
  [{ type: 'text', text: `Current balance: $${balance}` }],
  'before-user',  // position
  10,             // order (lower = earlier)
  { source: 'account-service' }, // metadata
  'balance-info', // id
  ['grounding'],  // tags
  'account'       // type (for model config filtering)
);
```

**Positions:**
| Position | Description |
|----------|-------------|
| `'start'` | At the beginning of context |
| `'end'` | At the end of context |
| `'before-user'` | Before the most recent user message |
| `'after-user'` | After the most recent user message |
| `'before-assistant'` | Before the most recent assistant message |
| `'after-assistant'` | After the most recent assistant message |

### getEphemeral()

Get all ephemeral entries.

```tsx
const ephemeral = com.getEphemeral(); // EphemeralEntry[]
```

## Model API

Manage the model adapter.

### setModel()

Set the model for this execution.

```tsx
com.setModel(myModelInstance);
// or by registry key
com.setModel('gpt-4');
```

### getModel()

Get the current model.

```tsx
const model = com.getModel(); // ModelInstance | string | undefined
```

### unsetModel()

Clear the current model.

```tsx
com.unsetModel();
```

### setModelOptions()

Set model configuration options.

```tsx
com.setModelOptions({
  temperature: 0.7,
  maxTokens: 1000,
  messageTransformation: {
    eventMessageHandling: 'convert-to-user',
  },
});
```

### getModelOptions()

Get model configuration.

```tsx
const options = com.getModelOptions(); // ModelConfig | undefined
```

## Process API

Manage child executions (Fork/Spawn).

### process.fork()

Create a child execution with inherited state.

```tsx
const handle = com.process.fork(
  { message: 'Research this topic' },
  ResearchAgent,
  { inherit: { timeline: 'copy', hooks: true } }
);
```

### process.spawn()

Create an independent child execution.

```tsx
const handle = com.process.spawn(
  { message: 'Background task' },
  BackgroundAgent
);
```

### process.signal()

Send a signal to an execution.

```tsx
com.process.signal(pid, 'interrupt', 'Need user input');
```

### process.kill()

Terminate an execution immediately.

```tsx
com.process.kill(pid, 'No longer needed');
```

### process.list()

List active child executions.

```tsx
const children = com.process.list(); // ExecutionHandle[]
```

### process.get()

Get an execution by PID.

```tsx
const handle = com.process.get(pid); // ExecutionHandle | undefined
```

## Tick Control API

Control execution flow.

### requestStop()

Request that execution stop after this tick.

```tsx
com.requestStop({
  reason: 'task-complete',
  status: 'completed', // 'continue' | 'completed' | 'aborted'
  priority: 10,
});
```

### requestContinue()

Override a stop condition and continue.

```tsx
com.requestContinue({
  reason: 'retrying-after-error',
  priority: 20,
});
```

**Priority:** Higher priority requests take precedence. Stop requests beat continue requests at the same priority.

### abort()

Request immediate execution abort.

```tsx
com.abort('User cancelled');
```

Use in `onMessage` hooks for immediate interruption.

## Recompilation API

Request re-compilation for context management.

### requestRecompile()

Request another compile pass.

```tsx
// In onAfterCompile hook
onAfterCompile(com, compiled, state) {
  const tokens = estimateTokens(compiled);
  if (tokens > MAX_TOKENS) {
    com.setTimeline(summarize(com.getTimeline()));
    com.requestRecompile('context-too-large');
  }
}
```

## Reference API

Access component instances by name.

### getRef()

Get a component reference.

```tsx
const myComponent = com.getRef<MyComponent>('myRef');
```

### getRefs()

Get all references.

```tsx
const refs = com.getRefs(); // Record<string, any>
```

## Channels API

Access real-time communication channels.

### channels

Get the channel service.

```tsx
const channelService = com.channels; // ChannelService | undefined
```

Or use the method:

```tsx
const channelService = com.getChannelService();
```

## User Input API

### getUserInput()

Get the original user input for this execution.

```tsx
const input = com.getUserInput(); // EngineInput | undefined
```

## Events

COM extends EventEmitter. Listen for mutations:

```tsx
com.on('message:added', (message, options) => { ... });
com.on('timeline:modified', (entry, action) => { ... });
com.on('tool:registered', (tool) => { ... });
com.on('tool:added', (toolName) => { ... });
com.on('tool:removed', (toolName) => { ... });
com.on('state:changed', (key, value, previousValue) => { ... });
com.on('state:cleared', () => { ... });
com.on('model:changed', (model) => { ... });
com.on('model:unset', () => { ... });
com.on('section:updated', (section, action) => { ... });
com.on('metadata:changed', (key, value, previousValue) => { ... });
com.on('execution:message', (message) => { ... });
```

## Output

### toInput()

Render COM to the final structure sent to models.

```tsx
const input = com.toInput();
// {
//   timeline: COMTimelineEntry[],
//   sections: { [id: string]: COMSection },
//   ephemeral: EphemeralEntry[],
//   system: COMTimelineEntry[],
//   tools: ToolDefinition[],
//   metadata: Record<string, unknown>,
//   modelOptions?: ModelConfig
// }
```

### clear()

Reset COM for a new render pass (called automatically each tick).

```tsx
com.clear();
```

## Related

- [Context Object Model](/docs/concepts/context-object-model) - Conceptual guide
- [Ephemeral vs Persisted](/docs/guides/ephemeral-content) - Content lifecycle
- [Engine](/docs/api/engine) - Engine API reference
