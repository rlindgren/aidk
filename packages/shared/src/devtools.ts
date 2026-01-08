/**
 * DevTools Event Types and Emitter
 *
 * This module provides the event types and singleton emitter for DevTools integration.
 * The engine emits events to this emitter, and DevTools subscribes to receive them.
 *
 * @module aidk-shared/devtools
 */

import type { TokenUsage, Message, ToolDefinition } from "./index";

// ============================================================================
// Constants
// ============================================================================

/**
 * DevTools channel name - used for engine to emit events
 */
export const DEVTOOLS_CHANNEL = "__devtools__";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Base fields present on all DevTools events
 */
export interface DevToolsEventBase {
  /** Discriminator for event type */
  type: string;
  /** UUID of the execution context */
  executionId: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  // ─────────────────────────────────────────────────────────────────────────────
  // Optional telemetry fields (auto-populated from context when available)
  // ─────────────────────────────────────────────────────────────────────────────
  /** Trace ID for distributed tracing correlation */
  traceId?: string;
  /** Request ID for this execution context */
  requestId?: string;
  /** Parent execution ID for nested executions (fork, spawn, component_tool) */
  parentExecutionId?: string;
  /** Current procedure ID */
  procedureId?: string;
  /** User ID from context (for attribution and multi-tenant filtering) */
  userId?: string;
  /** Tenant ID from context (for multi-tenant dashboards) */
  tenantId?: string;
}

/**
 * Execution context fields for events in an execution tree
 */
export interface ExecutionContextFields {
  /** Parent execution ID (for fork/spawn) */
  parentExecutionId?: string;
  /** Root of the execution tree */
  rootExecutionId?: string;
  /** Engine instance ID (constant across executions) */
  engineId?: string;
  /** OpenTelemetry trace ID if available */
  traceId?: string;
}

// ============================================================================
// Lifecycle Events
// ============================================================================

export interface DTExecutionStartEvent extends DevToolsEventBase, ExecutionContextFields {
  type: "execution_start";
  /** Component/agent name */
  agentName: string;
  /** User session ID if available */
  sessionId?: string;
  /** Type of execution */
  executionType?: "root" | "fork" | "spawn";
}

export interface DTExecutionEndEvent extends DevToolsEventBase {
  type: "execution_end";
  /** Cumulative token usage across all ticks */
  totalUsage: TokenUsage;
  /** Final execution state */
  finalState?: "completed" | "cancelled" | "error";
  /** Error details if finalState is 'error' */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ============================================================================
// Tick Events
// ============================================================================

export interface DTTickStartEvent extends DevToolsEventBase {
  type: "tick_start";
  /** 1-indexed tick number */
  tick: number;
}

export interface DTTickEndEvent extends DevToolsEventBase {
  type: "tick_end";
  tick: number;
  /** Token usage for this tick */
  usage?: TokenUsage;
  /** Stop reason: "end_turn", "tool_use", "max_tokens", etc. */
  stopReason?: string;
  /** Model ID used this tick */
  model?: string;
}

// ============================================================================
// Compilation Events
// ============================================================================

export interface DTCompiledEvent extends DevToolsEventBase {
  type: "compiled";
  tick: number;
  /** Full conversation history */
  messages: Message[];
  /** Available tools */
  tools: ToolDefinition[];
  /** System prompt */
  system?: string;
}

// ============================================================================
// Model Events
// ============================================================================

export interface DTModelStartEvent extends DevToolsEventBase {
  type: "model_start";
  tick: number;
  /** Model identifier, e.g., "claude-3-5-sonnet-20241022" */
  modelId: string;
  /** Provider name, e.g., "anthropic", "openai" */
  provider?: string;
}

export interface DTModelRequestEvent extends DevToolsEventBase {
  type: "model_request";
  tick: number;
  /** The formatted input in AIDK format (before provider transformation) */
  input?: {
    /** Messages array in AIDK format */
    messages?: unknown[];
    /** System prompt */
    system?: string;
    /** Tools available */
    tools?: unknown[];
    /** Other model parameters */
    [key: string]: unknown;
  };
}

export interface DTProviderRequestEvent extends DevToolsEventBase {
  type: "provider_request";
  /** Model ID */
  modelId?: string;
  /** Provider name (e.g., "openai", "anthropic", "google") */
  provider?: string;
  /** The actual input sent to the provider (after transformation)
   * This is the exact shape the provider SDK receives (e.g., AI SDK format for Gemini)
   */
  providerInput?: unknown;
}

export interface DTProviderResponseEvent extends DevToolsEventBase {
  type: "provider_response";
  tick: number;
  /** Model ID */
  modelId?: string;
  /** Provider name (e.g., "openai", "anthropic", "google") */
  provider?: string;
  /** Raw provider response before AIDK transformation */
  providerOutput?: unknown;
}

export interface DTModelResponseEvent extends DevToolsEventBase {
  type: "model_response";
  tick: number;
  /** Complete assistant message in AIDK format */
  message: Message;
}

// ============================================================================
// Streaming Events
// ============================================================================

export interface DTContentDeltaEvent extends DevToolsEventBase {
  type: "content_delta";
  tick: number;
  /** Incremental text content */
  delta: string;
  /** Which content block (for multi-block responses) */
  blockIndex?: number;
}

export interface DTReasoningDeltaEvent extends DevToolsEventBase {
  type: "reasoning_delta";
  tick: number;
  /** Incremental reasoning/thinking content */
  delta: string;
}

// ============================================================================
// Tool Events
// ============================================================================

export interface DTToolCallEvent extends DevToolsEventBase {
  type: "tool_call";
  tick: number;
  toolName: string;
  /** Unique ID for this tool invocation */
  toolUseId: string;
  /** Tool input (JSON-serializable) */
  input: unknown;
  /** Tool execution type */
  executionType?: "server" | "client" | "provider" | "mcp";
}

export interface DTToolResultEvent extends DevToolsEventBase {
  type: "tool_result";
  tick: number;
  /** Matches the tool_call */
  toolUseId: string;
  /** Tool output (JSON-serializable) */
  result: unknown;
  /** True if tool threw an error */
  isError?: boolean;
  /** Execution time in milliseconds */
  durationMs?: number;
}

export interface DTToolConfirmationEvent extends DevToolsEventBase {
  type: "tool_confirmation";
  tick: number;
  toolUseId: string;
  toolName: string;
  input: unknown;
  /** Message shown to user */
  confirmationMessage?: string;
  status: "pending" | "approved" | "denied";
}

// ============================================================================
// State Events
// ============================================================================

export interface DTStateChangeEvent extends DevToolsEventBase {
  type: "state_change";
  tick: number;
  /** Signal/state key */
  key: string;
  oldValue: unknown;
  newValue: unknown;
  /** Source of the change */
  source?: "signal" | "reducer" | "effect";
}

// ============================================================================
// Procedure Events (from kernel-level observability)
// ============================================================================

/**
 * Emitted when any procedure starts execution.
 * This captures model calls, tool executions, engine operations, etc.
 */
export interface DTProcedureStartEvent extends DevToolsEventBase {
  type: "procedure_start";
  /** Unique procedure instance ID */
  procedureId: string;
  /** Procedure name (e.g., 'model:stream', 'tool:calculator') */
  procedureName: string;
  /** Procedure type from metadata */
  procedureType?: string;
  /** Parent procedure ID for call tree */
  parentProcedureId?: string;
  /** Additional metadata from the procedure */
  metadata?: Record<string, unknown>;
  /** Engine tick number when this procedure started (if within a tick) */
  tick?: number;
}

/**
 * Emitted when a procedure completes successfully.
 */
export interface DTProcedureEndEvent extends DevToolsEventBase {
  type: "procedure_end";
  procedureId: string;
  procedureName?: string;
  status: "completed";
  /** Metrics accumulated during execution */
  metrics?: Record<string, number>;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Engine tick number when this procedure ended (if within a tick) */
  tick?: number;
}

/**
 * Emitted when a procedure fails with an error.
 */
export interface DTProcedureErrorEvent extends DevToolsEventBase {
  type: "procedure_error";
  procedureId: string;
  procedureName?: string;
  status: "failed" | "cancelled";
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  /** Metrics accumulated before failure */
  metrics?: Record<string, number>;
  /** Engine tick number when this procedure failed (if within a tick) */
  tick?: number;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * All DevTools event types
 */
export type DevToolsEvent =
  | DTExecutionStartEvent
  | DTExecutionEndEvent
  | DTTickStartEvent
  | DTTickEndEvent
  | DTCompiledEvent
  | DTModelStartEvent
  | DTModelRequestEvent
  | DTProviderRequestEvent
  | DTProviderResponseEvent
  | DTModelResponseEvent
  | DTContentDeltaEvent
  | DTReasoningDeltaEvent
  | DTToolCallEvent
  | DTToolResultEvent
  | DTToolConfirmationEvent
  | DTStateChangeEvent
  | DTProcedureStartEvent
  | DTProcedureEndEvent
  | DTProcedureErrorEvent;

// ============================================================================
// DevTools Configuration
// ============================================================================

/**
 * Configuration for DevTools integration in the engine
 */
export interface DevToolsConfig {
  /** Enable DevTools (default: true when config object is provided) */
  enabled?: boolean;
  /** Channel name (default: '__devtools__') */
  channel?: string;
  /** Enable remote mode (POST to remote server) */
  remote?: boolean;
  /** Remote server URL (required if remote: true) */
  remoteUrl?: string;
  /** Shared secret for remote authentication */
  secret?: string;
  /** Inherit devTools config on fork (default: true) */
  inheritOnFork?: boolean;
  /** Inherit devTools config on spawn (default: true) */
  inheritOnSpawn?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// DevTools Emitter Singleton
// ============================================================================

/**
 * Subscriber callback type
 */
export type DevToolsSubscriber = (event: DevToolsEvent) => void;

/**
 * Batch subscriber callback type
 */
export type DevToolsBatchSubscriber = (events: DevToolsEvent[]) => void;

/**
 * DevTools event emitter singleton.
 *
 * Engines emit events to this emitter, and DevTools subscribes to receive them.
 * This enables engine-agnostic instrumentation without tight coupling.
 *
 * This implementation is platform-agnostic (no Node.js dependencies) so it can
 * be used in both server and browser environments.
 *
 * @example
 * ```typescript
 * // Engine emits events
 * devToolsEmitter.emitEvent({
 *   type: 'execution_start',
 *   executionId: 'abc-123',
 *   agentName: 'MyAgent',
 *   timestamp: Date.now(),
 * });
 *
 * // DevTools subscribes
 * const unsubscribe = devToolsEmitter.subscribe((event) => {
 *   console.log('Event:', event.type);
 * });
 * ```
 */
class DevToolsEmitterImpl {
  private static instance: DevToolsEmitterImpl;
  private debug = false;

  // Subscribers
  private eventSubscribers: Set<DevToolsSubscriber> = new Set();
  private batchSubscribers: Set<DevToolsBatchSubscriber> = new Set();

  // Batching for high-frequency events
  private batchBuffer: DevToolsEvent[] = [];
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW_MS = 10;

  // History for late-joining subscribers
  private eventHistory: DevToolsEvent[] = [];
  private readonly MAX_HISTORY_SIZE = 1000;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): DevToolsEmitterImpl {
    if (!DevToolsEmitterImpl.instance) {
      DevToolsEmitterImpl.instance = new DevToolsEmitterImpl();
    }
    return DevToolsEmitterImpl.instance;
  }

  /**
   * Enable or disable debug mode
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * Emit a DevTools event.
   *
   * High-frequency events (content_delta, reasoning_delta) are batched
   * to reduce overhead. Other events are emitted immediately.
   */
  emitEvent(event: DevToolsEvent): void {
    try {
      // Add to history
      this.eventHistory.push(event);
      if (this.eventHistory.length > this.MAX_HISTORY_SIZE) {
        this.eventHistory.shift();
      }

      // High-frequency events get batched
      if (event.type === "content_delta" || event.type === "reasoning_delta") {
        this.batchBuffer.push(event);
        this.scheduleBatchFlush();
      } else {
        // Low-frequency events emit immediately (flush any pending batch first)
        this.flushBatch();
        this.notifySubscribers(event);
      }

      if (this.debug) {
        console.log("[DevTools] Emitted:", event.type, event.executionId);
      }
    } catch (error) {
      // Never throw - devtools is optional infrastructure
      if (this.debug) {
        console.warn("[DevTools] Emission error:", error);
      }
    }
  }

  private notifySubscribers(event: DevToolsEvent): void {
    for (const handler of this.eventSubscribers) {
      try {
        handler(event);
      } catch (error) {
        if (this.debug) {
          console.warn("[DevTools] Subscriber error:", error);
        }
      }
    }
  }

  private notifyBatchSubscribers(events: DevToolsEvent[]): void {
    for (const handler of this.batchSubscribers) {
      try {
        handler(events);
      } catch (error) {
        if (this.debug) {
          console.warn("[DevTools] Batch subscriber error:", error);
        }
      }
    }
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimeout) return;
    this.batchTimeout = setTimeout(() => {
      this.flushBatch();
    }, this.BATCH_WINDOW_MS);
  }

  private flushBatch(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batchBuffer.length === 0) return;

    // Emit each event individually for simple subscribers
    for (const event of this.batchBuffer) {
      this.notifySubscribers(event);
    }

    // Also emit as batch for batch-aware subscribers
    this.notifyBatchSubscribers(this.batchBuffer);
    this.batchBuffer = [];
  }

  /**
   * Subscribe to DevTools events
   *
   * @returns Unsubscribe function
   */
  subscribe(handler: DevToolsSubscriber): () => void {
    this.eventSubscribers.add(handler);
    return () => {
      this.eventSubscribers.delete(handler);
    };
  }

  /**
   * Subscribe to batched events (for high-frequency event handling)
   *
   * @returns Unsubscribe function
   */
  subscribeBatch(handler: DevToolsBatchSubscriber): () => void {
    this.batchSubscribers.add(handler);
    return () => {
      this.batchSubscribers.delete(handler);
    };
  }

  /**
   * Get event history (for late-joining subscribers)
   *
   * @param executionId - Optional filter by execution ID
   */
  getHistory(executionId?: string): DevToolsEvent[] {
    if (!executionId) return [...this.eventHistory];
    return this.eventHistory.filter((e) => e.executionId === executionId);
  }

  /**
   * Clear all state (useful for testing)
   */
  clear(): void {
    this.eventHistory = [];
    this.batchBuffer = [];
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.eventSubscribers.clear();
    this.batchSubscribers.clear();
  }

  /**
   * Check if there are any subscribers
   */
  hasSubscribers(): boolean {
    return this.eventSubscribers.size > 0;
  }
}

/**
 * Singleton DevTools emitter instance.
 *
 * Use this to emit events from engines or subscribe to events in DevTools.
 */
export const devToolsEmitter = DevToolsEmitterImpl.getInstance();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize DevTools config from various input formats.
 *
 * @param config - true, false, undefined, or DevToolsConfig object
 * @returns Normalized DevToolsConfig or false if disabled
 */
export function normalizeDevToolsConfig(
  config: boolean | DevToolsConfig | undefined,
): DevToolsConfig | false {
  if (config === false) return false;
  if (config === undefined) return false;

  if (config === true) {
    return {
      enabled: true,
      inheritOnFork: true,
      inheritOnSpawn: true,
    };
  }

  return {
    enabled: config.enabled !== false,
    channel: config.channel || DEVTOOLS_CHANNEL,
    remote: config.remote || false,
    remoteUrl: config.remoteUrl,
    secret: config.secret,
    inheritOnFork: config.inheritOnFork !== false,
    inheritOnSpawn: config.inheritOnSpawn !== false,
    debug: config.debug || false,
  };
}
