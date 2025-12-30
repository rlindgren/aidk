# Ephemeral vs Persisted Content

AIDK distinguishes between content that persists in the conversation history and content that exists only for the current tick. Understanding this distinction is key to effective context management.

## Quick Comparison

| Component   | Persisted? | Rebuilds Each Tick? | Use For                               |
| ----------- | ---------- | ------------------- | ------------------------------------- |
| `Section`   | Yes        | No                  | Role definitions, static instructions |
| `Grounding` | **No**     | Yes                 | Current state, real-time data         |
| `Ephemeral` | **No**     | Yes                 | Low-level ephemeral primitive         |
| `Timeline`  | Yes        | No                  | Conversation history                  |

## Persisted Content: Section

Content inside `<Section>` is persisted as part of the system message. It becomes part of the conversation history.

```tsx
<Section id="instructions" audience="model">
  You are a helpful customer support agent.
  Always be polite and professional.
</Section>
```

**Characteristics:**

- Added to system message
- Persists across all ticks
- Part of conversation history
- Use for: role definitions, static rules, consistent instructions

### When to Use Section

```tsx
class SupportAgent extends Component {
  render() {
    return (
      <>
        {/* Static instructions - persist across conversation */}
        <Section audience="model">
          <H2>Your Role</H2>
          <Paragraph>You are a customer support agent for TechCorp.</Paragraph>
          <List>
            <ListItem>Be helpful and professional</ListItem>
            <ListItem>Escalate complex issues to human agents</ListItem>
            <ListItem>Never make promises about refunds</ListItem>
          </List>
        </Section>

        <Timeline>{/* conversation history */}</Timeline>
      </>
    );
  }
}
```

## Ephemeral Content: Grounding

Content inside `<Grounding>` is **NOT persisted**. It provides current-state context to the model but is not part of the conversation history. It's rebuilt fresh each tick.

```tsx
<Grounding type="account_status" position="before-user">
  Current balance: ${account.balance}
  Account status: {account.status}
  Last login: {account.lastLogin}
</Grounding>
```

**Characteristics:**

- NOT added to conversation history
- Rebuilt fresh each tick
- Provides current-state context
- Use for: dynamic data, real-time state, changing context

### When to Use Grounding

```tsx
class SupportAgent extends Component {
  render() {
    const ctx = context();
    const account = ctx.metadata.account;

    return (
      <>
        <Section audience="model">
          You are a customer support agent.
        </Section>

        {/* Dynamic context - changes frequently, NOT persisted */}
        <Grounding type="customer_context" position="before-user">
          <H3>Current Customer Context</H3>
          <Table
            headers={['Field', 'Value']}
            rows={[
              ['Name', account.name],
              ['Tier', account.tier],
              ['Balance', `$${account.balance}`],
              ['Open Tickets', String(account.openTickets)],
            ]}
          />
        </Grounding>

        {/* Real-time inventory - ephemeral */}
        <Grounding type="inventory" position="after-system">
          Stock levels as of {new Date().toISOString()}:
          {JSON.stringify(inventory.current)}
        </Grounding>

        <Timeline>{/* conversation history */}</Timeline>
      </>
    );
  }
}
```

## The Ephemeral Primitive

`<Ephemeral>` is the low-level primitive that `<Grounding>` wraps. Use it when you need direct control over ephemeral content positioning.

```tsx
<Ephemeral
  type="tools"
  position="start"
  order={10}
  id="available-tools"
>
  Available tools: {toolList.join(', ')}
</Ephemeral>
```

### Position Options

Ephemeral content can be positioned at various points in the message list:

| Position         | Description                                    |
| ---------------- | ---------------------------------------------- |
| `'start'`        | At the beginning of messages                   |
| `'end'`          | At the end of messages (default for Ephemeral) |
| `'after-system'` | After system messages                          |
| `'before-user'`  | Before the user's message                      |
| `'after-user'`   | After the user's message                       |

```tsx
{/* Appears at the very start */}
<Ephemeral position="start" type="preamble">
  Session started at {sessionStart}
</Ephemeral>

{/* Appears after system message */}
<Grounding position="after-system" type="context">
  Additional context...
</Grounding>

{/* Appears just before the user's latest message */}
<Grounding position="before-user" type="state">
  Current state: {state}
</Grounding>
```

### Ordering Within Position

When multiple ephemeral items have the same position, use `order` to control their sequence:

```tsx
{/* These both appear before-user, but in specific order */}
<Grounding position="before-user" order={1} type="preferences">
  User preferences: {prefs}
</Grounding>

<Grounding position="before-user" order={2} type="recent_activity">
  Recent activity: {activity}
</Grounding>
```

Lower order values appear first.

## Why Does This Matter?

### Token Efficiency

Ephemeral content is not stored in conversation history, which means:

- It doesn't consume tokens in stored messages
- Fresh data is injected each tick
- Previous states don't accumulate

```tsx
// BAD: This persists and accumulates
onTickEnd(com, state) {
  this.timeline.update(t => [
    ...t,
    { role: 'system', content: `Balance: ${balance}` }, // Accumulates!
  ]);
}

// GOOD: This is ephemeral - rebuilt fresh each tick
render() {
  return (
    <>
      <Grounding type="balance">Balance: ${balance}</Grounding>
      <Timeline>{this.timeline()}</Timeline>
    </>
  );
}
```

### Consistent Context

Grounding ensures the model always has current information:

```tsx
class TradingAgent extends Component {
  render() {
    const prices = fetchCurrentPrices(); // Fresh each tick

    return (
      <>
        <Section audience="model">
          You are a trading assistant.
        </Section>

        {/* Always current - not stale from 10 messages ago */}
        <Grounding type="market_data" position="before-user">
          <H3>Current Prices</H3>
          <Table
            headers={['Symbol', 'Price', 'Change']}
            rows={prices.map(p => [p.symbol, p.price, p.change])}
          />
        </Grounding>

        <Timeline>{this.timeline()}</Timeline>
      </>
    );
  }
}
```

## Comparison with Examples

### Static Instructions (Use Section)

```tsx
// Persist across the entire conversation
<Section audience="model">
  You are a legal assistant. Always cite sources.
  Never provide advice that could be construed as legal representation.
</Section>
```

### Dynamic User Context (Use Grounding)

```tsx
// Changes between ticks, shouldn't be in history
<Grounding type="user_status">
  User is currently: {user.status}
  Cart items: {cart.items.length}
  Session duration: {sessionDuration}
</Grounding>
```

### Real-Time Data (Use Grounding)

```tsx
// Fetch fresh each tick
<Grounding type="weather" position="before-user">
  Current weather in {location}: {weather.current}
</Grounding>
```

### One-Time Setup (Use Section)

```tsx
// Set once, persists
<Section id="capabilities">
  You have access to the following tools:
  - search_database: Query the customer database
  - send_email: Send emails to customers
  - create_ticket: Create support tickets
</Section>
```

## Audience Options

Both Section and Grounding support audience targeting:

```tsx
// Only model sees this
<Section audience="model">
  Internal instructions...
</Section>

// Only user sees this (useful for UI-rendered content)
<Section audience="user">
  Visible to user...
</Section>

// Both see this (default)
<Section audience="all">
  Shared content...
</Section>
```

Grounding defaults to `audience="model"` since it's typically context for the model.

## Best Practices

### 1. Default to Grounding for Dynamic Data

If the data changes frequently or represents current state, use Grounding:

```tsx
// Good: Current state is ephemeral
<Grounding type="session">
  Session: {session.id}, Duration: {session.duration}
</Grounding>
```

### 2. Use Section for Stable Instructions

If the content is the same across the entire conversation, use Section:

```tsx
// Good: Role definition persists
<Section audience="model">
  You are a helpful coding assistant.
</Section>
```

### 3. Don't Duplicate

Avoid putting the same information in both:

```tsx
// Bad: Duplicate information
<Section>User tier: {user.tier}</Section>
<Grounding>User tier: {user.tier}</Grounding>

// Good: Choose based on whether it changes
<Grounding type="user_context">
  User: {user.name}, Tier: {user.tier}
</Grounding>
```

### 4. Position Thoughtfully

Put context where it's most relevant:

```tsx
// Good: User context right before their message
<Grounding position="before-user" type="context">
  {userContext}
</Grounding>

// Good: System context after system message
<Grounding position="after-system" type="state">
  {systemState}
</Grounding>
```

## Related

- [Semantic Primitives](/docs/semantic-primitives) - All JSX components
- [Context Object Model](/docs/concepts/context-object-model) - How state is managed
- [Tick Lifecycle](/docs/concepts/tick-lifecycle) - When content is rebuilt
