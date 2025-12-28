/**
 * Tool Types
 *
 * Platform-independent types for tool calling.
 * Used by both backend (aidk-core) and frontend (aidk-client).
 */

import type { ContentBlock } from "./blocks";

/**
 * Tool execution type determines how and where the tool is executed.
 */
export enum ToolExecutionType {
  /**
   * Server-executed: Tool runs on the engine server (default).
   * Tool has a `run` method that executes synchronously.
   */
  SERVER = "server",

  /**
   * Client-executed: Tool call is delegated to client/3rd party.
   * May or may not require feedback before continuing execution.
   */
  CLIENT = "client",

  /**
   * Provider-executed: Tool is executed by the model provider (e.g., Google grounding).
   * Tool results come directly from provider, bypassing ToolExecutor.
   */
  PROVIDER = "provider",

  /**
   * MCP-executed: Tool is executed by an MCP (Model Context Protocol) server.
   * Engine acts as MCP client, forwarding calls to external MCP servers.
   */
  MCP = "mcp",
}

/**
 * Tool intent describes WHAT the tool does, independent of WHERE it runs.
 * Used by clients to determine how to render/handle tool calls.
 */
export enum ToolIntent {
  /**
   * Renders UI in the client (form, chart, document, code output).
   * The tool_use block becomes renderable content.
   */
  RENDER = "render",

  /**
   * Performs an action (navigate, clipboard, notification, native feature).
   * Side-effect focused, may not produce visible output.
   */
  ACTION = "action",

  /**
   * Computes/transforms data (default for most tools).
   * Returns data that becomes part of the conversation.
   */
  COMPUTE = "compute",
}

/**
 * Model tool call - represents a tool call made by the model.
 * Platform-independent structure used in streaming and execution.
 */
export interface ModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Agent tool call - represents a tool call in the agent execution context.
 * Used in stream events and execution tracking.
 */
export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  toolResult?: AgentToolResult;
}

/**
 * Agent tool result - represents the result of a tool execution.
 * Used in stream events and execution tracking.
 */
export interface AgentToolResult {
  id?: string;
  /** ID of the tool call this result is for (matches AgentToolCall.id) */
  toolUseId: string;
  name: string;
  success: boolean;
  content: ContentBlock[]; // Tool results are ContentBlock[] instead of raw output
  error?: string; // Error message if success is false

  /**
   * Who executed this tool.
   * - 'engine': Executed by Engine's ToolExecutor
   * - 'provider': Executed by the LLM provider (e.g., OpenAI code interpreter)
   * - 'adapter': Executed by the model adapter library (e.g., AI SDK with maxSteps > 1)
   * - 'client': Executed by the client (browser/frontend)
   */
  executedBy?: "engine" | "provider" | "adapter" | "client";

  /**
   * Execution metadata for observability.
   */
  metadata?: {
    executionTimeMs?: number;
    retryCount?: number;
    cacheHit?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Simplified tool definition - platform-independent base structure.
 * Used for direct tool execution from clients.
 *
 * Backend extends this with providerOptions, libraryOptions, mcpConfig.
 */
export interface ToolDefinition {
  /** Tool name */
  name: string;
  /** Tool description for the model */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: Record<string, unknown>;
  /**
   * Tool execution type. Determines how the tool is executed.
   * Default: SERVER (engine executes tool.run on server).
   */
  type?: ToolExecutionType;
  /**
   * Tool intent describes what the tool does (render, action, compute).
   * Used by clients to determine how to render/handle tool calls.
   * Default: COMPUTE
   */
  intent?: ToolIntent;
  /**
   * Whether execution should wait for client response.
   * Only applicable for CLIENT type tools.
   * - true: Server pauses and waits for tool_result from client (e.g., forms)
   * - false: Server continues immediately with defaultResult (e.g., charts)
   * Default: false
   */
  requiresResponse?: boolean;
  /**
   * Timeout in milliseconds when waiting for client response.
   * Only applicable when requiresResponse is true.
   * Default: 30000 (30 seconds)
   */
  timeout?: number;
  /**
   * Default result to use when requiresResponse is false.
   * Returned immediately for render tools that don't need client feedback.
   * Default: [{ type: 'text', text: '[{name} rendered on client]' }]
   */
  defaultResult?: ContentBlock[];
}

/**
 * Client tool definition - sent by clients to declare available tools.
 * Simplified interface for client-provided tools.
 *
 * Note: This is the platform-independent structure. Backend-specific
 * fields (like providerOptions) are added when converting to ToolDefinition.
 */
export interface ClientToolDefinition {
  /** Tool name */
  name: string;
  /** Tool description for the model */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: Record<string, unknown>;
  /**
   * Tool intent (render, action, compute).
   * Default: RENDER (most client tools render UI)
   */
  intent?: ToolIntent;
  /**
   * Whether server should wait for client response.
   * Default: false (render tools return default result immediately)
   */
  requiresResponse?: boolean;
  /**
   * Timeout in ms when waiting for response.
   * Default: 30000
   */
  timeout?: number;
  /**
   * Default result when requiresResponse is false.
   * Default: [{ type: 'text', text: '[{name} rendered on client]' }]
   */
  defaultResult?: ContentBlock[];
}

// ============================================================================
// Tool Confirmation Types
// ============================================================================

/**
 * Response from client when confirming/denying a tool execution.
 * Sent via POST /api/channels/tool-confirmation.
 */
export interface ToolConfirmationResponse {
  /** ID of the tool call being confirmed */
  toolUseId: string;
  /** Whether the tool execution is allowed */
  confirmed: boolean;
  /**
   * If true, remember this decision for future calls to this tool.
   * Application should persist this preference.
   */
  always?: boolean;
}

/**
 * Result of a tool confirmation, includes tool metadata for hooks/events.
 * Used internally and in stream events.
 */
export interface ToolConfirmationResult {
  /** ID of the tool call */
  toolUseId: string;
  /** Name of the tool */
  toolName: string;
  /** Whether the tool execution was allowed */
  confirmed: boolean;
  /** Whether this is a persistent preference */
  always: boolean;
}
