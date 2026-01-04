import { describe, it, expect } from "vitest";
import {
  DEVTOOLS_CHANNEL,
  type DevToolsEvent,
  type ExecutionStartEvent,
  type ExecutionEndEvent,
  type TickStartEvent,
  type TickEndEvent,
  type CompiledEvent,
  type ModelStartEvent,
  type ContentDeltaEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type StateChangeEvent,
} from "../events";

describe("DevTools Events", () => {
  it("should export DEVTOOLS_CHANNEL constant", () => {
    expect(DEVTOOLS_CHANNEL).toBe("__devtools__");
  });

  describe("Event types", () => {
    it("should allow creating ExecutionStartEvent", () => {
      const event: ExecutionStartEvent = {
        type: "execution_start",
        executionId: "exec-1",
        agentName: "TestAgent",
        sessionId: "sess-1",
        timestamp: Date.now(),
      };

      expect(event.type).toBe("execution_start");
      expect(event.executionId).toBe("exec-1");
      expect(event.agentName).toBe("TestAgent");
      expect(event.sessionId).toBe("sess-1");
    });

    it("should allow creating ExecutionEndEvent", () => {
      const event: ExecutionEndEvent = {
        type: "execution_end",
        executionId: "exec-1",
        totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        timestamp: Date.now(),
      };

      expect(event.type).toBe("execution_end");
      expect(event.totalUsage.totalTokens).toBe(150);
    });

    it("should allow creating TickStartEvent", () => {
      const event: TickStartEvent = {
        type: "tick_start",
        executionId: "exec-1",
        tick: 1,
        timestamp: Date.now(),
      };

      expect(event.type).toBe("tick_start");
      expect(event.tick).toBe(1);
    });

    it("should allow creating TickEndEvent", () => {
      const event: TickEndEvent = {
        type: "tick_end",
        executionId: "exec-1",
        tick: 1,
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        stopReason: "end_turn",
        timestamp: Date.now(),
      };

      expect(event.type).toBe("tick_end");
      expect(event.tick).toBe(1);
      expect(event.stopReason).toBe("end_turn");
    });

    it("should allow creating CompiledEvent", () => {
      const event: CompiledEvent = {
        type: "compiled",
        executionId: "exec-1",
        tick: 1,
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        tools: [{ name: "test", description: "Test tool", input: {} }],
        system: "You are helpful",
        timestamp: Date.now(),
      };

      expect(event.type).toBe("compiled");
      expect(event.messages).toHaveLength(1);
      expect(event.tools).toHaveLength(1);
      expect(event.system).toBe("You are helpful");
    });

    it("should allow creating ModelStartEvent", () => {
      const event: ModelStartEvent = {
        type: "model_start",
        executionId: "exec-1",
        tick: 1,
        modelId: "claude-3-opus",
        provider: "anthropic",
        timestamp: Date.now(),
      };

      expect(event.type).toBe("model_start");
      expect(event.modelId).toBe("claude-3-opus");
      expect(event.provider).toBe("anthropic");
    });

    it("should allow creating ContentDeltaEvent", () => {
      const event: ContentDeltaEvent = {
        type: "content_delta",
        executionId: "exec-1",
        tick: 1,
        delta: "Hello, world!",
        timestamp: Date.now(),
      };

      expect(event.type).toBe("content_delta");
      expect(event.delta).toBe("Hello, world!");
    });

    it("should allow creating ToolCallEvent", () => {
      const event: ToolCallEvent = {
        type: "tool_call",
        executionId: "exec-1",
        tick: 1,
        toolName: "get_weather",
        toolUseId: "tool-123",
        input: { city: "NYC" },
        timestamp: Date.now(),
      };

      expect(event.type).toBe("tool_call");
      expect(event.toolName).toBe("get_weather");
      expect(event.input).toEqual({ city: "NYC" });
    });

    it("should allow creating ToolResultEvent", () => {
      const event: ToolResultEvent = {
        type: "tool_result",
        executionId: "exec-1",
        tick: 1,
        toolUseId: "tool-123",
        result: { temperature: 72 },
        isError: false,
        timestamp: Date.now(),
      };

      expect(event.type).toBe("tool_result");
      expect(event.result).toEqual({ temperature: 72 });
      expect(event.isError).toBe(false);
    });

    it("should allow creating StateChangeEvent", () => {
      const event: StateChangeEvent = {
        type: "state_change",
        executionId: "exec-1",
        tick: 1,
        key: "count",
        oldValue: 0,
        newValue: 1,
        timestamp: Date.now(),
      };

      expect(event.type).toBe("state_change");
      expect(event.key).toBe("count");
      expect(event.oldValue).toBe(0);
      expect(event.newValue).toBe(1);
    });
  });

  describe("DevToolsEvent union type", () => {
    it("should accept any valid event type", () => {
      const events: DevToolsEvent[] = [
        {
          type: "execution_start",
          executionId: "e1",
          agentName: "Agent",
          timestamp: Date.now(),
        },
        {
          type: "execution_end",
          executionId: "e1",
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          timestamp: Date.now(),
        },
        {
          type: "tick_start",
          executionId: "e1",
          tick: 1,
          timestamp: Date.now(),
        },
        {
          type: "tick_end",
          executionId: "e1",
          tick: 1,
          timestamp: Date.now(),
        },
        {
          type: "compiled",
          executionId: "e1",
          tick: 1,
          messages: [],
          tools: [],
          timestamp: Date.now(),
        },
        {
          type: "model_start",
          executionId: "e1",
          tick: 1,
          modelId: "model",
          timestamp: Date.now(),
        },
        {
          type: "content_delta",
          executionId: "e1",
          tick: 1,
          delta: "text",
          timestamp: Date.now(),
        },
        {
          type: "tool_call",
          executionId: "e1",
          tick: 1,
          toolName: "tool",
          toolUseId: "id",
          input: {},
          timestamp: Date.now(),
        },
        {
          type: "tool_result",
          executionId: "e1",
          tick: 1,
          toolUseId: "id",
          result: "ok",
          timestamp: Date.now(),
        },
        {
          type: "state_change",
          executionId: "e1",
          tick: 1,
          key: "key",
          oldValue: null,
          newValue: "value",
          timestamp: Date.now(),
        },
      ];

      expect(events).toHaveLength(10);

      // Type narrowing should work
      for (const event of events) {
        switch (event.type) {
          case "execution_start":
            expect(event.agentName).toBeDefined();
            break;
          case "execution_end":
            expect(event.totalUsage).toBeDefined();
            break;
          case "tick_start":
          case "tick_end":
            expect(event.tick).toBeDefined();
            break;
          case "compiled":
            expect(event.messages).toBeDefined();
            expect(event.tools).toBeDefined();
            break;
          case "model_start":
            expect(event.modelId).toBeDefined();
            break;
          case "content_delta":
            expect(event.delta).toBeDefined();
            break;
          case "tool_call":
            expect(event.toolName).toBeDefined();
            expect(event.input).toBeDefined();
            break;
          case "tool_result":
            expect(event.result).toBeDefined();
            break;
          case "state_change":
            expect(event.key).toBeDefined();
            expect(event.newValue).toBeDefined();
            break;
        }
      }
    });
  });
});
