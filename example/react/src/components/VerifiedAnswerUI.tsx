import { useState, useEffect, useRef } from "react";
import type { EngineClient } from "aidk-react";
import { useExecution } from "aidk-react";

interface VerifiedAnswerUIProps {
  client: EngineClient;
}

const SAMPLE_QUESTIONS = [
  "What is the capital of Australia?",
  "How many bones are in the human body?",
  "Who was the first person on the moon?",
  "Is the Great Wall visible from space?",
];

export function VerifiedAnswerUI({ client }: VerifiedAnswerUIProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const wasStreamingRef = useRef(false);

  const { isStreaming, messages, sendMessage, clearMessages } = useExecution({
    client,
    agentId: "verified-answer",
  });

  // Parse the answer when streaming completes
  useEffect(() => {
    // Detect transition from streaming to not streaming
    if (wasStreamingRef.current && !isStreaming) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant") {
        // First, try to find JSON block with structured data
        const jsonBlock = lastMessage.content?.find(
          (b) => b.type === "json"
        ) as { type: "json"; text: string; data?: { answer: string; voteCount: number; totalVotes: number; confidence: number } } | undefined;

        if (jsonBlock?.data) {
          setAnswer(jsonBlock.data.answer);
          setConfidence(`${jsonBlock.data.voteCount}/${jsonBlock.data.totalVotes} votes (${Math.round(jsonBlock.data.confidence * 100)}%)`);
        } else {
          // Fallback: parse text content (for backward compatibility)
          const text = lastMessage.content
            ?.filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join(" ");

          if (text) {
            const answerMatch = text.match(/Answer:\s*(.+?)(?:\n|$)/i);
            const confidenceMatch = text.match(/Confidence:\s*(.+?)(?:\n|$)/i);

            if (answerMatch) {
              setAnswer(answerMatch[1].trim());
            }
            if (confidenceMatch) {
              setConfidence(confidenceMatch[1].trim());
            }
          }
        }
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isStreaming) return;

    setAnswer(null);
    setConfidence(null);
    clearMessages();

    await sendMessage(question.trim());
    setQuestion("");
  };

  return (
    <div className="verified-answer">
      <div className="verified-answer-header">
        <h2>Verified Answer</h2>
        <p className="verified-answer-desc">Get consensus-verified answers using multiple AI agents</p>
      </div>

      <form onSubmit={handleSubmit} className="verified-answer-form">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a factual question..."
          disabled={isStreaming}
        />
        <button type="submit" disabled={!question.trim() || isStreaming}>
          {isStreaming ? "Verifying..." : "Get Answer"}
        </button>
      </form>

      {!isStreaming && !answer && (
        <div className="sample-questions">
          <span className="sample-label">Try:</span>
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              className="sample-question"
              onClick={() => setQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {isStreaming && (
        <div className="verified-answer-loading">
          <div className="spinner"></div>
          <p>Running 5 agents in parallel...</p>
        </div>
      )}

      {answer && !isStreaming && (
        <div className="verified-answer-result">
          <div className="answer-box">
            <strong>Answer:</strong>
            <span className="answer-text">{answer}</span>
          </div>
          {confidence && (
            <div className="confidence-box">
              <strong>Confidence:</strong>
              <span className="confidence-text">{confidence}</span>
            </div>
          )}
          <button
            className="try-another-btn"
            onClick={() => {
              setAnswer(null);
              setConfidence(null);
              clearMessages();
            }}
          >
            Try another question
          </button>
        </div>
      )}
    </div>
  );
}
