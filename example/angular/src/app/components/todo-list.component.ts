import { Component, OnInit, DestroyRef, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ChannelsService, ExecutionService, EngineService, ChannelEvent } from "aidk-angular";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";

interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt?: string;
  updatedAt?: string;
  userId?: string /* Tasks are scoped to users */;
}

interface TaskResponse {
  success: boolean;
  tasks?: Task[];
  message?: string;
}

@Component({
  selector: "app-todo-list",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="todo-list">
      <div class="todo-header">
        <h2>Todo List</h2>
        <div class="todo-stats">
          <span class="pending">{{ pendingCount }} pending</span>
          <span class="completed">{{ completedCount }} completed</span>
        </div>
      </div>

      <form class="add-task-form" (ngSubmit)="createTask()">
        <input
          type="text"
          [(ngModel)]="newTaskTitle"
          name="title"
          placeholder="Task title..."
          [disabled]="isLoading"
        />
        <input
          type="text"
          [(ngModel)]="newTaskDesc"
          name="description"
          placeholder="Description (optional)..."
          [disabled]="isLoading"
        />
        <button type="submit" [disabled]="!newTaskTitle.trim() || isLoading">
          Add Task
        </button>
      </form>

      <div class="tasks-list">
        @if (tasks.length === 0) {
          <div class="empty-tasks">
            <p>No tasks yet.</p>
            <p class="hint">Add a task above or ask the assistant to create one.</p>
          </div>
        }

        @for (task of tasks; track task.id) {
          <div class="task-item" [class.completed]="task.completed">
            <label class="task-checkbox">
              <input
                type="checkbox"
                [checked]="task.completed"
                (change)="toggleComplete(task)"
              />
              <span class="checkmark">{{ task.completed ? '✓' : '' }}</span>
            </label>

            <div class="task-content">
              <span class="task-title">{{ task.title }}</span>
              @if (task.description) {
                <span class="task-description">{{ task.description }}</span>
              }
            </div>

            <button class="delete-btn" (click)="deleteTask(task)" title="Delete task">
              ×
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .todo-list {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .todo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-border);
    }

    .todo-header h2 {
      font-size: 18px;
      font-weight: 600;
    }

    .todo-stats {
      display: flex;
      gap: 12px;
      font-size: 12px;
    }

    .todo-stats .pending {
      color: var(--color-primary);
    }

    .todo-stats .completed {
      color: var(--color-success);
    }

    .add-task-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface);
    }

    .add-task-form button {
      background: var(--color-primary);
      color: white;
      align-self: flex-end;
    }

    .add-task-form button:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }

    .tasks-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0 0 12px 0;
    }

    .empty-tasks {
      text-align: center;
      padding: 40px 20px;
      color: var(--color-text-muted);
    }

    .empty-tasks .hint {
      font-size: 13px;
      margin-top: 8px;
      font-style: italic;
    }

    .task-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      background: var(--color-surface);
      border-radius: 0; /* var(--radius-md); */
      margin-bottom: 8px;
      transition: all 0.15s ease;
    }

    .task-item:hover {
      background: var(--color-surface-hover);
    }

    .task-item.completed {
      opacity: 0.6;
    }

    .task-item.completed .task-title {
      text-decoration: line-through;
    }

    .task-checkbox {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: 2px solid var(--color-border);
      border-radius: 4px;
      cursor: pointer;
      flex-shrink: 0;
      position: relative;
    }

    .task-checkbox input {
      position: absolute;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }

    .task-checkbox .checkmark {
      font-size: 14px;
      color: var(--color-success);
    }

    .task-item.completed .task-checkbox {
      border-color: var(--color-success);
      background: rgba(74, 222, 128, 0.1);
    }

    .task-content {
      flex: 1;
      min-width: 0;
    }

    .task-title {
      display: block;
      font-weight: 500;
    }

    .task-description {
      display: block;
      font-size: 13px;
      color: var(--color-text-muted);
      margin-top: 4px;
    }

    .delete-btn {
      background: transparent;
      color: var(--color-text-muted);
      font-size: 20px;
      padding: 4px 8px;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .task-item:hover .delete-btn {
      opacity: 1;
    }

    .delete-btn:hover {
      color: var(--color-error);
    }
  `,
  ],
})
export class TodoListComponent implements OnInit {
  tasks: Task[] = [];
  isLoading = false;
  newTaskTitle = "";
  newTaskDesc = "";

  private destroyRef = inject(DestroyRef);

  get pendingCount(): number {
    return this.tasks.filter((t) => !t.completed).length;
  }

  get completedCount(): number {
    return this.tasks.filter((t) => t.completed).length;
  }

  constructor(
    private channelsService: ChannelsService,
    private engineService: EngineService,
  ) {}

  ngOnInit(): void {
    // Fetch initial tasks
    this.fetchTasks();

    // Subscribe to todo-list channel
    this.channelsService
      .subscribe("todo-list")
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: ChannelEvent) => {
        if (event.type === "state_changed") {
          const payload = event.payload as { tasks?: Task[] };
          if (payload?.tasks) {
            this.tasks = payload.tasks;
          }
        }
      });
  }

  private async fetchTasks(): Promise<void> {
    try {
      const params = new URLSearchParams();
      // Tasks are scoped by userId (not threadId)
      const userId = this.engineService.userId || "anonymous";
      params.set("userId", userId);

      // Use relative URL (proxied by Angular dev server)
      const response = await fetch(`/api/tasks?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (data.tasks) {
          this.tasks = data.tasks;
        }
      }
    } catch (err) {
      console.error("Failed to fetch initial tasks:", err);
    }
  }

  createTask(): void {
    if (!this.newTaskTitle.trim()) return;

    this.isLoading = true;

    // Optimistic update with temporary ID
    const tempTask: Task = {
      id: `temp-${Date.now()}`,
      title: this.newTaskTitle.trim(),
      description: this.newTaskDesc.trim() || undefined,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.tasks = [...this.tasks, tempTask];

    const title = this.newTaskTitle.trim();
    const description = this.newTaskDesc.trim() || undefined;
    this.newTaskTitle = "";
    this.newTaskDesc = "";

    // userId is sent via session; no need to pass here
    this.channelsService
      .publish<TaskResponse>("todo-list", "create_task", {
        title,
        description,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // Update with real tasks from server (replaces temp ID with real ID)
          if (response.tasks) {
            this.tasks = response.tasks;
          }
        },
        error: (err: Error) => {
          // Revert on error
          this.tasks = this.tasks.filter((t) => t.id !== tempTask.id);
          console.error("Failed to create task:", err);
        },
        complete: () => (this.isLoading = false),
      });
  }

  toggleComplete(task: Task): void {
    // Optimistic update
    task.completed = !task.completed;

    // userId is sent via session; no need to pass here
    this.channelsService
      .publish<TaskResponse>("todo-list", "toggle_complete", {
        task_id: task.id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // Update with server's authoritative state
          if (response.tasks) {
            this.tasks = response.tasks;
          }
        },
        error: (err: Error) => {
          // Revert on error
          task.completed = !task.completed;
          console.error("Failed to update task:", err);
        },
      });
  }

  deleteTask(task: Task): void {
    // Optimistic update
    const index = this.tasks.indexOf(task);
    this.tasks.splice(index, 1);

    // userId is sent via session; no need to pass here
    this.channelsService
      .publish<TaskResponse>("todo-list", "delete_task", {
        task_id: task.id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // Update with server's authoritative state
          if (response.tasks) {
            this.tasks = response.tasks;
          }
        },
        error: (err: Error) => {
          // Revert on error
          this.tasks.splice(index, 0, task);
          console.error("Failed to delete task:", err);
        },
      });
  }
}
