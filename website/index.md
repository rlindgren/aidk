---
layout: home

hero:
  name: AIDK
  text: Context Engineering for AI Agents
  tagline: Control what your model sees on every tick. No templates. No YAML. Just code.
  actions:
    - theme: brand
      text: Get Started
      link: /docs/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/rlindgren/aidk

features:
  - icon: <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
    title: You Control the Context
    details: Your code runs before every model call. Decide what the model sees. Transform, summarize, hydrate - whatever you need.

  - icon: <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
    title: Hook Into Everything
    details: Mount, unmount, tick start, tick end, message received. Run code at any point in the execution lifecycle.

  - icon: <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
    title: No More Jinja
    details: JSX compiles to model context. Conditionals, loops, components - use real programming constructs.

  - icon: <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
    title: Await or Fire-and-Forget
    details: Fork parallel work and wait. Spawn background tasks. Your agent, your control flow.

  - icon: <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
    title: Any Model, Any Framework
    details: OpenAI, Anthropic, Google. Express, NestJS. React, Angular. Plug in what you use.

  - icon: <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
    title: Format Per Model
    details: Write JSX once. Claude gets XML. GPT gets Markdown. The adapter handles it.
---

<div class="vp-doc custom-home">

## Stop configuring. Start programming.

Other frameworks give you an agent loop and ask you to configure it. Add a planning step. Add a summary step. Add guardrails. Tack on more and more until you're fighting the abstraction.

AIDK gives you the loop. **You decide what happens inside it.**

```tsx
class ResearchAgent extends Component {
  private sources = comState<Source[]>("sources", []);

  render(com, state) {
    return (
      <>
        <Model model={openai("gpt-4o")} />

        <System>
          You are a research assistant. Search for information, then synthesize
          findings.
        </System>

        <SearchTool />

        {/* Show sources the model has gathered */}
        {this.sources().length > 0 && (
          <Grounding title="Sources Found">
            {this.sources().map((s) => (
              <Section key={s.id} title={s.title}>
                {s.summary}
              </Section>
            ))}
          </Grounding>
        )}

        {/* You control how the timeline renders */}
        <Timeline>
          {state.current?.timeline.map((entry) => (
            <Message key={entry.id} {...entry.message} />
          ))}
        </Timeline>
      </>
    );
  }
}
```

Your component renders before every model call. The model responds. Your component renders again. That's it. **You control the interface.**

---

## Want to do X? Just do it.

<div class="just-do-it">

**Want to swap models mid-conversation?**

```tsx
<Model model={state.tick > 5 ? gpt4 : gpt4mini} />
```

**Want to summarize old messages to save tokens?**

```tsx
{
  messages.map((msg, i) =>
    i < messages.length - 10 ? (
      <Message role={msg.role}>[Earlier: {msg.summary}]</Message>
    ) : (
      <Message {...msg} />
    ),
  );
}
```

**Want to show image descriptions but let the model hydrate originals on demand?**

```tsx
<HydrateTool images={images} />;
{
  images.map((img) => (
    <Grounding key={img.id}>
      Image {img.id}: {img.description}
      (use hydrate tool to see original)
    </Grounding>
  ));
}
```

**Want XML for some parts and Markdown for others?**

```tsx
<Section format="xml">
  <StructuredData data={schema} />
</Section>
<Section format="markdown">
  {freeformInstructions}
</Section>
```

**Want to run verification in parallel and wait for results?**

```tsx
<Fork
  agent={<FactChecker claim={claim} />}
  waitUntilComplete={true}
  onComplete={(r) => this.verified.set(r)}
/>
```

**Want to log to an external service without blocking?**

```tsx
<Spawn agent={<AuditLogger interaction={state} />} />
```

</div>

It's just code. There's no config option to enable these things. You write what you need.

---

## Start where you are

You don't have to rewrite anything. Use AIDK for the parts that need it.

<div class="levels">

<div class="level">
<div class="level-badge">1</div>
<div class="level-content">

### Just compile JSX to messages

Keep your existing `generateText` calls. Use JSX for dynamic context.

```tsx
import { compile } from "aidk-ai-sdk";
import { generateText } from "ai";

const { messages, tools, system } = await compile(<MyAgent />);

const result = await generateText({
  model: openai("gpt-4o"),
  messages,
  tools,
  system,
});
```

</div>
</div>

<div class="level">
<div class="level-badge">2</div>
<div class="level-content">

### Let AIDK handle multi-turn

The compiler manages the tick loop. You still control model selection.

```tsx
import { createCompiler } from "aidk-ai-sdk";

const compiler = createCompiler();

for await (const event of compiler.stream(<MyAgent />, async (input) => {
  return streamText({ model: openai("gpt-4o"), ...input });
})) {
  console.log(event);
}
```

</div>
</div>

<div class="level">
<div class="level-badge">3</div>
<div class="level-content">

### Full engine with channels and persistence

Real-time updates, execution tracking, state recovery.

```tsx
import { createEngine } from "aidk";
import { createExpressMiddleware } from "aidk-express";

const engine = createEngine();
app.use("/agent", createExpressMiddleware({ engine, agent: TaskAgent }));
```

</div>
</div>

</div>

---

## Tools run where they need to

Four execution types. Use what makes sense.

<div class="tool-types">

<div class="tool-type">

**SERVER** - Runs on your backend

```tsx
const SearchTool = createTool({
  name: "search",
  type: ToolExecutionType.SERVER,
  handler: async ({ query }) => {
    return searchService.query(query);
  },
});
```

</div>

<div class="tool-type">

**CLIENT** - Runs in the browser

```tsx
// Render UI from structured data
const ChartTool = createTool({
  name: "render_chart",
  type: ToolExecutionType.CLIENT,
  intent: ToolIntent.RENDER,
  // React renders from tool input
});

// Collect user input
const FormTool = createTool({
  name: "collect_info",
  type: ToolExecutionType.CLIENT,
  requiresResponse: true,
});

// Client-side actions
const NavTool = createTool({
  name: "navigate",
  type: ToolExecutionType.CLIENT,
});
```

</div>

<div class="tool-type">

**PROVIDER** - Handled by the model provider

```tsx
const WebSearch = createTool({
  name: "web_search",
  type: ToolExecutionType.PROVIDER,
  // OpenAI/Anthropic handles execution
});
```

</div>

<div class="tool-type">

**MCP** - From MCP servers

```tsx
const mcpTools = await discoverMCPTools({
  config: {
    serverName: "filesystem",
    transport: "stdio",
    connection: { command: "npx", args: [...] },
  },
  include: ["read_file", "write_file"],
  toolPrefix: "fs_",
});
```

</div>

</div>

### Confirmation and feedback

Escalate tool execution requests

```tsx
const DeleteTool = createTool({
  name: "delete_file",
  requiresConfirmation: true, // User must approve
  confirmationMessage: (input) => `Delete ${input.path}?`,
  handler: async ({ path }) => fs.unlink(path),
});

const DangerousTool = createTool({
  name: "execute_sql",
  // Conditional confirmation
  requiresConfirmation: (input) => input.query.includes("DELETE"),
  handler: async ({ query }) => db.execute(query),
});
```

### Tools render context

Tools aren't just execution. They contribute to what the model sees.

```tsx
const TodoTool = createTool({
  name: "todo",
  description: "Manage tasks",
  parameters: z.object({
    action: z.enum(["add", "complete", "list"]),
    task: z.string().optional(),
  }),

  handler: async (input) => TodoService.perform(input),

  // Load state on mount
  async onMount(com) {
    com.setState("tasks", await TodoService.getTasks());
  },

  // Render current state as context
  render(com) {
    const tasks = com.getState("tasks") || [];
    return (
      <Grounding title="Current Tasks">
        <List>
          {tasks.map((t) => (
            <ListItem key={t.id}>
              {t.done ? "✓" : "○"} {t.text}
            </ListItem>
          ))}
        </List>
      </Grounding>
    );
  },
});
```

---

## Real-time channels

Define channel routers. Handle events. Broadcast to rooms.

```tsx
// Backend: Define a channel router
const todoChannel = new ChannelRouter<{ userId: string }>("todo", {
  scope: { user: "userId" },
}).on("add_task", async (event, ctx) => {
  const task = await TodoService.add(ctx.userId, event.payload.text);
  return { success: true, task };
});

// Broadcast updates to user's room
todoChannel
  .publisher()
  .to(userId)
  .broadcast({ type: "task_added", payload: task });
```

```tsx
// Frontend: Subscribe to execution events
function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const { subscribe } = useExecution();

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "channel" && event.channel === "todo") {
        setTasks((prev) => [...prev, event.payload.task]);
      }
    });
  }, [subscribe]);

  return (
    <ul>
      {tasks.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  );
}
```

---

## The package ecosystem

<div class="package-grid">

| Package        | What it does                                      |
| -------------- | ------------------------------------------------- |
| `aidk`         | Core framework. Engine, components, state, tools. |
| `aidk-ai-sdk`  | Vercel AI SDK adapter. Most people start here.    |
| `aidk-express` | Express middleware. SSE streaming, channels.      |
| `aidk-nestjs`  | NestJS module with decorators.                    |
| `aidk-react`   | `useEngine`, `useExecution`, channel hooks.       |
| `aidk-angular` | Services and components for Angular.              |
| `aidk-openai`  | Direct OpenAI adapter (no AI SDK dependency).     |
| `aidk-google`  | Google AI / Vertex adapter.                       |

</div>

---

## What AIDK is not

<div class="not-grid">

<div class="not-item">

**Not a managed service**

AIDK is a library. You run it on your infrastructure. Bring your own API keys.

</div>

<div class="not-item">

**Not a black box**

No magic. You see exactly what goes to the model because you're the one constructing it.

</div>

<div class="not-item">

**Not opinionated about architecture**

No mandatory planning steps. No required summarization. Build what you need, skip what you don't.

</div>

</div>

---

<div class="cta-section">

## Ready?

```bash
npm install aidk aidk-ai-sdk ai @ai-sdk/openai
```

<div class="cta-buttons">
<a href="/aidk/docs/getting-started">Get Started</a>
<a href="/aidk/examples/">See Examples</a>
<a href="/aidk/docs/">Read the Docs</a>
</div>

</div>

</div>

<style>
.custom-home {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 0;
  overflow-x: hidden;
}

/* Global code block overflow handling */
.custom-home pre,
.custom-home div[class*="language-"] {
  overflow-x: auto;
  max-width: 100%;
}

.custom-home pre code {
  display: block;
  min-width: max-content;
}

@media (max-width: 480px) {
  .custom-home {
    padding: 1.5rem 0;
  }
  
  .custom-home h2 {
    font-size: 1.5rem;
  }
}

/* Remove hr lines between sections */
.custom-home hr {
  display: none;
}

.custom-home h2 {
  margin-top: 4rem;
  margin-bottom: 1.5rem;
  font-size: 1.8rem;
  border: none !important;
  border-top: none !important;
  border-bottom: none !important;
  padding: 0;
  text-align: center;
}

.custom-home h2:first-of-type {
  margin-top: 2rem;
}

.custom-home h3 {
  border: none !important;
  border-top: none !important;
  padding-top: 0;
}

/* Comparison grid */
.comparison-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin: 2rem 0;
}

@media (max-width: 768px) {
  .comparison-grid {
    grid-template-columns: 1fr;
  }
}

.comparison-card {
  padding: 1.5rem;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
  min-width: 0;
}

.comparison-card pre {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.comparison-card pre code {
  display: block;
  min-width: max-content;
}

.comparison-card.bad {
  border-left: 4px solid var(--vp-c-danger-1);
}

.comparison-card.good {
  border-left: 4px solid var(--vp-c-brand-1);
}

.comparison-card strong {
  display: block;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
}

.comparison-card p:last-child {
  margin-top: 1rem;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

/* Progressive levels */
.levels {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  margin: 2rem 0;
}

.level {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
}

.level-badge {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vp-c-brand-1);
  color: white;
  font-weight: bold;
  font-size: 1.2rem;
  border-radius: 50%;
}

.level-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.level-content pre {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.level-content pre code {
  display: block;
  min-width: max-content;
}

.level-content h3 {
  margin: 0 0 0.75rem 0;
  font-size: 1.1rem;
}

.level-content p {
  margin: 0 0 1rem 0;
  color: var(--vp-c-text-2);
}

@media (max-width: 480px) {
  .level {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .level-badge {
    width: 32px;
    height: 32px;
    font-size: 1rem;
  }
}

/* Package grid */
.package-grid {
  margin: 2rem 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.package-grid table {
  width: 100%;
  min-width: 500px;
}

/* Tool types grid */
.tool-types {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
  margin: 2rem 0;
}

@media (max-width: 768px) {
  .tool-types {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .tool-types {
    gap: 1rem;
  }
}

.tool-type {
  padding: 1.5rem;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  min-width: 0;
}

.tool-type pre {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.tool-type pre code {
  display: block;
  min-width: max-content;
}

.tool-type strong {
  display: block;
  margin-bottom: 0.75rem;
  color: var(--vp-c-brand-1);
  font-size: 0.9rem;
}

.tool-type .language-tsx {
  margin: 0;
}

@media (max-width: 480px) {
  .tool-type {
    padding: 1rem;
  }
  
  .tool-type strong {
    font-size: 0.85rem;
  }
}

/* Not grid */
.not-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  margin: 2rem 0;
}

@media (max-width: 768px) {
  .not-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}

@media (max-width: 480px) {
  .not-item {
    padding: 1.25rem;
  }
}

.not-item {
  padding: 1.5rem;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
}

.not-item strong {
  display: block;
  margin-bottom: 0.75rem;
  color: var(--vp-c-text-1);
}

.not-item p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

/* CTA section */
.cta-section {
  margin-top: 4rem;
  padding: 3rem;
  background: var(--vp-c-bg-soft);
  border-radius: 16px;
  text-align: center;
}

.cta-section h2 {
  margin-top: 0 !important;
  margin-bottom: 1.5rem;
  border: none !important;
  padding: 0 !important;
}

.cta-section .language-bash {
  display: inline-block;
  margin-bottom: 2rem;
  max-width: 100%;
  overflow-x: auto;
}

.cta-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

.cta-buttons a {
  padding: 0.75rem 1.5rem;
  background: var(--vp-c-brand-1);
  color: white;
  border-radius: 8px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.2s;
  white-space: nowrap;
}

.cta-buttons a:hover {
  background: var(--vp-c-brand-3);
}

.cta-buttons a:not(:first-child) {
  background: transparent;
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
}

.cta-buttons a:not(:first-child):hover {
  background: var(--vp-c-brand-soft);
}

@media (max-width: 640px) {
  .cta-section {
    padding: 2rem 1rem;
  }
  
  .custom-home .cta-buttons {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 0.75rem !important;
    width: 100%;
  }
  
  .custom-home .cta-buttons a {
    text-align: center;
    width: 100% !important;
    max-width: none !important;
    display: block;
  }
}

/* Just do it section */
.just-do-it {
  margin: 2rem 0;
}

.just-do-it p strong {
  display: block;
  margin-top: 2rem;
  margin-bottom: 0.5rem;
  font-size: 1rem;
  color: var(--vp-c-text-1);
}

.just-do-it p:first-child strong {
  margin-top: 0;
}

.just-do-it .language-tsx,
.just-do-it pre {
  margin-bottom: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.just-do-it pre code {
  display: block;
  min-width: max-content;
}

@media (max-width: 480px) {
  .just-do-it p strong {
    font-size: 0.95rem;
    margin-top: 1.5rem;
  }
}
</style>
