# Components

AIDK supports both class-based and functional components. Both can be nested, composed, and reused.

## Component Types

### Class Components (Recommended)

Class components have full access to lifecycle hooks and are the preferred style:

```tsx
import { Component, ContextObjectModel, TickState, signal, comState } from 'aidk';

class MyAgent extends Component {
  // Local state (component-only)
  private count = signal(0);
  
  // Shared state (persisted across ticks)
  private timeline = comState<any[]>('timeline', []);
  
  // Lifecycle: Called when component mounts
  async onMount(com: ContextObjectModel) {
    console.log('Component mounted');
    await this.loadInitialState();
  }
  
  // Lifecycle: Called before each tick
  onTickStart(com: ContextObjectModel, state: TickState) {
    if (state.current?.timeline) {
      this.timeline.update(t => [...t, ...state.current.timeline]);
    }
  }
  
  // Required: Render method
  render(com: ContextObjectModel, state: TickState) {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <Timeline>
          {this.timeline().map((entry, i) => (
            <Message key={i} {...entry.message} />
          ))}
        </Timeline>
      </>
    );
  }
  
  // Lifecycle: Called when component unmounts
  onUnmount(com: ContextObjectModel) {
    console.log('Component unmounting');
  }
}
```

**Benefits:**
- Full lifecycle hook support
- Signal-based state management
- `this` context for methods
- Preferred for agents and complex components

### Functional Components

Functional components are simpler and support both stateless and stateful patterns:

#### Simple Presentational Component

```tsx
import { Section, H2, List, ListItem } from 'aidk';

interface UserProfileProps {
  user: User;
}

export function UserProfile({ user }: UserProfileProps) {
  return (
    <Section audience="model">
      <H2>User Profile</H2>
      <List>
        <ListItem>Name: {user.name}</ListItem>
        <ListItem>Email: {user.email}</ListItem>
        <ListItem>Tier: {user.tier}</ListItem>
      </List>
    </Section>
  );
}
```

#### Stateful Component with Hooks

```tsx
import { useSignal, useComState, useOnMount, useTickStart } from 'aidk';

function MessageTimeline() {
  // Local state
  const count = useSignal(0);
  
  // Shared state
  const timeline = useComState<Message[]>('timeline', []);
  
  // Lifecycle hooks
  useOnMount((com) => {
    console.log('Timeline mounted');
  });
  
  useTickStart((com, state) => {
    if (state.current?.timeline) {
      timeline.update(t => [...t, ...state.current.timeline]);
    }
  });
  
  return (
    <Timeline>
      {timeline().map((msg, i) => (
        <Message key={i} {...msg} />
      ))}
    </Timeline>
  );
}
```

**Benefits:**
- Simple, concise syntax
- Props-based (fully typed)
- Great for reusable components
- **Full hook support** - state, lifecycle, effects
- Async-first hooks (unlike React)

### When to Use Each

| Use Case | Recommended |
|----------|-------------|
| Root agent | Class component (preferred) or functional with hooks |
| Tool component | Class component or functional with hooks |
| Stateful component | Either - class with `signal()` or functional with `useSignal()` |
| Simple presentation | Functional component (no hooks needed) |
| Reusable UI piece | Functional component |
| Nested formatting | Functional component |

**General Rule:** Both styles have full capabilities. Choose based on preference:
- **Class components:** Traditional OOP style, clear lifecycle methods
- **Functional components:** Modern hooks style, more concise

## Nesting Components

Components can render other components, creating a tree:

### Functional in Class

```tsx
// Functional component
function FormattedMessage({ message }: { message: Message }) {
  return (
    <Message role={message.role}>
      {message.content.map((block, i) => {
        if (block.type === 'image') {
          return (
            <Text key={i}>
              [Image]: {block.altText}
            </Text>
          );
        }
        return block;
      })}
    </Message>
  );
}

// Class component using it
class ChatAgent extends Component {
  private timeline = comState<any[]>('timeline', []);
  
  render(com: ContextObjectModel, state: TickState) {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        
        <Timeline>
          {this.timeline().map((entry, index) => (
            <FormattedMessage 
              key={`msg-${index}`} 
              message={entry.message} 
            />
          ))}
        </Timeline>
      </>
    );
  }
}
```

### Class in Class

```tsx
class UserContext extends Component {
  render(com: ContextObjectModel) {
    const ctx = Context.get();
    return (
      <Section audience="model">
        <H3>User Context</H3>
        <Paragraph>User: {ctx.user.name}</Paragraph>
      </Section>
    );
  }
}

class MainAgent extends Component {
  render(com: ContextObjectModel, state: TickState) {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        
        {/* Nested class component */}
        <UserContext />
        
        <Timeline>{/* ... */}</Timeline>
      </>
    );
  }
}
```

### Deep Nesting

Components can be nested arbitrarily deep:

```tsx
function MessageBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'image') {
    return <Text>[Image: {block.altText}]</Text>;
  }
  if (block.type === 'text') {
    return <Text>{block.text}</Text>;
  }
  return null;
}

function FormattedMessage({ message }: { message: Message }) {
  return (
    <Message role={message.role}>
      {message.content.map((block, i) => (
        <MessageBlock key={i} block={block} />
      ))}
    </Message>
  );
}

function SlidingWindow({ messages }: { messages: Message[] }) {
  const recent = messages.slice(-10);
  
  return (
    <Timeline>
      {recent.map((msg, i) => (
        <FormattedMessage key={i} message={msg} />
      ))}
    </Timeline>
  );
}

class ChatAgent extends Component {
  private timeline = comState<Message[]>('timeline', []);
  
  render() {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <SlidingWindow messages={this.timeline()} />
      </>
    );
  }
}
```

**Component tree:**
```
ChatAgent (class)
└── SlidingWindow (function)
    └── FormattedMessage (function)
        └── MessageBlock (function)
            └── Text (primitive)
```

## Lifecycle Hooks

### Class Components

Class components use lifecycle methods:

```tsx
class LifecycleExample extends Component {
  async onMount(com: ContextObjectModel) {
    // Called once when component mounts
    console.log('Mounted');
  }
  
  async onStart(com: ContextObjectModel) {
    // Called before first tick
    console.log('Starting');
  }
  
  onTickStart(com: ContextObjectModel, state: TickState) {
    // Called before each render
    console.log(`Tick ${state.tick} starting`);
  }
  
  render(com: ContextObjectModel, state: TickState) {
    // Called every tick to build context
    return <>{/* ... */}</>;
  }
  
  onAfterCompile(com: ContextObjectModel, compiled: any, state: TickState) {
    // Called after compilation, before model call
    console.log('Context compiled');
  }
  
  onTickEnd(com: ContextObjectModel, state: TickState) {
    // Called after model responds
    console.log(`Tick ${state.tick} complete`);
  }
  
  onComplete(com: ContextObjectModel, finalState: any) {
    // Called when execution finishes
    console.log('Complete');
  }
  
  onUnmount(com: ContextObjectModel) {
    // Called when component is removed
    console.log('Unmounting');
  }
  
  onError(com: ContextObjectModel, error: Error, state: TickState) {
    // Called on errors
    console.error('Error:', error);
  }
}
```

### Function Components

Function components use lifecycle hooks:

```tsx
import { 
  useOnMount, 
  useOnUnmount, 
  useTickStart, 
  useTickEnd,
  useInit,
  useEffect 
} from 'aidk';

function LifecycleExample() {
  // Initialization (blocking, runs during render)
  await useInit(async (com, state) => {
    console.log('Initializing...');
  });
  
  // Mount (non-blocking, runs after first render)
  useOnMount((com) => {
    console.log('Mounted');
  });
  
  // Before each tick
  useTickStart((com, state) => {
    console.log(`Tick ${state.tick} starting`);
  });
  
  // After each tick
  useTickEnd((com, state) => {
    console.log(`Tick ${state.tick} complete`);
  });
  
  // Unmount
  useOnUnmount((com) => {
    console.log('Unmounting');
  });
  
  // Side effects with dependencies
  useEffect(async () => {
    console.log('Effect running');
    return () => console.log('Effect cleanup');
  }, [/* deps */]);
  
  return <Text>Hello</Text>;
}
```

## Component Props

Both component types support typed props:

### Functional Component Props

```tsx
interface UserCardProps {
  user: User;
  showEmail?: boolean;
  tier?: string;
}

export function UserCard({ user, showEmail = true, tier }: UserCardProps) {
  return (
    <Section audience="model">
      <Paragraph>Name: {user.name}</Paragraph>
      {showEmail && <Paragraph>Email: {user.email}</Paragraph>}
      {tier && <Paragraph>Tier: {tier}</Paragraph>}
    </Section>
  );
}

// Usage
<UserCard user={user} showEmail={false} tier="premium" />
```

### Class Component Props

```tsx
interface AgentProps {
  model?: string;
  temperature?: number;
}

class ConfigurableAgent extends Component<AgentProps> {
  render(com: ContextObjectModel, state: TickState) {
    const { model = 'gpt-4o', temperature = 0.7 } = this.props;
    
    return (
      <>
        <AiSdkModel 
          model={openai(model)} 
          temperature={temperature} 
        />
        <Timeline>{/* ... */}</Timeline>
      </>
    );
  }
}

// Usage
<ConfigurableAgent model="gpt-4o-mini" temperature={0.9} />
```

## Component Composition Patterns

### Container/Presenter Pattern

```tsx
// Presenter (functional)
function MessageList({ messages }: { messages: Message[] }) {
  return (
    <Timeline>
      {messages.map((msg, i) => (
        <Message key={i} role={msg.role} content={msg.content} />
      ))}
    </Timeline>
  );
}

// Container (class)
class ChatContainer extends Component {
  private messages = comState<Message[]>('messages', []);
  
  onTickStart(com, state) {
    if (state.current?.timeline) {
      this.messages.update(m => [...m, ...state.current.timeline]);
    }
  }
  
  render() {
    return (
      <>
        <AiSdkModel model={openai('gpt-4o')} />
        <MessageList messages={this.messages()} />
      </>
    );
  }
}
```

### Higher-Order Components

```tsx
// HOC that adds user context
function withUserContext<P>(Component: (props: P) => JSX.Element) {
  return (props: P) => {
    const ctx = Context.get();
    return (
      <>
        <Section audience="model">
          <Paragraph>User: {ctx.user.name}</Paragraph>
        </Section>
        <Component {...props} />
      </>
    );
  };
}

// Use it
const UserAwareProfile = withUserContext(UserProfile);

<UserAwareProfile user={user} />
```

### Render Props Pattern

```tsx
interface DataFetcherProps {
  endpoint: string;
  children: (data: any) => JSX.Element;
}

class DataFetcher extends Component<DataFetcherProps> {
  private data = comState<any>('data', null);
  
  async onMount(com) {
    const result = await fetch(this.props.endpoint);
    this.data.set(await result.json());
  }
  
  render() {
    const data = this.data();
    return data ? this.props.children(data) : null;
  }
}

// Usage
<DataFetcher endpoint="/api/users">
  {(users) => (
    <List>
      {users.map(u => <ListItem key={u.id}>{u.name}</ListItem>)}
    </List>
  )}
</DataFetcher>
```

## Best Practices

### 1. Use Class Components for Agents

```tsx
// ✅ Good: Agent as class component
class ChatAgent extends Component {
  private timeline = comState<any[]>('timeline', []);
  
  onTickStart(com, state) { /* ... */ }
  render(com, state) { /* ... */ }
}

// ❌ Less good: Agent as functional component
function ChatAgent() {
  // Can't use lifecycle hooks or state
  return <>{/* ... */}</>;
}
```

### 2. Use Functional Components for Presentation

```tsx
// ✅ Good: Simple presenter
function UserCard({ user }: { user: User }) {
  return (
    <Section>
      <Paragraph>{user.name}</Paragraph>
    </Section>
  );
}

// ❌ Overkill: Class for simple presentation
class UserCard extends Component {
  render() {
    return (
      <Section>
        <Paragraph>{this.props.user.name}</Paragraph>
      </Section>
    );
  }
}
```

### 3. Extract Reusable Components

```tsx
// ✅ Good: Extracted reusable component
function MessageTimestamp({ timestamp }: { timestamp: Date }) {
  return <Text>[{timestamp.toLocaleString()}]</Text>;
}

// Use it everywhere
<Message>
  <MessageTimestamp timestamp={msg.createdAt} />
  {msg.content}
</Message>
```

### 4. Type Your Props

```tsx
// ✅ Good: Typed props
interface Props {
  user: User;
  showDetails: boolean;
}

function UserProfile({ user, showDetails }: Props) {
  // TypeScript knows the types
}

// ❌ Avoid: Untyped props
function UserProfile(props: any) {
  // No type safety
}
```

## Related

- [State Management](/docs/state-management) - Using signals in components
- [Semantic Primitives](/docs/semantic-primitives) - Available JSX components
- [Tools](/docs/guides/tools) - Tools as components
- [Core Concepts](/docs/concepts) - Understanding the architecture

---

**Next:** [State Management](/docs/state-management)

