/**
 * SSE Transport for Engine ChannelService
 *
 * Bridges HTTP Server-Sent Events with Engine's channel system.
 * This implements the ChannelTransport interface with room-based routing,
 * allowing the Engine's channel service to communicate with HTTP clients.
 *
 * Room-based routing (inspired by Socket.io):
 * - Connections can join/leave rooms
 * - Events can target specific rooms via event.target.rooms
 * - excludeSender provides "broadcast" semantics (send to others)
 * - Auto-join rooms based on connection metadata (e.g., userId)
 */
import { type Response } from "express";
import {
  type ChannelTransport,
  type ChannelEvent,
  type ConnectionMetadata,
  type ChannelTransportConfig,
} from "aidk";

interface SSEConnection {
  res: Response;
  metadata: ConnectionMetadata;
  rooms: Set<string>;
  channels: Set<string>;
  heartbeatInterval?: NodeJS.Timeout;
}

export interface SSETransportConfig extends ChannelTransportConfig {
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-join rooms based on metadata */
  autoJoinRooms?: (metadata: ConnectionMetadata) => string[];
  /** Maximum total connections (default: unlimited). New connections rejected when limit reached. */
  maxConnections?: number;
  /** Maximum connections per user based on metadata.userId (default: unlimited) */
  maxConnectionsPerUser?: number;
}

export class SSETransport implements ChannelTransport {
  name = "sse";

  private connections = new Map<string, SSEConnection>();
  private roomConnections = new Map<string, Set<string>>();
  private receiveHandler?: (event: ChannelEvent) => void;
  private config: SSETransportConfig;

  constructor(config: SSETransportConfig = {}) {
    this.config = config;
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log("📡 [SSE]", ...args);
    }
  }

  /**
   * Apply config to existing instance (preserves connections).
   */
  applyConfig(config: Partial<SSETransportConfig>): void {
    this.config = { ...this.config, ...config };
    this.log("Config applied");
  }

  /**
   * Connect a new SSE client with optional metadata.
   * Connection may be rejected if limits are exceeded (response is sent automatically).
   */
  async connect(
    connectionId: string,
    metadata?: ConnectionMetadata & { res?: Response; channels?: string[] },
  ): Promise<void> {
    if (!metadata?.res) {
      console.warn(
        `SSE connect called without Response object for connection ${connectionId}`,
      );
      return;
    }

    const { res, channels = [], ...restMetadata } = metadata;

    // Check global connection limit
    if (
      this.config.maxConnections &&
      this.connections.size >= this.config.maxConnections
    ) {
      this.log(
        `Connection rejected: max connections (${this.config.maxConnections}) reached`,
      );
      res.status(503).json({
        error: "Too many connections",
        message: "Server connection limit reached. Please try again later.",
      });
      return;
    }

    // Check per-user connection limit
    if (this.config.maxConnectionsPerUser && restMetadata.userId) {
      const userConnections = this.countUserConnections(
        restMetadata.userId as string,
      );
      if (userConnections >= this.config.maxConnectionsPerUser) {
        this.log(
          `Connection rejected: user ${restMetadata.userId} at max connections (${this.config.maxConnectionsPerUser})`,
        );
        res.status(429).json({
          error: "Too many connections",
          message:
            "You have too many active connections. Please close some and try again.",
        });
        return;
      }
    }

    // Set SSE headers
    // Note: CORS should be handled by middleware (e.g., cors package) before this point
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx proxy buffering
    res.flushHeaders();

    // Store connection
    const connection: SSEConnection = {
      res,
      metadata: restMetadata,
      rooms: new Set(),
      channels: new Set(channels),
    };

    // Listen for client disconnect - this is the proper way to detect when
    // the client closes the connection (browser tab closed, network disconnect, etc.)
    res.on("close", () => {
      this.log(`Client closed connection: ${connectionId}`);
      this.disconnect(connectionId);
    });

    // Start heartbeat
    const heartbeatMs = this.config.heartbeatInterval ?? 30000;
    connection.heartbeatInterval = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {
        this.disconnect(connectionId);
      }
    }, heartbeatMs);

    this.connections.set(connectionId, connection);

    // Auto-join rooms based on metadata
    if (this.config.autoJoinRooms) {
      const autoRooms = this.config.autoJoinRooms(restMetadata);
      this.log(`Auto-joining rooms: ${autoRooms.join(", ")}`);
      for (const room of autoRooms) {
        if (room) {
          await this.join(connectionId, room);
        }
      }
    }

    // Send connected event
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        connectionId,
        rooms: Array.from(connection.rooms),
      })}\n\n`,
    );

    this.log(
      `Connected: ${connectionId}, rooms: [${Array.from(connection.rooms).join(", ")}], total: ${this.connections.size}`,
    );
  }

  /**
   * Count connections for a specific user.
   */
  private countUserConnections(userId: string): number {
    let count = 0;
    for (const connection of this.connections.values()) {
      if (connection.metadata.userId === userId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Disconnect an SSE client (or all if no connectionId).
   */
  async disconnect(connectionId?: string): Promise<void> {
    if (connectionId) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        if (connection.heartbeatInterval) {
          clearInterval(connection.heartbeatInterval);
        }

        for (const room of connection.rooms) {
          await this.leave(connectionId, room);
        }

        try {
          connection.res.end();
        } catch {
          // Connection already closed
        }

        this.connections.delete(connectionId);
        this.log(`Disconnected: ${connectionId}`);
      }
    } else {
      for (const id of this.connections.keys()) {
        await this.disconnect(id);
      }
    }
  }

  /**
   * Close all connections with a proper close event.
   * Used for graceful server shutdown.
   */
  closeAll(): void {
    console.log(`📡 [SSE] Closing ${this.connections.size} connections...`);

    for (const [connectionId, connection] of this.connections) {
      try {
        // Clear heartbeat
        if (connection.heartbeatInterval) {
          clearInterval(connection.heartbeatInterval);
        }

        // Send close event to client
        connection.res.write(
          `data: ${JSON.stringify({
            type: "server_shutdown",
            message: "Server is shutting down",
          })}\n\n`,
        );

        // End the response
        connection.res.end();

        this.log(`Closed: ${connectionId}`);
      } catch {
        // Connection already closed
      }
    }

    // Clear all state
    this.connections.clear();
    this.roomConnections.clear();

    console.log("📡 [SSE] All connections closed");
  }

  /**
   * Join a room.
   */
  async join(connectionId: string, room: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      console.warn(`Cannot join room: connection ${connectionId} not found`);
      return;
    }

    connection.rooms.add(room);

    if (!this.roomConnections.has(room)) {
      this.roomConnections.set(room, new Set());
    }
    this.roomConnections.get(room)!.add(connectionId);

    this.log(`${connectionId} joined room: ${room}`);
  }

  /**
   * Leave a room.
   */
  async leave(connectionId: string, room: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.rooms.delete(room);
    }

    const roomSet = this.roomConnections.get(room);
    if (roomSet) {
      roomSet.delete(connectionId);
      if (roomSet.size === 0) {
        this.roomConnections.delete(room);
      }
    }
  }

  /**
   * Get rooms a connection has joined.
   */
  getConnectionRooms(connectionId: string): string[] {
    const connection = this.connections.get(connectionId);
    return connection ? Array.from(connection.rooms) : [];
  }

  /**
   * Get connections in a room.
   */
  getRoomConnections(room: string): string[] {
    const roomSet = this.roomConnections.get(room);
    return roomSet ? Array.from(roomSet) : [];
  }

  /**
   * Send an event to SSE clients.
   *
   * Routing is determined by event.target:
   * - No target: broadcast to all
   * - target.connectionId: send to specific connection
   * - target.rooms: send to connections in those rooms
   * - target.excludeSender: exclude sourceConnectionId
   */
  async send(event: ChannelEvent): Promise<void> {
    const target = event.target;
    const sourceConnectionId = event.metadata?.["sourceConnectionId"] as
      | string
      | undefined;

    let targetConnections: Set<string>;

    if (target?.connectionId) {
      targetConnections = new Set([target.connectionId]);
    } else if (target?.rooms && target.rooms.length > 0) {
      targetConnections = new Set<string>();
      for (const room of target.rooms) {
        const roomConns = this.roomConnections.get(room);
        if (roomConns) {
          for (const connId of roomConns) {
            targetConnections.add(connId);
          }
        }
      }
    } else {
      targetConnections = new Set(this.connections.keys());
    }

    if (target?.excludeSender && sourceConnectionId) {
      targetConnections.delete(sourceConnectionId);
    }

    this.log(
      `Send: channel=${event.channel}, type=${event.type}, targets=${targetConnections.size}`,
    );

    let sentCount = 0;

    for (const connectionId of targetConnections) {
      const connection = this.connections.get(connectionId);
      if (!connection) continue;

      if (
        connection.channels.size > 0 &&
        !connection.channels.has(event.channel)
      ) {
        continue;
      }

      try {
        connection.res.write(`data: ${JSON.stringify(event)}\n\n`);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send SSE event to ${connectionId}:`, err);
        await this.disconnect(connectionId);
      }
    }

    if (sentCount === 0 && targetConnections.size > 0) {
      this.log(`Warning: No clients received event (filtered or disconnected)`);
    }
  }

  /**
   * Register handler for events received from transport.
   */
  onReceive(handler: (event: ChannelEvent) => void): void {
    this.receiveHandler = handler;
  }

  /**
   * Handle incoming event from HTTP POST.
   */
  handleIncomingEvent(event: ChannelEvent): void {
    if (this.receiveHandler) {
      this.receiveHandler(event);
    }
  }

  /**
   * Add a new SSE connection (convenience method for HTTP routes).
   */
  addConnection(
    connectionId: string,
    res: Response,
    options?: { channels?: string[]; metadata?: ConnectionMetadata },
  ): void {
    this.connect(connectionId, {
      res,
      channels: options?.channels,
      ...options?.metadata,
    });
  }

  /**
   * Check if a connection exists.
   */
  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  /**
   * Get all connected connection IDs.
   */
  getConnectedSessions(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection metadata.
   */
  getConnectionMetadata(connectionId: string): ConnectionMetadata | undefined {
    return this.connections.get(connectionId)?.metadata;
  }
}

// =============================================================================
// Singleton Factory
// =============================================================================

let sseTransportSingleton: SSETransport | null = null;

/**
 * Create or configure the SSE transport singleton.
 */
export function createSSETransport(config?: SSETransportConfig): SSETransport {
  if (sseTransportSingleton) {
    if (config) {
      sseTransportSingleton.applyConfig(config);
    }
    return sseTransportSingleton;
  }
  sseTransportSingleton = new SSETransport(config);
  return sseTransportSingleton;
}

/**
 * Get the SSE transport singleton.
 */
export function getSSETransport(): SSETransport {
  if (!sseTransportSingleton) {
    sseTransportSingleton = new SSETransport();
  }
  return sseTransportSingleton;
}

/**
 * Reset the singleton (for testing).
 */
export function resetSSETransport(): void {
  if (sseTransportSingleton) {
    sseTransportSingleton.disconnect();
    sseTransportSingleton = null;
  }
}
