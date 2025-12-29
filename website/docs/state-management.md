# State Management

AIDK provides a signal-based reactive state system inspired by Angular Signals and SolidJS. This guide covers how to manage state in your components.

## Overview

There are three types of state signals in AIDK:

| Type                    | Function                      | Scope            | Writable? | Persisted? |
| ----------------------- | ----------------------------- | ---------------- | --------- | ---------- |
| **Local State**         | `signal()`                    | Single component | Yes       | No         |
| **COM State (owned)**   | `comState()`                  | Shared           | Yes       | Yes        |
| **COM State (watched)** | `watchComState()` / `watch()` | Shared           | **No**    | Yes        |

**Writable signals** (`signal`, `comState`) return `Signal<T>`:

- `signal()` — read current value
- `signal.set(value)` — set new value
- `signal.update(fn)` — update with function
- `signal.dispose()` — cleanup (usually automatic)

**Read-only signals** (`watchComState`, `watch`) return `ReadonlySignal<T>`:

- `signal()` — read current value
- `signal.dispose()` — cleanup
- ❌ No `.set()` or `.update()` — can only observe, not modify

## Basic Usage

### Local State with `signal()`

Use `signal()` for component-local state that doesn't need to be shared:

``` tsx
import { EngineComponent, signal } from 'aidk';

class CounterComponent extends Component {
  // Local state - only this component can access it
  private count = signal(0);
  private startedAt = signal(new Date());

  onTickStart(com, state) {
    this.count.update(n => n + 1);
  }

  render() {
    return <div>Count: {this.count()}, Started: {this.startedAt()}</div>;
  }
}
```

### Shared State with `comState()`

Use `comState()` for state shared across components and persisted across ticks:

``` tsx
import { EngineComponent, comState, type COMTimelineEntry } from 'aidk';

class TimelineComponent extends Component {
  // COM state - shared across all components, persisted across ticks
  private timeline = comState<COMTimelineEntry[]>('timeline', []);

  async onMount(com) {
    // Load initial data
    const history = await loadHistory();
    this.timeline.set(history);
  }

  onTickStart(com, state) {
    // Append new entries from current tick
    if (state.current?.timeline?.length) {
      this.timeline.update(t => [...t, ...state.current.timeline]);
    }
  }

  render() {
    return (
      <Timeline>
        {this.timeline().map((entry, i) => (
          <Message key={i} {...entry.message} />
        ))}
      </Timeline>
    );
  }
}
```

### Watching State with `watchComState()` / `watch()`

Use `watchComState()` (or its shorthand `watch()`) when you want to **observe** COM state that another component owns, without being able to modify it:

``` tsx
import { EngineComponent, watchComState, watch, computed } from 'aidk';

class StatusDisplay extends Component {
  // Watch state owned by TimelineComponent
  private timeline = watchComState<COMTimelineEntry[]>('timeline');

  // Shorthand version
  private status = watch<'idle' | 'loading' | 'done'>('status', 'idle');

  // Can derive from watched state
  private messageCount = computed(() => this.timeline()?.length ?? 0);

  render() {
    return (
      <div>
        Status: {this.status()} | Messages: {this.messageCount()}
      </div>
    );

    // Cannot modify - these would be TypeScript errors:
    // this.timeline.set([...])  // ❌ No .set() method
    // this.status.update(...)   // ❌ No .update() method
  }
}
```

**When to use `watchComState` vs `comState`:**

- Use `comState()` when your component **owns** the state (creates, updates, manages it)
- Use `watchComState()` when your component just **observes** state owned by another component

### Derived State with `computed()`

Use `computed()` for values derived from other signals. Computed signals are:

- **Lazy** — only computed when read
- **Memoized** — cached until dependencies change
- **Reactive** — auto-update when dependencies change

``` tsx
import { EngineComponent, signal, computed } from 'aidk';

class StatsComponent extends Component {
  private items = signal<Item[]>([]);

  // Computed - recalculates only when items changes
  private totalPrice = computed(() =>
    this.items().reduce((sum, item) => sum + item.price, 0)
  );

  private itemCount = computed(() => this.items().length);

  render() {
    return (
      <div>
        Items: {this.itemCount()}, Total: ${this.totalPrice()}
      </div>
    );
  }
}
```

### Side Effects with `effect()`

Use `effect()` sparingly for syncing with external systems. **Prefer `computed()` for derived values.**

``` tsx
import { EngineComponent, signal, effect } from "aidk";

class LoggingComponent extends Component {
  private count = signal(0);
  private loggerEffect;

  onMount(com) {
    // Effect runs when count changes
    this.loggerEffect = effect(() => {
      console.log("Count changed:", this.count());
    });
  }

  // Effect is automatically cleaned up in onUnmount
}
```

Effects can return a cleanup function:

``` tsx
effect(() => {
  const timer = setInterval(() => console.log("tick"), 1000);

  // Cleanup runs before next execution and on dispose
  return () => clearInterval(timer);
});
```

## Batching Updates

When updating multiple signals, use `batch()` to prevent intermediate re-renders:

``` tsx
import { batch, signal } from "aidk";

const firstName = signal("");
const lastName = signal("");

// Without batch: effects run twice
firstName.set("John");
lastName.set("Doe");

// With batch: effects run once
batch(() => {
  firstName.set("John");
  lastName.set("Doe");
});
```

## Reading Without Tracking

Use `untracked()` to read a signal without creating a dependency:

``` tsx
import { effect, signal, untracked } from "aidk";

const user = signal("Alice");
const count = signal(0);

effect(() => {
  const currentUser = user(); // Tracked - effect re-runs when user changes
  const currentCount = untracked(() => count()); // Not tracked

  console.log(`${currentUser} has count ${currentCount}`);
});

count.set(10); // Effect does NOT re-run
user.set("Bob"); // Effect re-runs
```

## Cleanup

All signals are **automatically cleaned up** when a component unmounts. The cleanup:

- **signal()** — Clears all subscribers
- **comState()** — Removes COM event listener, clears subscribers
- **computed()** — Unsubscribes from dependencies, clears subscribers
- **effect()** — Unsubscribes from dependencies, runs cleanup function

### Manual Disposal

If you need to dispose a signal before unmount:

``` tsx
class MyComponent extends Component {
  private tempData = signal<Data | null>(null);

  clearTempData() {
    this.tempData.dispose();
    this.tempData = signal(null); // Create fresh if needed
  }
}
```

## State in Class Components

Class components use `signal()`, `comState()`, and `watch()` as class properties:

``` tsx
class MyAgent extends Component {
  // Local state
  private count = signal(0);

  // Shared state
  private timeline = comState<Message[]>('timeline', []);

  // Watch state from another component
  private status = watch<string>('agentStatus');

  render() {
    return <Text>Count: {this.count()}, Messages: {this.timeline().length}</Text>;
  }
}
```

### Props in Class Components

Use `input()` to create reactive props:

``` tsx
interface AgentProps {
  title?: string;
  model: string;  // Required
}

class ConfigurableAgent extends Component<AgentProps> {
  // Reactive props
  title = input<string>('Default Title');
  model = input<string>();  // Required from props interface

  render() {
    return (
      <>
        <H1>{this.title()}</H1>
        <AiSdkModel model={openai(this.model())} />
      </>
    );
  }
}

// Usage
<ConfigurableAgent model="gpt-4o" title="My Agent" />
```

## State in Function Components

Function components use **hooks** (React-inspired, async-first):

``` tsx
function Counter() {
  // Local state
  const count = useSignal(0);

  // Shared state
  const timeline = useComState<Message[]>('timeline', []);

  // Watch state
  const status = useWatch<string>('agentStatus');

  // Computed value
  const doubled = useComputed(() => count() * 2, []);

  return <Text>Count: {count()}, Doubled: {doubled()}</Text>;
}
```

### Props in Function Components

Function components receive props directly - just use them:

``` tsx
interface MessageCardProps {
  message: string;
  author?: string;
}

function MessageCard(props: MessageCardProps) {
  // Access props directly - no signals needed for function components
  const { message, author = 'Anonymous' } = props;

  return (
    <Section>
      <Paragraph>{message}</Paragraph>
      <Text><em>- {author}</em></Text>
    </Section>
  );
}

// Usage
<MessageCard message="Hello!" author="Alice" />
```

> **Note:** Unlike class components, function components don't need `input()` signals for props. The component re-runs on each tick, so just read from `props` directly.

### The Correct Patterns

``` tsx
// ✅ Use EngineComponent for stateful components
class GoodComponent extends Component {
  private count = signal(0);  // Stored on instance, persists

  render() {
    return <div>{this.count()}</div>;
  }
}

// ✅ Pure function components should be stateless
function PureComponent(props: { count: number }) {
  return <div>{props.count}</div>;  // Receive state as props
}

// ✅ Or use COM state passed down
function TimelineView(props: { entries: COMTimelineEntry[] }) {
  return <Timeline>{props.entries.map(...)}</Timeline>;
}
```

## API Reference

### `signal<T>(initialValue: T, options?): Signal<T>`

Creates a local reactive signal.

``` tsx
const count = signal(0);
const name = signal("", {
  equal: (a, b) => a.toLowerCase() === b.toLowerCase(),
});

count(); // Read: 0
count.set(10); // Set: 10
count.update((n) => n + 1); // Update: 11
count.value; // Property access: 11
count.dispose(); // Cleanup
count.disposed; // Check: true
```

### `comState<T>(key: string, initialValue: T): Signal<T>`

Creates a COM-bound signal (shared, persisted). Use when you **own** the state.

``` tsx
const timeline = comState<Entry[]>('timeline', []);

// Automatically syncs with COM state
timeline.set([...]);  // Updates COM
com.setState('timeline', [...]);  // Updates signal
```

### `watchComState<T>(key: string, defaultValue?): ReadonlySignal<T>`

Creates a **read-only** signal that watches COM state. Use when another component owns the state.

``` tsx
class ObserverComponent extends Component {
  // Watch state set by another component
  private timeline = watchComState<Entry[]>('timeline');

  // Can derive from it
  private count = computed(() => this.timeline()?.length ?? 0);

  render() {
    // Can read
    return <div>Count: {this.count()}</div>;

    // Cannot write - no .set() or .update()
    // this.timeline.set([...])  // ❌ Not available
  }
}
```

### `watch<T>(key: string, defaultValue?): ReadonlySignal<T>`

Shorthand for `watchComState`. Same API.

``` tsx
private status = watch<'idle' | 'loading'>('status', 'idle');
```

### `input<T>(initialValue?, config?): ReadonlySignal<T>`

Creates a signal bound to a component prop. **Class components only.**

The prop key is inferred from the property name, or can be overridden via `config.key`.

``` tsx
interface AgentProps {
  title?: string;
  model: string;  // Required
}

class ConfigurableAgent extends Component<AgentProps> {
  // Prop key inferred from property name
  title = input<string>('Default Title');
  model = input<string>();

  // Override the prop key if needed
  customName = input<string>('', { key: 'name' });

  render() {
    return <H1>{this.title()}: {this.model()}</H1>;
  }
}
```

Props signals are **read-only** from the component's perspective - only the compiler can update them when props change.

### `computed<T>(fn: () => T, options?): ComputedSignal<T>`

Creates a derived signal.

``` tsx
const doubled = computed(() => count() * 2);

doubled(); // Read (triggers computation if dirty)
doubled.value; // Property access
doubled.dispose();
```

### `effect(fn): EffectRef`

Runs a side effect when dependencies change.

``` tsx
const ref = effect((onCleanup) => {
  console.log(count());
  onCleanup(() => console.log('cleaning up'));
});

// Or return cleanup
const ref = effect(() => {
  const timer = setInterval(...);
  return () => clearInterval(timer);
});

ref.dispose();  // Stop effect
ref.disposed;   // Check: true
```

### `batch<T>(fn: () => T): T`

Groups updates to prevent intermediate notifications.

``` tsx
batch(() => {
  a.set(1);
  b.set(2);
  c.set(3);
  // Effects run once here
});
```

### `untracked<T>(fn: () => T): T`

Reads signals without creating dependencies.

``` tsx
effect(() => {
  const tracked = count();
  const notTracked = untracked(() => other());
});
```

### Type Guards

``` tsx
import { isSignal, isComputed, isEffect } from "aidk";

isSignal(count); // true for signal()
isComputed(doubled); // true for computed()
isEffect(ref); // true for effect()
```

### Manual Disposal

``` tsx
import { disposeSignal } from "aidk";

disposeSignal(mySignal); // Same as mySignal.dispose()
```

## Function Component Hooks

These hooks are for **function components only**. For class components, use the signal-based APIs above.

### `useSignal<T>(initialValue): Signal<T>`

Creates a local signal in a function component.

``` tsx
function Counter() {
  const count = useSignal(0);
  return <Text>Count: {count()}</Text>;
}
```

### `useComState<T>(key, initialValue): Signal<T>`

Creates a COM-bound signal in a function component.

``` tsx
function Timeline() {
  const entries = useComState<Entry[]>('timeline', []);
  return <List>{entries().map(...)}</List>;
}
```

### `useWatch<T>(key, defaultValue?): ReadonlySignal<T>`

Watches COM state owned by another component.

``` tsx
function StatusDisplay() {
  const status = useWatch<string>('agentStatus', 'idle');
  return <Text>Status: {status()}</Text>;
}
```

### `useComputed<T>(fn, deps): ComputedSignal<T>`

Creates a computed value.

``` tsx
function Summary() {
  const items = useComState<Item[]>('items', []);
  const total = useComputed(() => items().length, []);
  return <Text>Total: {total()}</Text>;
}
```

### `useEffect(callback, deps?): void`

Runs a side effect. Unlike React, callback CAN be async.

``` tsx
function Logger() {
  const message = useComState("message", "");

  useEffect(async () => {
    await logToServer(message());
    return () => console.log("cleanup");
  }, [message]);
}
```

### `useOnMount(callback): void`

Runs once when the component mounts.

``` tsx
function DataLoader() {
  const data = useComState("data", null);

  useOnMount(async () => {
    const result = await fetchData();
    data.set(result);
  });
}
```

### `useOnUnmount(callback): void`

Runs when the component unmounts.

``` tsx
function Subscription() {
  useOnUnmount(() => {
    unsubscribe();
  });
}
```

### `useTickStart(callback): void`

Runs at the start of each tick.

``` tsx
function TickLogger() {
  useTickStart((com, state) => {
    console.log(`Tick ${state.tick} starting`);
  });
}
```

### `useTickEnd(callback): void`

Runs at the end of each tick.

``` tsx
function TickLogger() {
  useTickEnd((com, state) => {
    console.log(`Tick ${state.tick} ended`);
  });
}
```

### `useOnMessage(callback): void`

Runs when a message is received during streaming.

``` tsx
function MessageHandler() {
  useOnMessage((message) => {
    console.log("Received:", message);
  });
}
```

### `useMemo<T>(factory, deps): T`

Memoizes a value.

``` tsx
function ExpensiveComponent(props) {
  const processed = useMemo(() => expensiveOperation(props.data), [props.data]);
}
```

### `useRef<T>(initialValue): RefObject<T>`

Creates a mutable ref that persists across renders.

``` tsx
function Timer() {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useOnMount(() => {
    timerRef.current = setInterval(...);
  });

  useOnUnmount(() => {
    if (timerRef.current) clearInterval(timerRef.current);
  });
}
```

### `useAbortSignal(): AbortSignal | undefined`

Gets the current execution's abort signal.

``` tsx
function CancellableRequest() {
  const signal = useAbortSignal();

  useOnMount(async () => {
    await fetch("/api", { signal });
  });
}
```

## Best Practices

1. **Prefer `signal()` for local state** — simpler, no COM overhead
2. **Use `comState()` for shared/persisted state** — timeline, user preferences, etc.
3. **Use `computed()` for derived values** — not `effect()` with `set()`
4. **Use `effect()` sparingly** — only for external side effects
5. **Batch related updates** — prevents intermediate renders
6. **Don't use signals in function components** — use `EngineComponent` instead
