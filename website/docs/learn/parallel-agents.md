# Parallel Agents

This tutorial covers Fork and Spawn—AIDK's primitives for running multiple agents concurrently.

## Two Primitives

| Aspect                | Fork                                     | Spawn                             |
| --------------------- | ---------------------------------------- | --------------------------------- |
| **Parent Required**   | Yes                                      | No                                |
| **State Inheritance** | Yes (timeline, sections, hooks, context) | No (blank slate)                  |
| **waitUntilComplete** | Yes                                      | Yes (but typically false)         |
| **Use Case**          | Parallel work needing context/results    | Background tasks, fire-and-forget |

**Key difference: inheritance.** Fork creates a child that can inherit state from the parent. Spawn creates a completely independent execution with a fresh engine—a true blank slate.

## Fork: Parallel Work with Results

Fork creates a child execution and optionally waits for it to complete.

### Basic Fork

```tsx
class ResearchAgent extends Component {
  private results = comState<ResearchResult[]>("results", []);

  render() {
    return (
      <>
        <Model model={openai("gpt-4o")} />
        <System>You are a research coordinator.</System>

        {/* Fork researchers in parallel */}
        <Fork
          root={<TopicResearcher topic="climate change" />}
          waitUntilComplete={true}
          onComplete={(result) => {
            this.results.set([...this.results(), result]);
          }}
        />

        <Fork
          root={<TopicResearcher topic="renewable energy" />}
          waitUntilComplete={true}
          onComplete={(result) => {
            this.results.set([...this.results(), result]);
          }}
        />

        {/* Show collected results */}
        <Grounding title="Research Results">
          {this.results().map((r, i) => (
            <Section key={i} title={r.topic}>
              {r.summary}
            </Section>
          ))}
        </Grounding>
      </>
    );
  }
}
```

### Fork with Children

Instead of the `root` prop, you can use children:

```tsx
<Fork waitUntilComplete={true} onComplete={handleResult}>
  <Model model={openai("gpt-4o")} />
  <System>Analyze this document for key themes.</System>
  <Grounding title="Document">{document}</Grounding>
  <AnalysisTool />
</Fork>
```

### Fork Options

```tsx
<Fork
  // The component to run (or use children)
  root={<MyComponent />}

  // Wait for completion before continuing parent tick
  waitUntilComplete={true}

  // Callback when fork completes
  onComplete={(result) => handleResult(result)}

  // Callback on error
  onError={(error) => handleError(error)}

  // Initial input for the fork
  input={{ timeline: [userMessage] }}

  // Inherit parent's model if not specified
  inheritModel={true}

  // Maximum ticks before timeout
  maxTicks={50}
/>
```

## Spawn: Independent Execution

Spawn creates a completely independent process with no state inheritance. It's typically fire-and-forget, but **can** use `waitUntilComplete={true}` when you need to wait for an isolated execution.

### Basic Spawn

```tsx
class ChatAgent extends Component {
  private timeline = comState<COMTimelineEntry[]>("timeline", []);

  onTickStart(com, state) {
    if (state.current?.timeline) {
      this.timeline.set([...this.timeline(), ...state.current.timeline]);
    }
  }

  render(com, state) {
    return (
      <>
        <Model model={openai("gpt-4o")} />
        <System>You are a helpful assistant.</System>

        {/* Log every interaction in background */}
        <Spawn root={<AuditLogger interaction={state.current} />} />

        {/* Send notifications without blocking */}
        {this.shouldNotify(state) && (
          <Spawn root={<NotificationSender userId={context().user?.id} />} />
        )}

        <Timeline>
          {this.timeline().map(entry => (
            <Message key={entry.id} {...entry.message} />
          ))}
        </Timeline>
      </>
    );
  }
}
```

### Spawn with Children

```tsx
<Spawn>
  <Model model={openai("gpt-4o-mini")} />
  <System>Summarize this conversation and store it.</System>
  <Grounding title="Conversation">{conversationText}</Grounding>
  <StorageTool />
</Spawn>
```

### Spawn Options

```tsx
<Spawn
  // The component to run (or use children)
  root={<BackgroundTask />}

  // Wait for completion (default: false)
  waitUntilComplete={false}

  // Callbacks
  onComplete={(result) => handleResult(result)}
  onError={(error) => handleError(error)}

  // Initial input (must provide timeline since no inheritance)
  input={{ timeline: [] }}

  // Engine configuration for the independent execution
  engineConfig={{ maxTicks: 10 }}
/>
```

**Note:** Unlike Fork, Spawn has no `inherit` option because it never inherits—it's always a blank slate.

## Patterns

### Pattern 1: Parallel Research

Run multiple researchers, synthesize results:

```tsx
class ResearchCoordinator extends Component {
  private sources = signal<string[]>(["arxiv", "pubmed", "google_scholar"]);
  private findings = comState<Finding[]>("findings", []);
  private synthesisReady = signal(false);

  render() {
    const sources = this.sources();
    const findings = this.findings();

    if (!this.synthesisReady()) {
      // Research phase: fork researchers for each source
      return (
        <>
          <Model model={openai("gpt-4o")} />
          <System>Coordinating research across {sources.length} sources.</System>

          {sources.map(source => (
            <Fork
              key={source}
              waitUntilComplete={true}
              onComplete={(result) => {
                const updated = [...this.findings(), ...result.findings];
                this.findings.set(updated);

                // Check if all sources are done
                if (updated.length >= sources.length * 3) {
                  this.synthesisReady.set(true);
                }
              }}
            >
              <Model model={openai("gpt-4o-mini")} />
              <System>Search {source} for relevant papers.</System>
              <SearchTool source={source} />
            </Fork>
          ))}
        </>
      );
    }

    // Synthesis phase
    return (
      <>
        <Model model={anthropic("claude-3-5-sonnet")} />
        <System>Synthesize these research findings into a coherent summary.</System>
        <Grounding title="Findings">
          {findings.map((f, i) => (
            <Section key={i} title={f.source}>{f.content}</Section>
          ))}
        </Grounding>
      </>
    );
  }
}
```

### Pattern 2: Verification Pipeline

Generate, then verify in parallel:

```tsx
class VerifiedGenerator extends Component {
  private draft = signal<string | null>(null);
  private verifications = signal<Verification[]>([]);

  render() {
    const draft = this.draft();
    const verifications = this.verifications();

    if (!draft) {
      // Generation phase
      return (
        <>
          <Model model={openai("gpt-4o")} />
          <System>Generate a detailed response.</System>
          <GenerateTool onGenerate={(d) => this.draft.set(d)} />
        </>
      );
    }

    const allVerified = verifications.length >= 3;

    if (!allVerified) {
      // Verification phase: multiple verifiers in parallel
      return (
        <>
          <Fork
            waitUntilComplete={true}
            onComplete={(v) => this.verifications.set([...this.verifications(), v])}
          >
            <Model model={anthropic("claude-3-5-sonnet")} />
            <System>Check for factual accuracy.</System>
            <Grounding title="Content">{draft}</Grounding>
            <VerifyTool aspect="accuracy" />
          </Fork>

          <Fork
            waitUntilComplete={true}
            onComplete={(v) => this.verifications.set([...this.verifications(), v])}
          >
            <Model model={openai("gpt-4o")} />
            <System>Check for logical consistency.</System>
            <Grounding title="Content">{draft}</Grounding>
            <VerifyTool aspect="logic" />
          </Fork>

          <Fork
            waitUntilComplete={true}
            onComplete={(v) => this.verifications.set([...this.verifications(), v])}
          >
            <Model model={openai("gpt-4o-mini")} />
            <System>Check for clarity and readability.</System>
            <Grounding title="Content">{draft}</Grounding>
            <VerifyTool aspect="clarity" />
          </Fork>
        </>
      );
    }

    // All verified - show results
    const allPassed = verifications.every(v => v.passed);

    return (
      <>
        {allPassed ? (
          <AssistantMessage>{draft}</AssistantMessage>
        ) : (
          <>
            <System>Some verifications failed. Revising...</System>
            <Grounding title="Issues">
              {verifications.filter(v => !v.passed).map((v, i) => (
                <Text key={i}>{v.aspect}: {v.issue}</Text>
              ))}
            </Grounding>
          </>
        )}
      </>
    );
  }
}
```

### Pattern 3: Background Processing

Handle long-running tasks without blocking:

```tsx
class DocumentProcessor extends Component {
  private processingJobs = signal<Job[]>([]);

  render(com) {
    const jobs = this.processingJobs();
    const pendingJobs = jobs.filter(j => j.status === "pending");

    return (
      <>
        <Model model={openai("gpt-4o")} />
        <System>
          You are a document processor.
          {pendingJobs.length > 0 && ` ${pendingJobs.length} jobs processing in background.`}
        </System>

        {/* Spawn background processors for new documents */}
        <ProcessDocumentTool
          onNewDocument={(doc) => {
            const job = { id: doc.id, status: "pending" };
            this.processingJobs.set([...jobs, job]);

            // Process in background
            <Spawn
              root={<DocumentAnalyzer document={doc} />}
              onComplete={() => {
                const updated = this.processingJobs().map(j =>
                  j.id === doc.id ? { ...j, status: "complete" } : j
                );
                this.processingJobs.set(updated);
              }}
            />
          }}
        />

        <Grounding title="Job Status">
          {jobs.map(job => (
            <Text key={job.id}>
              {job.id}: {job.status}
            </Text>
          ))}
        </Grounding>
      </>
    );
  }
}
```

### Pattern 4: Hierarchical Agents

Agents that manage sub-agents based on tool calls:

```tsx
class ProjectManager extends Component {
  private pendingDelegation = signal<{ team: string; task: string } | null>(null);
  private teamResults = comState<Record<string, any>>("teamResults", {});

  render() {
    const delegation = this.pendingDelegation();

    // If there's a pending delegation, fork the appropriate team
    if (delegation) {
      const TeamAgent = {
        frontend: FrontendTeam,
        backend: BackendTeam,
        qa: QATeam,
      }[delegation.team];

      return (
        <Fork
          waitUntilComplete={true}
          onComplete={(result) => {
            this.teamResults.set({
              ...this.teamResults(),
              [delegation.team]: result,
            });
            this.pendingDelegation.set(null);
          }}
        >
          <TeamAgent task={delegation.task} />
        </Fork>
      );
    }

    return (
      <>
        <Model model={openai("gpt-4o")} />
        <System>You manage a software project with specialized teams.</System>

        <DelegateTool
          onDelegate={(team, task) => this.pendingDelegation.set({ team, task })}
        />

        <Grounding title="Team Results">
          {Object.entries(this.teamResults()).map(([team, result]) => (
            <Section key={team} title={team}>{result}</Section>
          ))}
        </Grounding>
      </>
    );
  }
}

// Tool signals intent; parent component handles the fork
const DelegateTool = createTool({
  name: "delegate",
  description: "Delegate a task to a specialized team",
  parameters: z.object({
    team: z.enum(["frontend", "backend", "qa"]),
    task: z.string(),
  }),

  // Handler returns the delegation request
  handler: async ({ team, task }) => {
    return [{ type: "text", text: `Delegating "${task}" to ${team} team...` }];
  },
});
```

Note: Tools can't directly fork agents. Instead, the tool signals intent (via its result or by updating shared state), and the parent component's render handles the fork.

## Signal Communication

Forked agents can communicate via the parent's signals:

```tsx
class Coordinator extends Component {
  private sharedProgress = signal(0);
  private sharedResults = signal<Result[]>([]);

  render() {
    return (
      <>
        <System>Progress: {this.sharedProgress()}%</System>

        <Fork
          agent={
            <Worker
              onProgress={(p) => this.sharedProgress.set(p)}
              onResult={(r) => this.sharedResults.set([...this.sharedResults(), r])}
            />
          }
          waitUntilComplete={true}
        />
      </>
    );
  }
}
```

## Key Takeaways

1. **Fork for context-aware parallel work**: Inherits timeline, sections, hooks, and context from parent
2. **Spawn for isolated background tasks**: Completely independent, blank slate execution
3. **Both support waitUntilComplete**: Fork typically waits, Spawn typically doesn't (but can)
4. **Agents can nest**: Build hierarchical multi-agent systems with Fork
5. **Signals enable coordination**: Share state between parent and children via callbacks

## Next Steps

- [Fork & Spawn Reference](/docs/guides/fork-spawn) - Complete API documentation
- [Channels](/docs/guides/channels) - Real-time communication between agents
- [Examples](/examples/) - See Fork/Spawn in action
