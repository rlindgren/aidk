/**
 * Tests for SSE Transport
 *
 * Tests the Express SSE transport implementation.
 */

import {
  SSETransport,
  createSSETransport,
  getSSETransport,
  resetSSETransport,
} from "../transports/sse";
import type { Response } from "express";
import type { ChannelEvent, ConnectionMetadata } from "aidk";

// =============================================================================
// Mock Response
// =============================================================================

interface MockResponse extends Partial<Response> {
  _written: string[];
  _headers: Record<string, string>;
  _ended: boolean;
  _statusCode: number;
  _jsonBody: unknown;
  _closeHandlers: Array<() => void>;
}

function createMockResponse(): MockResponse {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const closeHandlers: Array<() => void> = [];
  let ended = false;
  let statusCode = 200;
  let jsonBody: unknown = null;

  const mockRes: MockResponse = {
    _written: written,
    _headers: headers,
    _ended: ended,
    _statusCode: statusCode,
    _jsonBody: jsonBody,
    _closeHandlers: closeHandlers,

    setHeader(name: string, value: string) {
      headers[name] = value;
      return this as unknown as Response;
    },
    flushHeaders() {
      // no-op for mock
    },
    write(chunk: string) {
      if (ended) throw new Error("Cannot write after end");
      written.push(chunk);
      return true;
    },
    end(_cb?: () => void) {
      ended = true;
      mockRes._ended = true;
      return mockRes as unknown as Response;
    },
    on(event: string, handler: () => void) {
      if (event === "close") {
        closeHandlers.push(handler);
      }
      return this as unknown as Response;
    },
    status(code: number) {
      statusCode = code;
      mockRes._statusCode = code;
      return this as unknown as Response;
    },
    json(body: unknown) {
      jsonBody = body;
      mockRes._jsonBody = body;
      return this as unknown as Response;
    },
  };

  return mockRes;
}

// Helper to simulate client disconnect
function simulateDisconnect(mockRes: MockResponse): void {
  for (const handler of mockRes._closeHandlers) {
    handler();
  }
}

// Helper to parse SSE data from written content
function parseSSEData(written: string[]): unknown[] {
  return written
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => {
      const json = chunk.replace("data: ", "").replace("\n\n", "");
      return JSON.parse(json);
    });
}

// =============================================================================
// Tests
// =============================================================================

describe("SSETransport", () => {
  let transport: SSETransport;

  beforeEach(() => {
    jest.useFakeTimers();
    transport = new SSETransport({ debug: false });
  });

  afterEach(() => {
    transport.disconnect();
    jest.useRealTimers();
    resetSSETransport();
  });

  describe("connect", () => {
    it("should establish SSE connection", async () => {
      const mockRes = createMockResponse();

      await transport.connect("conn-1", { res: mockRes as Response });

      expect(mockRes._headers["Content-Type"]).toBe("text/event-stream");
      expect(mockRes._headers["Cache-Control"]).toBe("no-cache");
      expect(mockRes._headers["Connection"]).toBe("keep-alive");
      expect(transport.isConnected("conn-1")).toBe(true);
    });

    it("should send connected event", async () => {
      const mockRes = createMockResponse();

      await transport.connect("conn-1", { res: mockRes as Response });

      const events = parseSSEData(mockRes._written);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "connected",
          connectionId: "conn-1",
        }),
      );
    });

    it("should store connection metadata", async () => {
      const mockRes = createMockResponse();
      const metadata: ConnectionMetadata = {
        userId: "user-123",
        tenantId: "tenant-456",
      };

      await transport.connect("conn-1", {
        res: mockRes as Response,
        ...metadata,
      });

      expect(transport.getConnectionMetadata("conn-1")).toEqual(metadata);
    });

    it("should handle missing response object", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      await transport.connect("conn-1", {});

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("without Response object"),
      );
      expect(transport.isConnected("conn-1")).toBe(false);

      consoleSpy.mockRestore();
    });

    it("should reject when max connections reached", async () => {
      const limitedTransport = new SSETransport({ maxConnections: 1 });
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await limitedTransport.connect("conn-1", { res: mockRes1 as Response });
      await limitedTransport.connect("conn-2", { res: mockRes2 as Response });

      expect(limitedTransport.isConnected("conn-1")).toBe(true);
      expect(limitedTransport.isConnected("conn-2")).toBe(false);
      expect(mockRes2._statusCode).toBe(503);
      expect(mockRes2._jsonBody).toEqual(
        expect.objectContaining({ error: "Too many connections" }),
      );

      limitedTransport.disconnect();
    });

    it("should reject when max connections per user reached", async () => {
      const limitedTransport = new SSETransport({ maxConnectionsPerUser: 1 });
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await limitedTransport.connect("conn-1", {
        res: mockRes1 as Response,
        userId: "user-123",
      });
      await limitedTransport.connect("conn-2", {
        res: mockRes2 as Response,
        userId: "user-123",
      });

      expect(limitedTransport.isConnected("conn-1")).toBe(true);
      expect(limitedTransport.isConnected("conn-2")).toBe(false);
      expect(mockRes2._statusCode).toBe(429);

      limitedTransport.disconnect();
    });

    it("should auto-join rooms based on metadata", async () => {
      const autoJoinTransport = new SSETransport({
        autoJoinRooms: (meta) => [
          `user:${meta.userId}`,
          `tenant:${meta.tenantId}`,
        ],
      });
      const mockRes = createMockResponse();

      await autoJoinTransport.connect("conn-1", {
        res: mockRes as Response,
        userId: "user-123",
        tenantId: "tenant-456",
      });

      const rooms = autoJoinTransport.getConnectionRooms("conn-1");
      expect(rooms).toContain("user:user-123");
      expect(rooms).toContain("tenant:tenant-456");

      autoJoinTransport.disconnect();
    });

    it("should subscribe to specified channels", async () => {
      const mockRes = createMockResponse();

      await transport.connect("conn-1", {
        res: mockRes as Response,
        channels: ["channel-1", "channel-2"],
      });

      // Connection is active
      expect(transport.isConnected("conn-1")).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("should disconnect specific connection", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });

      await transport.disconnect("conn-1");

      expect(transport.isConnected("conn-1")).toBe(false);
      expect(mockRes._ended).toBe(true);
    });

    it("should disconnect all connections when no ID provided", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });

      await transport.disconnect();

      expect(transport.isConnected("conn-1")).toBe(false);
      expect(transport.isConnected("conn-2")).toBe(false);
    });

    it("should clean up heartbeat interval on disconnect", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });

      // Advance past heartbeat
      jest.advanceTimersByTime(35000);
      const writesBeforeDisconnect = mockRes._written.length;

      await transport.disconnect("conn-1");

      // More time passes but no more heartbeats
      jest.advanceTimersByTime(35000);
      expect(mockRes._written.length).toBe(writesBeforeDisconnect);
    });

    it("should handle client-initiated disconnect", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });

      simulateDisconnect(mockRes);

      expect(transport.isConnected("conn-1")).toBe(false);
    });

    it("should leave all rooms on disconnect", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });
      await transport.join("conn-1", "room-1");
      await transport.join("conn-1", "room-2");

      await transport.disconnect("conn-1");

      expect(transport.getRoomConnections("room-1")).not.toContain("conn-1");
      expect(transport.getRoomConnections("room-2")).not.toContain("conn-1");
    });
  });

  describe("rooms", () => {
    it("should join a room", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });

      await transport.join("conn-1", "room-1");

      expect(transport.getConnectionRooms("conn-1")).toContain("room-1");
      expect(transport.getRoomConnections("room-1")).toContain("conn-1");
    });

    it("should leave a room", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });
      await transport.join("conn-1", "room-1");

      await transport.leave("conn-1", "room-1");

      expect(transport.getConnectionRooms("conn-1")).not.toContain("room-1");
      expect(transport.getRoomConnections("room-1")).not.toContain("conn-1");
    });

    it("should handle multiple connections in a room", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });
      await transport.join("conn-1", "room-1");
      await transport.join("conn-2", "room-1");

      const roomConns = transport.getRoomConnections("room-1");
      expect(roomConns).toContain("conn-1");
      expect(roomConns).toContain("conn-2");
    });

    it("should clean up empty rooms", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });
      await transport.join("conn-1", "room-1");
      await transport.leave("conn-1", "room-1");

      expect(transport.getRoomConnections("room-1")).toHaveLength(0);
    });

    it("should warn when joining with unknown connection", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      await transport.join("unknown-conn", "room-1");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("send", () => {
    it("should broadcast to all connections", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });

      const event: ChannelEvent = {
        channel: "test",
        type: "broadcast",
        payload: { message: "hello" },
      };
      await transport.send(event);

      expect(parseSSEData(mockRes1._written)).toContainEqual(event);
      expect(parseSSEData(mockRes2._written)).toContainEqual(event);
    });

    it("should send to specific connection", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });

      const initialWrites1 = mockRes1._written.length;
      const initialWrites2 = mockRes2._written.length;

      const event: ChannelEvent = {
        channel: "test",
        type: "direct",
        payload: {},
        target: { connectionId: "conn-1" },
      };
      await transport.send(event);

      expect(mockRes1._written.length).toBeGreaterThan(initialWrites1);
      expect(mockRes2._written.length).toBe(initialWrites2);
    });

    it("should send to specific rooms", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();
      const mockRes3 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });
      await transport.connect("conn-3", { res: mockRes3 as Response });

      await transport.join("conn-1", "room-1");
      await transport.join("conn-2", "room-1");
      // conn-3 not in room-1

      const initialWrites1 = mockRes1._written.length;
      const initialWrites2 = mockRes2._written.length;
      const initialWrites3 = mockRes3._written.length;

      const event: ChannelEvent = {
        channel: "test",
        type: "room-message",
        payload: {},
        target: { rooms: ["room-1"] },
      };
      await transport.send(event);

      expect(mockRes1._written.length).toBeGreaterThan(initialWrites1);
      expect(mockRes2._written.length).toBeGreaterThan(initialWrites2);
      expect(mockRes3._written.length).toBe(initialWrites3);
    });

    it("should exclude sender when specified", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });

      const initialWrites1 = mockRes1._written.length;
      const initialWrites2 = mockRes2._written.length;

      const event: ChannelEvent = {
        channel: "test",
        type: "broadcast-except-sender",
        payload: {},
        target: { excludeSender: true },
        metadata: { sourceConnectionId: "conn-1" },
      };
      await transport.send(event);

      expect(mockRes1._written.length).toBe(initialWrites1);
      expect(mockRes2._written.length).toBeGreaterThan(initialWrites2);
    });

    it("should filter by subscribed channels", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", {
        res: mockRes1 as Response,
        channels: ["channel-1"],
      });
      await transport.connect("conn-2", {
        res: mockRes2 as Response,
        channels: ["channel-2"],
      });

      const initialWrites1 = mockRes1._written.length;
      const initialWrites2 = mockRes2._written.length;

      const event: ChannelEvent = {
        channel: "channel-1",
        type: "filtered",
        payload: {},
      };
      await transport.send(event);

      expect(mockRes1._written.length).toBeGreaterThan(initialWrites1);
      expect(mockRes2._written.length).toBe(initialWrites2);
    });

    it("should handle failed writes by disconnecting", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });

      // Simulate write failure
      mockRes.write = () => {
        throw new Error("Write failed");
      };

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await transport.send({
        channel: "test",
        type: "message",
        payload: {},
      });

      expect(consoleSpy).toHaveBeenCalled();
      expect(transport.isConnected("conn-1")).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe("heartbeat", () => {
    it("should send heartbeat at configured interval", async () => {
      const heartbeatTransport = new SSETransport({
        heartbeatInterval: 10000,
      });
      const mockRes = createMockResponse();

      await heartbeatTransport.connect("conn-1", { res: mockRes as Response });
      const _initialWrites = mockRes._written.length;

      jest.advanceTimersByTime(10000);

      const heartbeats = mockRes._written.filter((w) =>
        w.includes("heartbeat"),
      );
      expect(heartbeats.length).toBeGreaterThan(0);

      heartbeatTransport.disconnect();
    });

    it("should use default heartbeat interval", async () => {
      const mockRes = createMockResponse();

      await transport.connect("conn-1", { res: mockRes as Response });

      // Default is 30000ms
      jest.advanceTimersByTime(30000);

      const heartbeats = mockRes._written.filter((w) =>
        w.includes("heartbeat"),
      );
      expect(heartbeats.length).toBeGreaterThan(0);
    });
  });

  describe("onReceive", () => {
    it("should register receive handler", () => {
      const handler = jest.fn();
      transport.onReceive(handler);

      const event: ChannelEvent = {
        channel: "test",
        type: "incoming",
        payload: {},
      };
      transport.handleIncomingEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("closeAll", () => {
    it("should close all connections gracefully", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });

      transport.closeAll();

      expect(transport.isConnected("conn-1")).toBe(false);
      expect(transport.isConnected("conn-2")).toBe(false);
      expect(mockRes1._ended).toBe(true);
      expect(mockRes2._ended).toBe(true);

      // Should have sent shutdown event
      expect(mockRes1._written.some((w) => w.includes("server_shutdown"))).toBe(
        true,
      );
    });
  });

  describe("applyConfig", () => {
    it("should update config without disconnecting", async () => {
      const mockRes = createMockResponse();
      await transport.connect("conn-1", { res: mockRes as Response });

      transport.applyConfig({ debug: true });

      expect(transport.isConnected("conn-1")).toBe(true);
    });
  });

  describe("utility methods", () => {
    it("getConnectedSessions should return all connection IDs", async () => {
      const mockRes1 = createMockResponse();
      const mockRes2 = createMockResponse();

      await transport.connect("conn-1", { res: mockRes1 as Response });
      await transport.connect("conn-2", { res: mockRes2 as Response });

      const sessions = transport.getConnectedSessions();
      expect(sessions).toContain("conn-1");
      expect(sessions).toContain("conn-2");
    });

    it("addConnection should be convenience for connect", async () => {
      // Use real timers for this test since addConnection is async
      jest.useRealTimers();

      const mockRes = createMockResponse();

      transport.addConnection("conn-1", mockRes as Response, {
        channels: ["test"],
        metadata: { userId: "user-123" },
      });

      // Wait for connection to be established (connect is async)
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(transport.isConnected("conn-1")).toBe(true);

      // Restore fake timers
      jest.useFakeTimers();
    });
  });
});

describe("Singleton Functions", () => {
  beforeEach(() => {
    resetSSETransport();
  });

  afterEach(() => {
    resetSSETransport();
  });

  describe("createSSETransport", () => {
    it("should create singleton on first call", () => {
      const transport1 = createSSETransport({ debug: false });
      const transport2 = createSSETransport();

      expect(transport1).toBe(transport2);
    });

    it("should apply config on subsequent calls", () => {
      const transport1 = createSSETransport({ maxConnections: 10 });
      const transport2 = createSSETransport({ maxConnections: 20 });

      expect(transport1).toBe(transport2);
    });
  });

  describe("getSSETransport", () => {
    it("should create new transport if none exists", () => {
      const transport = getSSETransport();
      expect(transport).toBeDefined();
    });

    it("should return existing transport", () => {
      const transport1 = getSSETransport();
      const transport2 = getSSETransport();

      expect(transport1).toBe(transport2);
    });
  });

  describe("resetSSETransport", () => {
    it("should clear the singleton", () => {
      const transport1 = createSSETransport();
      resetSSETransport();
      const transport2 = createSSETransport();

      expect(transport1).not.toBe(transport2);
    });
  });
});
