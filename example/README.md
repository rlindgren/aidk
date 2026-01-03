# AIDK Examples

A full-stack example application demonstrating AIDK features:

- **Express Backend** - Agent execution, channels, persistence
- **React Frontend** - Hooks-based integration
- **Angular Frontend** - Service-based integration

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- OpenAI API key

### 1. Install Dependencies

From the repository root:

```bash
pnpm install
```

### 2. Configure Environment

```bash
cd example/express
cp env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=sk-...
```

### 3. Run the Stack

**Terminal 1 - Backend:**

```bash
cd example
pnpm dev:express
```

**Terminal 2 - Frontend (React or Angular):**

```bash
cd example
pnpm dev:react    # React on http://localhost:5173
# or
pnpm dev:angular  # Angular on http://localhost:4200
```

## What's Included

### Backend (`express/`)

- **Agents**: Task assistant with tools for todo lists and scratchpad
- **Tools**: Todo management, scratchpad notes, calculator
- **Channels**: Real-time sync between server and clients
- **Persistence**: In-memory storage (demo only)

See [express/README.md](./express/README.md) for API details.

### React Frontend (`react/`)

- `useEngineClient` - Client connection and lifecycle
- `useExecution` - Agent execution and streaming
- `useTodoList`, `useScratchpad` - Channel subscriptions
- Content block rendering components

See [react/README.md](./react/README.md) for details.

### Angular Frontend (`angular/`)

- `EngineService` - Client connection and configuration
- `ExecutionService` - Agent execution handling
- `ChannelsService` - Channel subscriptions
- Content block rendering components

See [angular/README.md](./angular/README.md) for details.

## Project Structure

```
example/
├── express/              # Backend
│   ├── src/
│   │   ├── agents/       # Agent definitions
│   │   ├── tools/        # Tool implementations
│   │   ├── channels/     # Channel definitions
│   │   ├── routes/       # API endpoints
│   │   ├── services/     # Business logic
│   │   └── persistence/  # Storage layer
│   └── README.md
│
├── react/                # React frontend
│   ├── src/
│   │   ├── components/   # UI components
│   │   └── hooks/        # AIDK hooks
│   └── README.md
│
└── angular/              # Angular frontend
    ├── src/app/
    │   └── components/   # UI components
    └── README.md
```

## Common Commands

```bash
# Run everything in dev mode (from example/)
pnpm dev

# Build all
pnpm build

# Type check
pnpm typecheck
```

## Troubleshooting

### CORS errors

Make sure the backend is running on port 3000 and the frontend proxy is configured correctly.

### Connection refused

The backend must be running before the frontend. Start `pnpm dev:express` first.

### API key errors

Verify your `OPENAI_API_KEY` in `express/.env` is valid and has credits.
