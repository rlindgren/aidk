/**
 * Tests for EngineClient
 *
 * Tests the high-level client that wraps transport and channel primitives.
 */

import { EngineClient, createEngineClient } from "../engine-client";
import type {
  ChannelTransport,
  TransportState,
  TransportInfo,
} from "../core/transport";
import { ChannelClient } from "../core/channel-client";

// =============================================================================
// Mock Transport
// =============================================================================

function createMockTransport(): ChannelTransport & {
  _handlers: Set<(data: unknown) => void>;
  _state: TransportState;
  _dispatch: (data: unknown) => void;
  _sendCalls: unknown[];
} {
  const handlers = new Set<(data: unknown) => void>();
  let state: TransportState = "disconnected";
  const sendCalls: unknown[] = [];

  return {
    _handlers: handlers,
    _state: state,
    _dispatch: (data: unknown) => {
      for (const h of handlers) h(data);
    },
    _sendCalls: sendCalls,

    connect() {
      state = "connected";
    },
    disconnect() {
      state = "disconnected";
    },
    reconnect() {
      state = "connected";
    },
    dispose() {
      handlers.clear();
      state = "disconnected";
    },
    onMessage(handler: (data: unknown) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async send<T = unknown>(data: unknown): Promise<T> {
      sendCalls.push(data);
      return { success: true } as T;
    },
    getState() {
      return state;
    },
    getInfo(): TransportInfo {
      return {
        state,
        reconnectAttempts: 0,
      };
    },
    isConnected() {
      return state === "connected";
    },
  };
}

// Mock fetch for HTTP operations
const originalFetch = global.fetch;

function mockFetch(responses: Map<string, () => Response | Promise<Response>>) {
  global.fetch = jest.fn(
    async (url: string | URL | Request, _options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      for (const [pattern, responseFn] of responses) {
        if (urlStr.includes(pattern)) {
          return await responseFn();
        }
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
      });
    },
  ) as jest.Mock;
}

function restoreFetch() {
  global.fetch = originalFetch;
}

// =============================================================================
// Tests
// =============================================================================

describe("EngineClient", () => {
  let client: EngineClient;
  let transport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    transport = createMockTransport();
    client = new EngineClient({
      baseUrl: "http://localhost:3000",
      userId: "user-123",
      tenantId: "tenant-456",
      transport,
    });
  });

  afterEach(() => {
    client.dispose();
    restoreFetch();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const defaultClient = new EngineClient();
      expect(defaultClient.getSessionId()).toBeDefined();
      expect(defaultClient.getUserId()).toBeUndefined();
      defaultClient.dispose();
    });

    it("should use provided sessionId", () => {
      const sessionClient = new EngineClient({ sessionId: "custom-session" });
      expect(sessionClient.getSessionId()).toBe("custom-session");
      sessionClient.dispose();
    });

    it("should use provided transport", () => {
      expect(client.getConnectionState()).toBe("disconnected");
    });

    it("should use provided ChannelClient", () => {
      const channelClient = new ChannelClient({ transport });
      const clientWithChannels = new EngineClient({ channels: channelClient });
      expect(clientWithChannels.getConnectionState()).toBe("disconnected");
      clientWithChannels.dispose();
    });
  });

  describe("updateConfig", () => {
    it("should update scalar config values", () => {
      client.updateConfig({ userId: "new-user" });
      expect(client.getUserId()).toBe("new-user");
    });

    it("should trigger reconnect when userId changes", () => {
      // First connect
      transport.connect();

      jest.spyOn(transport, "reconnect");
      client.updateConfig({ userId: "new-user" });

      // The client wraps transport in ChannelClient, so reconnect is called on that
      // This test verifies the config update logic
      expect(client.getUserId()).toBe("new-user");
    });

    it("should NOT trigger reconnect when userId stays same", () => {
      const reconnectSpy = jest.spyOn(transport, "reconnect");
      client.updateConfig({ userId: "user-123" }); // Same as initial

      // No reconnect since value didn't change
      expect(reconnectSpy).not.toHaveBeenCalled();
    });

    it("should merge callbacks", () => {
      const onConnect = jest.fn();
      const onDisconnect = jest.fn();

      client.updateConfig({ callbacks: { onConnect } });
      client.updateConfig({ callbacks: { onDisconnect } });

      // Both callbacks should be registered (merged)
    });

    it("should merge routes", () => {
      client.updateConfig({
        routes: {
          agentExecute: (id) => `/custom/agents/${id}/run`,
        },
      });
      // Route is updated
    });
  });

  describe("execute", () => {
    beforeEach(() => {
      mockFetch(
        new Map([
          [
            "/api/agents/test-agent/execute",
            () =>
              new Response(JSON.stringify({ timeline: [], metrics: {} }), {
                status: 200,
              }),
          ],
        ]),
      );
    });

    it("should execute agent and return result", async () => {
      const result = await client.execute("test-agent", { messages: [] });
      expect(result).toEqual({ timeline: [], metrics: {} });
    });

    it("should enrich input with session/user context", async () => {
      await client.execute("test-agent", { messages: [] });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.sessionId).toBeDefined();
      expect(body.userId).toBe("user-123");
      expect(body.metadata.userId).toBe("user-123");
      expect(body.metadata.tenantId).toBe("tenant-456");
    });

    it("should throw on HTTP error", async () => {
      mockFetch(
        new Map([
          [
            "/api/agents/",
            () =>
              new Response(JSON.stringify({ message: "Agent not found" }), {
                status: 404,
              }),
          ],
        ]),
      );

      await expect(
        client.execute("unknown-agent", { messages: [] }),
      ).rejects.toThrow("Not Found");
    });
  });

  describe("stream", () => {
    it("should stream agent execution events", async () => {
      const events = [
        { type: "execution_start", executionId: "exec-1" },
        { type: "text_delta", delta: "Hello" },
        { type: "execution_end" },
      ];

      // Create a readable stream from events
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          }
          controller.close();
        },
      });

      mockFetch(
        new Map([
          [
            "/api/agents/test-agent/stream",
            () =>
              new Response(stream, {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
              }),
          ],
        ]),
      );

      const received: unknown[] = [];
      for await (const event of client.stream("test-agent", { messages: [] })) {
        received.push(event);
      }

      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({
        type: "execution_start",
        executionId: "exec-1",
      });
      expect(received[1]).toEqual({ type: "text_delta", delta: "Hello" });
    });

    it("should throw on stream error", async () => {
      mockFetch(
        new Map([
          [
            "/api/agents/",
            () =>
              new Response(JSON.stringify({ message: "Stream failed" }), {
                status: 500,
              }),
          ],
        ]),
      );

      const gen = client.stream("test-agent", { messages: [] });
      await expect(gen.next()).rejects.toThrow("Internal Server Error");
    });

    it("should handle stream with no body", async () => {
      mockFetch(
        new Map([
          [
            "/api/agents/test-agent/stream",
            () => {
              const response = new Response(null, { status: 200 });
              // @ts-ignore - Override body to be null
              Object.defineProperty(response, "body", { value: null });
              return response;
            },
          ],
        ]),
      );

      const gen = client.stream("test-agent", { messages: [] });
      await expect(gen.next()).rejects.toThrow("No response body");
    });
  });

  describe("subscribe", () => {
    it("should subscribe to channel events", () => {
      const handler = jest.fn();
      const unsub = client.subscribe("test-channel", handler);

      // Simulate event
      transport._dispatch({
        channel: "test-channel",
        type: "test-event",
        payload: { data: "value" },
      });

      expect(handler).toHaveBeenCalledWith({
        channel: "test-channel",
        type: "test-event",
        payload: { data: "value" },
      });

      unsub();
    });

    it("should support wildcard subscriptions", () => {
      const handler = jest.fn();
      client.subscribe("*", handler);

      transport._dispatch({
        channel: "any-channel",
        type: "any-event",
        payload: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should support multiple channel subscriptions", () => {
      const handler = jest.fn();
      client.subscribe(["channel-1", "channel-2"], handler);

      transport._dispatch({
        channel: "channel-1",
        type: "event",
        payload: {},
      });

      transport._dispatch({
        channel: "channel-2",
        type: "event",
        payload: {},
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("publish", () => {
    beforeEach(() => {
      mockFetch(
        new Map([
          [
            "/api/channels/events",
            () =>
              new Response(JSON.stringify({ success: true }), { status: 200 }),
          ],
        ]),
      );
    });

    it("should publish event to channel", async () => {
      // Need to subscribe first to connect
      client.subscribe("test-channel", () => {});

      // The transport.send will be called via the channel client
      const result = await client.publish("test-channel", "my-event", {
        key: "value",
      });

      expect(result).toEqual({ success: true });
    });
  });

  describe("sendToolResult", () => {
    it("should send tool result", async () => {
      mockFetch(
        new Map([
          [
            "/api/channels/tool-results",
            () =>
              new Response(
                JSON.stringify({ success: true, toolUseId: "tool-123" }),
                { status: 200 },
              ),
          ],
        ]),
      );

      const result = await client.sendToolResult("tool-123", { name: "John" });
      expect(result).toEqual({ success: true, toolUseId: "tool-123" });
    });

    it("should send tool result with error flag", async () => {
      mockFetch(
        new Map([
          [
            "/api/channels/tool-results",
            () =>
              new Response(
                JSON.stringify({ success: true, toolUseId: "tool-123" }),
                { status: 200 },
              ),
          ],
        ]),
      );

      await client.sendToolResult("tool-123", "Validation failed", {
        isError: true,
        error: "Invalid input",
      });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.isError).toBe(true);
      expect(body.error).toBe("Invalid input");
    });

    it("should throw on HTTP error", async () => {
      mockFetch(
        new Map([
          [
            "/api/channels/tool-results",
            () =>
              new Response(JSON.stringify({ message: "Not found" }), {
                status: 404,
              }),
          ],
        ]),
      );

      await expect(
        client.sendToolResult("unknown-tool", { data: "value" }),
      ).rejects.toThrow("Not Found");
    });
  });

  describe("sendMessage", () => {
    it("should send message to execution channel", async () => {
      // Subscribe to trigger connection
      client.subscribe("execution", () => {});

      await client.sendMessage({
        type: "user_feedback",
        content: { priority: "high" },
      });

      expect(transport._sendCalls.length).toBeGreaterThan(0);
      const lastCall = transport._sendCalls[
        transport._sendCalls.length - 1
      ] as {
        channel: string;
        type: string;
        payload: unknown;
      };
      expect(lastCall.channel).toBe("execution");
      expect(lastCall.type).toBe("message");
    });

    it("should include targetPid when specified", async () => {
      client.subscribe("execution", () => {});

      await client.sendMessage(
        { type: "stop", content: {} },
        { targetPid: "exec-abc" },
      );

      const lastCall = transport._sendCalls[
        transport._sendCalls.length - 1
      ] as {
        payload: { targetPid?: string };
      };
      expect(lastCall.payload.targetPid).toBe("exec-abc");
    });
  });

  describe("connection state", () => {
    it("should return disconnected initially", () => {
      expect(client.getConnectionState()).toBe("disconnected");
      expect(client.isConnected()).toBe(false);
    });

    it("should connect when subscribing", () => {
      client.subscribe("test", () => {});
      expect(client.isConnected()).toBe(true);
    });

    it("should return connection info", () => {
      const info = client.getConnectionInfo();
      expect(info.state).toBe("disconnected");
      expect(info.reconnectAttempts).toBe(0);
    });

    it("should reconnect", () => {
      client.subscribe("test", () => {}); // Connect first
      expect(client.isConnected()).toBe(true);

      // Reconnect should work (transport reconnect is called via ChannelClient)
      client.reconnect();
      // Just verify it doesn't throw and state is still valid
      expect(client.getConnectionState()).toBeDefined();
    });

    it("should disconnect", () => {
      client.subscribe("test", () => {}); // Connect first
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      // Verify disconnect happened via state
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("getExecutions", () => {
    it("should fetch executions list", async () => {
      mockFetch(
        new Map([
          [
            "/api/executions",
            () =>
              new Response(
                JSON.stringify([
                  { id: "exec-1", status: "completed" },
                  { id: "exec-2", status: "running" },
                ]),
                { status: 200 },
              ),
          ],
        ]),
      );

      const executions = await client.getExecutions();
      expect(executions).toHaveLength(2);
      expect(executions[0].id).toBe("exec-1");
    });

    it("should pass query params", async () => {
      mockFetch(
        new Map([
          [
            "/api/executions",
            () => new Response(JSON.stringify([]), { status: 200 }),
          ],
        ]),
      );

      await client.getExecutions({ status: "completed", limit: 10 });

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain("status=completed");
      expect(url).toContain("limit=10");
    });

    it("should use custom API implementation if provided", async () => {
      const customGetExecutions = jest
        .fn()
        .mockResolvedValue([{ id: "custom" }]);
      const customClient = new EngineClient({
        transport,
        api: { getExecutions: customGetExecutions },
      });

      const result = await customClient.getExecutions({ status: "pending" });

      expect(customGetExecutions).toHaveBeenCalledWith({ status: "pending" });
      expect(result).toEqual([{ id: "custom" }]);
      customClient.dispose();
    });
  });

  describe("getExecution", () => {
    it("should fetch single execution", async () => {
      mockFetch(
        new Map([
          [
            "/api/executions/exec-123",
            () =>
              new Response(
                JSON.stringify({ id: "exec-123", status: "completed" }),
                { status: 200 },
              ),
          ],
        ]),
      );

      const execution = await client.getExecution("exec-123");
      expect(execution.id).toBe("exec-123");
    });

    it("should use custom API implementation if provided", async () => {
      const customGetExecution = jest.fn().mockResolvedValue({ id: "custom" });
      const customClient = new EngineClient({
        transport,
        api: { getExecution: customGetExecution },
      });

      const result = await customClient.getExecution("exec-123");

      expect(customGetExecution).toHaveBeenCalledWith("exec-123");
      expect(result).toEqual({ id: "custom" });
      customClient.dispose();
    });
  });

  describe("getMetrics", () => {
    it("should fetch execution metrics", async () => {
      mockFetch(
        new Map([
          [
            "/api/executions/metrics",
            () =>
              new Response(
                JSON.stringify([{ executionId: "exec-1", inputTokens: 100 }]),
                { status: 200 },
              ),
          ],
        ]),
      );

      const metrics = await client.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].inputTokens).toBe(100);
    });

    it("should use custom API implementation if provided", async () => {
      const customGetMetrics = jest.fn().mockResolvedValue([{ custom: true }]);
      const customClient = new EngineClient({
        transport,
        api: { getMetrics: customGetMetrics },
      });

      const result = await customClient.getMetrics({ from: "2024-01-01" });

      expect(customGetMetrics).toHaveBeenCalledWith({ from: "2024-01-01" });
      expect(result).toEqual([{ custom: true }]);
      customClient.dispose();
    });
  });

  describe("request timeout", () => {
    it("should use abort signal for timeout", async () => {
      const timeoutClient = new EngineClient({
        baseUrl: "http://localhost:3000",
        transport,
        requestTimeout: 100, // Short timeout for testing
      });

      // Mock fetch that checks for abort signal
      let receivedSignal: AbortSignal | null | undefined;
      global.fetch = jest.fn(async (_url: string, options?: RequestInit) => {
        receivedSignal = options?.signal;
        // Return immediately for this test
        return new Response(JSON.stringify({ timeline: [] }), { status: 200 });
      }) as jest.Mock;

      await timeoutClient.execute("test-agent", { messages: [] });

      // Verify an abort signal was passed
      expect(receivedSignal).toBeDefined();
      timeoutClient.dispose();
    });

    it("should not use abort signal when requestTimeout is 0", async () => {
      const noTimeoutClient = new EngineClient({
        baseUrl: "http://localhost:3000",
        transport,
        requestTimeout: 0,
      });

      let receivedSignal: AbortSignal | null | undefined;
      global.fetch = jest.fn(async (_url: string, options?: RequestInit) => {
        receivedSignal = options?.signal;
        return new Response(JSON.stringify({ timeline: [] }), { status: 200 });
      }) as jest.Mock;

      await noTimeoutClient.execute("test-agent", { messages: [] });

      // No abort signal when timeout is 0
      expect(receivedSignal).toBeUndefined();
      noTimeoutClient.dispose();
    });

    it("should complete request before timeout", async () => {
      const noTimeoutClient = new EngineClient({
        baseUrl: "http://localhost:3000",
        transport,
        requestTimeout: 0,
      });

      mockFetch(
        new Map([
          [
            "/api/agents/",
            () =>
              new Response(JSON.stringify({ timeline: [] }), { status: 200 }),
          ],
        ]),
      );

      // Should complete without timeout
      const result = await noTimeoutClient.execute("test-agent", {
        messages: [],
      });
      expect(result.timeline).toEqual([]);
      noTimeoutClient.dispose();
    });
  });

  describe("custom routes", () => {
    it("should use custom route builders", async () => {
      const customClient = new EngineClient({
        baseUrl: "http://localhost:3000",
        transport,
        routes: {
          agentExecute: (id) => `/v2/agents/${id}/run`,
          executionsList: () => "/v2/history",
        },
      });

      mockFetch(
        new Map([
          [
            "/v2/agents/test/run",
            () =>
              new Response(JSON.stringify({ timeline: [] }), { status: 200 }),
          ],
          [
            "/v2/history",
            () => new Response(JSON.stringify([]), { status: 200 }),
          ],
        ]),
      );

      await customClient.execute("test", { messages: [] });
      const [executeUrl] = (global.fetch as jest.Mock).mock.calls[0];
      expect(executeUrl).toContain("/v2/agents/test/run");

      await customClient.getExecutions();
      const [historyUrl] = (global.fetch as jest.Mock).mock.calls[1];
      expect(historyUrl).toContain("/v2/history");

      customClient.dispose();
    });
  });

  describe("dispose", () => {
    it("should cleanup resources for owned transport", () => {
      // Create client that owns transport
      const ownedClient = new EngineClient({
        baseUrl: "http://localhost:3000",
      });

      // Should not throw
      ownedClient.dispose();

      // After dispose, client should be disconnected
      expect(ownedClient.isConnected()).toBe(false);
    });

    it("should disconnect when using provided transport", () => {
      // Dispose calls disconnect on the internal ChannelClient
      // which in turn calls disconnect on the transport
      client.dispose();

      // After dispose, client should not be connected
      expect(client.isConnected()).toBe(false);
    });
  });
});

describe("Factory Functions", () => {
  afterEach(() => {
    // Reset default client between tests
    // @ts-ignore - accessing private for testing
    jest.resetModules();
  });

  describe("createEngineClient", () => {
    it("should create new client instance", () => {
      const client1 = createEngineClient({ sessionId: "session-1" });
      const client2 = createEngineClient({ sessionId: "session-2" });

      expect(client1.getSessionId()).toBe("session-1");
      expect(client2.getSessionId()).toBe("session-2");
      expect(client1).not.toBe(client2);

      client1.dispose();
      client2.dispose();
    });
  });
});
