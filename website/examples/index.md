# Examples

Complete, runnable examples demonstrating AIDK features.

## Quick Links

- [Simple Chat](/examples/simple-chat) - Basic chat agent
- [Progressive Adoption](/examples/progressive-adoption) - All adoption levels
- [Multi-Agent](/examples/multi-agent) - Coordinator with forks/spawns  
- [Tools & MCP](/examples/tools-mcp) - Tool integration
- [Real-time Updates](/examples/realtime) - Channels and SSE
- [Full Stack](/examples/fullstack) - Complete application

## Running Examples

All examples are in the [`example/`](https://github.com/rlindgren/aidk/tree/main/example) directory.

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
├── backend/          # Express + AIDK server
│   ├── agents/      # Agent definitions
│   ├── tools/       # Tool implementations
│   ├── channels/    # Channel definitions
│   └── server.ts    # Express setup
│
├── frontend-react/   # React client
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

### [Progressive Adoption](/examples/progressive-adoption)
See all 5 adoption levels in action.

</div>

<div class="feature-card">

### [Multi-Agent](/examples/multi-agent)
Coordinator with parallel execution.

</div>

<div class="feature-card">

### [Tools & MCP](/examples/tools-mcp)
Custom tools and MCP integration.

</div>

<div class="feature-card">

### [Real-time](/examples/realtime)
Channels and real-time updates.

</div>

<div class="feature-card">

### [Full Stack](/examples/fullstack)
Complete application walkthrough.

</div>

</div>











