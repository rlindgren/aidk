import { Component, DestroyRef, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ExecutionService, Message } from "aidk-angular";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Subject } from "rxjs";
import { switchMap } from "rxjs/operators";

@Component({
  selector: "app-verified-answer",
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [ExecutionService],
  template: `
    <div class="verified-answer">
      <div class="verified-answer-header">
        <h2>Verified Answer</h2>
        <p class="verified-answer-desc">Get consensus-verified answers using multiple AI agents</p>
      </div>

      <form class="verified-answer-form" (ngSubmit)="getAnswer()">
        <input
          type="text"
          [(ngModel)]="question"
          name="question"
          placeholder="Ask a factual question..."
          [disabled]="isLoading"
        />
        <button type="submit" [disabled]="!question.trim() || isLoading">
          {{ isLoading ? 'Verifying...' : 'Get Answer' }}
        </button>
      </form>

      @if (!isLoading && !answer) {
        <div class="sample-questions">
          <span class="sample-label">Try:</span>
          @for (q of sampleQuestions; track q) {
            <button class="sample-question" (click)="selectQuestion(q)">
              {{ q }}
            </button>
          }
        </div>
      }

      @if (isLoading) {
        <div class="verified-answer-loading">
          <div class="spinner"></div>
          <p>Running 5 agents in parallel...</p>
        </div>
      }

      @if (answer && !isLoading) {
        <div class="verified-answer-result">
          <div class="answer-box">
            <strong>Answer:</strong>
            <span class="answer-text">{{ answer }}</span>
          </div>
          @if (confidence) {
            <div class="confidence-box">
              <strong>Confidence:</strong>
              <span class="confidence-text">{{ confidence }}</span>
            </div>
          }
          <button class="try-another-btn" (click)="resetAnswer()">
            Try another question
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
    .verified-answer {
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
    }

    .verified-answer-header {
      padding: 16px 20px 8px;
    }

    .verified-answer-header h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    .verified-answer-desc {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .verified-answer-form {
      display: flex;
      gap: 8px;
      padding: 8px 20px 16px;
    }

    .verified-answer-form input {
      flex: 1;
      padding: 8px 12px;
      font-size: 14px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-bg);
      color: var(--color-text);
    }

    .verified-answer-form input:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    .verified-answer-form button {
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
    }

    .verified-answer-form button:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }

    .verified-answer-form button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .verified-answer-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: var(--color-text-muted);
      font-size: 14px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .verified-answer-result {
      padding: 12px 20px 16px;
    }

    .answer-box {
      display: flex;
      gap: 8px;
      padding: 12px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      margin-bottom: 8px;
    }

    .answer-box strong {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .answer-text {
      color: var(--color-text);
      font-size: 15px;
    }

    .confidence-box {
      display: flex;
      gap: 8px;
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .confidence-text {
      color: var(--color-success);
      font-weight: 500;
    }

    .try-another-btn {
      margin-top: 12px;
      padding: 8px 16px;
      font-size: 13px;
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .try-another-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .sample-questions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 0 20px 16px;
    }

    .sample-label {
      font-size: 12px;
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .sample-question {
      padding: 4px 10px;
      font-size: 12px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .sample-question:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
  `,
  ],
})
export class VerifiedAnswerComponent implements OnInit {
  question = "";
  answer: string | null = null;
  confidence: string | null = null;
  isLoading = false;

  sampleQuestions = [
    "What is the capital of Australia?",
    "How many bones are in the human body?",
    "Who was the first person on the moon?",
    "Is the Great Wall visible from space?",
  ];

  private destroyRef = inject(DestroyRef);
  private sendQuestion$ = new Subject<string>();

  constructor(private executionService: ExecutionService) {}

  ngOnInit(): void {
    // Subscribe to streaming state
    this.executionService.isStreaming$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isStreaming) => {
        this.isLoading = isStreaming;
      });

    // Subscribe to messages to extract the answer
    this.executionService.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((messages: Message[]) => {
        // Find the last assistant message
        const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
        if (lastAssistant?.content) {
          // First, try to find JSON block with structured data
          const jsonBlock = lastAssistant.content.find(
            (b: any) => b.type === "json" && b.data?.answer,
          );

          if (jsonBlock && (jsonBlock as any).data) {
            const data = (jsonBlock as any).data;
            this.answer = data.answer;
            this.confidence = `${data.voteCount}/${data.totalVotes} votes (${Math.round(data.confidence * 100)}%)`;
          } else {
            // Fallback: parse text content (for backward compatibility)
            const text = lastAssistant.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join(" ");
            if (text) {
              this.parseAnswer(text);
            }
          }
        }
      });

    // Handle question submission
    this.sendQuestion$
      .pipe(
        switchMap((text) => this.executionService.sendMessage("verified-answer", text)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: (err) => console.error("Failed to get verified answer:", err),
      });
  }

  selectQuestion(q: string): void {
    this.question = q;
  }

  getAnswer(): void {
    if (!this.question.trim() || this.isLoading) return;

    // Reset state before sending
    this.answer = null;
    this.confidence = null;

    const questionText = this.question.trim();
    this.question = "";

    // Clear previous messages and send new question
    this.executionService.clearMessages();
    this.sendQuestion$.next(questionText);
  }

  resetAnswer(): void {
    this.answer = null;
    this.confidence = null;
    this.executionService.clearMessages();
  }

  private parseAnswer(text: string): void {
    const answerMatch = text.match(/Answer:\s*(.+?)(?:\n|$)/i);
    const confidenceMatch = text.match(/Confidence:\s*(.+?)(?:\n|$)/i);

    if (answerMatch) {
      this.answer = answerMatch[1].trim();
    }
    if (confidenceMatch) {
      this.confidence = confidenceMatch[1].trim();
    }
  }
}
