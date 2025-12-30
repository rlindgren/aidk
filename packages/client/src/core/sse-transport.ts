/**
 * SSETransport - SSE-based transport implementation
 *
 * Receives messages via EventSource (SSE), sends via HTTP POST.
 * Implements the ChannelTransport interface for use with ChannelClient.
 *
 * @example
 * ```typescript
 * const transport = new SSETransport({
 *   buildUrl: () => `${baseUrl}/events/sse?session=${sessionId}`,
 *   send: async (data) => {
 *     const res = await fetch(`${baseUrl}/events`, {
 *       method: 'POST',
 *       body: JSON.stringify(data),
 *     });
 *     return res.json();
 *   },
 * });
 *
 * transport.connect();
 * transport.onMessage((data) => console.log('Received:', data));
 * await transport.send({ channel: 'todo', type: 'create', payload: {} });
 * ```
 */

import { TransportError } from "aidk-shared";
import type {
  ChannelTransport,
  TransportState,
  TransportInfo,
  TransportCallbacks,
  TransportReconnectConfig,
} from "./transport";

export interface SSETransportConfig extends TransportReconnectConfig {
  /** Function that builds the SSE URL (called on each connection attempt) */
  buildUrl: () => string;

  /**
   * Function to send data. Required for SSE since it's receive-only.
   * Typically makes an HTTP POST request.
   */
  send: <T = unknown>(data: unknown) => Promise<T>;

  /** Lifecycle callbacks */
  callbacks?: TransportCallbacks;
}

export class SSETransport implements ChannelTransport {
  private config: {
    buildUrl: () => string;
    send: <T = unknown>(data: unknown) => Promise<T>;
    callbacks: TransportCallbacks;
    reconnectDelay: number;
    maxReconnectDelay: number;
    maxReconnectAttempts: number;
    reconnectJitter: number;
  };

  private eventSource: EventSource | null = null;
  private messageHandlers = new Set<(data: unknown) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionState: TransportState = "disconnected";
  private lastConnectedAt?: Date;
  private lastDisconnectedAt?: Date;
  private lastError?: Error;
  private wasConnected = false;
  private manualDisconnect = false;

  // Network listeners
  private onlineHandler?: () => void;
  private offlineHandler?: () => void;

  constructor(config: SSETransportConfig) {
    this.config = {
      buildUrl: config.buildUrl,
      send: config.send,
      callbacks: config.callbacks || {},
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectDelay: config.maxReconnectDelay ?? 5000, // Cap at 5s - reconnect quickly when server is back
      maxReconnectAttempts: config.maxReconnectAttempts ?? 0,
      reconnectJitter: config.reconnectJitter ?? 0.25,
    };

    this.setupNetworkListeners();
  }

  // ===========================================================================
  // ChannelTransport Implementation
  // ===========================================================================

  connect(): void {
    this.manualDisconnect = false;
    this.ensureConnection();
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.cleanup();
    this.setState("disconnected");
  }

  reconnect(): void {
    this.manualDisconnect = false;
    this.cleanup();
    this.reconnectAttempts = 0;
    this.ensureConnection();
  }

  dispose(): void {
    this.cleanupNetworkListeners();
    this.cleanup();
    this.messageHandlers.clear();
    this.wasConnected = false;
    this.reconnectAttempts = 0;
  }

  onMessage(handler: (data: unknown) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  async send<T = unknown>(data: unknown): Promise<T> {
    return this.config.send<T>(data);
  }

  getState(): TransportState {
    return this.connectionState;
  }

  getInfo(): TransportInfo {
    return {
      state: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
    };
  }

  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private setState(state: TransportState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.config.callbacks.onStateChange?.(state, this.getInfo());
  }

  private ensureConnection(): void {
    if (this.eventSource || this.connectionState === "connecting") return;

    // Check if offline (browser only)
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.setState("offline");
      return;
    }

    this.setState("connecting");

    const url = this.config.buildUrl();
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      const previousAttempts = this.reconnectAttempts;
      const wasReconnecting = this.wasConnected;

      this.lastConnectedAt = new Date();
      this.reconnectAttempts = 0;
      this.lastError = undefined;
      this.setState("connected");

      if (wasReconnecting && previousAttempts > 0) {
        this.config.callbacks.onReconnected?.(previousAttempts);
      } else {
        this.config.callbacks.onConnect?.();
      }

      this.wasConnected = true;
    };

    this.eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchMessage(data);
      } catch {
        // Not JSON, dispatch raw
        this.dispatchMessage(e.data);
      }
    };

    this.eventSource.onerror = (e) => {
      const isClosed = this.eventSource?.readyState === 2;

      if (this.connectionState === "connected" || this.connectionState === "connecting") {
        this.lastError = TransportError.connection("SSE connection error");
        this.config.callbacks.onError?.(e);
        this.handleDisconnect(isClosed ? "closed" : "error");
      }
    };
  }

  private dispatchMessage(data: unknown): void {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }

  private handleDisconnect(reason: string): void {
    if (this.connectionState === "disconnected" || this.connectionState === "reconnecting") {
      return;
    }

    this.cleanup();
    this.lastDisconnectedAt = new Date();
    this.config.callbacks.onDisconnect?.(reason);

    // Auto-reconnect unless manually disconnected
    if (!this.manualDisconnect) {
      this.scheduleReconnect();
    } else {
      this.setState("disconnected");
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private calculateReconnectDelay(): number {
    const exponentialDelay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts);

    // Cap the delay at maxReconnectDelay, but don't reset attempts
    // Attempts are only reset on successful connection (in onopen handler)
    const cappedDelay = Math.min(exponentialDelay, this.config.maxReconnectDelay);
    const jitter = cappedDelay * this.config.reconnectJitter * (Math.random() * 2 - 1);
    return Math.round(cappedDelay + jitter);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Check if offline
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.setState("offline");
      return;
    }

    // Check max attempts
    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.config.callbacks.onReconnectFailed?.(this.reconnectAttempts);
      this.setState("disconnected");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.calculateReconnectDelay();

    this.setState("reconnecting");
    this.config.callbacks.onReconnecting?.(this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnection();
    }, delay);
  }

  // ===========================================================================
  // Network Listeners
  // ===========================================================================

  private setupNetworkListeners(): void {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    this.onlineHandler = () => {
      this.config.callbacks.onOnline?.();

      if (this.connectionState === "offline" && !this.manualDisconnect) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      }
    };

    this.offlineHandler = () => {
      this.config.callbacks.onOffline?.();

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      this.setState("offline");
    };

    window.addEventListener("online", this.onlineHandler);
    window.addEventListener("offline", this.offlineHandler);
  }

  private cleanupNetworkListeners(): void {
    if (typeof window === "undefined") return;

    if (this.onlineHandler) {
      window.removeEventListener("online", this.onlineHandler);
    }
    if (this.offlineHandler) {
      window.removeEventListener("offline", this.offlineHandler);
    }
  }
}
