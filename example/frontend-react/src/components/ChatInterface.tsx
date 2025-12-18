import { useState, useRef, useEffect, ReactNode } from 'react';
import { type Message, ContentBlockList } from 'aidk-react';

interface ChatInterfaceProps {
  messages: Message[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onClear?: () => void;
  /** Optional content to render at the top of the messages area (e.g., scratchpad) */
  topContent?: ReactNode;
}

export function ChatInterface({
  messages,
  isStreaming,
  onSendMessage,
  onClear,
  topContent,
}: ChatInterfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  // Filter out empty messages (no content blocks)
  const displayMessages = messages.filter(m => m.content.length > 0);

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>Task Assistant</h2>
        {onClear && (
          <button onClick={onClear} className="clear-btn" disabled={isStreaming}>
            Clear Chat
          </button>
        )}
      </div>

      {/* Thread-scoped content like scratchpad - fixed above messages */}
      {topContent && <div className="chat-top-content">{topContent}</div>}

      <div className="messages-container">
        {displayMessages.length === 0 && (
          <div className="empty-state">
            <p>Start a conversation with the Task Assistant.</p>
            <p className="hint">
              Try: "Create a task to buy groceries" or "List all my tasks"
            </p>
          </div>
        )}

        {displayMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}


        {isStreaming && (
          <div className="streaming-indicator">
            <span className="thinking-label">Thinking</span>
            <span className="dot"></span>
            <span className="dot"></span>
            <span className="dot"></span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type your message..."
          disabled={isStreaming}
          autoFocus
        />
        <button type="submit" disabled={!inputValue.trim() || isStreaming}>
          {isStreaming ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  
  // Determine the display role label
  const roleLabel = isUser ? 'You' : isTool ? 'Tool Result' : 'Assistant';
  const roleClass = isUser ? 'user' : 'assistant';

  return (
    <div className={`message ${roleClass}`}>
      <div className="message-role">{roleLabel}</div>
      <div className="message-content">
        <ContentBlockList blocks={message.content} gap="8px" />
      </div>
    </div>
  );
}
