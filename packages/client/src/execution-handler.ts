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

import { EngineClient } from './engine-client';
import type { Message, ContentBlock, EngineStreamEvent } from './types';

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
  role: Message['role'],
  content: ContentBlock[] | string,
  metadata?: Record<string, unknown>
): Message {
  return {
    id: generateMessageId(),
    role,
    content: typeof content === 'string' 
      ? [{ type: 'text', text: content }] 
      : content,
    created_at: new Date().toISOString(),
    metadata,
  };
}

/**
 * Flexible message input types
 */
export type MessageInput =
  | string                    // Simple text -> user message
  | ContentBlock              // Single block -> user message
  | ContentBlock[]            // Multiple blocks -> user message
  | Message                   // Full message
  | Message[];                // Multiple messages

/**
 * Normalize flexible input to Message array
 */
export function normalizeMessageInput(input: MessageInput, defaultRole: Message['role'] = 'user'): Message[] {
  // Already an array of messages
  if (Array.isArray(input) && input.length > 0 && 'role' in input[0]) {
    return input as Message[];
  }
  
  // Single message
  if (typeof input === 'object' && 'role' in input && 'content' in input) {
    return [input as Message];
  }
  
  // String -> text block in user message
  if (typeof input === 'string') {
    return [createMessage(defaultRole, input)];
  }
  
  // Single content block
  if (typeof input === 'object' && 'type' in input) {
    return [createMessage(defaultRole, [input as ContentBlock])];
  }
  
  // Array of content blocks
  if (Array.isArray(input)) {
    return [createMessage(defaultRole, input as ContentBlock[])];
  }
  
  throw new Error(`Invalid message input: ${typeof input}`);
}

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
  
  /** Index for O(1) tool_use block lookup by tool_use_id */
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
    this.messages = this.messages.map(msg => 
      msg.id === id ? updater(msg) : msg
    );
    this.callbacks.onMessagesChange(this.messages);
  }

  /**
   * Patch a tool_use block with its result.
   * Uses the pre-built index for O(1) lookup.
   */
  private patchToolUseWithResult(location: ToolUseLocation, result: ContentBlock): void {
    this.messages = this.messages.map(msg => {
      if (msg.id !== location.messageId) return msg;
      
      return {
        ...msg,
        content: msg.content.map((block, index) => {
          if (index !== location.blockIndex || block.type !== 'tool_use') return block;
          
          // Patch the tool_use block with the result
          return {
            ...block,
            tool_result: result,
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
    addedAssistantMessage: boolean
  ): { addedAssistantMessage: boolean } {
    const { assistantMessage, assistantMessageId } = context;

    switch (event.type) {
      case 'execution_start':
        // Execution started with thread context
        if (event.thread_id) {
          this.callbacks.onThreadIdChange?.(event.thread_id);
        }
        break;

      case 'execution_end':
        // Execution ended
        break;

      case 'agent_start':
        // Agent started - could emit event
        break;

      case 'tick_start':
        // New tick starting
        break;

      case 'model_chunk':
        // Process the chunk based on its type
        const chunk = event.chunk as any;
        if (!chunk?.type) break;
        
        switch (chunk.type) {
          // Message lifecycle - create placeholder here
          case 'message_start':
            if (!addedAssistantMessage) {
              this.addMessage(assistantMessage);
              addedAssistantMessage = true;
            }
            break;
          case 'message_end':
            // Message ended - could extract final usage stats from chunk.usage
            break;
            
          // Reasoning/thinking chunks
          case 'reasoning_start':
          case 'reasoning_delta':
          case 'reasoning_end':
            if (chunk.reasoning) {
              this.updateMessage(assistantMessageId, (msg) => {
                const existingReasoning = msg.content.find(b => b.type === 'reasoning') as any;
                if (existingReasoning) {
                  return {
                    ...msg,
                    content: msg.content.map(b => 
                      b.type === 'reasoning' 
                        ? { ...b, text: (b as any).text + chunk.reasoning }
                        : b
                    ),
                  };
                } else {
                  // Add reasoning block at the start of content
                  return {
                    ...msg,
                    content: [{ type: 'reasoning', text: chunk.reasoning }, ...msg.content],
                  };
                }
              });
            }
            break;
            
          // Content chunks
          case 'content_start':
            // Content block starting - could track by chunk.id for multi-block support
            break;
          case 'content_delta':
            if (chunk.delta) {
              // Check if this is tool input streaming (blockType: 'tool_use')
              if (chunk.blockType === 'tool_use') {
                // Tool input streaming - informational only, full input arrives via tool_call event
                break;
              }
              
              // Check if this is tool result content streaming (blockType: 'tool_result')
              if (chunk.blockType === 'tool_result') {
                // Tool result content streaming - accumulate in the most recent tool_result block
                this.updateMessage(assistantMessageId, (msg) => {
                  const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result');
                  if (toolResultBlocks.length > 0) {
                    const lastToolResult = toolResultBlocks[toolResultBlocks.length - 1];
                    // Append delta to the last text block in tool_result content, or create new text block
                    const updatedContent = [...lastToolResult.content];
                    const lastTextBlock = updatedContent[updatedContent.length - 1];
                    if (lastTextBlock?.type === 'text') {
                      updatedContent[updatedContent.length - 1] = {
                        ...lastTextBlock,
                        text: lastTextBlock.text + chunk.delta,
                      };
                    } else {
                      updatedContent.push({ type: 'text', text: chunk.delta });
                    }
                    
                    return {
                      ...msg,
                      content: msg.content.map(b => 
                        b === lastToolResult 
                          ? { ...b, content: updatedContent }
                          : b
                      ),
                    };
                  }
                  return msg;
                });
                break;
              }
              
              // Regular text content delta
              this.updateMessage(assistantMessageId, (msg) => {
                const existingText = msg.content.find(b => b.type === 'text') as any;
                if (existingText) {
                  return {
                    ...msg,
                    content: msg.content.map(b => 
                      b.type === 'text' 
                        ? { ...b, text: (b as any).text + chunk.delta }
                        : b
                    ),
                  };
                } else {
                  return {
                    ...msg,
                    content: [...msg.content, { type: 'text', text: chunk.delta }],
                  };
                }
              });
            }
            break;
          case 'content_end':
            // Content block ended
            break;
            
          // Tool-related chunks
          case 'tool_call':
            // Handled via the tool_call event type above
            break;
          case 'tool_result':
            // Provider-executed tool result (web search, code execution, etc.)
            // Add as tool_result block to assistant message
            this.updateMessage(assistantMessageId, (msg) => ({
              ...msg,
              content: [
                ...msg.content,
                {
                  type: 'tool_result',
                  tool_use_id: chunk.toolCallId,
                  name: chunk.toolName,
                  content: Array.isArray(chunk.toolResult) 
                    ? chunk.toolResult 
                    : [{ type: 'text', text: String(chunk.toolResult) }],
                  is_error: chunk.isToolError || false,
                  executed_by: chunk.providerExecuted ? 'provider' : 'engine',
                } as ContentBlock,
              ],
            }));
            break;
            
          // Step lifecycle
          case 'step_start':
            // Step starting - could emit event or track metadata
            break;
          case 'step_end':
            // Step ended - could extract usage stats from chunk.usage
            break;
            
          // Errors
          case 'error':
            if (chunk.raw?.error) {
              this.callbacks.onError?.(
                chunk.raw.error instanceof Error 
                  ? chunk.raw.error 
                  : new Error(String(chunk.raw.error))
              );
            }
            break;
        }
        break;

      case 'tool_call':
        // Find current block count to know where this tool_use will be
        const currentMsg = this.messages.find(m => m.id === assistantMessageId);
        const blockIndex = currentMsg?.content.length ?? 0;
        
        // Register in index for O(1) lookup when result arrives
        this.toolUseIndex.set(event.call.id, {
          messageId: assistantMessageId,
          blockIndex,
        });
        
        this.updateMessage(assistantMessageId, (msg) => ({
          ...msg,
          content: [
            ...msg.content,
            {
              type: 'tool_use',
              tool_use_id: event.call.id,
              name: event.call.name,
              input: event.call.input,
            } as ContentBlock,
          ],
        }));
        break;

      case 'tool_result':
        // Backend sends: { tool_use_id, name, success, content, error, executed_by }
        const toolResult = event.result as any;
        
        // Build the tool result block
        const toolResultBlock: ContentBlock = {
          type: 'tool_result',
          tool_use_id: toolResult.tool_use_id,
          name: toolResult.name,
          content: toolResult.content || [],
          is_error: !toolResult.success,
          executed_by: toolResult.executed_by,
        };
        
        // Patch the tool_use block with the result (O(1) lookup)
        const location = this.toolUseIndex.get(toolResult.tool_use_id);
        if (location) {
          this.patchToolUseWithResult(location, toolResultBlock);
        }
        
        // Also add tool result as separate message (for API/model compatibility)
        const toolResultMessage = createMessage('tool', [toolResultBlock]);
        this.addMessage(toolResultMessage);
        break;

      case 'tick_end':
        // Tick completed
        break;

      case 'agent_end':
        // Extract thread_id from result metadata
        const result = event.output as any;
        this.callbacks.onComplete?.(result);
        break;

      case 'error':
        const error = event.error instanceof Error 
          ? event.error 
          : new Error(String(event.error));
        this.callbacks.onError?.(error);
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
    options: SendMessageOptions = {}
  ): Promise<void> {
    // Normalize input to messages
    const inputMessages = normalizeMessageInput(input, 'user');

    // Add input messages to display
    for (const msg of inputMessages) {
      const displayMessage = createMessage(msg.role, msg.content);
      this.processor.addMessage(displayMessage);
    }

    // Create placeholder for assistant response
    const assistantMessage = createMessage('assistant', []);
    const assistantMessageId = assistantMessage.id!;
    this.processor.setCurrentAssistantId(assistantMessageId);

    // Build engine input
    const engineInput = {
      messages: inputMessages,
      thread_id: options.threadId || this.threadId || undefined,
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
          addedAssistantMessage
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

