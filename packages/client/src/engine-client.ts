/**
 * EngineClient - Opinionated client for Engine backend
 *
 * Built on core primitives (SSETransport, ChannelClient) with conventions:
 * - Default routes for agents, channels, executions
 * - Session/user/tenant context enrichment
 * - Streaming agent execution
 *
 * For custom routes or different transports, use the core primitives directly.
 *
 * @example
 * ```typescript
 * // Use with defaults
 * const client = new EngineClient({
 *   baseUrl: 'http://localhost:3001',
 *   userId: 'user-123',
 * });
 *
 * // Customize routes
 * const client = new EngineClient({
 *   baseUrl: 'http://localhost:3001',
 *   routes: {
 *     agentExecute: (id) => `/custom/agents/${id}/run`,
 *     channelsSse: () => `/v2/events/stream`,
 *   },
 * });
 *
 * // Or use core primitives for full control
 * import { SSETransport, ChannelClient } from './core';
 * const transport = new SSETransport({ ... });
 * const channels = new ChannelClient({ transport });
 * ```
 */

import { AbortError, TransportError } from "aidk-shared";
import {
  SSETransport,
  ChannelClient,
  type ChannelTransport,
  type ChannelEvent,
  type TransportState,
  type TransportInfo,
  type TransportCallbacks,
} from "./core";
import type { EngineStreamEvent, EngineInput } from "./types";

// Re-export core types
export type { ChannelEvent, TransportState, TransportInfo };

// Re-export as connection types for backwards compatibility
export type ConnectionState = TransportState;
export type ConnectionInfo = TransportInfo;
export type EngineClientCallbacks = TransportCallbacks;

// =============================================================================
// Types
// =============================================================================

export interface EngineRoutes {
  /** Agent execute endpoint: (agentId) => path */
  agentExecute?: (agentId: string) => string;
  /** Agent stream endpoint: (agentId) => path */
  agentStream?: (agentId: string) => string;
  /** Channels SSE endpoint: () => path */
  channelsSse?: () => string;
  /** Channels publish endpoint: () => path */
  channelsPublish?: () => string;
  /** Tool results endpoint: () => path */
  toolResults?: () => string;
  /** Tool confirmation endpoint: () => path */
  toolConfirmation?: () => string;
  /** Executions list endpoint: () => path */
  executionsList?: () => string;
  /** Execution by ID endpoint: (id) => path */
  executionById?: (id: string) => string;
  /** Metrics endpoint: () => path */
  metricsEndpoint?: () => string;
}

/**
 * Custom API implementations - override default fetch-based methods
 */
export interface EngineClientApi {
  /** Custom execution list fetcher */
  getExecutions?: (params?: Record<string, unknown>) => Promise<Execution[]>;
  /** Custom single execution fetcher */
  getExecution?: (id: string) => Promise<Execution>;
  /** Custom metrics fetcher */
  getMetrics?: (
    params?: Record<string, unknown>,
  ) => Promise<ExecutionMetrics[]>;
}

export interface EngineClientConfig {
  /** Base URL for API requests */
  baseUrl?: string;

  /** Session ID (auto-generated if not provided) */
  sessionId?: string;

  /** User ID for context enrichment */
  userId?: string;

  /** Tenant ID for multi-tenant apps */
  tenantId?: string;

  /** Thread ID for conversation context */
  threadId?: string;

  /** Additional metadata to include in requests */
  metadata?: Record<string, unknown>;

  /** Custom route builders (optional) */
  routes?: EngineRoutes;

  // =========================================================================
  // Transport Layer (optional - sensible defaults if not provided)
  // =========================================================================

  /**
   * Pre-configured ChannelClient.
   * If provided, transport is ignored and this is used directly.
   */
  channels?: ChannelClient;

  /**
   * Pre-configured transport.
   * If provided (and channels is not), this transport is used.
   * Otherwise, an SSETransport is created with default settings.
   */
  transport?: ChannelTransport;

  // =========================================================================
  // API Layer (optional - override default implementations)
  // =========================================================================

  /**
   * Custom API implementations.
   * Override individual methods or provide your own implementations.
   */
  api?: EngineClientApi;

  // =========================================================================
  // Connection Settings
  // =========================================================================

  /** Reconnection settings (only used if transport not provided) */
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  maxReconnectAttempts?: number;

  /**
   * Request timeout in milliseconds (default: 30000).
   * Applies to execute and stream fetch requests.
   * Set to 0 to disable timeout.
   */
  requestTimeout?: number;

  /** Lifecycle callbacks */
  callbacks?: EngineClientCallbacks;
}

// Default route builders
const DEFAULT_ROUTES: Required<EngineRoutes> = {
  agentExecute: (agentId) => `/api/agents/${agentId}/execute`,
  agentStream: (agentId) => `/api/agents/${agentId}/stream`,
  channelsSse: () => "/api/channels/sse",
  channelsPublish: () => "/api/channels/events",
  toolResults: () => "/api/channels/tool-results",
  toolConfirmation: () => "/api/channels/tool-confirmation",
  executionsList: () => "/api/executions",
  executionById: (id) => `/api/executions/${id}`,
  metricsEndpoint: () => "/api/executions/metrics",
};

// Note: EngineInput imported from ./types

export interface ExecutionResult {
  timeline: unknown[];
  metrics?: unknown;
}

export interface Execution {
  id: string;
  threadId?: string;
  userId?: string;
  tenantId?: string;
  status: string;
  createdAt: string;
  completed_at?: string;
}

export interface ExecutionMetrics {
  executionId: string;
  inputTokens?: number;
  outputTokens?: number;
  duration_ms?: number;
}

// =============================================================================
// Implementation
// =============================================================================

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface ResolvedConfig {
  baseUrl: string;
  sessionId: string;
  userId?: string;
  tenantId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
  routes: Required<EngineRoutes>;
  api: EngineClientApi;
  reconnectDelay: number;
  maxReconnectDelay: number;
  maxReconnectAttempts: number;
  requestTimeout: number;
  callbacks: EngineClientCallbacks;
}

export class EngineClient {
  private config: ResolvedConfig;
  private transport?: ChannelTransport;
  private channels: ChannelClient;
  private ownsTransport: boolean; // Track if we created the transport (for cleanup)

  constructor(config: EngineClientConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || "",
      sessionId: config.sessionId || generateUUID(),
      userId: config.userId,
      tenantId: config.tenantId,
      threadId: config.threadId,
      metadata: config.metadata,
      routes: { ...DEFAULT_ROUTES, ...config.routes },
      api: config.api || {},
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectDelay: config.maxReconnectDelay ?? 5000, // Cap at 5s
      maxReconnectAttempts: config.maxReconnectAttempts ?? 0,
      requestTimeout: config.requestTimeout ?? 30000, // 30 seconds default
      callbacks: config.callbacks || {},
    };

    // Use provided ChannelClient, or create one
    if (config.channels) {
      // User provided their own ChannelClient - use it directly
      this.channels = config.channels;
      this.ownsTransport = false;
    } else {
      // Use provided transport or create SSETransport
      if (config.transport) {
        // Wrap the provided transport's send() to enrich with metadata
        const originalSend = config.transport.send.bind(config.transport);
        const enrichedSend = <T = unknown>(data: unknown): Promise<T> => {
          const enriched = this.enrichChannelEvent(data);
          return originalSend(enriched) as Promise<T>;
        };

        // Create a wrapper that uses enriched send
        this.transport = {
          ...config.transport,
          send: enrichedSend,
        } as ChannelTransport;
        this.ownsTransport = false;
      } else {
        // Create default SSE transport with enriched send
        this.transport = new SSETransport({
          buildUrl: () => this.buildSseUrl(),
          send: (data) => this.httpPublish(this.enrichChannelEvent(data)),
          callbacks: this.config.callbacks,
          reconnectDelay: this.config.reconnectDelay,
          maxReconnectDelay: this.config.maxReconnectDelay,
          maxReconnectAttempts: this.config.maxReconnectAttempts,
        });
        this.ownsTransport = true;
      }

      // Create channel client with the transport
      this.channels = new ChannelClient({
        transport: this.transport,
        // No publish override - transport.send() handles it
      });
    }
  }

  /**
   * Enrich channel event with metadata (sessionId, userId, etc.)
   * This ensures any transport (custom or default) receives enriched data
   */
  private enrichChannelEvent(data: unknown): unknown {
    // If it's a channel event structure, enrich it
    if (
      typeof data === "object" &&
      data !== null &&
      "channel" in data &&
      "type" in data
    ) {
      return {
        ...(data as Record<string, unknown>),
        sessionId: this.config.sessionId,
        userId: this.config.userId,
        tenantId: this.config.tenantId,
      };
    }
    // Otherwise return as-is
    return data;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update client configuration.
   * Only triggers reconnect if userId or threadId actually changed.
   */
  updateConfig(updates: Partial<EngineClientConfig>): void {
    // Check if identity values actually changed BEFORE applying updates
    const userIdChanged =
      updates.userId !== undefined && updates.userId !== this.config.userId;
    const threadIdChanged =
      updates.threadId !== undefined &&
      updates.threadId !== this.config.threadId;

    // Apply callback/route/api updates
    if (updates.callbacks) {
      this.config.callbacks = {
        ...this.config.callbacks,
        ...updates.callbacks,
      };
    }
    if (updates.routes) {
      this.config.routes = { ...this.config.routes, ...updates.routes };
    }
    if (updates.api) {
      this.config.api = { ...this.config.api, ...updates.api };
    }

    // Apply scalar updates
    const { callbacks, routes, api, channels, transport, ...rest } = updates;
    Object.assign(this.config, rest);

    // Only reconnect if identity actually changed - room memberships depend on these
    if (userIdChanged || threadIdChanged) {
      this.channels.reconnect();
    }
  }

  getSessionId(): string {
    return this.config.sessionId;
  }

  getUserId(): string | undefined {
    return this.config.userId;
  }

  // ===========================================================================
  // Request Helpers
  // ===========================================================================

  /**
   * Fetch with timeout support.
   * If requestTimeout is 0, no timeout is applied.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const timeout = this.config.requestTimeout;

    if (timeout <= 0) {
      return fetch(url, options);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw AbortError.timeout(timeout);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // Agent Execution
  // ===========================================================================

  /**
   * Execute an agent (non-streaming)
   */
  async execute(agentId: string, input: EngineInput): Promise<ExecutionResult> {
    const enrichedInput = this.enrichInput(input);
    const url = `${this.config.baseUrl}${this.config.routes.agentExecute(agentId)}`;

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enrichedInput),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        message: string;
      };
      throw TransportError.http(
        response.status,
        url,
        error.message || "Execution failed",
      );
    }

    return response.json() as Promise<ExecutionResult>;
  }

  /**
   * Stream agent execution
   */
  async *stream(
    agentId: string,
    input: EngineInput,
  ): AsyncGenerator<EngineStreamEvent> {
    const enrichedInput = this.enrichInput(input);
    const url = `${this.config.baseUrl}${this.config.routes.agentStream(agentId)}`;

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enrichedInput),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        message: string;
      };
      throw TransportError.http(
        response.status,
        url,
        error.message || "Stream failed",
      );
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new TransportError("response", "No response body", { url });
    }

    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            yield JSON.parse(line.slice(6));
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  }

  private enrichInput(input: EngineInput): EngineInput {
    const userId = input.userId || this.config.userId;
    return {
      ...input,
      sessionId: input.sessionId || this.config.sessionId,
      userId,
      metadata: {
        ...this.config.metadata,
        ...input.metadata,
        userId: userId,
        tenantId: this.config.tenantId,
      },
    };
  }

  // ===========================================================================
  // Channel Subscriptions
  // ===========================================================================

  /**
   * Subscribe to channel events
   */
  subscribe(
    channelFilter: string | string[],
    handler: (event: ChannelEvent) => void,
  ): () => void {
    return this.channels.subscribe(channelFilter, handler);
  }

  /**
   * Publish an event to a channel
   */
  async publish<T = unknown>(
    channel: string,
    type: string,
    payload?: unknown,
    _options?: { excludeSender?: boolean },
  ): Promise<T> {
    // Pass raw payload to channels.publish()
    // The transport's send() method will handle wrapping it in the HTTP request body
    // with metadata at the top level (sessionId, userId, etc.)
    return this.channels.publish<T>(channel, type, payload);
  }

  private buildSseUrl(): string {
    const params = new URLSearchParams({
      sessionId: this.config.sessionId,
    });

    if (this.config.userId) {
      params.set("userId", this.config.userId);
    }
    if (this.config.tenantId) {
      params.set("tenantId", this.config.tenantId);
    }
    if (this.config.threadId) {
      params.set("threadId", this.config.threadId);
    }

    return `${this.config.baseUrl}${this.config.routes.channelsSse()}?${params.toString()}`;
  }

  private async httpPublish<T>(data: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${this.config.routes.channelsPublish()}`;

    // Data is already enriched by enrichChannelEvent() before reaching here
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        message: string;
      };
      throw TransportError.http(
        response.status,
        url,
        error.message || "Failed to publish event",
      );
    }

    return response.json() as Promise<T>;
  }

  // ===========================================================================
  // Client Tool Results
  // ===========================================================================

  /**
   * Send a tool result back to the server.
   *
   * Used when a client-executed tool (render, action) needs to return a result.
   * For example, when a form is submitted and the server is waiting for the response.
   *
   * @param toolUseId - The toolUseId from the tool_call event
   * @param content - The result content (ContentBlock[] or string or object)
   * @param options - Additional options
   * @returns Promise resolving when result is acknowledged
   *
   * @example
   * ```typescript
   * // In a form component after user submits
   * await client.sendToolResult(toolCall.id, { name: 'John', age: 30 });
   *
   * // With explicit content blocks
   * await client.sendToolResult(toolCall.id, [
   *   { type: 'json', text: JSON.stringify(formData), data: formData }
   * ]);
   *
   * // For errors
   * await client.sendToolResult(toolCall.id, 'Validation failed', { isError: true });
   * ```
   */
  async sendToolResult(
    toolUseId: string,
    content: unknown,
    options: { isError?: boolean; error?: string } = {},
  ): Promise<{ success: boolean; toolUseId: string }> {
    const url = `${this.config.baseUrl}${this.config.routes.toolResults()}`;

    const body = {
      toolUseId: toolUseId,
      content,
      isError: options.isError ?? false,
      error: options.error,
    };

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        message: string;
      };
      throw TransportError.http(
        response.status,
        url,
        error.message || `Failed to send tool result: ${response.status}`,
      );
    }

    return response.json() as Promise<{
      success: boolean;
      toolUseId: string;
    }>;
  }

  /**
   * Send a tool confirmation response to the server.
   *
   * Called when the user confirms or denies a tool execution request.
   * The server is waiting for this response before proceeding with execution.
   *
   * @param toolUseId - ID of the tool call being confirmed
   * @param confirmed - Whether the user confirmed the execution
   * @param options - Additional options
   * @param options.always - If true, remember this decision for future calls
   * @returns Confirmation result
   *
   * @example
   * ```typescript
   * // User confirms tool execution
   * await client.sendToolConfirmation(toolCall.id, true);
   *
   * // User denies tool execution
   * await client.sendToolConfirmation(toolCall.id, false);
   *
   * // User says "always allow this tool"
   * await client.sendToolConfirmation(toolCall.id, true, { always: true });
   *
   * // User says "never allow this tool"
   * await client.sendToolConfirmation(toolCall.id, false, { always: true });
   * ```
   */
  async sendToolConfirmation(
    toolUseId: string,
    confirmed: boolean,
    options: { always?: boolean } = {},
  ): Promise<{ success: boolean; toolUseId: string }> {
    const url = `${this.config.baseUrl}${this.config.routes.toolConfirmation()}`;

    const body = {
      toolUseId,
      confirmed,
      always: options.always ?? false,
    };

    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        message: string;
      };
      throw TransportError.http(
        response.status,
        url,
        error.message || `Failed to send tool confirmation: ${response.status}`,
      );
    }

    return response.json() as Promise<{
      success: boolean;
      toolUseId: string;
    }>;
  }

  // ===========================================================================
  // Execution Messages
  // ===========================================================================

  /**
   * Send a message to a running execution.
   *
   * Messages are delivered to the execution's onMessage lifecycle hooks
   * and queued for TickState.queuedMessages on the next render tick.
   *
   * Messages are routed by sessionId (automatic via channel subscription).
   * If multiple executions run in the same session, you can optionally specify
   * a targetPid to target a specific execution.
   *
   * @param message - The message to send (type and content)
   * @param options - Optional targeting options
   * @returns Promise resolving when message is acknowledged
   *
   * @example
   * ```typescript
   * // Send user feedback to the current session's execution
   * await client.sendMessage({
   *   type: 'user_feedback',
   *   content: { priority: 'high', focus: 'security' }
   * });
   *
   * // Request execution to stop
   * await client.sendMessage({
   *   type: 'stop',
   *   content: { reason: 'User requested stop' }
   * });
   *
   * // Target a specific execution (when multiple run in same session)
   * await client.sendMessage(
   *   { type: 'feedback', content: { ... } },
   *   { targetPid: 'exec_abc123' }
   * );
   * ```
   */
  async sendMessage(
    message: { type: string; content?: unknown },
    options?: { targetPid?: string },
  ): Promise<void> {
    // Publish to the 'execution' channel
    // The channel subscription is scoped to this session via sessionId
    // Optionally include targetPid to target a specific execution within the session
    const payload: Record<string, unknown> = {
      type: message.type,
      content: message.content,
    };
    if (options?.targetPid) {
      payload["targetPid"] = options.targetPid;
    }
    await this.channels.publish("execution", "message", payload);
  }

  // ===========================================================================
  // Connection State
  // ===========================================================================

  getConnectionState(): ConnectionState {
    return this.channels.getState();
  }

  getConnectionInfo(): ConnectionInfo {
    return this.channels.getInfo();
  }

  isConnected(): boolean {
    return this.channels.isConnected();
  }

  reconnect(): void {
    this.channels.reconnect();
  }

  disconnect(): void {
    this.channels.disconnect();
  }

  // ===========================================================================
  // Execution History (Optional API - can be overridden via config.api)
  // ===========================================================================

  async getExecutions(params?: Record<string, unknown>): Promise<Execution[]> {
    // Use custom implementation if provided
    if (this.config.api.getExecutions) {
      return this.config.api.getExecutions(params);
    }

    // Default implementation
    const searchParams = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      }
    }

    const url = `${this.config.baseUrl}${this.config.routes.executionsList()}?${searchParams.toString()}`;
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      throw TransportError.http(
        response.status,
        url,
        "Failed to fetch executions",
      );
    }

    return response.json() as Promise<Execution[]>;
  }

  async getExecution(executionId: string): Promise<Execution> {
    // Use custom implementation if provided
    if (this.config.api.getExecution) {
      return this.config.api.getExecution(executionId);
    }

    // Default implementation
    const url = `${this.config.baseUrl}${this.config.routes.executionById(executionId)}`;
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      throw TransportError.http(
        response.status,
        url,
        "Failed to fetch execution",
      );
    }

    return response.json() as Promise<Execution>;
  }

  async getMetrics(
    params?: Record<string, unknown>,
  ): Promise<ExecutionMetrics[]> {
    // Use custom implementation if provided
    if (this.config.api.getMetrics) {
      return this.config.api.getMetrics(params);
    }

    // Default implementation
    const searchParams = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      }
    }

    const url = `${this.config.baseUrl}${this.config.routes.metricsEndpoint()}?${searchParams.toString()}`;
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      throw TransportError.http(
        response.status,
        url,
        "Failed to fetch metrics",
      );
    }

    return response.json() as Promise<ExecutionMetrics[]>;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  dispose(): void {
    // Only dispose what we own
    if (this.ownsTransport) {
      this.channels.dispose();
    } else {
      // Just disconnect our handlers, don't dispose the transport
      this.channels.disconnect();
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

let defaultClient: EngineClient | null = null;

/**
 * Get or create the default client instance
 */
export function getEngineClient(config?: EngineClientConfig): EngineClient {
  if (!defaultClient) {
    defaultClient = new EngineClient(config);
  } else if (config) {
    defaultClient.updateConfig(config);
  }
  return defaultClient;
}

/**
 * Create a new client instance
 */
export function createEngineClient(config?: EngineClientConfig): EngineClient {
  return new EngineClient(config);
}
