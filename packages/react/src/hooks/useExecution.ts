/**
 * React hook for Agent execution
 * 
 * Provides high-level execution management with:
 * - Message accumulation
 * - Streaming state
 * - Error handling
 * - Thread management
 * 
 * Uses the framework-agnostic ExecutionHandler under the hood.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { EngineClient, ExecutionHandler } from 'aidk-client';
import type { Message, EngineStreamEvent, MessageInput } from 'aidk-client';

export interface UseExecutionOptions {
  /** Engine client instance */
  client: EngineClient;
  /** Agent ID to execute */
  agentId: string;
  /** Callback for each stream event */
  onEvent?: (event: EngineStreamEvent) => void;
  /** Callback when execution completes */
  onComplete?: (result: any) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export interface UseExecutionReturn {
  /** 
   * Send a message and stream the response.
   * 
   * @param input - Flexible message input:
   *   - string: Converted to TextBlock in user message
   *   - ContentBlock: Single block in user message
   *   - ContentInput[]: Array of blocks in user message
   *   - Message: Full message with role
   *   - Message[]: Multiple messages
   * @param threadId - Optional thread ID override
   */
  sendMessage: (input: MessageInput, threadId?: string) => Promise<void>;
  /** Whether currently streaming */
  isStreaming: boolean;
  /** Accumulated messages */
  messages: Message[];
  /** Current thread ID */
  threadId: string | null;
  /** Last error */
  error: Error | null;
  /** Clear messages and reset state */
  clearMessages: () => void;
}

/**
 * Hook for managing agent execution with message accumulation
 * 
 * @example
 * ```tsx
 * function Chat() {
 *   const { client } = useEngineClient({ ... });
 *   
 *   const { 
 *     sendMessage, 
 *     isStreaming, 
 *     messages, 
 *     error 
 *   } = useExecution({
 *     client,
 *     agentId: 'task-assistant',
 *   });
 *   
 *   return (
 *     <div>
 *       {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
 *       {isStreaming && <LoadingIndicator />}
 *       <input onSubmit={(text) => sendMessage(text)} disabled={isStreaming} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useExecution(options: UseExecutionOptions): UseExecutionReturn {
  const { client, agentId, onEvent, onComplete, onError } = options;
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  // Persist callbacks in refs to avoid recreation of handler
  const callbacksRef = useRef({ onEvent, onComplete, onError });
  callbacksRef.current = { onEvent, onComplete, onError };
  
  // Create the handler once and update it when client changes
  const handlerRef = useRef<ExecutionHandler | null>(null);
  
  if (!handlerRef.current) {
    handlerRef.current = new ExecutionHandler({
      client,
      onMessagesChange: setMessages,
      onStreamingChange: setIsStreaming,
      onThreadIdChange: setThreadId,
      onErrorChange: setError,
      onEvent: (event) => callbacksRef.current.onEvent?.(event),
      onComplete: (result) => callbacksRef.current.onComplete?.(result),
      onError: (error) => callbacksRef.current.onError?.(error),
    });
  }
  
  // Update client reference if it changes
  useEffect(() => {
    handlerRef.current?.updateClient(client);
  }, [client]);

  const sendMessage = useCallback(
    async (input: MessageInput, explicitThreadId?: string): Promise<void> => {
      await handlerRef.current?.sendMessage(agentId, input, {
        threadId: explicitThreadId,
      });
    },
    [agentId]
  );

  const clearMessages = useCallback(() => {
    handlerRef.current?.clear();
  }, []);

  return {
    sendMessage,
    isStreaming,
    messages,
    threadId,
    error,
    clearMessages,
  };
}
