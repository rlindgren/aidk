/**
 * Angular Service for Agent Execution
 *
 * Provides high-level execution management with:
 * - Message accumulation
 * - Streaming state
 * - Thread management
 * - Observable-based API
 *
 * Uses the framework-agnostic StreamProcessor for event handling.
 */

import { Injectable, type OnDestroy } from "@angular/core";
import { BehaviorSubject, Subject, Observable, throwError } from "rxjs";
import { takeUntil, tap, finalize, catchError } from "rxjs/operators";
import { EngineService } from "./engine.service";
import {
  type Message,
  StreamProcessor,
  type StreamEvent,
  createMessage,
  normalizeMessageInput,
} from "aidk-client";
import type { EngineStreamEvent, MessageInput } from "aidk-client";

@Injectable()
export class ExecutionService implements OnDestroy {
  private destroy$ = new Subject<void>();
  private processor: StreamProcessor;

  private messagesSubject = new BehaviorSubject<Message[]>([]);
  private isStreamingSubject = new BehaviorSubject<boolean>(false);
  private threadIdSubject = new BehaviorSubject<string | null>(null);
  private errorSubject = new BehaviorSubject<Error | null>(null);

  /** Observable of accumulated messages */
  readonly messages$ = this.messagesSubject.asObservable();

  /** Observable of streaming state */
  readonly isStreaming$ = this.isStreamingSubject.asObservable();

  /** Observable of current thread ID */
  readonly threadId$ = this.threadIdSubject.asObservable();

  /** Observable of last error */
  readonly error$ = this.errorSubject.asObservable();

  /** Current messages snapshot */
  get messages(): Message[] {
    return this.messagesSubject.getValue();
  }

  /** Current streaming state */
  get isStreaming(): boolean {
    return this.isStreamingSubject.getValue();
  }

  /** Current thread ID */
  get threadId(): string | null {
    return this.threadIdSubject.getValue();
  }

  constructor(private engineService: EngineService) {
    this.processor = new StreamProcessor({
      onMessagesChange: (messages) => this.messagesSubject.next(messages),
      onThreadIdChange: (threadId) => {
        this.threadIdSubject.next(threadId);
        this.engineService.updateConfig({ threadId: threadId || undefined });
      },
      onComplete: () => {
        // Handled via finalize in the observable chain
      },
      onError: (error) => this.errorSubject.next(error),
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Send a message and stream the response
   *
   * @param agentId - The agent to execute
   * @param input - Flexible message input:
   *   - string: Converted to TextBlock in user message
   *   - ContentBlock: Single block in user message
   *   - ContentInput[]: Array of blocks in user message
   *   - Message: Full message with role
   *   - Message[]: Multiple messages
   * @param threadId - Optional thread ID override
   */
  sendMessage(
    agentId: string,
    input: MessageInput,
    threadId?: string,
  ): Observable<EngineStreamEvent> {
    // Normalize input to messages
    const inputMessages = normalizeMessageInput(input, "user");

    // Add all input messages to the display
    for (const msg of inputMessages) {
      const displayMessage = createMessage(msg.role, msg.content);
      this.processor.addMessage(displayMessage);
    }

    // Create placeholder for assistant response
    const assistantMessage = createMessage("assistant", []);
    const assistantMessageId = assistantMessage.id!;
    this.processor.setCurrentAssistantId(assistantMessageId);

    // Build engine input
    const engineInput = {
      messages: inputMessages,
      threadId: threadId || this.threadId || undefined,
      sessionId: this.engineService.sessionId,
      userId: this.engineService.userId,
    };

    this.isStreamingSubject.next(true);
    this.errorSubject.next(null);

    // Track whether assistant message has been added
    let addedAssistantMessage = false;

    return this.engineService.stream(agentId, engineInput).pipe(
      tap((event) => {
        const result = this.processor.processEvent(
          event as StreamEvent,
          { assistantMessage, assistantMessageId },
          addedAssistantMessage,
        );
        addedAssistantMessage = result.addedAssistantMessage;
      }),
      finalize(() => {
        this.isStreamingSubject.next(false);
        this.processor.setCurrentAssistantId(null);
      }),
      takeUntil(this.destroy$),
      catchError((error: any) => {
        console.error("Error sending message to agent:", error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Clear all messages and reset state
   */
  clearMessages(): void {
    this.processor.clear();
    this.threadIdSubject.next(null);
    this.errorSubject.next(null);
  }
}
