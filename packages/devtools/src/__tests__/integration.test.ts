import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initDevTools,
  isDevToolsActive,
  devtools,
  attachDevTools,
  type DevToolsEngine,
} from "../integration";
import { stopDevTools, getDevToolsServer } from "../server/registry";

describe("DevTools Integration", () => {
  afterEach(() => {
    stopDevTools();
  });

  describe("initDevTools", () => {
    it("should initialize the devtools server", () => {
      expect(isDevToolsActive()).toBe(false);
      initDevTools({ port: 0, debug: false });
      expect(isDevToolsActive()).toBe(true);
    });

    it("should be idempotent", () => {
      initDevTools({ port: 0, debug: false });
      const server1 = getDevToolsServer();
      initDevTools({ port: 0, debug: false });
      const server2 = getDevToolsServer();
      expect(server1).toBe(server2);
    });
  });

  describe("devtools helpers", () => {
    beforeEach(() => {
      initDevTools({ port: 0, debug: false });
    });

    it("should emit execution_start event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.executionStart("exec-1", "MyAgent", "session-1");

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "execution_start",
          executionId: "exec-1",
          agentName: "MyAgent",
          sessionId: "session-1",
        }),
      );
    });

    it("should emit execution_end event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.executionEnd("exec-1", { inputTokens: 100, outputTokens: 50, totalTokens: 150 });

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "execution_end",
          executionId: "exec-1",
          totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        }),
      );
    });

    it("should emit tick_start event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.tickStart("exec-1", 1);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tick_start",
          executionId: "exec-1",
          tick: 1,
        }),
      );
    });

    it("should emit tick_end event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.tickEnd(
        "exec-1",
        1,
        { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        "end_turn",
      );

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tick_end",
          executionId: "exec-1",
          tick: 1,
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
          stopReason: "end_turn",
        }),
      );
    });

    it("should emit compiled event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      const messages = [
        { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
      ];
      const tools = [{ name: "test_tool", description: "A test tool", input: {} }];

      devtools.compiled("exec-1", 1, messages, tools, "You are a helpful assistant");

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "compiled",
          executionId: "exec-1",
          tick: 1,
          messages,
          tools,
          system: "You are a helpful assistant",
        }),
      );
    });

    it("should emit model_start event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.modelStart("exec-1", 1, "claude-3-opus", "anthropic");

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "model_start",
          executionId: "exec-1",
          tick: 1,
          modelId: "claude-3-opus",
          provider: "anthropic",
        }),
      );
    });

    it("should emit content_delta event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.contentDelta("exec-1", 1, "Hello, ");

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "content_delta",
          executionId: "exec-1",
          tick: 1,
          delta: "Hello, ",
        }),
      );
    });

    it("should emit tool_call event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.toolCall("exec-1", 1, "get_weather", "tool-use-123", { city: "NYC" });

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_call",
          executionId: "exec-1",
          tick: 1,
          toolName: "get_weather",
          toolUseId: "tool-use-123",
          input: { city: "NYC" },
        }),
      );
    });

    it("should emit tool_result event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.toolResult("exec-1", 1, "tool-use-123", { temperature: 72 });

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_result",
          executionId: "exec-1",
          tick: 1,
          toolUseId: "tool-use-123",
          result: { temperature: 72 },
        }),
      );
    });

    it("should emit tool_result event with error", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.toolResult("exec-1", 1, "tool-use-123", "City not found", true);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_result",
          executionId: "exec-1",
          tick: 1,
          toolUseId: "tool-use-123",
          result: "City not found",
          isError: true,
        }),
      );
    });

    it("should emit state_change event", () => {
      const server = getDevToolsServer();
      const emitSpy = vi.spyOn(server, "emit");

      devtools.stateChange("exec-1", 1, "count", 0, 1);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "state_change",
          executionId: "exec-1",
          tick: 1,
          key: "count",
          oldValue: 0,
          newValue: 1,
        }),
      );
    });
  });

  describe("attachDevTools", () => {
    it("should initialize devtools server", () => {
      const mockEngine: DevToolsEngine = {
        id: "test-engine",
      };

      expect(isDevToolsActive()).toBe(false);
      const detach = attachDevTools({ instance: mockEngine, port: 0, debug: false });
      expect(isDevToolsActive()).toBe(true);

      // Clean up
      detach();
    });

    it("should return a detach function", () => {
      const mockEngine: DevToolsEngine = {
        id: "test-engine",
      };

      const detach = attachDevTools({ instance: mockEngine, port: 0, debug: false });
      expect(typeof detach).toBe("function");

      // Detach should not throw
      expect(() => detach()).not.toThrow();
    });

    it("should register stream middleware when engineHooks is available", () => {
      const registerSpy = vi.fn();
      const mockEngine: DevToolsEngine = {
        id: "test-engine",
        engineHooks: {
          register: registerSpy,
        },
      };

      const detach = attachDevTools({ instance: mockEngine, port: 0, debug: false });

      expect(registerSpy).toHaveBeenCalledWith("stream", expect.any(Function));

      detach();
    });

    it("should work without engineHooks", () => {
      const mockEngine: DevToolsEngine = {
        id: "test-engine",
        // No engineHooks
      };

      const detach = attachDevTools({ instance: mockEngine, port: 0, debug: false });

      // Should not throw
      expect(isDevToolsActive()).toBe(true);

      detach();
    });
  });
});
