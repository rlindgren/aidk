# AIDK React Example

React frontend demonstrating AIDK client integration with hooks.

## Prerequisites

- Backend running at `http://localhost:3000` (see [express/README.md](../express/README.md))

## Running

```bash
cd example
pnpm dev:react
```

Opens at http://localhost:5173

## Features

- **Chat Interface** - Streaming agent responses with markdown rendering
- **Todo List** - Real-time sync via channels
- **Scratchpad** - Thread-scoped notes synced across components
- **Content Blocks** - Renders text, code, tool calls, reasoning

## Key Hooks

### `useEngineClient`

Creates and manages the AIDK client connection:

```tsx
const { client } = useEngineClient({
  baseUrl: "http://localhost:3000",
  userId: "demo-user",
  callbacks: {
    onConnect: () => console.log("Connected"),
    onError: (err) => console.error(err),
  },
});
```

### `useExecution`

Handles agent execution and message streaming:

```tsx
const { messages, isStreaming, sendMessage, clearMessages } = useExecution({
  client,
  agentId: "task-assistant",
});

// Send a message
sendMessage("Create a task to buy groceries");
```

### `useTodoList`

Subscribes to the todo list channel:

```tsx
const { tasks, createTask, toggleComplete, deleteTask } = useTodoList(
  client,
  userId
);
```

### `useScratchpad`

Subscribes to the scratchpad channel (thread-scoped):

```tsx
const { notes, addNote, removeNote, clearNotes } = useScratchpad(
  client,
  threadId
);
```

## Project Structure

```
src/
├── App.tsx           # Main app with all hooks wired up
├── components/
│   ├── ChatInterface.tsx   # Chat UI with message list
│   ├── TodoListUI.tsx      # Todo list component
│   └── ScratchpadUI.tsx    # Scratchpad notes
└── hooks/
    ├── useEngineClient.ts  # Client setup
    ├── useExecution.ts     # Agent execution
    ├── useTodoList.ts      # Todo channel
    └── useScratchpad.ts    # Scratchpad channel
```

## Environment Variables

Create a `.env` file:

```
VITE_API_URL=http://localhost:3000
```

## Building for Production

```bash
pnpm build
pnpm preview
```
