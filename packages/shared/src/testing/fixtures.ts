/**
 * Test Fixtures
 *
 * Factory functions for creating test data with sensible defaults.
 * All functions accept partial overrides for flexibility.
 */

import type {
  ContentBlock,
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  CodeBlock,
} from "../blocks";
import type { Message } from "../messages";
import { StreamChunkType, StopReason, type StreamChunk } from "../streaming";
import type { ToolDefinition, AgentToolCall, AgentToolResult } from "../tools";

// =============================================================================
// ID Generation
// =============================================================================

let idCounter = 0;

/**
 * Generate a unique test ID
 */
export function testId(prefix: string = "test"): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Reset the ID counter (call in beforeEach)
 */
export function resetTestIds(): void {
  idCounter = 0;
}

// =============================================================================
// Content Block Fixtures
// =============================================================================

/**
 * Create a text block
 */
export function createTextBlock(
  text: string = "Test text content",
  overrides: Partial<TextBlock> = {},
): TextBlock {
  return {
    type: "text",
    text,
    ...overrides,
  };
}

/**
 * Create an image block with URL source
 */
export function createImageBlock(
  url: string = "https://example.com/image.png",
  overrides: Partial<ImageBlock> = {},
): ImageBlock {
  return {
    type: "image",
    source: { type: "url", url },
    ...overrides,
  };
}

/**
 * Create an image block with base64 source
 */
export function createBase64ImageBlock(
  data: string = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  mimeType: string = "image/png",
  overrides: Partial<ImageBlock> = {},
): ImageBlock {
  return {
    type: "image",
    source: { type: "base64", data, mimeType },
    ...overrides,
  };
}

/**
 * Create a tool use block
 */
export function createToolUseBlock(
  name: string = "test_tool",
  input: Record<string, unknown> = {},
  overrides: Partial<ToolUseBlock> = {},
): ToolUseBlock {
  return {
    type: "tool_use",
    toolUseId: overrides.toolUseId ?? testId("tool-use"),
    name,
    input,
    ...overrides,
  };
}

/**
 * Create a tool result block
 */
export function createToolResultBlock(
  toolUseId: string,
  content: ContentBlock[] = [createTextBlock("Tool result")],
  overrides: Partial<ToolResultBlock> = {},
): ToolResultBlock {
  return {
    type: "tool_result",
    toolUseId,
    name: overrides.name ?? "test_tool",
    content,
    isError: false,
    ...overrides,
  };
}

/**
 * Create an error tool result block
 */
export function createErrorToolResultBlock(
  toolUseId: string,
  errorMessage: string = "Tool execution failed",
  overrides: Partial<ToolResultBlock> = {},
): ToolResultBlock {
  return createToolResultBlock(toolUseId, [createTextBlock(errorMessage)], {
    ...overrides,
    isError: true,
  });
}

/**
 * Create a reasoning block
 */
export function createReasoningBlock(
  text: string = "Let me think about this...",
  overrides: Partial<ReasoningBlock> = {},
): ReasoningBlock {
  return {
    type: "reasoning",
    text,
    ...overrides,
  };
}

/**
 * Create a code block
 */
export function createCodeBlock(
  text: string = "console.log('Hello');",
  language: string = "typescript",
  overrides: Partial<CodeBlock> = {},
): CodeBlock {
  return {
    type: "code",
    text,
    language: language as any,
    ...overrides,
  };
}

// =============================================================================
// Message Fixtures
// =============================================================================

/**
 * Create a user message
 */
export function createUserMessage(
  content: string | ContentBlock[] = "Hello",
  overrides: Partial<Message> = {},
): Message {
  const contentBlocks = typeof content === "string" ? [createTextBlock(content)] : content;

  return {
    id: overrides.id ?? testId("msg"),
    role: "user",
    content: contentBlocks,
    ...overrides,
  };
}

/**
 * Create an assistant message
 */
export function createAssistantMessage(
  content: string | ContentBlock[] = "Hello! How can I help?",
  overrides: Partial<Message> = {},
): Message {
  const contentBlocks = typeof content === "string" ? [createTextBlock(content)] : content;

  return {
    id: overrides.id ?? testId("msg"),
    role: "assistant",
    content: contentBlocks,
    ...overrides,
  };
}

/**
 * Create a system message
 */
export function createSystemMessage(
  content: string = "You are a helpful assistant.",
  overrides: Partial<Message> = {},
): Message {
  return {
    id: overrides.id ?? testId("msg"),
    role: "system",
    content: [createTextBlock(content)],
    ...overrides,
  };
}

/**
 * Create a tool message (tool result)
 */
export function createToolMessage(
  toolUseId: string,
  content: ContentBlock[] = [createTextBlock("Tool result")],
  overrides: Partial<Message> = {},
): Message {
  return {
    id: overrides.id ?? testId("msg"),
    role: "tool",
    content,
    ...overrides,
  };
}

/**
 * Create a conversation (array of messages)
 */
export function createConversation(
  exchanges: Array<{ user: string; assistant: string }>,
): Message[] {
  const messages: Message[] = [];

  for (const exchange of exchanges) {
    messages.push(createUserMessage(exchange.user));
    messages.push(createAssistantMessage(exchange.assistant));
  }

  return messages;
}

// =============================================================================
// Tool Fixtures
// =============================================================================

/**
 * Create a tool definition
 */
export function createToolDefinition(
  name: string = "test_tool",
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name,
    description: overrides.description ?? `A test tool called ${name}`,
    parameters: overrides.parameters ?? {
      type: "object",
      properties: {
        input: { type: "string", description: "Input value" },
      },
      required: ["input"],
    },
    ...overrides,
  };
}

/**
 * Create an agent tool call
 */
export function createAgentToolCall(
  name: string = "test_tool",
  input: Record<string, unknown> = { input: "test" },
  overrides: Partial<AgentToolCall> = {},
): AgentToolCall {
  return {
    id: overrides.id ?? testId("call"),
    name,
    input,
    ...overrides,
  };
}

/**
 * Create an agent tool result
 */
export function createAgentToolResult(
  toolUseId: string,
  content: ContentBlock[] = [createTextBlock("Result")],
  overrides: Partial<AgentToolResult> = {},
): AgentToolResult {
  return {
    toolUseId,
    name: overrides.name ?? "test_tool",
    success: overrides.success ?? true,
    content,
    ...overrides,
  };
}

// =============================================================================
// Stream Event Fixtures
// =============================================================================

/**
 * Create a stream chunk
 */
export function createStreamChunk(
  type: StreamChunk["type"],
  overrides: Partial<StreamChunk> = {},
): StreamChunk {
  return {
    type,
    ...overrides,
  };
}

/**
 * Create a text delta chunk
 */
export function createTextDeltaChunk(
  delta: string,
  overrides: Partial<StreamChunk> = {},
): StreamChunk {
  return createStreamChunk(StreamChunkType.CONTENT_DELTA, {
    delta,
    ...overrides,
  });
}

/**
 * Create a message start chunk
 */
export function createMessageStartChunk(
  id: string = testId("msg"),
  overrides: Partial<StreamChunk> = {},
): StreamChunk {
  return createStreamChunk(StreamChunkType.MESSAGE_START, { id, ...overrides });
}

/**
 * Create a message end chunk
 */
export function createMessageEndChunk(
  stopReason: StopReason = StopReason.STOP,
  overrides: Partial<StreamChunk> = {},
): StreamChunk {
  return createStreamChunk(StreamChunkType.MESSAGE_END, {
    stopReason,
    ...overrides,
  });
}

/**
 * Create a tool call chunk
 */
export function createToolCallChunk(
  toolName: string,
  toolCallId: string = testId("call"),
  overrides: Partial<StreamChunk> = {},
): StreamChunk {
  return createStreamChunk(StreamChunkType.TOOL_CALL, {
    toolName,
    toolCallId,
    ...overrides,
  });
}

/**
 * Create a tool result chunk
 */
export function createToolResultChunk(
  toolCallId: string,
  toolResult: unknown,
  overrides: Partial<StreamChunk> = {},
): StreamChunk {
  return createStreamChunk(StreamChunkType.TOOL_RESULT, {
    toolCallId,
    toolResult,
    ...overrides,
  });
}

/**
 * Create a sequence of stream chunks for a simple text response
 */
export function createTextStreamSequence(text: string, chunkSize: number = 10): StreamChunk[] {
  const chunks: StreamChunk[] = [createMessageStartChunk()];

  // Split text into chunks
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(createTextDeltaChunk(text.slice(i, i + chunkSize)));
  }

  chunks.push(createMessageEndChunk(StopReason.STOP));

  return chunks;
}

/**
 * Create a sequence of stream chunks for a tool call response
 */
export function createToolCallStreamSequence(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: unknown,
): StreamChunk[] {
  const toolCallId = testId("call");

  return [
    createMessageStartChunk(),
    createToolCallChunk(toolName, toolCallId),
    createStreamChunk(StreamChunkType.TOOL_INPUT_START, { toolCallId }),
    createStreamChunk(StreamChunkType.TOOL_INPUT_DELTA, {
      toolCallId,
      delta: JSON.stringify(toolInput),
    }),
    createStreamChunk(StreamChunkType.TOOL_INPUT_END, { toolCallId }),
    createToolResultChunk(toolCallId, toolResult),
    createMessageEndChunk(StopReason.TOOL_USE),
  ];
}
