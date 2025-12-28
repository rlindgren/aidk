# Fork & Spawn

Run agents in parallel or in the background. Coordinate results. Handle independent workstreams.

## Fork vs Spawn

|              | Fork                          | Spawn                             |
| ------------ | ----------------------------- | --------------------------------- |
| **Waits?**   | Can wait for completion       | Never waits                       |
| **Result?**  | Returns result to parent      | Fire and forget                   |
| **Use case** | Parallel research, multi-step | Background logging, notifications |

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
          agent={<MarketResearchAgent />}
          waitUntilComplete={true}
          onComplete={(result) => this.marketData.set(result)}
        />
        <Fork
          agent={<CompetitorResearchAgent />}
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
  agent={<SubAgent />}          // Agent to run (or use children)
  waitUntilComplete={true}      // Wait for completion before continuing
  onComplete={(result) => {}}   // Callback when done
  onError={(error) => {}}       // Callback on error
  input={{ timeline: [...] }}   // Input for the forked execution
  inherit={{ state: true }}     // Inherit state from parent
/>
```

You can also use children instead of the `agent` prop:

```tsx
<Fork waitUntilComplete={true} onComplete={(result) => {}}>
  <Model model={openai("gpt-4o")} />
  <System>You are a research assistant.</System>
  <Timeline>{/* ... */}</Timeline>
</Fork>
```

### Fork with Input

Pass data to the forked agent:

```tsx
<Fork
  agent={<AnalysisAgent />}
  input={{
    topic: "Q4 revenue",
    depth: "detailed",
    sources: ["internal", "external"],
  }}
  waitUntilComplete={true}
  onComplete={(analysis) => this.analysis.set(analysis)}
/>
```

The input becomes the `EngineInput` for the forked execution (typically containing a timeline).

## Spawn: Fire and Forget

Spawn launches a background agent without waiting.

```tsx
class MainAgent extends Component {
  render(com, state) {
    return (
      <>
        <Model model={openai("gpt-4o")} />

        {/* Log this interaction in the background */}
        <Spawn agent={<AuditLogger interaction={state.timeline} />} />

        {/* Send notifications without blocking */}
        <Spawn agent={<NotificationAgent userId={ctx.user.id} />} />

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
  agent={<BackgroundAgent />}   // Agent to run (or use children)
  waitUntilComplete={false}     // Whether to wait (usually false for Spawn)
  onComplete={(result) => {}}   // Callback when done
  onError={(error) => {}}       // Callback on error
  input={{ timeline: [...] }}   // Input for the spawned execution
/>
```

Like Fork, you can use children instead of the `agent` prop.

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
            agent={this.getAgentForTask(task.id)}
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
        <Fork agent={<LevelTwoAgent />} waitUntilComplete={true} />
        {/* ... */}
      </>
    );
  }
}

class LevelTwoAgent extends Component {
  render() {
    return (
      <>
        <Fork agent={<LevelThreeAgent />} waitUntilComplete={true} />
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
  agent={<RiskyAgent />}
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

## Context and State Inheritance

Fork can inherit state from the parent execution:

```tsx
<Fork
  agent={<SubAgent />}
  inherit={{ state: true }} // Inherit parent's COM state
  waitUntilComplete={true}
/>
```

The forked execution shares the same context (user, traceId, etc.) as the parent.
Spawn creates an independent execution with a fresh engine instance.

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
    const ctx = Context.get();

    return (
      <>
        <Model model={openai("gpt-4o")} />

        <System>
          You coordinate research across multiple sources. Synthesize findings
          when all sources report.
        </System>

        {/* Fork agents for each source */}
        <Fork
          agent={<WebSearchAgent query={state.query} />}
          waitUntilComplete={true}
          onComplete={(r) => this.addSource("web", r)}
        />
        <Fork
          agent={<DatabaseAgent query={state.query} />}
          waitUntilComplete={true}
          onComplete={(r) => this.addSource("database", r)}
        />
        <Fork
          agent={<DocumentAgent query={state.query} />}
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
