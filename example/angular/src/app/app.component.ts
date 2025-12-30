import { Component, NgZone } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ChatComponent } from "./components/chat.component";
import { TodoListComponent } from "./components/todo-list.component";
import { EngineService } from "aidk-angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, ChatComponent, TodoListComponent],
  template: `
    <div class="app">
      <header class="app-header">
        <h1>aidk Example</h1>
        <p>Task Assistant with Channel-Synced Todo List (Angular)</p>
      </header>

      <main class="app-main">
        <div class="panel chat-panel">
          <app-chat />
        </div>

        <div class="panel todo-panel">
          <app-todo-list />
        </div>
      </main>

      <footer class="app-footer">
        <p>
          Powered by <strong>aidk</strong> • 
          Channel-based state sync • 
          Angular Frontend
        </p>
      </footer>
    </div>
  `,
  styles: [
    `
    .app {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .app-header {
      flex-shrink: 0;
      padding: 16px 24px;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      text-align: center;
    }

    .app-header h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 4px;
      background: linear-gradient(135deg, var(--color-primary), #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .app-header p {
      color: var(--color-text-muted);
      font-size: 14px;
    }

    .app-main {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr 400px;
      gap: 1px;
      background: var(--color-border);
      overflow: hidden;
    }

    .panel {
      background: var(--color-bg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .app-footer {
      flex-shrink: 0;
      padding: 12px 24px;
      background: var(--color-surface);
      border-top: 1px solid var(--color-border);
      text-align: center;
    }

    .app-footer p {
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .app-footer strong {
      color: var(--color-primary);
    }

    @media (max-width: 900px) {
      .app-main {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 1fr;
      }
    }
  `,
  ],
})
export class AppComponent {
  constructor(private engineService: EngineService) {
    // Set userId in constructor so it's available before child ngOnInit hooks run
    // In a real app, this would come from auth service after login
    this.engineService.updateConfig({
      userId: "demo-user",
      callbacks: {
        onConnect: () => console.log("Connected!"),
        onDisconnect: (reason) => console.log("Disconnected:", reason),
        onReconnecting: (attempt, delay) => console.log(`Retry ${attempt} in ${delay}ms`),
        onReconnected: (attempts) => console.log(`Reconnected after ${attempts} attempts`),
        onReconnectFailed: (attempts) => console.log("Gave up after", attempts),
        onError: (error) => console.error("SSE error:", error),
        onOffline: () => console.log("Browser went offline"),
        onOnline: () => console.log("Browser back online"),
        onStateChange: (state, info) => console.log("State changed:", state, info),
      },
    });
  }
}
