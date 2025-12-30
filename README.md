<p align="center">
  <img src="./website/public/logo-banner.svg" alt="AIDK" width="400" />
</p>

<p align="center">
  <strong>JSX Runtime for AI Applications</strong>
</p>

<p align="center">
  <a href="https://rlindgren.github.io/aidk/">Documentation</a> ·
  <a href="https://rlindgren.github.io/aidk/docs/getting-started">Getting Started</a> ·
  <a href="./example/">Examples</a>
</p>

---

## Your code runs between model calls.

Other frameworks: you configure an agent, call it, and hope for the best.

AIDK: your component renders before _every_ model call. The model responds, you see what happened, your code runs again, you decide what's next.

```tsx
render(com, state) {
  // This runs on EVERY tick. Not once. Every time.
  const lastResponse = getLastAssistantMessage(state);

  // Swap models based on what just happened
  const needsUpgrade = lastResponse?.includes("I'm not sure");

  return (
    <>
      <Model model={needsUpgrade ? gpt4 : gpt4mini} />

      {needsUpgrade && (
        <System>The user needs more help. Take your time. Be thorough.</System>
      )}

      <Timeline>{this.timeline()}</Timeline>
    </>
  );
}
```

No configuration for this. No "model fallback" setting. You just... do it.

---

## See it in action

**Compose agents like UI components:**

```tsx
render() {
  const messages = this.timeline();
  const cutoff = messages.length - 10;

  return (
    <Section title="Research Assistant">
      <System>{this.systemPrompt()}</System>

      <Grounding title="Knowledge Base">
        <Document src={this.activeDoc()} />
        <List title="Related">{this.relatedDocs().map(d => d.title)}</List>
      </Grounding>

      <SearchTool onResult={(r) => this.results.set(r)} />

      <Timeline>
        {messages.map((msg, i) => (
          <Message key={msg.id} role={msg.role}>
            {i < cutoff && msg.role === 'user' && <Meta>({formatRelative(msg.timestamp)})</Meta>}
            {msg.content}
          </Message>
        ))}
      </Timeline>
    </Section>
  );
}
```

**Route to specialized agents by rendering them:**

```tsx
render() {
  const intent = this.detectedIntent();

  if (intent === "refund") return <RefundAgent customer={this.customer()} />;
  if (intent === "technical") return <TechSupportAgent />;

  return <TriageAgent onIntent={(i) => this.detectedIntent.set(i)} />;
}
```

**Tools that show the model what they know:**

```tsx
const InventoryTool = createTool({
  name: "check_inventory",
  description: "Check stock levels for a product",
  parameters: z.object({
    sku: z.string().describe("Product SKU to check"),
  }),

  // Load data when the tool mounts
  async onMount(com) {
    com.setState("inventory", await fetchInventory());
  },

  // Render current state as context the model sees
  render(com) {
    const items = com.getState("inventory") || [];
    return (
      <Grounding title="Current Inventory">
        {items.map(i => `${i.sku}: ${i.qty} in stock`).join("\n")}
      </Grounding>
    );
  },

  handler: async ({ sku }) => { /* ... */ }
});
```

**Intercept context before it goes to the model:**

```tsx
onAfterCompile(com, compiled) {
  const tokens = estimateTokens(compiled);

  if (tokens > 100000) {
    // Too big. Compact old messages.
    const compacted = compactOldMessages(this.timeline(), 20);
    this.timeline.set(compacted);
    com.requestRecompile();
  }
}
```

**Fork parallel work, await results:**

```tsx
<Fork root={<FactChecker claim={claim} />} waitUntilComplete={true}
      onComplete={(result) => this.verified.set(result)} />

<Fork root={<SourceFinder topic={topic} />} waitUntilComplete={true}
      onComplete={(result) => this.sources.set(result)} />

{/* Both complete before the parent continues */}
```

**Fire and forget background work:**

```tsx
<Spawn root={<AuditLogger interaction={state.current} />} />
```

---

## The mental model

```
┌─────────────────────────────────────────────────┐
│                    TICK LOOP                    │
│                                                 │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐    │
│    │ COMPILE │ -> │  MODEL  │ -> │  TOOLS  │    │
│    └─────────┘    └─────────┘    └─────────┘    │
│        ^                              │         │
│        │         ┌─────────┐          │         │
│        └──────── │  STATE  │ <────────┘         │
│                  └─────────┘                    │
│                                                 │
│   Your component's render() runs on every tick  │
└─────────────────────────────────────────────────┘
```

Each tick: compile JSX → call model → execute tools → update state → repeat.

Your code sees everything. Your code controls everything.

---

## Install

```bash
npm install aidk aidk-ai-sdk ai @ai-sdk/openai
```

## Packages

| Package        | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `aidk`         | Core runtime, components, state, tools            |
| `aidk-ai-sdk`  | Vercel AI SDK adapter (OpenAI, Anthropic, Google) |
| `aidk-express` | Express middleware, SSE streaming                 |
| `aidk-react`   | React hooks and components                        |
| `aidk-client`  | Browser client for real-time connections          |

## Documentation

- [What is AIDK?](https://rlindgren.github.io/aidk/docs/) — The full picture
- [Getting Started](https://rlindgren.github.io/aidk/docs/getting-started) — 5-minute quickstart
- [Runtime Architecture](https://rlindgren.github.io/aidk/docs/concepts/runtime-architecture) — The tick loop explained
- [API Reference](https://rlindgren.github.io/aidk/api/)

## License

MIT
