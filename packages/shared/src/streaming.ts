/**
 * Streaming Types
 *
 * Platform-independent types for streaming model responses.
 * Used by both backend (aidk-core) and frontend (aidk-client).
 */

import type { ContentBlock } from "./blocks";
import type { BlockType, BlockTypes } from "./block-types";
import type { Message } from "./messages";
import type { ModelToolCall } from "./tools";

/**
 * Stream chunk type enumeration.
 * Defines all possible chunk types in the streaming protocol.
 */
export enum StreamChunkType {
  ERROR = "error",
  CONTENT_DELTA = "content_delta",
  CONTENT_START = "content_start",
  CONTENT_END = "content_end",
  CONTENT = "content",
  MESSAGE_START = "message_start",
  MESSAGE_END = "message_end",
  MESSAGE = "message",
  TOOL_INPUT_START = "tool_input_start",
  TOOL_INPUT_DELTA = "tool_input_delta",
  TOOL_INPUT_END = "tool_input_end",
  TOOL_CALL = "tool_call",
  TOOL_RESULT = "tool_result",
  REASONING_START = "reasoning_start",
  REASONING_DELTA = "reasoning_delta",
  REASONING_END = "reasoning_end",
  STEP_START = "step_start",
  STEP_END = "step_end",
}

/**
 * Stop reason enumeration.
 * Defines why model generation stopped.
 */
export enum StopReason {
  MAX_TOKENS = "max_tokens",
  STOP_SEQUENCE = "stop_sequence",
  CONTENT_FILTER = "content_filter",
  TOOL_USE = "tool_use",
  FUNCTION_CALL = "function_call",
  UNSPECIFIED = "unspecified",
  OTHER = "other",
  STOP = "stop",
  PAUSED = "paused",
  FORMAT_ERROR = "format_error",
  EMPTY_RESPONSE = "empty_response",
  NO_CONTENT = "no_content",
  EXPLICIT_COMPLETION = "explicit_completion",
  NATURAL_COMPLETION = "natural_completion",
  ERROR = "error",
}

/**
 * Stream chunk (normalized across all providers).
 *
 * This is the platform-independent contract for streaming chunks
 * between backend and frontend.
 */
export interface StreamChunk {
  type:
    | StreamChunkType
    | "error"
    | "content_delta"
    | "content_start"
    | "content_end"
    | "content"
    | "message_start"
    | "message_end"
    | "message"
    | "tool_input_start"
    | "tool_input_delta"
    | "tool_input_end"
    | "tool_call"
    | "tool_result"
    | "reasoning_start"
    | "reasoning_delta"
    | "reasoning_end"
    | "step_start"
    | "step_end";
  delta?: string; // content delta for content type
  reasoning?: string; // reasoning delta for reasoning types
  reasoningId?: string; // ID for reasoning block (from AI SDK)
  id?: string; // refers to message.id for message types and content.id for content types
  toolCallId?: string; // toolUseId for tool_result chunks
  toolName?: string; // tool name for tool_result chunks
  toolResult?: any; // tool result content for tool_result chunks
  isToolError?: boolean; // whether tool_result is an error
  providerExecuted?: boolean; // whether tool was executed by provider (web search, code execution, etc)
  model?: string;
  stopReason?: StopReason;
  messageId?: string; // message.id of content type's message
  message?: Message; // full message object for message type
  blockType?: BlockType | BlockTypes; // block.type for content type (e.g., 'tool_use' for tool-input-delta)
  mimeType?: string; // mime type for content type
  block?: ContentBlock; // full content block for content type
  index?: number; // content block position within message (useful for ordering)
  createdAt?: string; // ISO 8601 UTC timestamp when chunk was created/emitted
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
    cachedInputTokens?: number;
  };
  toolCalls?: ModelToolCall[];
  stepRequest?: any; // request metadata for step_start
  stepResponse?: any; // response metadata for step_end
  stepWarnings?: any[]; // warnings for step_start
  raw?: any; // Raw provider chunk or final assembled response
  [key: string]: any;
}
