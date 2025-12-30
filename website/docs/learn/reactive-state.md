# Reactive State

This tutorial covers state management patterns in AIDK—from simple COM state to reactive signals.

## Two State Systems

AIDK provides two complementary state systems:

| System        | Use Case                       | Reactivity |
| ------------- | ------------------------------ | ---------- |
| **COM State** | Shared state across components | Manual     |
| **Signals**   | Component-local reactive state | Automatic  |

## COM State

The Context Object Model (COM) is a shared state tree that all components can read and write.

### Using `comState` (Recommended)

The `comState` helper creates a reactive accessor that syncs with the COM:

```tsx
class TaskAgent extends Component {
  // Create scoped accessors
  private tasks = comState<Task[]>("tasks", []);
  private config = comState<Config>("config", { maxTasks: 10 });

  async onMount() {
    // Load initial data
    this.tasks.set(await TaskService.getTasks());
  }

  render() {
    // Access is cleaner
    const tasks = this.tasks();
    const config = this.config();

    return (
      <>
        <System>Max tasks: {config.maxTasks}</System>
        {tasks.length >= config.maxTasks && (
          <System>Task limit reached. Complete some tasks first.</System>
        )}
      </>
    );
  }
}
```

### When to Use COM State

- **Shared data**: Multiple components need access
- **Persistence**: State that should survive component remounts
- **Cross-cutting concerns**: User info, configuration, feature flags

## Signals

Signals are reactive primitives that automatically trigger recompilation when they change.

### Basic Signals

```tsx
import { signal } from "aidk";

class CounterAgent extends Component {
  private count = signal(0);

  render() {
    return (
      <>
        <System>Current count: {this.count()}</System>
        <IncrementTool onIncrement={() => this.count.set(this.count() + 1)} />
      </>
    );
  }
}
```

### Computed Values

Derive values from signals:

```tsx
import { signal, computed } from "aidk";

class ShoppingAgent extends Component {
  private items = signal<CartItem[]>([]);

  // Computed values update automatically
  private total = computed(() =>
    this.items().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

  private itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity, 0)
  );

  render() {
    return (
      <>
        <Grounding title="Cart Summary">
          <Text>Items: {this.itemCount()}</Text>
          <Text>Total: ${this.total().toFixed(2)}</Text>
        </Grounding>
      </>
    );
  }
}
```

### Watching Changes

React to signal changes:

```tsx
import { signal, watch } from "aidk";

class MonitoringAgent extends Component {
  private errorCount = signal(0);
  private alert = comState<string | null>("alert", null);

  async onMount(com) {
    // Watch for changes and react
    watch(this.errorCount, (count, prevCount) => {
      if (count > 5 && prevCount <= 5) {
        // Alert when errors exceed threshold
        this.alert.set("High error rate detected");
      }
    });
  }

  render(com) {
    const alertMsg = this.alert();

    return (
      <>
        {alertMsg && <System priority="high">{alertMsg}</System>}
        <System>Error count: {this.errorCount()}</System>
      </>
    );
  }
}
```

### When to Use Signals

- **Component-local state**: State that belongs to one component
- **UI-like reactivity**: When changes should trigger recompilation
- **Derived values**: Computed properties that depend on other state

## Combining Both Systems

In practice, you'll use both together:

```tsx
class ResearchAgent extends Component {
  // Signals for component-local reactive state
  private searchCount = signal(0);
  private lastQuery = signal<string | null>(null);

  // COM state for shared data
  private sources = comState<Source[]>("sources", []);
  private findings = comState<Finding[]>("findings", []);

  // Computed from signals
  private isActive = computed(() => this.searchCount() > 0);

  async onMount(com) {
    // Initialize shared state
    this.sources.set(await SourceService.getAll());
  }

  render(com) {
    return (
      <>
        <System>
          Research assistant.
          {this.isActive() && ` Last searched: "${this.lastQuery()}"`}
        </System>

        <SearchTool
          onSearch={(query) => {
            this.searchCount.set(this.searchCount() + 1);
            this.lastQuery.set(query);
          }}
        />

        <Grounding title="Sources">
          {this.sources().map(s => <Text key={s.id}>{s.name}</Text>)}
        </Grounding>

        <Grounding title="Findings">
          {this.findings().map(f => <Text key={f.id}>{f.summary}</Text>)}
        </Grounding>
      </>
    );
  }
}
```

## State Patterns

### Pattern: Async Data Loading

`onMount` is async and completes before the first render. By the time `render()` runs, your data is ready:

```tsx
class DataAgent extends Component {
  private data = comState<Data | null>("data", null);
  private loadError = signal<string | null>(null);

  async onMount() {
    // This completes BEFORE the first render
    try {
      const result = await fetchData();
      this.data.set(result);
    } catch (e) {
      this.loadError.set(e.message);
    }
  }

  render() {
    const error = this.loadError();
    const data = this.data();

    // Handle error case
    if (error) {
      return (
        <System>
          Data unavailable: {error}. Proceeding with limited functionality.
        </System>
      );
    }

    // Data is guaranteed to be loaded by now
    return (
      <>
        <System>You have access to the following data.</System>
        <Grounding title="Available Data">
          {data?.items.map(item => (
            <Text key={item.id}>{item.name}: {item.value}</Text>
          ))}
        </Grounding>
      </>
    );
  }
}
```

Note: There's no "loading" state to render—`onMount` completes before `render` is ever called. The model only sees the final, stable context.

### Pattern: Undo/Redo

```tsx
class EditorAgent extends Component {
  private history = signal<string[]>([]);
  private historyIndex = signal(0);

  private currentContent = computed(() => {
    const h = this.history();
    const idx = this.historyIndex();
    return h[idx] || "";
  });

  private canUndo = computed(() => this.historyIndex() > 0);
  private canRedo = computed(() =>
    this.historyIndex() < this.history().length - 1
  );

  pushContent(content: string) {
    const h = this.history();
    const idx = this.historyIndex();
    // Truncate any redo history
    const newHistory = [...h.slice(0, idx + 1), content];
    this.history.set(newHistory);
    this.historyIndex.set(newHistory.length - 1);
  }

  undo() {
    if (this.canUndo()) {
      this.historyIndex.set(this.historyIndex() - 1);
    }
  }

  redo() {
    if (this.canRedo()) {
      this.historyIndex.set(this.historyIndex() + 1);
    }
  }
}
```

### Pattern: Debounced Updates

```tsx
class SearchAgent extends Component {
  private query = signal("");
  private debouncedQuery = signal("");
  private debounceTimer: NodeJS.Timeout | null = null;

  setQuery(value: string) {
    this.query.set(value);

    // Debounce the actual search
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debouncedQuery.set(value);
    }, 300);
  }

  render() {
    const query = this.debouncedQuery();

    return (
      <>
        <System>
          {query ? `Searching for: ${query}` : "Enter a search query"}
        </System>
      </>
    );
  }
}
```

## Best Practices

1. **Prefer signals for component-local state**: They're more explicit and reactive
2. **Use COM state for shared/persistent data**: When multiple components need access
3. **Keep state minimal**: Only store what you need
4. **Derive don't duplicate**: Use `computed` instead of maintaining derived state manually
5. **Clean up in onUnmount**: Clear timers, subscriptions, etc.

## Key Takeaways

1. **COM state** is shared and manual—good for cross-component data
2. **Signals** are local and reactive—good for component state
3. **Computed** derives values automatically—no manual syncing
4. **Watch** reacts to changes—for side effects
5. Use both systems together for complex agents

## Next Steps

- [Dynamic Models](./dynamic-models) - Switch models based on state
- [Context Object Model](/docs/concepts/context-object-model) - Deep dive on COM
- [State Management](/docs/state-management) - Complete API reference
