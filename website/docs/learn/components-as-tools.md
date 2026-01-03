# Components as Tools

Wrap any component as a tool using `createComponentTool`, enabling **model-driven delegation** to sub-agents.

## The Key Insight

In AIDK, tools and components have a bidirectional relationship:

| Direction              | What It Means                                         | Use Case                             |
| ---------------------- | ----------------------------------------------------- | ------------------------------------ |
| **Tools → Components** | Tools ARE components with lifecycle, state, rendering | [Creating Tools](/docs/guides/tools) |
| **Components → Tools** | Components CAN BE tools via `createComponentTool`     | This page                            |

This page covers the second direction: turning components into tools that the model can call.

## Why Component Tools?

| Approach                              | Who Decides | Best For                                 |
| ------------------------------------- | ----------- | ---------------------------------------- |
| [Fork/Spawn](/docs/guides/fork-spawn) | Your code   | Known parallel workflows, pipelines      |
| Component Tools                       | The model   | Dynamic delegation, unknown task routing |

With component tools, you give the model a "specialist" it can call when needed. The model decides **if** and **when** to use it.

## Basic Usage

```tsx
import { createComponentTool, Model, System, Section, H2, H3, Paragraph } from 'aidk';
import { aisdk } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

// Define a specialist agent
const ResearchAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>
      You are a research specialist. Given a topic, provide comprehensive
      research findings with sources and confidence levels.
    </System>
    <WebSearchTool />
    <ArxivSearchTool />
  </>
);

// Wrap it as a tool - render() provides context about this tool
const ResearchTool = createComponentTool({
  name: 'research',
  description: 'Delegate research tasks to a specialist agent',
  component: ResearchAgent,
  render() {
    return (
      <>
        <H3>Research Agent</H3>
        <Paragraph>
          Research specialist with web and academic search.
        </Paragraph>
      </>
    );
  }
});

// Use in an orchestrator agent
const OrchestratorAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You are a helpful assistant.</System>

    {/* Parent controls the organization - tools render inside */}
    <Section id="sub-agents" title="Specialized Sub-Agents">
      <H2>You have access to the following sub-agents. Delegate appropriately.</H2>
      <ResearchTool />
      {/* Add more tools here - their render() output flows into this Section */}
    </Section>
  </>
);
```

**What's happening here:**

1. `ResearchTool` has a `render()` method that outputs content (H3, Paragraph)
2. The tool is placed **inside** the `<Section>` in the orchestrator
3. The compiler collects all children of the Section—including the tool's rendered content
4. The model sees one organized "Specialized Sub-Agents" section with all tool descriptions
5. The tool is automatically registered with the COM onMount and removed onUnmount.

This shows the full circle: component tools are themselves components with lifecycle and rendering. You get sub-agent delegation **and** clean context organization. The parent controls the structure, and tools just contribute their content.

## How It Works

1. **Model calls the tool** with a prompt (or custom input)
2. **New engine instance** is created for the sub-agent
3. **Sub-agent executes** independently with its own tick loop
4. **Result extracted** from the last assistant message
5. **Tool result returned** to the orchestrating model

```
┌─────────────────────────────────────────────────────────────┐
│ Orchestrator Agent                                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Model calls research tool with: "quantum computing"     │ │
│ └────────────────────────┬────────────────────────────────┘ │
│                          │                                  │
│                          ▼                                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Component Tool: Creates isolated engine                 │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Research Agent (sub-engine)                         │ │ │
│ │ │ - Receives "quantum computing" as user message      │ │ │
│ │ │ - Executes ticks with its own model                 │ │ │
│ │ │ - Calls WebSearchTool, ArxivSearchTool              │ │ │
│ │ │ - Returns research findings                         │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └────────────────────────┬────────────────────────────────┘ │
│                          │                                  │
│                          ▼                                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Last assistant message content → tool result            │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Custom Input Schema

By default, component tools accept `{ prompt: string }`. You can define custom schemas:

```tsx
import { z } from 'zod';

const CodeReviewTool = createComponentTool({
  name: 'review_code',
  description: 'Review code for issues. Expects code and language.',
  input: z.object({
    code: z.string().describe('The code to review'),
    language: z.string().describe('Programming language'),
    focus: z.enum(['security', 'performance', 'style']).optional(),
  }),
  component: CodeReviewAgent,
});
```

Custom input is JSON-serialized into the user message for the sub-agent.

## Custom Result Transformation

Control how sub-agent output becomes the tool result:

```tsx
const SummarizerTool = createComponentTool({
  name: 'summarize',
  description: 'Summarize content',
  component: SummarizerAgent,
  transformResult: (output) => {
    // Extract from timeline
    const assistantMessages = output.timeline
      .filter(e => e.message?.role === 'assistant')
      .map(e => e.message?.content.map(c => c.text).join(''))
      .join('\n');

    return [{
      type: 'text',
      text: `Summary:\n${assistantMessages}`,
    }];
  },
});
```

## Nested Component Tools

Component tools can use other component tools, enabling hierarchical delegation:

```tsx
// Level 1: Specialist agents
const WebSearchAgent = () => <>{/* ... */}</>;
const ArxivAgent = () => <>{/* ... */}</>;

const WebSearchTool = createComponentTool({
  name: 'web_search',
  description: 'Search the web',
  component: WebSearchAgent,
});

const ArxivTool = createComponentTool({
  name: 'arxiv_search',
  description: 'Search academic papers',
  component: ArxivAgent,
});

// Level 2: Research agent that uses specialists
const ResearchAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You coordinate research using web and academic search.</System>
    <WebSearchTool />
    <ArxivTool />
  </>
);

const ResearchTool = createComponentTool({
  name: 'research',
  description: 'Deep research on a topic',
  component: ResearchAgent,
});

// Level 3: Top-level orchestrator
const OrchestratorAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You help users. Delegate research when needed.</System>
    <ResearchTool />
  </>
);
```

## Confirmation Support

Require user approval before delegating:

```tsx
const DangerousTool = createComponentTool({
  name: 'execute_code',
  description: 'Execute arbitrary code',
  component: CodeExecutorAgent,
  requiresConfirmation: true,
  confirmationMessage: 'This will execute code. Continue?',
});

// Dynamic confirmation
const ConditionalTool = createComponentTool({
  name: 'file_operation',
  description: 'Perform file operations',
  component: FileAgent,
  requiresConfirmation: (input) => input.prompt.includes('delete'),
});
```

## Component Tools vs Fork/Spawn

| Feature        | Component Tools                        | Fork/Spawn                      |
| -------------- | -------------------------------------- | ------------------------------- |
| Decision maker | Model                                  | Your code                       |
| Isolation      | Separate engine                        | Same engine, separate fibers    |
| Communication  | Tool input/output                      | Shared state, callbacks         |
| Parallelism    | Sequential (model calls one at a time) | True parallel execution         |
| Best for       | Dynamic routing, specialist delegation | Known workflows, fan-out/fan-in |

**Use component tools when:**

- The model should decide what work to delegate
- You want clean isolation between agents
- Sub-agents have their own tool sets
- You're building a "team of specialists"

**Use Fork/Spawn when:**

- You know the parallel structure upfront
- You need true concurrent execution
- Agents need to share state or communicate
- You're building pipelines

## Example: Multi-Specialist Orchestrator

```tsx
// Specialist agents
const WriterAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You are a skilled writer. Create polished content.</System>
  </>
);

const EditorAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You are an editor. Review and improve content.</System>
  </>
);

const FactCheckerAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You verify facts. Check claims against sources.</System>
    <WebSearchTool />
  </>
);

// Wrap as tools - each provides its own description via render()
const WriterTool = createComponentTool({
  name: 'writer',
  description: 'Create written content on any topic',
  component: WriterAgent,
  render: () => <>
    <H3>Writer</H3>
    <Paragraph>Creates initial drafts and written content.</Paragraph>
  </>
});

const EditorTool = createComponentTool({
  name: 'editor',
  description: 'Review and improve written content',
  component: EditorAgent,
  render: () => <>
    <H3>Editor</H3>
    <Paragraph>Reviews, polishes, and improves content quality.</Paragraph>
  </>
});

const FactCheckerTool = createComponentTool({
  name: 'fact_checker',
  description: 'Verify factual claims in content',
  component: FactCheckerAgent,
  render: () => <>
    <H3>Fact Checker</H3>
    <Paragraph>Verifies claims against sources. Has web search.</Paragraph>
  </>
});

// Orchestrator - tools inside Section, content flows together
const ContentOrchestratorAgent = () => (
  <>
    <Model model={aisdk({ model: openai('gpt-5.2') })} />
    <System>You are a content production manager.</System>

    <Section id="team" title="Your Content Team">
      <Paragraph>
        Coordinate these specialists to produce high-quality content:
      </Paragraph>
      <WriterTool />
      <EditorTool />
      <FactCheckerTool />
    </Section>
  </>
);
```

The model sees a single "Your Content Team" section with all three specialists described. It decides the workflow dynamically: maybe writer → fact_checker → editor, or skip fact_checker for opinion pieces.

## Related

- [Creating Tools](/docs/guides/tools) - Tools as components (the other direction)
- [Fork & Spawn](/docs/guides/fork-spawn) - Code-driven parallel execution
- [Parallel Agents](/docs/learn/parallel-agents) - Learn more about multi-agent patterns
- [Multi-Agent Example](/examples/multi-agent) - Complete orchestration patterns

---

**Next:** [Reactive State](/docs/learn/reactive-state)
