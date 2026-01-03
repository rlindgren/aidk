# Multi-Agent Example

Two approaches to multi-agent orchestration:

1. **Component Tools (Model-Driven)** - The model decides when to delegate
2. **Fork/Spawn (Compiler-Driven)** - Your code controls parallel execution

Both are valid patterns. Choose based on your use case.

## Approach 1: Component Tools (Recommended for Dynamic Delegation)

When the **model** should decide what work to delegate and when.

### Architecture

```mermaid
flowchart TB
    User[User Query] --> Orchestrator
    Orchestrator --> |"Model decides"| ResearchTool[research tool]
    Orchestrator --> |"Model decides"| CodeTool[code_review tool]
    Orchestrator --> |"Model decides"| AnalysisTool[analysis tool]

    subgraph ResearchTool [Research Tool]
        RA[Research Agent] --> WebSearch[Web Search]
        RA --> ArxivSearch[ArXiv Search]
    end

    subgraph CodeTool [Code Review Tool]
        CA[Code Agent] --> Linter[Linter]
        CA --> SecurityScan[Security Scan]
    end

    ResearchTool --> Orchestrator
    CodeTool --> Orchestrator
    AnalysisTool --> Orchestrator
    Orchestrator --> Response[Final Response]
```

### Specialist Agents

```tsx
// agents/research-agent.tsx
import { Model, System } from 'aidk';
import { aisdk } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

export const ResearchAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2-mini') })} />
    <System>
      You are a research specialist. Given a topic, search for relevant
      information and provide comprehensive findings with:
      - Key facts and data
      - Source quality assessment
      - Confidence level (0-1)

      Be thorough but concise.
    </System>
    <WebSearchTool />
    <ArxivSearchTool />
  </>
);

// agents/code-review-agent.tsx
export const CodeReviewAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>
      You are a code review specialist. Analyze the provided code for:
      - Security vulnerabilities
      - Performance issues
      - Style and best practices

      Provide actionable feedback.
    </System>
    <LinterTool />
    <SecurityScanTool />
  </>
);

// agents/analysis-agent.tsx
export const AnalysisAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>
      You are a data analysis specialist. Given data or findings,
      synthesize insights, identify patterns, and draw conclusions.
    </System>
  </>
);
```

### Component Tools

```tsx
// tools/component-tools.tsx
import { createComponentTool } from 'aidk';
import { z } from 'zod';

export const ResearchTool = createComponentTool({
  name: 'research',
  description: 'Delegate research tasks to a specialist. Use for topics requiring web or academic search.',
  component: ResearchAgent,
});

export const CodeReviewTool = createComponentTool({
  name: 'code_review',
  description: 'Delegate code review to a specialist. Analyzes security, performance, and style.',
  input: z.object({
    code: z.string().describe('The code to review'),
    language: z.string().describe('Programming language'),
    focus: z.enum(['security', 'performance', 'style', 'all']).default('all'),
  }),
  component: CodeReviewAgent,
});

export const AnalysisTool = createComponentTool({
  name: 'analyze',
  description: 'Delegate analysis to a specialist. Synthesizes data and draws conclusions.',
  component: AnalysisAgent,
});
```

### Orchestrator Agent

```tsx
// agents/orchestrator.tsx
import { Component, Model, System, Tool, Timeline, User, Assistant } from 'aidk';
import { aisdk } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';
import { ResearchTool, CodeReviewTool, AnalysisTool } from '../tools/component-tools';

export class OrchestratorAgent extends Component {
  render(com, state) {
    return (
      <>
        <Model model={aisdk({ model: openai('gpt-5.2') })} />

        <System>
          You are an intelligent assistant with access to specialist agents.

          **Available specialists:**
          - `research`: For topics requiring web or academic search
          - `code_review`: For analyzing code quality and security
          - `analyze`: For synthesizing data and drawing conclusions

          **Guidelines:**
          - Delegate to specialists when their expertise is needed
          - You can call multiple specialists for complex queries
          - Synthesize their findings into a coherent response
          - If a task is simple, handle it yourself

          Always explain your reasoning when delegating.
        </System>

        <Timeline>
          {state.timeline.messages.map((msg, i) => (
            msg.role === 'user' ? <User key={i}>{msg.content}</User>
                                : <Assistant key={i}>{msg.content}</Assistant>
          ))}
        </Timeline>

        {/* Specialist tools - model decides when to use them */}
        <ResearchTool />
        <CodeReviewTool />
        <AnalysisTool />
      </>
    );
  }
}
```

### Benefits of Component Tools

1. **Dynamic delegation** - Model decides based on the query
2. **Clean isolation** - Each specialist has its own engine instance
3. **Independent tools** - Specialists can have their own tool sets
4. **Simple composition** - Easy to add new specialists
5. **Nestable** - Specialists can delegate to other specialists

---

## Approach 2: Fork/Spawn (For Known Parallel Workflows)

When **your code** controls the parallel structure upfront.

## What You'll Build

- A coordinator agent that manages parallel research tasks
- Specialized sub-agents for different research sources
- Real-time progress tracking via channels
- Result synthesis from multiple agents

## Architecture

```mermaid
flowchart TB
    User[User Query] --> Coordinator
    Coordinator --> Fork1[Fork: ArXiv Researcher]
    Coordinator --> Fork2[Fork: Web Researcher]
    Coordinator --> Fork3[Fork: Code Researcher]
    Fork1 --> Results[Results Collection]
    Fork2 --> Results
    Fork3 --> Results
    Results --> Synthesizer[Synthesis Agent]
    Synthesizer --> Response[Final Response]

    Coordinator -.-> Spawn[Spawn: Progress Logger]
```

## The Coordinator Agent

The coordinator manages the overall research flow:

```tsx
// agents/research-coordinator.tsx
import {
  Component,
  Model,
  System,
  Fork,
  Spawn,
  Grounding,
  Section,
  comState,
  signal,
} from "aidk";
import { aisdk } from "aidk-ai-sdk";
import { openai, anthropic } from "@ai-sdk/openai";

interface ResearchResult {
  source: string;
  findings: string[];
  confidence: number;
}

export class ResearchCoordinator extends Component {
  // Track results from parallel researchers
  private results = comState<ResearchResult[]>("results", []);
  private phase = signal<"research" | "synthesis" | "complete">("research");
  private query = signal<string | null>(null);

  // Track which researchers have completed
  private completedSources = signal<string[]>([]);
  private targetSources = ["arxiv", "web", "github"];

  async onMessage(message) {
    // Capture the research query
    if (message.role === "user") {
      this.query.set(message.content);
    }
  }

  render(com, state) {
    const phase = this.phase();
    const query = this.query();
    const results = this.results();

    // Phase 1: Dispatch parallel researchers
    if (phase === "research" && query) {
      return (
        <>
          <Model model={aisdk({ model: openai("gpt-5.2") })} />

          <System>
            You are a research coordinator. A query has been received and
            researchers are gathering information. Wait for their results.
          </System>

          {/* Log progress in background */}
          <Spawn>
            <ProgressLogger
              query={query}
              sources={this.targetSources}
            />
          </Spawn>

          {/* Fork parallel researchers */}
          <Fork
            waitUntilComplete={true}
            onComplete={(result) => this.handleResearchComplete("arxiv", result)}
          >
            <ArxivResearcher query={query} />
          </Fork>

          <Fork
            waitUntilComplete={true}
            onComplete={(result) => this.handleResearchComplete("web", result)}
          >
            <WebResearcher query={query} />
          </Fork>

          <Fork
            waitUntilComplete={true}
            onComplete={(result) => this.handleResearchComplete("github", result)}
          >
            <CodeResearcher query={query} />
          </Fork>

          <Grounding title="Research Status">
            <Section title="Query">{query}</Section>
            <Section title="Progress">
              {this.completedSources().length} / {this.targetSources.length} sources complete
            </Section>
          </Grounding>
        </>
      );
    }

    // Phase 2: Synthesize results
    if (phase === "synthesis") {
      return (
        <>
          {/* Use a more capable model for synthesis */}
          <Model model={aisdk({ model: anthropic("claude-3-5-sonnet") })} />

          <System>
            You are a research synthesizer. Analyze the findings from multiple
            sources and create a comprehensive summary. Highlight agreements,
            disagreements, and gaps in the research.
          </System>

          <Grounding title="Research Findings">
            {results.map((result, i) => (
              <Section key={i} title={`${result.source} (confidence: ${result.confidence})`}>
                {result.findings.map((f, j) => (
                  <p key={j}>• {f}</p>
                ))}
              </Section>
            ))}
          </Grounding>

          <SynthesisTool onComplete={() => this.phase.set("complete")} />
        </>
      );
    }

    // Phase 3: Complete
    return (
      <>
        <Model model={aisdk({ model: openai("gpt-5.2") })} />
        <System>Research complete. Answer any follow-up questions.</System>
      </>
    );
  }

  private handleResearchComplete(source: string, result: ResearchResult) {
    // Add result
    this.results.set([...this.results(), { ...result, source }]);

    // Track completion
    const completed = [...this.completedSources(), source];
    this.completedSources.set(completed);

    // Move to synthesis when all complete
    if (completed.length >= this.targetSources.length) {
      this.phase.set("synthesis");
    }
  }
}
```

## Specialized Researcher Agents

Each researcher focuses on a specific source:

```tsx
// agents/arxiv-researcher.tsx
import { Component, Model, System, Grounding } from "aidk";
import { aisdk } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";

interface ArxivResearcherProps {
  query: string;
}

export class ArxivResearcher extends Component<ArxivResearcherProps> {
  render(com, state) {
    const { query } = this.props;

    return (
      <>
        <Model model={aisdk({ model: openai("gpt-5.2-mini") })} />

        <System>
          You are an academic research specialist. Search arXiv for papers
          related to the query. Return structured findings with:
          - Key papers and their contributions
          - Main conclusions
          - Confidence level (0-1)

          Focus on recent, highly-cited work.
        </System>

        <Grounding title="Research Query">{query}</Grounding>

        <ArxivSearchTool />
        <FindingsTool />
      </>
    );
  }
}

// agents/web-researcher.tsx
export class WebResearcher extends Component<{ query: string }> {
  render() {
    const { query } = this.props;

    return (
      <>
        <Model model={aisdk({ model: openai("gpt-5.2-mini") })} />

        <System>
          You are a web research specialist. Search the web for authoritative
          sources on the query. Focus on:
          - Official documentation
          - Expert blog posts
          - Industry reports

          Return structured findings with confidence levels.
        </System>

        <Grounding title="Research Query">{query}</Grounding>

        <WebSearchTool />
        <FindingsTool />
      </>
    );
  }
}

// agents/code-researcher.tsx
export class CodeResearcher extends Component<{ query: string }> {
  render() {
    const { query } = this.props;

    return (
      <>
        <Model model={aisdk({ model: openai("gpt-5.2-mini") })} />

        <System>
          You are a code research specialist. Search GitHub for implementations
          and examples related to the query. Focus on:
          - Popular repositories
          - Code patterns and best practices
          - Common issues and solutions

          Return structured findings with confidence levels.
        </System>

        <Grounding title="Research Query">{query}</Grounding>

        <GitHubSearchTool />
        <FindingsTool />
      </>
    );
  }
}
```

## Background Progress Logger

A spawned agent that logs progress without blocking:

```tsx
// agents/progress-logger.tsx
import { Component, Model, System } from "aidk";
import { aisdk } from "aidk-ai-sdk";
import { openai } from "@ai-sdk/openai";

interface ProgressLoggerProps {
  query: string;
  sources: string[];
}

export class ProgressLogger extends Component<ProgressLoggerProps> {
  async onMount(com) {
    const { query, sources } = this.props;

    // Log to analytics/monitoring service
    await fetch("/api/analytics/research-started", {
      method: "POST",
      body: JSON.stringify({
        query,
        sources,
        timestamp: Date.now(),
      }),
    });
  }

  async onComplete(com, result) {
    // Log completion
    await fetch("/api/analytics/research-completed", {
      method: "POST",
      body: JSON.stringify({
        result,
        timestamp: Date.now(),
      }),
    });
  }

  render() {
    // Minimal render - this agent just logs
    return (
      <>
        <Model model={aisdk({ model: openai("gpt-5.2-mini") })} maxTokens={10} />
        <System>Acknowledge and complete.</System>
      </>
    );
  }
}
```

## Tools

```tsx
// tools/findings-tool.tsx
import { createTool } from "aidk";
import { z } from "zod";

export const FindingsTool = createTool({
  name: "submit_findings",
  description: "Submit research findings to the coordinator",
  input: z.object({
    findings: z.array(z.string()).describe("List of key findings"),
    confidence: z.number().min(0).max(1).describe("Confidence in findings"),
    sources: z.array(z.string()).optional().describe("Source URLs"),
  }),

  handler: async (input) => {
    // The findings are captured by the Fork's onComplete callback
    return {
      success: true,
      findings: input.findings,
      confidence: input.confidence,
    };
  },
});

// tools/synthesis-tool.tsx
// Note: Tool signals completion via its result; parent component
// checks the result and advances the phase
export const SynthesisTool = createTool({
  name: "submit_synthesis",
  description: "Submit the final synthesized research summary",
  input: z.object({
    summary: z.string().describe("Comprehensive summary"),
    agreements: z.array(z.string()).describe("Points where sources agree"),
    disagreements: z.array(z.string()).describe("Points of contention"),
    gaps: z.array(z.string()).describe("Areas needing more research"),
    recommendations: z.array(z.string()).describe("Action items"),
  }),

  // Handler only receives input
  handler: async (input) => {
    return [{
      type: "text",
      text: `Synthesis complete:\n\n${input.summary}\n\nAgreements: ${input.agreements.length}\nDisagreements: ${input.disagreements.length}`,
    }];
  },
});
```

## Real-Time Progress with Channels

Track research progress in real-time:

```tsx
// channels/research.channel.ts
import { ChannelRouter } from "aidk";

export const researchChannel = new ChannelRouter<{
  sessionId: string;
}>("research", {
  scope: { session: "sessionId" },
});

// Broadcast progress updates from researchers
function broadcastProgress(sessionId: string, update: {
  source: string;
  status: "started" | "searching" | "analyzing" | "complete";
  progress?: number;
}) {
  researchChannel
    .publisher()
    .to(sessionId)
    .broadcast({ type: "progress", payload: update });
}
```

## Frontend Integration

```tsx
// components/ResearchProgress.tsx
import { useState, useEffect } from "react";
import { useExecution } from "aidk-react";

interface ProgressState {
  [source: string]: {
    status: string;
    progress: number;
  };
}

export function ResearchProgress() {
  const [progress, setProgress] = useState<ProgressState>({});
  const { subscribe } = useExecution();

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "channel" && event.channel === "research") {
        const { source, status, progress: pct } = event.payload;
        setProgress((prev) => ({
          ...prev,
          [source]: { status, progress: pct || 0 },
        }));
      }
    });
  }, [subscribe]);

  const sources = Object.entries(progress);

  if (sources.length === 0) return null;

  return (
    <div className="research-progress">
      <h3>Research Progress</h3>
      {sources.map(([source, { status, progress }]) => (
        <div key={source} className="source-progress">
          <span className="source-name">{source}</span>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="status">{status}</span>
        </div>
      ))}
    </div>
  );
}
```

## Running the Example

```bash
# Start backend
cd example/express
pnpm dev

# Start frontend
cd example/react
pnpm dev
```

Try queries like:

- "Research the current state of quantum computing"
- "What are best practices for building LLM applications?"
- "Compare React, Vue, and Svelte for large applications"

## Key Concepts Demonstrated

### Fork for Parallel Work

```tsx
<Fork waitUntilComplete={true} onComplete={handleResult}>
  <ResearcherAgent query={query} />
</Fork>
```

Multiple Fork components run their agents in parallel. The coordinator waits for all to complete via `waitUntilComplete={true}`.

### Spawn for Background Tasks

```tsx
<Spawn>
  <ProgressLogger query={query} />
</Spawn>
```

Spawn creates independent processes that don't block the parent. Used for logging, notifications, and analytics.

### Phase-Based Rendering

The coordinator uses signals to track phase and renders different content:

- **Research phase**: Fork parallel researchers
- **Synthesis phase**: Combine results with a powerful model
- **Complete phase**: Answer follow-up questions

### Result Aggregation

```tsx
private handleResearchComplete(source: string, result: ResearchResult) {
  this.results.set([...this.results(), { ...result, source }]);

  if (this.completedSources().length >= this.targetSources.length) {
    this.phase.set("synthesis");
  }
}
```

Results accumulate as forks complete. When all sources report in, move to synthesis.

### Model Selection by Task

- **Researchers**: Use fast, cheap models (`gpt-5.2-mini`)
- **Coordinator**: Use capable model for orchestration (`gpt-5.2`)
- **Synthesizer**: Use best model for analysis (`claude-3-5-sonnet`)

## Patterns You Can Apply

1. **Fan-out/Fan-in**: Fork multiple workers, collect results, synthesize
2. **Pipeline**: Each phase uses results from the previous
3. **Background processing**: Spawn for non-blocking side effects
4. **Progressive enhancement**: Start with fast models, upgrade for synthesis
5. **Real-time progress**: Broadcast updates via channels

## Next Steps

- Add caching for repeated queries
- Implement retry logic for failed researchers
- Add user feedback to improve results
- Store research history for future reference

---

## Choosing Your Approach

| Aspect                | Component Tools                   | Fork/Spawn                   |
| --------------------- | --------------------------------- | ---------------------------- |
| **Control**           | Model decides                     | Your code decides            |
| **Execution**         | Sequential (one tool at a time)   | True parallel                |
| **Isolation**         | Separate engine per call          | Same engine, separate fibers |
| **State sharing**     | None (isolated)                   | Can share via signals/COM    |
| **Progress tracking** | Via tool results                  | Via channels + state         |
| **Best for**          | Dynamic routing, specialist teams | Known workflows, pipelines   |

### When to Use Component Tools

- Model should decide what expertise is needed
- Tasks vary significantly in complexity
- Specialists have distinct tool sets
- Clean isolation is important
- Building a "team of specialists"

### When to Use Fork/Spawn

- Workflow structure is known upfront
- Need true concurrent execution
- Agents must share state during execution
- Building data pipelines
- Need fine-grained progress tracking

### Combining Both

You can use both patterns together. Here's a realistic example—a research assistant that:

- Uses **component tools** for model-driven delegation (general tasks)
- Uses **Fork** for known parallel workflows (comprehensive research)

```tsx
class ResearchAssistant extends Component {
  // Track parallel research results
  private arxivResults = signal<string[]>([]);
  private webResults = signal<string[]>([]);
  private isResearching = signal(false);

  // Detect when user wants comprehensive research
  onMessage(message) {
    if (message.role === 'user') {
      const text = message.content.toLowerCase();
      // Trigger parallel research for comprehensive requests
      if (text.includes('comprehensive') || text.includes('deep dive')) {
        this.isResearching.set(true);
      }
    }
  }

  render(com, state) {
    return (
      <>
        <Model model={aisdk({ model: openai('gpt-5.2') })} />

        <System>
          You are a research assistant. For general questions, use your tools.
          For comprehensive research, parallel searches are running automatically.
        </System>

        {/* Model-driven delegation - model decides when to use these */}
        <Section title="Available Tools">
          <QuickSearchTool />     {/* Simple searches */}
          <SummarizeTool />       {/* Summarize content */}
          <FactCheckTool />       {/* Verify claims */}
        </Section>

        {/* Code-driven parallel research - triggered by user intent */}
        {this.isResearching() && (
          <>
            <Fork
              waitUntilComplete={true}
              onComplete={(r) => {
                this.arxivResults.set(r.findings);
                this.checkComplete();
              }}
            >
              <ArxivResearcher query={state.lastUserMessage} />
            </Fork>

            <Fork
              waitUntilComplete={true}
              onComplete={(r) => {
                this.webResults.set(r.findings);
                this.checkComplete();
              }}
            >
              <WebResearcher query={state.lastUserMessage} />
            </Fork>
          </>
        )}

        {/* Show aggregated results when parallel research completes */}
        {this.arxivResults().length > 0 && this.webResults().length > 0 && (
          <Grounding title="Research Findings">
            <Section title="Academic Sources">
              {this.arxivResults().map((f, i) => <Paragraph key={i}>{f}</Paragraph>)}
            </Section>
            <Section title="Web Sources">
              {this.webResults().map((f, i) => <Paragraph key={i}>{f}</Paragraph>)}
            </Section>
          </Grounding>
        )}

        <Timeline>{/* ... */}</Timeline>
      </>
    );
  }

  private checkComplete() {
    if (this.arxivResults().length > 0 && this.webResults().length > 0) {
      this.isResearching.set(false);
    }
  }
}
```

**What's happening:**

- `QuickSearchTool`, `SummarizeTool`, `FactCheckTool` are component tools—the model decides when to use them
- When the user asks for "comprehensive" research, `isResearching` triggers parallel Forks
- Forks run ArxivResearcher and WebResearcher concurrently
- Results aggregate via signals, then appear in `<Grounding>` for the model to synthesize

See the full source in the [example directory](https://github.com/rlindgren/aidk/tree/master/example).
