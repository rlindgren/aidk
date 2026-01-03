# Examples

Complete, runnable examples demonstrating AIDK features.

## Quick Links

- [Simple Chat](/examples/simple-chat) - Basic chat agent with streaming
- [Task Assistant](/examples/task-assistant) - Full-stack app with tools and channels
- [Multi-Agent](/examples/multi-agent) - Research coordinator with Component Tools and Fork/Spawn
- [Dynamic Router](/examples/dynamic-router) - Model switching based on context
- [User Memory](/examples/user-memory) - Tools that remember and personalize
- [Voting Consensus](/examples/voting-consensus) - Multi-agent voting for reliable outputs
- [Progressive Adoption](/examples/progressive-adoption) - Start simple, add features incrementally

## Running Examples

All examples are in the [`example/`](https://github.com/rlindgren/aidk/tree/master/example) directory.

```bash
# Clone the repo
git clone https://github.com/rlindgren/aidk.git
cd aidk

# Install dependencies
pnpm install

# Run the backend
cd example
pnpm dev:backend

# In another terminal, run the frontend
cd example
pnpm dev:frontend
```

## Example Structure

```
example/
├── backend/         # Express + AIDK server
│   ├── agents/      # Agent definitions
│   ├── tools/       # Tool implementations
│   ├── channels/    # Channel definitions
│   └── server.ts    # Express setup
│
├── frontend-react/  # React client
│   └── src/
│       ├── App.tsx
│       └── components/
│
└── frontend-angular/ # Angular client
    └── src/app/
```

## By Feature

### State Management

See how signals work:

- **Files:** `backend/agents/task-assistant.tsx`
- **Features:** `comState`, `signal`, `computed`

### Tools

Custom tool definitions:

- **Files:** `backend/tools/calculator-tool.ts`, `backend/tools/scratchpad-tool.tsx`
- **Features:** Tool creation, execution, rendering

### Channels

Real-time updates:

- **Files:** `backend/channels/todo-list.channel.ts`, `backend/routes/channels.ts`
- **Features:** Channel definition, publishing, subscribing

### Client Integration

#### React

- **Files:** `frontend-react/src/App.tsx`, `frontend-react/src/hooks/`
- **Hooks:** `useEngineClient`, `useExecution`, `useChannel`

#### Angular

- **Files:** `frontend-angular/src/app/`
- **Services:** `EngineService`, `ExecutionService`, `ChannelService`

### Persistence

Database integration:

- **Files:** `backend/persistence/`
- **Features:** Execution tracking, message logging, metrics

## Next Steps

Explore a specific example:

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 2rem;">

<div class="feature-card">

### [Simple Chat](/examples/simple-chat)

Basic chat agent with streaming responses.

</div>

<div class="feature-card">

### [Task Assistant](/examples/task-assistant)

Full-stack app with tools, channels, and React.

</div>

<div class="feature-card">

### [Multi-Agent](/examples/multi-agent)

Model-driven orchestration with Component Tools and Fork/Spawn.

</div>

<div class="feature-card">

### [Dynamic Router](/examples/dynamic-router)

Smart model selection based on task and cost.

</div>

<div class="feature-card">

### [User Memory](/examples/user-memory)

Tools that remember user context and personalize responses.

</div>

<div class="feature-card">

### [Voting Consensus](/examples/voting-consensus)

Multi-agent voting for near-zero error rates. Inspired by MAKER.

</div>

<div class="feature-card">

### [Progressive Adoption](/examples/progressive-adoption)

Start simple, add features incrementally as needs grow.

</div>

</div>
