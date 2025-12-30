/**
 * ExecutionHandler - Framework-agnostic execution management
 *
 * Provides:
 * - Message accumulation
 * - Stream event processing
 * - Thread management
 * - Error handling
 *
 * Used by React hooks and Angular services for consistent behavior.
 */

import { EngineClient } from "./engine-client";
import type { Message, ContentBlock, EngineStreamEvent } from "./types";
import { normalizeMessageInput as normalizeInput, type MessageInput } from "aidk-shared";

// =============================================================================
// Message Helpers
// =============================================================================

let messageIdCounter = 0;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

/**
 * Create a Message object with generated ID and timestamp
 */
export function createMessage(
  role: Message["role"],
  content: ContentBlock[] | string,
  metadata?: Record<string, unknown>,
): Message {
  return {
    id: generateMessageId(),
    role,
    content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    createdAt: new Date().toISOString(),
    metadata,
  };
}

/**
 * Re-export MessageInput from shared for backward compatibility
 */
export type { MessageInput };

/**
 * Re-export normalizeMessageInput from shared for backward compatibility
 */
export const normalizeMessageInput = normalizeInput;

// =============================================================================
// Stream Event Types
// =============================================================================

/**
 * Generic stream event for processing
 */
export type StreamEvent = EngineStreamEvent;

/**
 * Context for processing a stream event
 */
export interface StreamEventContext {
  assistantMessage: Message;
  assistantMessageId: string;
}

// =============================================================================
// StreamProcessor - Event processing logic
// =============================================================================

export interface StreamProcessorCallbacks {
  onMessagesChange: (messages: Message[]) => void;
  onThreadIdChange?: (threadId: string | null) => void;
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
}

/**
 * Index entry for tracking tool_use block locations
 */
interface ToolUseLocation {
  messageId: string;
  blockIndex: number;
}

/**
 * StreamProcessor - Framework-agnostic stream event processor
 *
 * Handles:
 * - Message accumulation
 * - Text delta aggregation
 * - Tool call/result handling with automatic result patching
 * - Thread ID extraction
 */
export class StreamProcessor {
  private messages: Message[] = [];
  private callbacks: StreamProcessorCallbacks;

  /** Index for O(1) tool_use block lookup by toolUseId */
  private toolUseIndex = new Map<string, ToolUseLocation>();

  constructor(callbacks: StreamProcessorCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Get current messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Set the current assistant message ID being streamed (no-op, kept for API compatibility)
   */
  setCurrentAssistantId(_id: string | null): void {
    // Currently unused, but kept for potential future debugging/tracking
  }

  /**
   * Add a message to the list
   */
  addMessage(message: Message): void {
    this.messages = [...this.messages, message];
    this.callbacks.onMessagesChange(this.messages);
  }

  /**
   * Update a message by ID
   */
  updateMessage(id: string, updater: (message: Message) => Message): void {
    this.messages = this.messages.map((msg) => (msg.id === id ? updater(msg) : msg));
    this.callbacks.onMessagesChange(this.messages);
  }

  /**
   * Patch a tool_use block with its result.
   * Uses the pre-built index for O(1) lookup.
   */
  private patchToolUseWithResult(location: ToolUseLocation, result: ContentBlock): void {
    this.messages = this.messages.map((msg) => {
      if (msg.id !== location.messageId) return msg;

      return {
        ...msg,
        content: msg.content.map((block, index) => {
          if (index !== location.blockIndex || block.type !== "tool_use") return block;

          // Patch the tool_use block with the result
          return {
            ...block,
            toolResult: result,
          } as ContentBlock;
        }),
      };
    });
    this.callbacks.onMessagesChange(this.messages);
  }

  /**
   * Process a stream event and update state
   *
   * @returns Processing result with state updates
   */
  processEvent(
    event: StreamEvent,
    context: StreamEventContext,
    addedAssistantMessage: boolean,
  ): { addedAssistantMessage: boolean } {
    const { assistantMessage, assistantMessageId } = context;

    switch (event.type) {
      // =========================================================================
      // Execution Lifecycle Events
      // =========================================================================
      case "execution_start":
        // Execution started with thread context
        if (event.threadId) {
          this.callbacks.onThreadIdChange?.(event.threadId);
        }
        break;

      case "execution_end":
        // Execution ended with output
        if (event.output) {
          this.callbacks.onComplete?.(event.output);
        }
        break;

      // =========================================================================
      // Tick Lifecycle Events
      // =========================================================================
      case "tick_start":
        // New tick starting
        break;

      case "tick_end":
        // Tick completed
        break;

      // =========================================================================
      // Message Lifecycle Events
      // =========================================================================
      case "message_start":
        // Create assistant message placeholder
        if (!addedAssistantMessage) {
          this.addMessage(assistantMessage);
          addedAssistantMessage = true;
        }
        break;

      case "message_end":
        // Message ended - could extract final usage stats
        break;

      // =========================================================================
      // Content Events
      // =========================================================================
      case "content_start":
        // Content block starting
        break;

      case "content_delta":
        // Check if this is tool input streaming (blockType: 'tool_use')
        if (event.blockType === "tool_use") {
          // Tool input streaming - informational only, full input arrives via tool_call event
          break;
        }

        // Check if this is tool result content streaming (blockType: 'tool_result')
        if (event.blockType === "tool_result") {
          // Tool result content streaming - accumulate in the most recent tool_result block
          this.updateMessage(assistantMessageId, (msg) => {
            const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");
            if (toolResultBlocks.length > 0) {
              const lastToolResult = toolResultBlocks[toolResultBlocks.length - 1];
              const updatedContent = [...lastToolResult.content];
              const lastTextBlock = updatedContent[updatedContent.length - 1];
              if (lastTextBlock?.type === "text") {
                updatedContent[updatedContent.length - 1] = {
                  ...lastTextBlock,
                  text: lastTextBlock.text + event.delta,
                };
              } else {
                updatedContent.push({ type: "text", text: event.delta });
              }
              return {
                ...msg,
                content: msg.content.map((b) =>
                  b === lastToolResult ? { ...b, content: updatedContent } : b,
                ),
              };
            }
            return msg;
          });
          break;
        }

        // Regular text content delta
        this.updateMessage(assistantMessageId, (msg) => {
          const existingText = msg.content.find((b) => b.type === "text") as any;
          if (existingText) {
            return {
              ...msg,
              content: msg.content.map((b) =>
                b.type === "text" ? { ...b, text: (b as any).text + event.delta } : b,
              ),
            };
          } else {
            return {
              ...msg,
              content: [...msg.content, { type: "text", text: event.delta }],
            };
          }
        });
        break;

      case "content_end":
        // Content block ended
        break;

      // =========================================================================
      // Reasoning Events
      // =========================================================================
      case "reasoning_start":
        // Reasoning block starting
        break;

      case "reasoning_delta":
        this.updateMessage(assistantMessageId, (msg) => {
          const existingReasoning = msg.content.find((b) => b.type === "reasoning") as any;
          if (existingReasoning) {
            return {
              ...msg,
              content: msg.content.map((b) =>
                b.type === "reasoning" ? { ...b, text: (b as any).text + event.delta } : b,
              ),
            };
          } else {
            // Add reasoning block at the start of content
            return {
              ...msg,
              content: [{ type: "reasoning", text: event.delta }, ...msg.content],
            };
          }
        });
        break;

      case "reasoning_end":
        // Reasoning block ended
        break;

      // =========================================================================
      // Tool Events
      // =========================================================================
      case "tool_call": {
        // Find current block count to know where this tool_use will be
        const currentMsg = this.messages.find((m) => m.id === assistantMessageId);
        const blockIdx = currentMsg?.content.length ?? 0;

        // Register in index for O(1) lookup when result arrives
        this.toolUseIndex.set(event.callId, {
          messageId: assistantMessageId,
          blockIndex: blockIdx,
        });

        this.updateMessage(assistantMessageId, (msg) => ({
          ...msg,
          content: [
            ...msg.content,
            {
              type: "tool_use",
              toolUseId: event.callId,
              name: event.name,
              input: event.input,
            } as ContentBlock,
          ],
        }));
        break;
      }

      case "tool_result": {
        // Build the tool result block
        const resultBlock: ContentBlock = {
          type: "tool_result",
          toolUseId: event.callId,
          name: event.name,
          content: Array.isArray(event.result)
            ? event.result
            : [{ type: "text", text: String(event.result) }],
          isError: event.isError || false,
          executedBy: event.executedBy,
        };

        // Patch the tool_use block with the result (O(1) lookup)
        const location = this.toolUseIndex.get(event.callId);
        if (location) {
          this.patchToolUseWithResult(location, resultBlock);
        }

        // Also add tool result as separate message (for API/model compatibility)
        const toolMessage = createMessage("tool", [resultBlock]);
        this.addMessage(toolMessage);
        break;
      }

      case "tool_confirmation_required":
        // Tool requires user confirmation - could emit event
        break;

      case "tool_confirmation_result":
        // Confirmation result received
        break;

      // =========================================================================
      // Error Events
      // =========================================================================
      case "error":
        // Stream error from model
        this.callbacks.onError?.(new Error(event.error.message));
        break;

      case "engine_error":
        // Engine error
        this.callbacks.onError?.(new Error(event.error.message));
        break;
    }

    return { addedAssistantMessage };
  }

  /**
   * Clear all messages and reset state
   */
  clear(): void {
    this.messages = [];
    this.toolUseIndex.clear();
    this.callbacks.onMessagesChange([]);
    this.callbacks.onThreadIdChange?.(null);
  }
}

// =============================================================================
// ExecutionHandler - Full execution management with client
// =============================================================================

export interface ExecutionHandlerCallbacks extends StreamProcessorCallbacks {
  onStreamingChange?: (isStreaming: boolean) => void;
  onErrorChange?: (error: Error | null) => void;
  onEvent?: (event: StreamEvent) => void;
}

export interface ExecutionHandlerConfig {
  client: EngineClient;
  onMessagesChange: (messages: Message[]) => void;
  onStreamingChange?: (isStreaming: boolean) => void;
  onThreadIdChange?: (threadId: string | null) => void;
  onErrorChange?: (error: Error | null) => void;
  onEvent?: (event: StreamEvent) => void;
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
}

export interface SendMessageOptions {
  threadId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * ExecutionHandler - Full execution management
 *
 * Wraps EngineClient and StreamProcessor for complete execution lifecycle.
 * Framework-agnostic - used by React hooks and Angular services.
 */
export class ExecutionHandler {
  private client: EngineClient;
  private processor: StreamProcessor;
  private callbacks: ExecutionHandlerCallbacks;
  private threadId: string | null = null;
  private isStreaming = false;

  constructor(config: ExecutionHandlerConfig) {
    this.client = config.client;
    this.callbacks = {
      onMessagesChange: config.onMessagesChange,
      onStreamingChange: config.onStreamingChange,
      onThreadIdChange: (threadId) => {
        this.threadId = threadId;
        config.onThreadIdChange?.(threadId);
      },
      onErrorChange: config.onErrorChange,
      onEvent: config.onEvent,
      onComplete: config.onComplete,
      onError: (error) => {
        config.onErrorChange?.(error);
        config.onError?.(error);
      },
    };

    this.processor = new StreamProcessor({
      onMessagesChange: this.callbacks.onMessagesChange,
      onThreadIdChange: this.callbacks.onThreadIdChange,
      onComplete: this.callbacks.onComplete,
      onError: this.callbacks.onError,
    });
  }

  /**
   * Update the client instance (e.g., when config changes)
   */
  updateClient(client: EngineClient): void {
    this.client = client;
  }

  /**
   * Get current thread ID
   */
  getThreadId(): string | null {
    return this.threadId;
  }

  /**
   * Get current messages
   */
  getMessages(): Message[] {
    return this.processor.getMessages();
  }

  /**
   * Check if currently streaming
   */
  getIsStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Send a message and stream the response
   */
  async sendMessage(
    agentId: string,
    input: MessageInput,
    options: SendMessageOptions = {},
  ): Promise<void> {
    // Normalize input to messages
    const inputMessages = normalizeMessageInput(input, "user");

    // Add input messages to display
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
      threadId: options.threadId || this.threadId || undefined,
      metadata: options.metadata,
    };

    // Set streaming state
    this.isStreaming = true;
    this.callbacks.onStreamingChange?.(true);
    this.callbacks.onErrorChange?.(null);

    let addedAssistantMessage = false;

    try {
      const stream = this.client.stream(agentId, engineInput);

      for await (const event of stream) {
        // Emit raw event
        this.callbacks.onEvent?.(event as StreamEvent);

        // Process event
        const result = this.processor.processEvent(
          event as StreamEvent,
          { assistantMessage, assistantMessageId },
          addedAssistantMessage,
        );
        addedAssistantMessage = result.addedAssistantMessage;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError?.(err);
      throw error;
    } finally {
      this.isStreaming = false;
      this.callbacks.onStreamingChange?.(false);
      this.processor.setCurrentAssistantId(null);
    }
  }

  /**
   * Clear all messages and reset state
   */
  clear(): void {
    this.processor.clear();
    this.threadId = null;
    this.callbacks.onErrorChange?.(null);
  }
}
