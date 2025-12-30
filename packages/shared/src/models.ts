/**
 * Model Types
 *
 * Platform-independent types for model input/output and configuration.
 * Used by both backend (aidk-core) and frontend (aidk-client) for direct model execution.
 *
 * These are simplified versions that exclude backend-specific adapter concerns.
 * Backend extends these with providerOptions, libraryOptions, ephemeralConfig, etc.
 */

import type { Message } from "./messages";
import type { StopReason } from "./streaming";
import type { ModelToolCall } from "./tools";
import type { ToolDefinition } from "./tools";

// ============================================================================
// Model Tool Reference
// ============================================================================

/**
 * Reference to a tool that can be used with a model.
 * Can be a string (tool name/id), ToolDefinition, or ClientToolDefinition.
 */
export type ModelToolReference = string | ToolDefinition;

// ============================================================================
// Model Input (Simplified)
// ============================================================================

/**
 * Model input - simplified platform-independent structure.
 *
 * Used for direct model execution from clients.
 * Backend extends this with providerOptions, libraryOptions, messageTransformation, etc.
 */
export interface ModelInput {
  /**
   * Model identifier (e.g., 'gpt-4', 'claude-3-5-sonnet')
   */
  model?: string;

  /**
   * Conversation messages
   */
  messages: string | string[] | Message[];

  /**
   * System prompt (optional)
   */
  system?: string;

  /**
   * Generation parameters
   */
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];

  /**
   * Tool references
   */
  tools?: ModelToolReference[];

  /**
   * Whether to stream the response
   */
  stream?: boolean;
}

// ============================================================================
// Model Output (Simplified)
// ============================================================================

/**
 * Model output - simplified platform-independent structure.
 *
 * Used for direct model execution from clients.
 * Backend extends this with raw provider response, cacheId, etc.
 */
export interface ModelOutput {
  /**
   * Generation metadata
   */
  model: string;
  createdAt: string;

  /**
   * All messages from this model call.
   * May contain multiple messages for multi-step execution or provider-executed tools.
   * For single-turn responses, this will typically contain one assistant message.
   */
  messages?: Message[];

  /**
   * Convenience accessor for the primary assistant message.
   * When `messages` is provided, this is the last assistant-role message.
   * When `messages` is not provided, this is the single generated message.
   *
   * Use `messages` array for full conversation history or multi-message responses.
   */
  message?: Message;

  /**
   * Why generation stopped
   */
  stopReason: StopReason;

  /**
   * Token usage
   */
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
    cachedInputTokens?: number;
  };

  /**
   * Tool calls made by the model
   */
  toolCalls?: ModelToolCall[];
}

// ============================================================================
// Model Config (Simplified)
// ============================================================================

/**
 * Model configuration - simplified platform-independent structure.
 *
 * Used for model instance configuration from clients.
 * Backend extends this with providerOptions, messageTransformation, etc.
 */
export interface ModelConfig {
  /**
   * Model instance identifier
   */
  id?: string;

  /**
   * Model instance name
   */
  name?: string;

  /**
   * Model identifier (e.g., 'gpt-4', 'claude-3-5-sonnet')
   */
  model?: string;

  /**
   * Generation parameters
   */
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];

  /**
   * Tool references
   */
  tools?: ModelToolReference[];
}
