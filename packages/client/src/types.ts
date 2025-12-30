/**
 * Shared types for Engine Client
 *
 * These types define the contract between frontend clients and the Engine backend.
 * Framework-agnostic - used by React, Angular, and vanilla JS implementations.
 */

// Import platform-independent types from aidk-shared
import type {
  ContentBlock,
  Message,
  BlockType,
  MediaBlock,
  ToolBlock,
  ModelInput,
  ModelOutput,
  ModelConfig,
  ToolDefinition,
  MessageInput,
  ContentInput,
  ContentInputArray,
  TimelineEntry,
} from "aidk-shared";
import {
  StreamChunkType,
  StopReason,
  normalizeMessageInput,
  normalizeContentInput,
  normalizeContentArray,
  isMessage,
  isContentBlock,
} from "aidk-shared";
import type {
  StreamChunk,
  AgentToolCall,
  AgentToolResult,
  ClientToolDefinition,
  ToolConfirmationResult,
  EngineStreamEvent,
} from "aidk-shared";

// Re-export for convenience
export type {
  ContentBlock,
  Message,
  BlockType,
  MediaBlock,
  ToolBlock,
  StreamChunk,
  AgentToolCall,
  AgentToolResult,
  ClientToolDefinition,
  ToolConfirmationResult,
  ModelInput,
  ModelOutput,
  ModelConfig,
  ToolDefinition,
  MessageInput,
  ContentInput,
  ContentInputArray,
  TimelineEntry,
  EngineStreamEvent,
};
export {
  StreamChunkType,
  StopReason,
  normalizeMessageInput,
  normalizeContentInput,
  normalizeContentArray,
  isMessage,
  isContentBlock,
};

// =============================================================================
// Engine Input/Output Types
// =============================================================================

/**
 * Engine input for client-side execution requests.
 *
 * Can provide either:
 * - `messages`: Simple message array (converted to timeline by server)
 * - `timeline`: Unified timeline entries (matches backend format)
 *
 * Tool calls and results are embedded in message content blocks,
 * not as separate timeline entries.
 */
export interface EngineInput {
  /**
   * Simple message format - server converts to timeline
   */
  messages?: Message[];

  /**
   * Unified timeline format - matches backend COMTimelineEntry structure
   * Tool calls/results are in message content blocks (tool_use, tool_result)
   */
  timeline?: TimelineEntry[];

  /**
   * Thread ID for conversation continuity
   */
  threadId?: string;

  /**
   * Session ID for this client session
   */
  sessionId?: string;

  /**
   * User ID for user-scoped operations
   */
  userId?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

// TimelineEntry is now imported from aidk-shared (unified format)

export interface ExecutionResult {
  executionId: string;
  threadId: string;
  sessionId?: string;
  result?: {
    timeline?: TimelineEntry[];
    [key: string]: unknown;
  };
}

// =============================================================================
// Channel Types
// =============================================================================

export interface ChannelTarget {
  connectionId?: string;
  rooms?: string[];
  excludeSender?: boolean;
}

export interface ChannelEvent {
  type: string;
  channel: string;
  payload?: unknown;
  metadata?: {
    timestamp?: number;
    sourceConnectionId?: string;
    [key: string]: unknown;
  };
  target?: ChannelTarget;
}

// =============================================================================
// Persistence Types
// =============================================================================

export interface Execution {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  rootId: string;
  parentId?: string;
  threadId?: string;
  userId?: string;
  tenantId?: string;
  interactionId?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ExecutionMetrics {
  id: string;
  executionId: string;
  tenantId?: string;
  userId?: string;
  threadId?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  llmCalls: number;
  toolCalls: number;
  agentCalls: number;
  functionCalls: number;
  codeRuns: number;
  executions: number;
  requests: number;
  createdAt: string;
}

// =============================================================================
// Connection Types
// =============================================================================

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export interface ConnectionInfo {
  state: ConnectionState;
  reconnectAttempts: number;
  lastError?: Error;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
}

// =============================================================================
// Lifecycle Callbacks
// =============================================================================

export interface EngineClientCallbacks {
  /** Called when SSE connection is established */
  onConnect?: () => void;
  /** Called when SSE connection is lost */
  onDisconnect?: (reason?: string) => void;
  /** Called when attempting to reconnect */
  onReconnecting?: (attempt: number, delay: number) => void;
  /** Called when reconnection succeeds */
  onReconnected?: (attempts: number) => void;
  /** Called when max reconnect attempts exceeded (if not infinite) */
  onReconnectFailed?: (attempts: number) => void;
  /** Called on SSE error */
  onError?: (error: Event) => void;
  /** Called when browser goes offline */
  onOffline?: () => void;
  /** Called when browser comes back online */
  onOnline?: () => void;
  /** Called on any state change */
  onStateChange?: (state: ConnectionState, info: ConnectionInfo) => void;
}

// =============================================================================
// Client Configuration
// =============================================================================

export interface EngineClientConfig {
  /** Base URL for the Engine API (e.g., 'http://localhost:3001') */
  baseUrl?: string;

  /** Session ID for this client instance (auto-generated if not provided) */
  sessionId?: string;

  /** User ID for room-based channel routing (user-scoped broadcasts) */
  userId?: string;

  /** Thread ID for thread-scoped channel routing */
  threadId?: string;

  /** Tenant ID for multi-tenant setups */
  tenantId?: string;

  /** Additional metadata to include in requests */
  metadata?: Record<string, unknown>;

  // =========================================================================
  // Reconnection Settings
  // =========================================================================

  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;

  /** Maximum reconnect delay in ms (default: 5000) - caps exponential backoff */
  maxReconnectDelay?: number;

  /** Maximum reconnect attempts. 0 = infinite (default: 0) */
  maxReconnectAttempts?: number;

  // =========================================================================
  // Lifecycle Callbacks
  // =========================================================================

  /** Connection lifecycle callbacks */
  callbacks?: EngineClientCallbacks;
}
