# aidk Example Backend

Express.js backend demonstrating the aidk Engine with:
- Agent execution via REST API
- Real-time channel updates via SSE
- In-memory persistence for demo purposes

## Prerequisites

- Node.js >= 24.0.0
- npm or yarn

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp env.example .env
```

### 3. Edit `.env` with your configuration

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Port the server listens on |
| `OPENAI_API_KEY` | **Yes** | - | Your OpenAI API key for GPT model access |
| `OPENAI_BASE_URL` | No | - | OpenAI Base URL |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model to use |
| `DEBUG` | No | `false` | Enable verbose logging |

### Getting an OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign up or log in
3. Create a new API key
4. Copy the key to your `.env` file

## Running the Server

### Development (with hot reload)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## API Endpoints

### Health Check

```
GET /health
```

Returns `{ "status": "ok" }` if the server is running.

### Agent Execution

```
POST /api/agents/:agentId/execute
POST /api/agents/:agentId/stream
```

Execute an agent with the given input. Available agents:
- `task-assistant` - A todo list management assistant

**Request Body:**
```json
{
  "timeline": [
    {
      "message": {
        "role": "user",
        "content": [{ "type": "text", "text": "Create a task to buy groceries" }]
      }
    }
  ],
  "sessionId": "optional-session-id"
}
```

### Channel Events (SSE)

```
GET /api/channels/sse?sessionId=<id>&channels=<channel-names>
```

Subscribe to real-time channel updates via Server-Sent Events.

```
POST /api/channels/events
```

Publish an event to a channel.

### Executions

```
GET /api/executions/thread/:threadId
GET /api/executions/:executionId
GET /api/executions/:executionId/graph
```

Query execution history and details.

## Architecture

```
┌─────────────────────────────────────────┐
│  Express Server                         │
│  └── Routes                             │
│      ├── /api/agents/*   (execution)    │
│      ├── /api/channels/* (SSE/events)   │
│      └── /api/executions/* (history)    │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  aidk Engine                            │
│  ├── ChannelService (with SSE Transport)│
│  ├── TaskAssistantAgent                 │
│  │   ├── OpenAI Model                   │
│  │   ├── TodoListTool                   │
│  │   └── CalculatorTool                 │
│  └── In-Memory Persistence              │
└─────────────────────────────────────────┘
```

## Troubleshooting

### "Cannot find module" errors

Make sure you've installed dependencies:
```bash
npm install
```

### OpenAI API errors

Verify your `OPENAI_API_KEY` is set correctly in `.env`.

### Port already in use

Change the `PORT` in your `.env` file or kill the process using that port:
```bash
lsof -ti:3000 | xargs kill -9
```

