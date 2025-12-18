import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExecutionService, Message, ContentBlockComponent } from 'aidk-angular';
import { Subject } from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScratchpadComponent } from './scratchpad.component';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, ScratchpadComponent, ContentBlockComponent],
  template: `
    <div class="chat-interface">
      <div class="chat-header">
        <h2>Task Assistant</h2>
        <button 
          class="clear-btn" 
          (click)="clearChat()" 
          [disabled]="isStreaming"
        >
          Clear Chat
        </button>
      </div>

      <!-- Thread-scoped scratchpad - fixed above messages -->
      <div class="chat-top-content">
        <app-scratchpad></app-scratchpad>
      </div>

      <div class="messages-container" #messagesContainer>
        @if (displayMessages.length === 0) {
          <div class="empty-state">
            <p>Start a conversation with the Task Assistant.</p>
            <p class="hint">
              Try: "Create a task to buy groceries" or "List all my tasks"
            </p>
          </div>
        }

        @for (message of displayMessages; track message.id) {
          <div class="message" [class.user]="message.role === 'user'" [class.assistant]="message.role !== 'user'">
            <div class="message-role">{{ getRoleLabel(message) }}</div>
            <div class="message-content">
              @for (block of message.content; track $index) {
                <aidk-content-block [block]="block" />
              }
            </div>
          </div>
        }

        @if (isStreaming) {
          <div class="streaming-indicator">
            <span class="thinking-label">Thinking</span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        }
      </div>

      <form class="input-form" (ngSubmit)="sendMessage()">
        <input
          type="text"
          [(ngModel)]="inputValue"
          name="message"
          placeholder="Type your message..."
          [disabled]="isStreaming"
          autocomplete="off"
        />
        <button type="submit" [disabled]="!inputValue.trim() || isStreaming">
          {{ isStreaming ? 'Sending...' : 'Send' }}
        </button>
      </form>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .chat-interface {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .chat-header {
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-border);
    }

    .chat-header h2 {
      font-size: 18px;
      font-weight: 600;
    }

    .clear-btn {
      background: transparent;
      color: var(--color-text-muted);
      font-size: 13px;
      padding: 6px 12px;
    }

    .clear-btn:hover:not(:disabled) {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    .chat-top-content {
      flex-shrink: 0;
      border-bottom: 1px solid var(--color-border);
    }

    .messages-container {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 20px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 200px;
      text-align: center;
      padding: 40px 20px;
      color: var(--color-text-muted);
    }

    .empty-state .hint {
      font-size: 13px;
      margin-top: 8px;
      font-style: italic;
    }

    .message {
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
    }

    .message.user {
      background: var(--color-user-bg);
      margin-left: 40px;
    }

    .message.assistant {
      background: var(--color-assistant-bg);
      margin-right: 40px;
    }

    .message-role {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .message-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Markdown styling - Enhanced for better readability */
    .message-content :deep(*) {
      margin-top: 0;
      margin-bottom: 0;
    }

    .message-content :deep(* + *) {
      margin-top: 0.5rem;
    }

    .message-content :deep(h1),
    .message-content :deep(h2),
    .message-content :deep(h3),
    .message-content :deep(h4),
    .message-content :deep(h5),
    .message-content :deep(h6) {
      margin-top: 1.25rem;
      margin-bottom: 0.75rem;
      font-weight: 600;
      line-height: 1.2;
      color: inherit;
    }

    .message-content :deep(h1:first-child),
    .message-content :deep(h2:first-child),
    .message-content :deep(h3:first-child) {
      margin-top: 0;
    }

    .message-content :deep(h1) { 
      font-size: 1.75em; 
      font-weight: 700;
      border-bottom: 2px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 0.5rem;
    }

    .message-content :deep(h2) { 
      font-size: 1.5em; 
      font-weight: 700;
    }

    .message-content :deep(h3) { 
      font-size: 1.25em; 
      font-weight: 600;
    }

    .message-content :deep(h4) { 
      font-size: 1.1em; 
      font-weight: 600;
    }

    .message-content :deep(p) {
      margin: 0.75rem 0;
      line-height: 1.7;
      word-wrap: break-word;
    }

    .message-content :deep(p:first-child) {
      margin-top: 0;
    }

    .message-content :deep(p:last-child) {
      margin-bottom: 0;
    }

    .message-content :deep(ul),
    .message-content :deep(ol) {
      margin: 0.75rem 0;
      padding-left: 1.75rem;
      line-height: 1.7;
    }

    .message-content :deep(ul:first-child),
    .message-content :deep(ol:first-child) {
      margin-top: 0;
    }

    .message-content :deep(li) {
      margin: 0.5rem 0;
      line-height: 1.7;
      padding-left: 0.25rem;
    }

    .message-content :deep(li > p) {
      margin: 0.5rem 0;
    }

    .message-content :deep(li > ul),
    .message-content :deep(li > ol) {
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .message-content :deep(code) {
      background: rgba(0, 0, 0, 0.15);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
      color: inherit;
      font-weight: 500;
    }

    .message.user .message-content :deep(code) {
      background: rgba(255, 255, 255, 0.2);
    }

    .message-content :deep(pre) {
      background: rgba(0, 0, 0, 0.15);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .message.user .message-content :deep(pre) {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .message-content :deep(pre code) {
      background: none;
      padding: 0;
      font-size: 0.875em;
      line-height: 1.6;
      display: block;
    }

    .message-content :deep(blockquote) {
      border-left: 4px solid rgba(255, 255, 255, 0.4);
      padding: 0.75rem 1rem;
      margin: 1rem 0;
      background: rgba(0, 0, 0, 0.1);
      border-radius: 0 6px 6px 0;
      font-style: italic;
    }

    .message.user .message-content :deep(blockquote) {
      background: rgba(255, 255, 255, 0.1);
      border-left-color: rgba(255, 255, 255, 0.5);
    }

    .message-content :deep(blockquote p:last-child) {
      margin-bottom: 0;
    }

    .message-content :deep(strong),
    .message-content :deep(b) {
      font-weight: 700;
      color: inherit;
    }

    .message-content :deep(em),
    .message-content :deep(i) {
      font-style: italic;
    }

    .message-content :deep(a) {
      color: inherit;
      text-decoration: underline;
      text-decoration-color: rgba(255, 255, 255, 0.4);
      text-underline-offset: 2px;
      transition: text-decoration-color 0.2s;
    }

    .message-content :deep(a:hover) {
      text-decoration-color: rgba(255, 255, 255, 0.8);
    }

    .message-content :deep(table) {
      border-collapse: collapse;
      margin: 1rem 0;
      width: 100%;
      font-size: 0.95em;
    }

    .message-content :deep(th),
    .message-content :deep(td) {
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 0.625rem 0.75rem;
      text-align: left;
      line-height: 1.5;
    }

    .message-content :deep(th) {
      font-weight: 600;
      background: rgba(0, 0, 0, 0.15);
      border-bottom-width: 2px;
    }

    .message.user .message-content :deep(th) {
      background: rgba(255, 255, 255, 0.15);
    }

    .message-content :deep(tr:hover) {
      background: rgba(0, 0, 0, 0.05);
    }

    .message.user .message-content :deep(tr:hover) {
      background: rgba(255, 255, 255, 0.05);
    }

    .message-content :deep(hr) {
      border: none;
      border-top: 2px solid rgba(255, 255, 255, 0.15);
      margin: 1.5rem 0;
    }

    .message-content :deep(img) {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      margin: 1rem 0;
    }

    .streaming-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 16px;
      color: var(--color-text-muted);
    }

    .thinking-label {
      font-size: 13px;
      font-style: italic;
    }

    .dot {
      width: 6px;
      height: 6px;
      background: var(--color-primary);
      border-radius: 50%;
      animation: pulse 1.4s infinite ease-in-out;
    }

    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    .dot:nth-child(4) { animation-delay: 0.6s; }

    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    .input-form {
      flex-shrink: 0;
      display: flex;
      gap: 12px;
      padding: 16px 20px;
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
    }

    .input-form input {
      flex: 1;
    }

    .input-form button {
      background: var(--color-primary);
      color: white;
      min-width: 100px;
    }

    .input-form button:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }
  `],
})
export class ChatComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  messages: Message[] = [];
  isStreaming = false;
  inputValue = '';

  private shouldScrollToBottom = false;
  private sendMessage$ = new Subject<string>();
  private destroyRef = inject(DestroyRef);

  constructor(private executionService: ExecutionService) {}

  ngOnInit(): void {
    this.executionService.messages$.pipe(
      takeUntilDestroyed(this.destroyRef),
      map((messages: Message[]) => messages.filter((message) => message.role !== 'tool'))
    ).subscribe((messages) => {
      this.messages = messages;
      this.shouldScrollToBottom = true;
    });

    this.executionService.isStreaming$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((isStreaming) => {
      this.isStreaming = isStreaming;
    });

    this.sendMessage$.pipe(
      switchMap(text => this.executionService.sendMessage('task-assistant', text)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      error: (err) => console.error('Stream error:', err),
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  sendMessage(): void {
    if (!this.inputValue.trim()) return;
    this.sendMessage$.next(this.inputValue.trim());
    this.inputValue = '';
  }

  clearChat(): void {
    this.executionService.clearMessages();
  }

  private scrollToBottom(): void {
    try {
      const container = this.messagesContainer?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    } catch {
      // Ignore scroll errors
    }
  }

  /** Filter out empty messages */
  get displayMessages(): Message[] {
    return this.messages.filter(m => m.content.length > 0);
  }

  /** Get display label for message role */
  getRoleLabel(message: Message): string {
    switch (message.role) {
      case 'user': return 'You';
      case 'tool': return 'Tool Result';
      case 'system': return 'System';
      default: return 'Assistant';
    }
  }
}
