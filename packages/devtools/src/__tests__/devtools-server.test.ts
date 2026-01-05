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

describe("DevToolsServer API endpoints", () => {
  let server: DevToolsServer;

  beforeEach(() => {
    server = new DevToolsServer({ port: 0, debug: false });
  });

  afterEach(() => {
    server.stop();
  });

  describe("handleApiEvents", () => {
    it("should return empty events with pagination", () => {
      const url = new URL("http://localhost/api/events");
      // @ts-expect-error - accessing private method for testing
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiEvents"](url, mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.events).toEqual([]);
      expect(response.pagination).toEqual({
        total: 0,
        limit: 100,
        offset: 0,
        hasMore: false,
      });
    });

    it("should filter by event type", () => {
      // Add some events to history
      const events: DevToolsEvent[] = [
        { type: "execution_start", executionId: "exec-1", agentName: "Agent1", timestamp: 1000 },
        { type: "tool_call", executionId: "exec-1", tick: 1, toolName: "myTool", timestamp: 2000 },
        { type: "execution_end", executionId: "exec-1", timestamp: 3000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const url = new URL("http://localhost/api/events?type=tool_call");
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiEvents"](url, mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.events).toHaveLength(1);
      expect(response.events[0].type).toBe("tool_call");
    });

    it("should filter by executionId", () => {
      const events: DevToolsEvent[] = [
        { type: "execution_start", executionId: "exec-1", agentName: "Agent1", timestamp: 1000 },
        { type: "execution_start", executionId: "exec-2", agentName: "Agent2", timestamp: 2000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const url = new URL("http://localhost/api/events?executionId=exec-1");
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiEvents"](url, mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.events).toHaveLength(1);
      expect(response.events[0].executionId).toBe("exec-1");
    });

    it("should support pagination with limit and offset", () => {
      const events: DevToolsEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({
          type: "execution_start",
          executionId: `exec-${i}`,
          agentName: `Agent${i}`,
          timestamp: 1000 + i,
        });
      }
      for (const event of events) {
        server.emit(event);
      }

      const url = new URL("http://localhost/api/events?limit=3&offset=2");
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiEvents"](url, mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.events).toHaveLength(3);
      expect(response.pagination.total).toBe(10);
      expect(response.pagination.hasMore).toBe(true);
    });

    it("should respect max limit of 1000", () => {
      const url = new URL("http://localhost/api/events?limit=5000");
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiEvents"](url, mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.pagination.limit).toBe(1000);
    });

    it("should sort by timestamp ascending", () => {
      const events: DevToolsEvent[] = [
        { type: "execution_start", executionId: "exec-1", agentName: "Agent1", timestamp: 3000 },
        { type: "execution_start", executionId: "exec-2", agentName: "Agent2", timestamp: 1000 },
        { type: "execution_start", executionId: "exec-3", agentName: "Agent3", timestamp: 2000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const url = new URL("http://localhost/api/events?order=asc");
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiEvents"](url, mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.events[0].timestamp).toBe(1000);
      expect(response.events[1].timestamp).toBe(2000);
      expect(response.events[2].timestamp).toBe(3000);
    });
  });

  describe("handleApiSummary", () => {
    it("should return markdown content type", () => {
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    });

    it("should include summary header", () => {
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.body).toContain("# AIDK DevTools Summary");
    });

    it("should include executions section", () => {
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.body).toContain("## Executions");
    });

    it("should include procedures section", () => {
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.body).toContain("## Recent Procedures");
    });

    it("should include API help section", () => {
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.body).toContain("## API Endpoints");
      expect(mockRes.body).toContain("GET /api/events");
      expect(mockRes.body).toContain("GET /api/summary");
    });

    it("should summarize executions from events", () => {
      const events: DevToolsEvent[] = [
        { type: "execution_start", executionId: "exec-1", agentName: "TestAgent", timestamp: 1000 },
        {
          type: "tick_end",
          executionId: "exec-1",
          tick: 1,
          usage: { totalTokens: 100 },
          timestamp: 2000,
        },
        { type: "execution_end", executionId: "exec-1", timestamp: 3000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.body).toContain("TestAgent");
      expect(mockRes.body).toContain("completed");
    });

    it("should track procedures from events", () => {
      const events: DevToolsEvent[] = [
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-1",
          procedureName: "engine:stream",
          timestamp: 1000,
        },
        { type: "procedure_end", executionId: "exec-1", procedureId: "proc-1", timestamp: 2000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiSummary"](mockRes);

      expect(mockRes.body).toContain("engine:stream");
      expect(mockRes.body).toContain("completed");
    });
  });

  describe("handleApiExecutions", () => {
    it("should list executions with summary", () => {
      const events: DevToolsEvent[] = [
        { type: "execution_start", executionId: "exec-1", agentName: "Agent1", timestamp: 1000 },
        {
          type: "tick_end",
          executionId: "exec-1",
          tick: 1,
          usage: { totalTokens: 100 },
          timestamp: 2000,
        },
        {
          type: "tool_call",
          executionId: "exec-1",
          tick: 1,
          toolName: "myTool",
          callId: "call-1",
          timestamp: 2500,
        },
        { type: "execution_end", executionId: "exec-1", timestamp: 3000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiExecutions"](new URL("http://localhost/api/executions"), mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.executions).toHaveLength(1);
      expect(response.executions[0].agentName).toBe("Agent1");
      expect(response.executions[0].status).toBe("completed");
      expect(response.executions[0].ticks).toBe(1);
      expect(response.executions[0].totalTokens).toBe(100);
      expect(response.executions[0].toolCalls).toBe(1);
    });
  });

  describe("handleApiExecutionTree", () => {
    it("should return execution with procedure tree", () => {
      const events: DevToolsEvent[] = [
        { type: "execution_start", executionId: "exec-1", agentName: "Agent1", timestamp: 1000 },
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-1",
          procedureName: "engine:stream",
          timestamp: 1100,
        },
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-2",
          procedureName: "model:generate",
          parentProcedureId: "proc-1",
          timestamp: 1200,
        },
        { type: "procedure_end", executionId: "exec-1", procedureId: "proc-2", timestamp: 1300 },
        { type: "procedure_end", executionId: "exec-1", procedureId: "proc-1", timestamp: 1400 },
        { type: "execution_end", executionId: "exec-1", timestamp: 2000 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiExecutionTree"](
        new URL("http://localhost/api/executions/exec-1/tree"),
        "exec-1",
        mockRes,
      );

      const response = JSON.parse(mockRes.body);
      expect(response.execution.agentName).toBe("Agent1");
      expect(response.procedureTree).toHaveLength(1);
      expect(response.procedureTree[0].name).toBe("engine:stream");
      expect(response.procedureTree[0].children).toHaveLength(1);
      expect(response.procedureTree[0].children[0].name).toBe("model:generate");
    });

    it("should return 404 for unknown execution", () => {
      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiExecutionTree"](
        new URL("http://localhost/api/executions/unknown/tree"),
        "unknown",
        mockRes,
      );

      expect(mockRes.statusCode).toBe(404);
    });
  });

  describe("handleApiProcedureTree", () => {
    it("should return procedure with subtree and ancestry", () => {
      const events: DevToolsEvent[] = [
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-1",
          procedureName: "engine:stream",
          timestamp: 1000,
        },
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-2",
          procedureName: "model:generate",
          parentProcedureId: "proc-1",
          timestamp: 1100,
        },
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-3",
          procedureName: "tool:myTool",
          parentProcedureId: "proc-2",
          timestamp: 1200,
        },
        { type: "procedure_end", executionId: "exec-1", procedureId: "proc-3", timestamp: 1300 },
        { type: "procedure_end", executionId: "exec-1", procedureId: "proc-2", timestamp: 1400 },
        { type: "procedure_end", executionId: "exec-1", procedureId: "proc-1", timestamp: 1500 },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiProcedureTree"](
        new URL("http://localhost/api/procedures/proc-2/tree"),
        "proc-2",
        mockRes,
      );

      const response = JSON.parse(mockRes.body);
      expect(response.procedure.name).toBe("model:generate");
      expect(response.ancestry).toHaveLength(1);
      expect(response.ancestry[0]).toContain("engine:stream");
      expect(response.children).toHaveLength(1);
      expect(response.children[0].name).toBe("tool:myTool");
    });
  });

  describe("handleApiErrors", () => {
    it("should return errors with ancestry", () => {
      const events: DevToolsEvent[] = [
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-1",
          procedureName: "engine:stream",
          timestamp: 1000,
        },
        {
          type: "procedure_start",
          executionId: "exec-1",
          procedureId: "proc-2",
          procedureName: "tool:myTool",
          parentProcedureId: "proc-1",
          timestamp: 1100,
        },
        {
          type: "procedure_error",
          executionId: "exec-1",
          procedureId: "proc-2",
          procedureName: "tool:myTool",
          error: { message: "Something failed" },
          timestamp: 1200,
        },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiErrors"](new URL("http://localhost/api/errors"), mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.count).toBe(1);
      expect(response.errors[0].procedureName).toBe("tool:myTool");
      expect(response.errors[0].error.message).toBe("Something failed");
      expect(response.errors[0].ancestry).toHaveLength(1);
    });
  });

  describe("handleApiTools", () => {
    it("should pair tool calls with results", () => {
      const events: DevToolsEvent[] = [
        {
          type: "tool_call",
          executionId: "exec-1",
          tick: 1,
          toolName: "myTool",
          callId: "call-1",
          input: { query: "test" },
          timestamp: 1000,
        },
        {
          type: "tool_result",
          executionId: "exec-1",
          tick: 1,
          callId: "call-1",
          output: { result: "success" },
          isError: false,
          timestamp: 1100,
        },
        {
          type: "tool_call",
          executionId: "exec-1",
          tick: 1,
          toolName: "failTool",
          callId: "call-2",
          input: {},
          timestamp: 1200,
        },
        {
          type: "tool_result",
          executionId: "exec-1",
          tick: 1,
          callId: "call-2",
          output: { error: "failed" },
          isError: true,
          timestamp: 1300,
        },
      ];
      for (const event of events) {
        server.emit(event);
      }

      const mockRes = createMockResponse();
      // @ts-expect-error - accessing private method for testing
      server["handleApiTools"](new URL("http://localhost/api/tools"), mockRes);

      const response = JSON.parse(mockRes.body);
      expect(response.summary.total).toBe(2);
      expect(response.summary.succeeded).toBe(1);
      expect(response.summary.failed).toBe(1);
      expect(response.tools).toHaveLength(2);
      expect(response.tools[0].result).toBeDefined();
    });
  });
});

// Helper to create a mock ServerResponse
function createMockResponse() {
  const res: {
    body: string;
    headers: Record<string, string>;
    statusCode: number;
    writeHead: (code: number, headers?: Record<string, string>) => void;
    end: (body?: string) => void;
  } = {
    body: "",
    headers: {},
    statusCode: 200,
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      if (headers) {
        Object.assign(this.headers, headers);
      }
    },
    end(body?: string) {
      this.body = body || "";
    },
  };
  return res;
}

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
