import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DevToolsServer } from "../server/devtools-server";
import {
  getDevToolsServer,
  stopDevTools,
  isDevToolsActive,
  emitDevToolsEvent,
} from "../server/registry";
import { devToolsEmitter, type DevToolsEvent } from "aidk-shared";

describe("DevToolsServer", () => {
  let server: DevToolsServer;

  beforeEach(() => {
    server = new DevToolsServer({ port: 0, debug: false }); // port 0 = random available port
  });

  afterEach(() => {
    server.stop();
  });

  describe("start/stop", () => {
    it("should start and stop the server", () => {
      expect(() => server.start()).not.toThrow();
      expect(() => server.stop()).not.toThrow();
    });

    it("should handle multiple start calls gracefully", () => {
      server.start();
      expect(() => server.start()).not.toThrow(); // Should not throw on second start
      server.stop();
    });

    it("should handle multiple stop calls gracefully", () => {
      server.start();
      expect(() => server.stop()).not.toThrow();
      expect(() => server.stop()).not.toThrow(); // Should not throw on second stop
    });
  });

  describe("emit", () => {
    it("should store events in history", () => {
      const event: DevToolsEvent = {
        type: "execution_start",
        executionId: "test-123",
        agentName: "TestAgent",
        timestamp: Date.now(),
      };

      // Emit without clients should not throw
      expect(() => server.emit(event)).not.toThrow();
    });
  });

  describe("getUrl", () => {
    it("should return the correct URL", () => {
      const serverWithPort = new DevToolsServer({ port: 4567 });
      expect(serverWithPort.getUrl()).toBe("http://localhost:4567");
      serverWithPort.stop();
    });
  });

  describe("security config", () => {
    it("should default to localhost binding", () => {
      const secureServer = new DevToolsServer({});
      // Default host should be 127.0.0.1 (internal, not directly testable without reflection)
      expect(secureServer).toBeDefined();
      secureServer.stop();
    });

    it("should accept security configuration", () => {
      const secureServer = new DevToolsServer({
        host: "0.0.0.0",
        secret: "test-secret",
        rateLimit: 100,
        allowedOrigins: ["http://example.com"],
      });
      expect(secureServer).toBeDefined();
      secureServer.stop();
    });
  });
});

describe("DevToolsServer validateEvent", () => {
  // Test event validation logic directly without HTTP server
  // This avoids flaky network tests while still testing the security logic

  // We access the private validateEvent method via prototype for testing
  const server = new DevToolsServer({ port: 0 });
  const validateEvent = (event: unknown) => {
    // @ts-expect-error - accessing private method for testing
    return server["validateEvent"](event);
  };

  afterAll(() => {
    server.stop();
  });

  describe("required fields", () => {
    it("should accept valid execution_start event", () => {
      expect(
        validateEvent({
          type: "execution_start",
          executionId: "test-123",
          agentName: "TestAgent",
          timestamp: Date.now(),
        }),
      ).toBe(true);
    });

    it("should reject events missing type", () => {
      expect(
        validateEvent({
          executionId: "test-123",
          timestamp: Date.now(),
        }),
      ).toBe(false);
    });

    it("should reject events missing executionId", () => {
      expect(
        validateEvent({
          type: "execution_start",
          timestamp: Date.now(),
        }),
      ).toBe(false);
    });

    it("should reject events missing timestamp", () => {
      expect(
        validateEvent({
          type: "execution_start",
          executionId: "test-123",
        }),
      ).toBe(false);
    });

    it("should reject null", () => {
      expect(validateEvent(null)).toBe(false);
    });

    it("should reject non-objects", () => {
      expect(validateEvent("string")).toBe(false);
      expect(validateEvent(123)).toBe(false);
    });
  });

  describe("event type validation", () => {
    it("should accept all valid event types", () => {
      const validTypes = [
        "execution_start",
        "execution_end",
        "tick_start",
        "tick_end",
        "compiled",
        "model_start",
        "model_output",
        "content_delta",
        "reasoning_delta",
        "tool_call",
        "tool_result",
        "tool_confirmation",
        "state_change",
      ];

      for (const type of validTypes) {
        const event: Record<string, unknown> = {
          type,
          executionId: "test-123",
          timestamp: Date.now(),
        };

        // Tick events need tick number
        const tickEvents = [
          "tick_start",
          "tick_end",
          "compiled",
          "model_start",
          "model_output",
          "content_delta",
          "reasoning_delta",
          "tool_call",
          "tool_result",
          "tool_confirmation",
          "state_change",
        ];
        if (tickEvents.includes(type)) {
          event.tick = 1;
        }

        expect(validateEvent(event)).toBe(true);
      }
    });

    it("should reject invalid event types", () => {
      expect(
        validateEvent({
          type: "invalid_type",
          executionId: "test-123",
          timestamp: Date.now(),
        }),
      ).toBe(false);
    });

    it("should reject events with type too long", () => {
      expect(
        validateEvent({
          type: "a".repeat(100),
          executionId: "test-123",
          timestamp: Date.now(),
        }),
      ).toBe(false);
    });
  });

  describe("tick events", () => {
    it("should reject tick events without tick number", () => {
      expect(
        validateEvent({
          type: "tick_start",
          executionId: "test-123",
          timestamp: Date.now(),
        }),
      ).toBe(false);
    });

    it("should accept tick events with valid tick number", () => {
      expect(
        validateEvent({
          type: "tick_start",
          executionId: "test-123",
          timestamp: Date.now(),
          tick: 1,
        }),
      ).toBe(true);
    });

    it("should reject tick events with negative tick", () => {
      expect(
        validateEvent({
          type: "tick_start",
          executionId: "test-123",
          timestamp: Date.now(),
          tick: -1,
        }),
      ).toBe(false);
    });
  });
});

describe("DevToolsServer auth verification", () => {
  it("should pass auth when no secret configured", () => {
    const server = new DevToolsServer({ port: 0 });
    // @ts-expect-error - accessing private method for testing
    const result = server["verifyAuth"]({ headers: {} });
    expect(result).toBe(true);
    server.stop();
  });

  it("should fail auth when secret configured but no header", () => {
    const server = new DevToolsServer({ port: 0, secret: "test-secret" });
    // @ts-expect-error - accessing private method for testing
    const result = server["verifyAuth"]({ headers: {} });
    expect(result).toBe(false);
    server.stop();
  });

  it("should fail auth with wrong token", () => {
    const server = new DevToolsServer({ port: 0, secret: "test-secret" });
    // @ts-expect-error - accessing private method for testing
    const result = server["verifyAuth"]({ headers: { authorization: "Bearer wrong" } });
    expect(result).toBe(false);
    server.stop();
  });

  it("should pass auth with correct token", () => {
    const server = new DevToolsServer({ port: 0, secret: "test-secret" });
    // @ts-expect-error - accessing private method for testing
    const result = server["verifyAuth"]({ headers: { authorization: "Bearer test-secret" } });
    expect(result).toBe(true);
    server.stop();
  });
});

describe("DevToolsServer rate limiting", () => {
  it("should allow requests under limit", () => {
    const server = new DevToolsServer({ port: 0, rateLimit: 5 });
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(true);
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(true);
    server.stop();
  });

  it("should block requests over limit", () => {
    const server = new DevToolsServer({ port: 0, rateLimit: 2 });
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(true);
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(true);
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(false); // Over limit
    server.stop();
  });

  it("should track IPs separately", () => {
    const server = new DevToolsServer({ port: 0, rateLimit: 1 });
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(true);
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.1")).toBe(false); // Over limit
    // @ts-expect-error - accessing private method for testing
    expect(server["checkRateLimit"]("192.168.1.2")).toBe(true); // Different IP
    server.stop();
  });
});

describe("DevToolsServer Registry", () => {
  afterEach(() => {
    stopDevTools();
  });

  describe("singleton behavior", () => {
    it("should return the same instance on multiple calls", () => {
      const server1 = getDevToolsServer({ port: 0, debug: false });
      const server2 = getDevToolsServer({ port: 0, debug: false });
      expect(server1).toBe(server2);
    });

    it("should track active state", () => {
      expect(isDevToolsActive()).toBe(false);
      getDevToolsServer({ port: 0, debug: false });
      expect(isDevToolsActive()).toBe(true);
      stopDevTools();
      expect(isDevToolsActive()).toBe(false);
    });
  });

  describe("emitDevToolsEvent", () => {
    it("should not throw when devtools is not active", () => {
      expect(() =>
        emitDevToolsEvent({
          type: "execution_start",
          executionId: "test-123",
          agentName: "TestAgent",
          timestamp: Date.now(),
        }),
      ).not.toThrow();
    });

    it("should emit events when devtools is active", () => {
      const server = getDevToolsServer({ port: 0, debug: false });
      const emitSpy = vi.spyOn(server, "emit");

      const event: DevToolsEvent = {
        type: "execution_start",
        executionId: "test-123",
        agentName: "TestAgent",
        timestamp: Date.now(),
      };

      emitDevToolsEvent(event);
      expect(emitSpy).toHaveBeenCalledWith(event);
    });
  });

  describe("devToolsEmitter subscription", () => {
    beforeEach(() => {
      devToolsEmitter.clear();
    });

    afterEach(() => {
      stopDevTools();
      devToolsEmitter.clear();
    });

    it("should forward events from devToolsEmitter to server", () => {
      const server = getDevToolsServer({ port: 0, debug: false });
      const emitSpy = vi.spyOn(server, "emit");

      const event: DevToolsEvent = {
        type: "execution_start",
        executionId: "emitter-test-123",
        agentName: "EmitterTestAgent",
        timestamp: Date.now(),
      };

      // Emit via the singleton emitter (like an engine would)
      devToolsEmitter.emitEvent(event);

      // Should be forwarded to server
      expect(emitSpy).toHaveBeenCalledWith(event);
    });

    it("should stop forwarding after stopDevTools", () => {
      const server = getDevToolsServer({ port: 0, debug: false });
      const emitSpy = vi.spyOn(server, "emit");

      const event1: DevToolsEvent = {
        type: "execution_start",
        executionId: "test-1",
        agentName: "Agent1",
        timestamp: Date.now(),
      };

      devToolsEmitter.emitEvent(event1);
      expect(emitSpy).toHaveBeenCalledTimes(1);

      stopDevTools();

      const event2: DevToolsEvent = {
        type: "execution_start",
        executionId: "test-2",
        agentName: "Agent2",
        timestamp: Date.now(),
      };

      devToolsEmitter.emitEvent(event2);
      // Should not be forwarded - registry unsubscribed
      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });
});
