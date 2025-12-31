/**
 * Tests for ChannelClient
 *
 * Tests the pub/sub channel abstraction over transports.
 */

import { ChannelClient } from "../core/channel-client";
import type { ChannelTransport, TransportState, TransportInfo } from "../core/transport";

// =============================================================================
// Mock Transport
// =============================================================================

function createMockTransport(): ChannelTransport & {
  _handlers: Set<(data: unknown) => void>;
  _state: TransportState;
  _dispatch: (data: unknown) => void;
  _sendCalls: unknown[];
  _setConnected: () => void;
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
    _setConnected: () => {
      state = "connected";
    },

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

// =============================================================================
// Tests
// =============================================================================

describe("ChannelClient", () => {
  let transport: ReturnType<typeof createMockTransport>;
  let client: ChannelClient;

  beforeEach(() => {
    transport = createMockTransport();
    client = new ChannelClient({ transport });
  });

  afterEach(() => {
    client.dispose();
  });

  describe("subscribe", () => {
    it("should subscribe to a single channel", () => {
      const handler = vi.fn();
      client.subscribe("test-channel", handler);

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
    });

    it("should subscribe to multiple channels", () => {
      const handler = vi.fn();
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

    it("should support wildcard subscription", () => {
      const handler = vi.fn();
      client.subscribe("*", handler);

      transport._dispatch({
        channel: "any-channel",
        type: "any-event",
        payload: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should not call handler for unsubscribed channel", () => {
      const handler = vi.fn();
      client.subscribe("channel-1", handler);

      transport._dispatch({
        channel: "channel-2",
        type: "event",
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should connect transport on first subscription", () => {
      const connectSpy = vi.spyOn(transport, "connect");

      client.subscribe("test", () => {});

      expect(connectSpy).toHaveBeenCalled();
    });

    it("should not connect if already connected", () => {
      transport._setConnected();
      const connectSpy = vi.spyOn(transport, "connect");

      client.subscribe("test", () => {});

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it("should return unsubscribe function", () => {
      const handler = vi.fn();
      const unsub = client.subscribe("test", handler);

      unsub();

      transport._dispatch({
        channel: "test",
        type: "event",
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should disconnect when all handlers unsubscribe", () => {
      const disconnectSpy = vi.spyOn(transport, "disconnect");

      const unsub1 = client.subscribe("channel-1", () => {});
      const unsub2 = client.subscribe("channel-2", () => {});

      unsub1();
      expect(disconnectSpy).not.toHaveBeenCalled();

      unsub2();
      expect(disconnectSpy).toHaveBeenCalled();
    });

    it("should support multiple handlers per channel", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      client.subscribe("test", handler1);
      client.subscribe("test", handler2);

      transport._dispatch({
        channel: "test",
        type: "event",
        payload: {},
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("publish", () => {
    it("should send event through transport", async () => {
      await client.publish("test-channel", "my-event", { key: "value" });

      expect(transport._sendCalls).toHaveLength(1);
      expect(transport._sendCalls[0]).toEqual({
        channel: "test-channel",
        type: "my-event",
        payload: { key: "value" },
      });
    });

    it("should return transport send result", async () => {
      const result = await client.publish("test", "event", {});
      expect(result).toEqual({ success: true });
    });

    it("should use custom publish override if provided", async () => {
      const customPublish = vi.fn().mockResolvedValue({ custom: true });
      const customClient = new ChannelClient({
        transport,
        publish: customPublish,
      });

      const result = await customClient.publish("test", "event", { data: 1 });

      expect(customPublish).toHaveBeenCalledWith("test", "event", { data: 1 });
      expect(result).toEqual({ custom: true });

      customClient.dispose();
    });

    it("should work without payload", async () => {
      await client.publish("test", "event");

      expect(transport._sendCalls[0]).toEqual({
        channel: "test",
        type: "event",
        payload: undefined,
      });
    });
  });

  describe("message filtering", () => {
    it("should ignore non-channel events", () => {
      const handler = vi.fn();
      client.subscribe("test", handler);

      // Dispatch non-channel event
      transport._dispatch({ foo: "bar" });
      transport._dispatch("string message");
      transport._dispatch(null);
      transport._dispatch(undefined);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should use custom isChannelEvent filter", () => {
      // Custom filter that only accepts events with customChannel field
      const customFilter = (data: unknown): data is any => {
        return typeof data === "object" && data !== null && "customChannel" in data;
      };

      const customClient = new ChannelClient({
        transport,
        isChannelEvent: customFilter,
      });

      const handler = vi.fn();
      customClient.subscribe("*", handler);

      // This should NOT match (uses standard format)
      transport._dispatch({ channel: "test", type: "event", payload: {} });
      expect(handler).not.toHaveBeenCalled();

      customClient.dispose();
    });

    it("should require both channel and type fields", () => {
      const handler = vi.fn();
      client.subscribe("test", handler);

      // Missing type
      transport._dispatch({ channel: "test", payload: {} });
      expect(handler).not.toHaveBeenCalled();

      // Missing channel
      transport._dispatch({ type: "event", payload: {} });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("connection state", () => {
    it("should return transport state", () => {
      expect(client.getState()).toBe("disconnected");

      transport._setConnected();
      expect(client.getState()).toBe("connected");
    });

    it("should return transport info", () => {
      const info = client.getInfo();
      expect(info.state).toBeDefined();
      expect(info.reconnectAttempts).toBeDefined();
    });

    it("should check if connected", () => {
      expect(client.isConnected()).toBe(false);

      transport._setConnected();
      expect(client.isConnected()).toBe(true);
    });
  });

  describe("reconnect", () => {
    it("should reconnect if there are handlers", () => {
      const reconnectSpy = vi.spyOn(transport, "reconnect");

      client.subscribe("test", () => {});
      client.reconnect();

      expect(reconnectSpy).toHaveBeenCalled();
    });

    it("should not reconnect if no handlers", () => {
      const reconnectSpy = vi.spyOn(transport, "reconnect");

      client.reconnect();

      expect(reconnectSpy).not.toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("should clear all handlers and disconnect", () => {
      const handler = vi.fn();
      client.subscribe("test", handler);

      const disconnectSpy = vi.spyOn(transport, "disconnect");
      client.disconnect();

      expect(disconnectSpy).toHaveBeenCalled();

      // Handler should no longer receive events
      transport._dispatch({ channel: "test", type: "event", payload: {} });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should cleanup all resources", () => {
      const handler = vi.fn();
      client.subscribe("test", handler);

      const disposeSpy = vi.spyOn(transport, "dispose");
      client.dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });

    it("should unsubscribe from transport messages", () => {
      client.dispose();

      // Dispatching should not throw even after dispose
      transport._dispatch({ channel: "test", type: "event", payload: {} });
    });
  });
});
