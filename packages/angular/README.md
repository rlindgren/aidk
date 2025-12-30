# aidk-angular

Angular services and components for AIDK.

## Installation

```bash
pnpm add aidk-angular aidk-client
```

## Usage

### Setup

```typescript
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideEngine } from 'aidk-angular';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideEngine({
      baseUrl: 'http://localhost:3000',
    }),
  ],
});
```

### Using Services

```typescript
import { Component, inject } from '@angular/core';
import { EngineService, ExecutionService } from 'aidk-angular';

@Component({
  selector: 'app-chat',
  template: `
    <div *ngFor="let msg of execution.messages$ | async">
      {{ msg.content }}
    </div>
    <input (keydown.enter)="send($event)" />
  `
})
export class ChatComponent {
  private engine = inject(EngineService);
  protected execution = inject(ExecutionService);

  ngOnInit() {
    this.engine.updateConfig({ userId: 'user-123' });
    this.execution.initialize('assistant');
  }

  send(event: KeyboardEvent) {
    const input = event.target as HTMLInputElement;
    this.execution.sendMessage(input.value);
    input.value = '';
  }
}
```

## Key Exports

### Services

- `EngineService` - Client management
- `ExecutionService` - Agent execution
- `ChannelsService` - Real-time channels

### Components

- `ContentBlockComponent` - Render content blocks
- `TextBlockComponent` - Text content
- `ToolUseBlockComponent` - Tool call display
- `ToolResultBlockComponent` - Tool result display

### Providers

- `provideEngine()` - Configure the engine

## Documentation

See the [full documentation](https://rlindgren.github.io/aidk).
