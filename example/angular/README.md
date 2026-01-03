# AIDK Angular Example

Angular frontend demonstrating AIDK client integration with services.

## Prerequisites

- Backend running at `http://localhost:3000` (see [express/README.md](../express/README.md))

## Running

```bash
cd example
pnpm dev:angular
```

Opens at http://localhost:4200

## Features

- **Chat Interface** - Streaming agent responses with markdown rendering
- **Todo List** - Real-time sync via channels
- **Content Blocks** - Renders text, code, tool calls, reasoning

## Key Services

### `EngineService`

Manages client connection and configuration:

```typescript
@Component({ ... })
export class AppComponent {
  constructor(private engineService: EngineService) {
    this.engineService.updateConfig({
      userId: "demo-user",
      callbacks: {
        onConnect: () => console.log("Connected"),
        onError: (err) => console.error(err),
      },
    });
  }
}
```

### `ExecutionService`

Handles agent execution:

```typescript
@Component({ ... })
export class ChatComponent {
  messages = signal<Message[]>([]);
  isStreaming = signal(false);

  constructor(private executionService: ExecutionService) {}

  async sendMessage(text: string) {
    this.isStreaming.set(true);

    for await (const event of this.executionService.execute("task-assistant", {
      messages: this.messages(),
      newMessage: text,
    })) {
      // Handle streaming events
    }

    this.isStreaming.set(false);
  }
}
```

### `ChannelsService`

Subscribes to real-time channels:

```typescript
@Component({ ... })
export class TodoListComponent {
  tasks = signal<Task[]>([]);

  constructor(private channelsService: ChannelsService) {}

  ngOnInit() {
    this.channelsService.subscribe("todo-list", { userId: "demo-user" }, (event) => {
      if (event.tasks) {
        this.tasks.set(event.tasks);
      }
    });
  }
}
```

## Project Structure

```
src/app/
├── app.component.ts      # Root component with EngineService setup
└── components/
    ├── chat.component.ts      # Chat UI with execution
    └── todo-list.component.ts # Todo list with channel sync
```

## Proxy Configuration

The `proxy.conf.json` routes API calls to the backend:

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false
  }
}
```

## Building for Production

```bash
pnpm build
```

Output is in `dist/` - serve with any static file server.
