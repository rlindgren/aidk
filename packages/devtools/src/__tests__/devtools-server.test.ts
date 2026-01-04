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
