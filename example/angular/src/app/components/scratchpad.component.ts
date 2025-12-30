import { Component, OnInit, DestroyRef, inject, Input } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ChannelsService, ExecutionService, ChannelEvent } from "aidk-angular";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";

interface ScratchpadNote {
  id: string;
  text: string;
  source: "model" | "user";
  createdAt?: string;
}

interface ScratchpadResponse {
  success: boolean;
  notes?: ScratchpadNote[];
  message?: string;
}

@Component({
  selector: "app-scratchpad",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="scratchpad" [class.expanded]="isExpanded" [class.collapsed]="!isExpanded">
      <div class="scratchpad-header" (click)="toggleExpanded()">
        <div class="scratchpad-title">
          <span>Notes</span>
          @if (notes.length > 0) {
            <span class="note-count">({{ notes.length }})</span>
          }
        </div>
        <button class="toggle-btn" [attr.aria-label]="isExpanded ? 'Collapse' : 'Expand'">
          {{ isExpanded ? '▾' : '▸' }}
        </button>
      </div>

      @if (isExpanded) {
        <div class="scratchpad-content">
          @if (notes.length === 0) {
            <div class="empty-notes">
              <p>No notes yet</p>
            </div>
          } @else {
            <div class="notes-list">
              @for (note of notes; track note.id) {
                <div class="note-item" [class.source-model]="note.source === 'model'" [class.source-user]="note.source === 'user'">
                  <span class="note-source">{{ note.source === 'model' ? 'AI' : '—' }}</span>
                  <span class="note-text">{{ note.text }}</span>
                  <button class="remove-btn" (click)="removeNote(note)" title="Remove">×</button>
                </div>
              }
            </div>
          }

          <form class="add-note-form" (ngSubmit)="addNote()">
            <input
              type="text"
              [(ngModel)]="newNoteText"
              name="noteText"
              placeholder="Add note..."
              [disabled]="isLoading"
            />
            <button type="submit" [disabled]="!newNoteText.trim() || isLoading">+</button>
          </form>

          @if (notes.length > 0) {
            <button class="clear-btn" (click)="clearNotes()">Clear</button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
    .scratchpad {
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      overflow: hidden;
    }

    .scratchpad-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
    }

    .scratchpad-header:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .scratchpad-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .scratchpad-icon {
      font-size: 12px;
      opacity: 0.7;
    }

    .note-count {
      color: rgba(255, 255, 255, 0.4);
      font-size: 11px;
      font-weight: 400;
    }

    .toggle-btn {
      background: none;
      border: none;
      font-size: 8px;
      color: rgba(255, 255, 255, 0.3);
      cursor: pointer;
      padding: 4px;
    }

    .scratchpad-content {
      padding: 0 12px 10px;
    }

    .empty-notes {
      text-align: center;
      padding: 8px 0;
      color: rgba(255, 255, 255, 0.35);
      font-size: 12px;
    }

    .empty-notes .hint {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 2px;
    }

    .notes-list {
      display: flex;
      flex-direction: column;
      margin-bottom: 8px;
      max-height: 150px;
      overflow-y: auto;
    }

    .note-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      font-size: 13px;
      line-height: 1.3;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .note-item:last-child {
      border-bottom: none;
    }

    .note-item.source-model .note-source {
      color: #60a5fa;
    }

    .note-item.source-user .note-source {
      color: #34d399;
    }

    .note-source {
      flex-shrink: 0;
      font-size: 11px;
      opacity: 0.8;
    }

    .note-text {
      flex: 1;
      color: rgba(255, 255, 255, 0.8);
      word-break: break-word;
    }

    .note-item .remove-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.3);
      font-size: 14px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;
      padding: 0;
      line-height: 1;
    }

    .note-item:hover .remove-btn {
      opacity: 1;
    }

    .note-item .remove-btn:hover {
      color: #f87171;
    }

    .add-note-form {
      display: flex;
      gap: 6px;
    }

    .add-note-form input {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      font-size: 12px;
      background: rgba(0, 0, 0, 0.2);
      color: rgba(255, 255, 255, 0.9);
    }

    .add-note-form input::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }

    .add-note-form input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.2);
    }

    .add-note-form button {
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
      border: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }

    .add-note-form button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.9);
    }

    .add-note-form button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .clear-btn {
      display: block;
      width: 100%;
      margin-top: 6px;
      padding: 4px;
      background: transparent;
      border: none;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.3);
      cursor: pointer;
    }

    .clear-btn:hover {
      color: rgba(255, 255, 255, 0.5);
    }
  `,
  ],
})
export class ScratchpadComponent implements OnInit {
  notes: ScratchpadNote[] = [];
  isLoading = false;
  isExpanded = true;
  newNoteText = "";

  private destroyRef = inject(DestroyRef);

  constructor(
    private channelsService: ChannelsService,
    private executionService: ExecutionService,
  ) {}

  ngOnInit(): void {
    // Fetch initial notes
    this.fetchNotes();

    // Subscribe to scratchpad channel
    this.channelsService
      .subscribe("scratchpad")
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: ChannelEvent) => {
        if (event.type === "state_changed") {
          const payload = event.payload as { notes?: ScratchpadNote[]; threadId?: string };
          // Only update if it's for our thread
          if (payload?.notes) {
            const eventThreadId = payload.threadId;
            if (!eventThreadId || eventThreadId === this.executionService.threadId) {
              this.notes = payload.notes;
            }
          }
        }
      });
  }

  private async fetchNotes(): Promise<void> {
    try {
      const threadId = this.executionService.threadId;
      if (!threadId) return;
      const params = new URLSearchParams();
      params.set("threadId", threadId);

      const response = await fetch(`/api/notes?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (data.notes) {
          this.notes = data.notes;
        }
      }
    } catch (err) {
      console.error("Failed to fetch initial notes:", err);
    }
  }

  toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
  }

  addNote(): void {
    if (!this.newNoteText.trim()) return;

    this.isLoading = true;
    const text = this.newNoteText.trim();
    this.newNoteText = "";

    this.channelsService
      .publish<ScratchpadResponse>("scratchpad", "add_note", {
        text,
        threadId: this.executionService.threadId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.notes) {
            this.notes = response.notes;
          }
        },
        error: (err: Error) => {
          console.error("Failed to add note:", err);
        },
        complete: () => (this.isLoading = false),
      });
  }

  removeNote(note: ScratchpadNote): void {
    // Optimistic update
    this.notes = this.notes.filter((n) => n.id !== note.id);

    this.channelsService
      .publish<ScratchpadResponse>("scratchpad", "remove_note", {
        note_id: note.id,
        threadId: this.executionService.threadId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.notes) {
            this.notes = response.notes;
          }
        },
        error: (err: Error) => {
          // Revert on error - would need to store old state
          console.error("Failed to remove note:", err);
        },
      });
  }

  clearNotes(): void {
    // Optimistic update
    const oldNotes = [...this.notes];
    this.notes = [];

    this.channelsService
      .publish<ScratchpadResponse>("scratchpad", "clear_notes", {
        threadId: this.executionService.threadId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.notes) {
            this.notes = response.notes;
          }
        },
        error: (err: Error) => {
          // Revert on error
          this.notes = oldNotes;
          console.error("Failed to clear notes:", err);
        },
      });
  }
}
