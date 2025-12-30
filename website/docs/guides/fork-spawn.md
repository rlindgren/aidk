# Fork & Spawn

Run agents in parallel or in the background. Coordinate results. Handle independent workstreams.

## Fork vs Spawn

|                       | Fork                             | Spawn                             |
| --------------------- | -------------------------------- | --------------------------------- |
| **Parent Required**   | Yes (throws if missing)          | No                                |
| **State Inheritance** | Yes (configurable via `inherit`) | No (blank slate)                  |
| **Hooks Inherited**   | Yes (by default)                 | No                                |
| **waitUntilComplete** | Yes                              | Yes                               |
| **Engine Instance**   | Shares parent's config           | New independent engine            |
| **Abort Signal**      | Merged with parent's signal      | Independent                       |
| **Use case**          | Parallel work needing context    | Background tasks, fire-and-forget |

The key difference is **inheritance**: Fork creates a child execution that can inherit timeline, sections, tools, hooks, and context from its parent. Spawn creates a completely independent execution with a fresh engine instance—a true blank slate.

## Fork: Parallel Execution

Fork runs a sub-agent and optionally waits for its result.

```tsx
class ResearchAgent extends Component {
  private marketData = signal<MarketData | null>(null);
  private competitorData = signal<CompetitorData | null>(null);

  render(com, state) {
    return (
      <>
        <Model model={openai("gpt-4o")} />

        {/*
         * Fork components are class-based and track their own started state.
         * They only create the fork once, even though render() runs on each tick.
         * The component instance persists across ticks.
         */}
        <Fork
          root={<MarketResearchAgent />}
          waitUntilComplete={true}
          onComplete={(result) => this.marketData.set(result)}
        />
        <Fork
          root={<CompetitorResearchAgent />}
          waitUntilComplete={true}
          onComplete={(result) => this.competitorData.set(result)}
        />

        {/* Once both complete, synthesize */}
        {this.marketData() && this.competitorData() && (
          <Section title="Research Complete">
            <Paragraph>Market: {this.marketData()!.summary}</Paragraph>
            <Paragraph>Competitors: {this.competitorData()!.summary}</Paragraph>
          </Section>
        )}

        <Timeline>{/* Timeline entries */}</Timeline>
      </>
    );
  }
}
```

> **Note:** `<Fork>` and `<Spawn>` are class components that internally track whether they've started. They only create the child execution once, even though `render()` is called on each tick. This is safe because component instances persist across ticks.

### Fork Options

```tsx
<Fork
  root={<SubComponent />}       // Component to run (or use children)
  waitUntilComplete={true}      // Wait for completion before continuing
  onComplete={(result) => {}}   // Callback when done
  onError={(error) => {}}       // Callback on error
  input={{ timeline: [...] }}   // Input for the forked execution
  inherit={{                    // Inheritance options (see below)
    timeline: 'copy',
    sections: 'copy',
    hooks: true,
    context: true,
  }}
/>
```

### Fork Inheritance Options

Fork can inherit state from the parent execution:

```tsx
interface ForkInheritanceOptions {
  // Timeline inheritance
  timeline?: 'copy' | 'reference';   // 'copy' = deep copy, 'reference' = shared
  sections?: 'copy' | 'reference';   // Same as timeline

  // Tools are always shared (not copied)
  tools?: 'share';

  // Context inheritance
  channels?: boolean;    // Inherit channels service
  traceId?: boolean;     // Inherit traceId for distributed tracing
  context?: boolean;     // Inherit metadata, user, traceId from Kernel context

  // Hooks inheritance (default: true)
  hooks?: boolean;       // Inherit component, model, tool, engine hooks
}
```

**Copy vs Reference:**

- `'copy'`: Deep copies the data. Changes in the fork don't affect the parent.
- `'reference'`: Shares the same array/object. Changes in the fork affect the parent (use carefully).

Example with full inheritance:

```tsx
<Fork
  root={<ResearchAgent query={query} />}
  inherit={{
    timeline: 'copy',      // Fork gets parent's timeline, changes isolated
    sections: 'copy',
    hooks: true,           // Inherits all middleware hooks
    context: true,         // Inherits user, metadata, traceId
    channels: true,        // Can communicate via parent's channels
  }}
  waitUntilComplete={true}
  onComplete={(result) => this.results.update(r => [...r, result])}
/>
```

You can also use children instead of the `root` prop:

```tsx
<Fork waitUntilComplete={true} onComplete={(result) => {}}>
  <Model model={openai("gpt-4o")} />
  <System>You are a research assistant.</System>
  <Timeline>{/* ... */}</Timeline>
</Fork>
```

### Fork with Input

Pass data to the forked agent via component props or EngineInput:

```tsx
{/* Option 1: Pass data as component props (preferred) */}
<Fork
  root={
    <AnalysisAgent
      topic="Q4 revenue"
      depth="detailed"
      sources={["internal", "external"]}
    />
  }
  waitUntilComplete={true}
  onComplete={(analysis) => this.analysis.set(analysis)}
/>

{/* Option 2: Use EngineInput with metadata */}
<Fork
  root={<AnalysisAgent />}
  input={{
    timeline: [],
    metadata: {
      topic: "Q4 revenue",
      depth: "detailed",
      sources: ["internal", "external"],
    },
  }}
  waitUntilComplete={true}
  onComplete={(analysis) => this.analysis.set(analysis)}
/>
```

The `input` prop accepts `EngineInput` (timeline, sections, metadata). For custom data, either pass it as component props or use `metadata`.

## Spawn: Independent Execution

Spawn creates a completely independent execution with a fresh engine instance. Unlike Fork, Spawn has no parent relationship and inherits nothing—it's a true blank slate.

```tsx
class MainAgent extends Component {
  render(com, state) {
    return (
      <>
        <Model model={openai("gpt-4o")} />

        {/* Log this interaction in the background */}
        <Spawn root={<AuditLogger interaction={state.timeline} />} />

        {/* Send notifications without blocking */}
        <Spawn root={<NotificationAgent userId={ctx.user.id} />} />

        <System>You are a helpful assistant.</System>
        <Timeline>{/* Timeline entries */}</Timeline>
      </>
    );
  }
}
```

### Spawn Options

```tsx
<Spawn
  root={<BackgroundComponent />}  // Component to run (or use children)
  waitUntilComplete={false}     // Can wait if needed (default: false)
  onComplete={(result) => {}}   // Callback when done
  onError={(error) => {}}       // Callback on error
  input={{ timeline: [...] }}   // Input for the spawned execution
  engineConfig={{               // Configure the independent engine
    maxTicks: 10,
  }}
/>
```

**Note**: Spawn CAN use `waitUntilComplete={true}` when you need to wait for an independent execution. The key difference from Fork is that Spawn has no state inheritance—use it when you want complete isolation.

Like Fork, you can use children instead of the `root` prop.

### When to Use Fork vs Spawn

| Scenario                          | Use   | Why                              |
| --------------------------------- | ----- | -------------------------------- |
| Parallel research sharing context | Fork  | Need parent's timeline/sections  |
| Background logging                | Spawn | No shared state needed           |
| Child agent needing user context  | Fork  | Inherit context (user, metadata) |
| Independent job queue processing  | Spawn | Complete isolation               |
| Branching with shared hooks       | Fork  | Inherit middleware               |
| Fire-and-forget notification      | Spawn | Don't need results               |

## Coordinating Multiple Forks

For complex parallel workflows, use signals to track state:

```tsx
class ParallelWorkflow extends Component {
  private tasks = signal([
    { id: "research", status: "pending", result: null },
    { id: "analysis", status: "pending", result: null },
    { id: "report", status: "pending", result: null },
  ]);

  private allComplete = computed(() =>
    this.tasks().every((t) => t.status === "complete"),
  );

  updateTask(id: string, update: Partial<Task>) {
    this.tasks.update((tasks) =>
      tasks.map((t) => (t.id === id ? { ...t, ...update } : t)),
    );
  }

  render(com, state) {
    const pending = this.tasks().filter((t) => t.status === "pending");

    return (
      <>
        <Model model={openai("gpt-4o")} />

        {/* Launch pending tasks */}
        {pending.map((task) => (
          <Fork
            key={task.id}
            root={this.getAgentForTask(task.id)}
            waitUntilComplete={true}
            onComplete={(result) =>
              this.updateTask(task.id, {
                status: "complete",
                result,
              })
            }
            onError={(error) =>
              this.updateTask(task.id, {
                status: "failed",
              })
            }
          />
        ))}

        {/* Progress indicator */}
        <Grounding title="Workflow Progress">
          <List>
            {this.tasks().map((t) => (
              <ListItem key={t.id}>
                {t.status === "complete" ? "✓" : "○"} {t.id}
              </ListItem>
            ))}
          </List>
        </Grounding>

        {/* Final synthesis when all complete */}
        {this.allComplete() && (
          <Section title="Synthesize Results">
            <Paragraph>
              All research complete. Please synthesize the findings.
            </Paragraph>
          </Section>
        )}

        <Timeline>{/* Timeline entries */}</Timeline>
      </>
    );
  }

  getAgentForTask(id: string) {
    switch (id) {
      case "research":
        return <ResearchAgent />;
      case "analysis":
        return <AnalysisAgent />;
      case "report":
        return <ReportAgent />;
    }
  }
}
```

## Nested Forks

Forked agents can fork other agents:

```tsx
class LevelOneAgent extends Component {
  render() {
    return (
      <>
        <Fork root={<LevelTwoAgent />} waitUntilComplete={true} />
        {/* ... */}
      </>
    );
  }
}

class LevelTwoAgent extends Component {
  render() {
    return (
      <>
        <Fork root={<LevelThreeAgent />} waitUntilComplete={true} />
        {/* ... */}
      </>
    );
  }
}
```

The execution tree is tracked and can be inspected via the execution handle.

## Error Handling

Handle errors in forked agents:

```tsx
<Fork
  root={<RiskyAgent />}
  waitUntilComplete={true}
  onComplete={(result) => {
    this.result.set(result);
  }}
  onError={(error) => {
    // Log the error
    Logger.error("Fork failed", { error });

    // Set fallback
    this.result.set({ fallback: true });

    // Or rethrow to fail the parent
    // throw error;
  }}
/>
```

## Context and State Inheritance Summary

**Fork** inherits from parent (configurable via `inherit` prop):

- Timeline entries (copy or reference)
- Sections (copy or reference)
- Tools (always shared)
- Middleware hooks (by default)
- Kernel context (user, metadata, traceId)
- Channels service
- Abort signal (merged with parent's signal)

**Spawn** is completely independent:

- No timeline inheritance
- No sections inheritance
- No hooks inheritance
- No context inheritance
- Fresh abort controller
- New engine instance

```tsx
// Fork inherits parent context
<Fork
  root={<SubAgent />}
  inherit={{ timeline: 'copy', context: true, hooks: true }}
  waitUntilComplete={true}
/>

// Spawn is isolated - starts fresh
<Spawn
  root={<IndependentAgent />}
  input={{ timeline: [] }}  // Must provide input explicitly
/>
```

## Best Practices

1. **Don't overuse Fork** - Parallel execution has overhead. Use for genuinely independent work.

2. **Set timeouts** - Prevent forks from running forever.

3. **Handle errors** - Decide if a failed fork should fail the parent.

4. **Use Spawn for fire-and-forget** - Don't use Fork with `waitUntilComplete={false}` when Spawn is clearer.

5. **Monitor execution** - Use the execution handle to track fork status in production.

## Example: Multi-Agent Research

```tsx
class ResearchCoordinator extends Component {
  private sources = signal<SourceResult[]>([]);

  render(com, state) {
    const ctx = context();

    return (
      <>
        <Model model={openai("gpt-4o")} />

        <System>
          You coordinate research across multiple sources. Synthesize findings
          when all sources report.
        </System>

        {/* Fork agents for each source */}
        <Fork
          root={<WebSearchAgent query={state.query} />}
          waitUntilComplete={true}
          onComplete={(r) => this.addSource("web", r)}
        />
        <Fork
          root={<DatabaseAgent query={state.query} />}
          waitUntilComplete={true}
          onComplete={(r) => this.addSource("database", r)}
        />
        <Fork
          root={<DocumentAgent query={state.query} />}
          waitUntilComplete={true}
          onComplete={(r) => this.addSource("documents", r)}
        />

        {/* Show progress */}
        <Grounding title="Source Status">
          <List>
            {this.sources().map((s) => (
              <ListItem key={s.name}>
                {s.name}: {s.summary}
              </ListItem>
            ))}
          </List>
        </Grounding>

        <Timeline>{/* Timeline entries */}</Timeline>
      </>
    );
  }

  addSource(name: string, result: any) {
    this.sources.update((s) => [...s, { name, ...result }]);
  }
}
```
