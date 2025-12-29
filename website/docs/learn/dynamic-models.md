# Dynamic Models

This tutorial shows how to switch models mid-conversation based on context, complexity, or cost.

## The Power of Dynamic Selection

In AIDK, model selection happens in `render()`. Since render runs on every tick, you can change models at any point:

```tsx
class AdaptiveAgent extends Component {
  // Accumulate timeline entries across ticks
  private timeline = comState<COMTimelineEntry[]>("timeline", []);

  onTickStart(com, state) {
    if (state.current?.timeline) {
      this.timeline.set([...this.timeline(), ...state.current.timeline]);
    }
  }

  render(com, state) {
    // Different model based on tick count
    const model = state.tick > 5
      ? openai("gpt-4o")      // Switch to powerful model
      : openai("gpt-4o-mini"); // Start with fast model

    return (
      <>
        <Model model={model} />
        <System>You are a helpful assistant.</System>
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

## Common Patterns

### Pattern 1: Complexity-Based Upgrade

Start with a cheaper model, upgrade when the conversation gets complex:

```tsx
class SmartRouterAgent extends Component {
  private complexity = signal<"low" | "medium" | "high">("low");

  async onTickEnd(com, state) {
    // Analyze the last assistant response
    const lastEntry = state.current?.timeline.at(-1);
    if (lastEntry?.message.role === "assistant") {
      const content = getTextContent(lastEntry.message);

      // Simple heuristics for complexity
      if (content.includes("```") || content.length > 2000) {
        this.complexity.set("high");
      } else if (content.length > 500) {
        this.complexity.set("medium");
      }
    }
  }

  render() {
    const complexity = this.complexity();

    const model = {
      low: openai("gpt-4o-mini"),
      medium: openai("gpt-4o"),
      high: anthropic("claude-3-5-sonnet"),
    }[complexity];

    return (
      <>
        <Model model={model} />
        <System>You are an expert assistant.</System>
        {/* ... */}
      </>
    );
  }
}
```

### Pattern 2: Task-Based Selection

Choose models based on what the user is asking for:

```tsx
class TaskRouterAgent extends Component {
  private taskType = signal<"chat" | "code" | "analysis">("chat");

  async onMessage(message) {
    const content = message.content.toLowerCase();

    if (content.includes("code") || content.includes("function") || content.includes("bug")) {
      this.taskType.set("code");
    } else if (content.includes("analyze") || content.includes("compare") || content.includes("evaluate")) {
      this.taskType.set("analysis");
    } else {
      this.taskType.set("chat");
    }
  }

  render() {
    const task = this.taskType();

    // Best model for each task
    const model = {
      chat: openai("gpt-4o-mini"),       // Fast for simple chat
      code: anthropic("claude-3-5-sonnet"), // Great for code
      analysis: openai("gpt-4o"),         // Good for analysis
    }[task];

    return (
      <>
        <Model model={model} />
        <System>
          {task === "code" && "You are an expert programmer."}
          {task === "analysis" && "You are a careful analyst."}
          {task === "chat" && "You are a helpful assistant."}
        </System>
        {/* ... */}
      </>
    );
  }
}
```

### Pattern 3: Cost-Conscious Routing

Track token usage and switch to cheaper models when budget runs low:

```tsx
class BudgetAgent extends Component {
  private totalTokens = signal(0);
  private budget = 100000; // Token budget

  async onTickEnd(com, state) {
    const usage = state.current?.usage;
    if (usage) {
      this.totalTokens.set(this.totalTokens() + usage.totalTokens);
    }
  }

  render() {
    const used = this.totalTokens();
    const remaining = this.budget - used;
    const percentUsed = (used / this.budget) * 100;

    // Downgrade as budget depletes
    let model;
    if (percentUsed < 50) {
      model = openai("gpt-4o");
    } else if (percentUsed < 80) {
      model = openai("gpt-4o-mini");
    } else {
      model = openai("gpt-3.5-turbo");
    }

    return (
      <>
        <Model model={model} />
        <System>
          You are a helpful assistant.
          {percentUsed > 70 && " Please be concise to conserve resources."}
        </System>
        {/* ... */}
      </>
    );
  }
}
```

### Pattern 4: Fallback on Error

Switch to a backup model if the primary fails:

```tsx
class ResilientAgent extends Component {
  private primaryFailed = signal(false);
  private failureCount = signal(0);

  async onError(error, com) {
    if (error.code === "RATE_LIMIT" || error.code === "SERVICE_UNAVAILABLE") {
      this.failureCount.set(this.failureCount() + 1);

      if (this.failureCount() >= 2) {
        this.primaryFailed.set(true);
      }

      // Retry with fallback
      return { retry: true };
    }

    // Don't handle other errors
    throw error;
  }

  render() {
    const useFallback = this.primaryFailed();

    const model = useFallback
      ? anthropic("claude-3-haiku")  // Fallback
      : openai("gpt-4o");             // Primary

    return (
      <>
        <Model model={model} />
        {useFallback && (
          <System note="internal">Using fallback model due to primary unavailability.</System>
        )}
        <System>You are a helpful assistant.</System>
        {/* ... */}
      </>
    );
  }
}
```

### Pattern 5: User Tier Routing

Different models for different user tiers:

```tsx
class TieredAgent extends Component {
  render(com) {
    const ctx = context();
    const tier = ctx.user?.tier || "free";

    const model = {
      free: openai("gpt-3.5-turbo"),
      pro: openai("gpt-4o-mini"),
      enterprise: openai("gpt-4o"),
    }[tier];

    const maxTokens = {
      free: 1000,
      pro: 4000,
      enterprise: 16000,
    }[tier];

    return (
      <>
        <Model model={model} maxTokens={maxTokens} />
        <System>You are a helpful assistant.</System>
        {tier === "free" && (
          <System>Keep responses concise (under 500 words).</System>
        )}
        {/* ... */}
      </>
    );
  }
}
```

## Model Configuration

The `<Model>` component accepts various configuration options:

```tsx
<Model
  model={openai("gpt-4o")}
  temperature={0.7}
  maxTokens={4096}
  topP={0.9}
  frequencyPenalty={0.5}
  presencePenalty={0.5}
  stopSequences={["END", "STOP"]}
/>
```

You can make any of these dynamic:

```tsx
render(com, state) {
  // More creative as conversation progresses
  const temperature = Math.min(0.3 + (state.tick * 0.1), 1.0);

  return (
    <>
      <Model model={openai("gpt-4o")} temperature={temperature} />
      {/* ... */}
    </>
  );
}
```

## Multi-Model Architectures

### Orchestrator Pattern

One model decides, another executes:

```tsx
class OrchestratorAgent extends Component {
  private plan = comState<string[]>("plan", []);
  private currentStep = signal(0);

  render(com, state) {
    const plan = this.plan();
    const step = this.currentStep();

    if (plan.length === 0) {
      // Planning phase: use a reasoning model
      return (
        <>
          <Model model={openai("o1-preview")} />
          <System>
            Create a step-by-step plan for the user's request.
            Output as JSON: ["step1", "step2", ...]
          </System>
          <PlanningTool onPlan={(steps) => this.plan.set(steps)} />
          {/* ... */}
        </>
      );
    }

    // Execution phase: use a fast model
    return (
      <>
        <Model model={openai("gpt-4o-mini")} />
        <System>
          Execute step {step + 1}: {plan[step]}
        </System>
        <ExecutionTools onComplete={() => this.currentStep.set(step + 1)} />
        {/* ... */}
      </>
    );
  }
}
```

### Verification Pattern

One model generates, another verifies:

```tsx
class VerifiedAgent extends Component {
  private draft = signal<string | null>(null);
  private verified = signal(false);

  render() {
    const draft = this.draft();
    const verified = this.verified();

    if (!draft) {
      // Generation phase
      return (
        <>
          <Model model={openai("gpt-4o")} />
          <System>Generate a response to the user's question.</System>
          <DraftTool onDraft={(d) => this.draft.set(d)} />
          {/* ... */}
        </>
      );
    }

    if (!verified) {
      // Verification phase
      return (
        <>
          <Model model={anthropic("claude-3-5-sonnet")} />
          <System>
            Verify this response for accuracy. If correct, approve it.
            If incorrect, explain the issues.
          </System>
          <Grounding title="Draft to Verify">{draft}</Grounding>
          <VerifyTool
            onApprove={() => this.verified.set(true)}
            onReject={() => this.draft.set(null)}
          />
        </>
      );
    }

    // Verified - return the draft
    return <AssistantMessage>{draft}</AssistantMessage>;
  }
}
```

## Key Takeaways

1. **Model selection is dynamic**: Happens on every tick in `render()`
2. **Use signals to track context**: Complexity, task type, budget, errors
3. **Multiple models can work together**: Orchestration, verification, fallback
4. **Configuration is also dynamic**: Temperature, max tokens, etc.
5. **Match model to task**: Not every request needs the most powerful model

## Next Steps

- [Parallel Agents](./parallel-agents) - Fork and Spawn for multi-agent systems
- [Vercel AI SDK Adapter](/docs/adapters/ai-sdk) - All supported models
- [Error Handling](/docs/guides/error-handling) - Robust error recovery
