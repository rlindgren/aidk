/**
 * Tests for Express Engine Middleware
 *
 * Tests the withEngine and withTransport middleware.
 */

import type { Mock } from "vitest";
import {
  withEngine,
  withTransport,
  setupStreamingResponse,
  writeSSEEvent,
  writeSSEEventSafe,
} from "../middleware/engine";
import type { EngineRequest } from "../middleware/engine";
import { SSETransport } from "../transports/sse";
import type { Request, Response, NextFunction } from "express";
import type { Engine } from "aidk";

// =============================================================================
// Mock Engine
// =============================================================================

function createMockEngine(): Engine {
  return {
    execute: {
      withContext: vi.fn(() => async () => ({ timeline: [] })),
    },
  } as unknown as Engine;
}

// =============================================================================
// Mock Request/Response
// =============================================================================

interface MockRequest extends Partial<Request> {
  body: Record<string, unknown>;
  headers: Record<string, string | undefined>;
  engineContext?: EngineRequest["engineContext"];
}

function createMockRequest(
  body: Record<string, unknown> = {},
  headers: Record<string, string | undefined> = {},
): MockRequest {
  return {
    body,
    headers,
  };
}

interface MockResponse extends Partial<Response> {
  _headers: Record<string, string>;
  _written: string[];
}

function createMockResponse(): MockResponse {
  const headers: Record<string, string> = {};
  const written: string[] = [];

  return {
    _headers: headers,
    _written: written,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this as unknown as Response;
    },
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("withEngine middleware", () => {
  let mockEngine: Engine;
  let next: NextFunction;

  beforeEach(() => {
    mockEngine = createMockEngine();
    next = vi.fn();
  });

  it("should attach engineContext to request", async () => {
    const middleware = withEngine({ engine: mockEngine });
    const req = createMockRequest({
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      threadId: "thread-123",
      userId: "user-456",
    });
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    // Middleware calls next() - check if it was called without error
    expect(next).toHaveBeenCalled();

    const engineReq = req as unknown as EngineRequest;
    expect(engineReq.engineContext).toBeDefined();
    expect(engineReq.engineContext.engine).toBe(mockEngine);
    expect(engineReq.engineContext.executionId).toBeDefined();
    expect(engineReq.engineContext.threadId).toBe("thread-123");
    expect(engineReq.engineContext.userId).toBe("user-456");
  });

  it("should support engine factory function", () => {
    const engineFactory = vi.fn(() => mockEngine);
    const middleware = withEngine({ engine: engineFactory });
    const req = createMockRequest({ messages: [], userId: "user-1" });
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    expect(engineFactory).toHaveBeenCalled();
    const engineReq = req as unknown as EngineRequest;
    expect(engineReq.engineContext.engine).toBe(mockEngine);
  });

  it("should use custom ID generator", () => {
    let counter = 0;
    const middleware = withEngine({
      engine: mockEngine,
      generateId: () => `exec_custom_${++counter}`,
    });
    const req = createMockRequest({ messages: [], userId: "user-1" });
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    const engineReq = req as unknown as EngineRequest;
    expect(engineReq.engineContext.executionId).toBe("exec_custom_1");
  });

  it("should use custom context extractor", () => {
    const middleware = withEngine({
      engine: mockEngine,
      extractContext: (body, headers) => ({
        threadId: body.conversation_id as string,
        userId: body.user?.id as string,
        tenantId: headers?.["x-tenant-id"],
        sessionId: headers?.["x-session-id"],
      }),
    });
    const req = createMockRequest(
      {
        messages: [],
        conversation_id: "convo-789",
        user: { id: "custom-user" },
      },
      {
        "x-tenant-id": "tenant-abc",
        "x-session-id": "session-xyz",
      },
    );
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    const engineReq = req as unknown as EngineRequest;
    expect(engineReq.engineContext.threadId).toBe("convo-789");
    expect(engineReq.engineContext.userId).toBe("custom-user");
    expect(engineReq.engineContext.tenantId).toBe("tenant-abc");
    expect(engineReq.engineContext.sessionId).toBe("session-xyz");
  });

  it("should use custom input transformer", () => {
    const middleware = withEngine({
      engine: mockEngine,
      transformInput: (body, _context) => ({
        messages: body.customMessages,
        metadata: { custom: true },
      }),
    });
    const req = createMockRequest({
      customMessages: [{ role: "user", content: "Custom" }],
      userId: "user-1",
    });
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    const engineReq = req as unknown as EngineRequest;
    expect(engineReq.engineContext.input.messages).toEqual([{ role: "user", content: "Custom" }]);
    expect(engineReq.engineContext.input.metadata?.custom).toBe(true);
  });

  it("should provide withContext object", () => {
    const middleware = withEngine({ engine: mockEngine });
    const req = createMockRequest({
      messages: [],
      userId: "user-1",
      threadId: "thread-1",
    });
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    const engineReq = req as unknown as EngineRequest;
    expect(engineReq.engineContext.withContext).toBeDefined();
    // withContext is an object returned by buildEngineContext
    expect(typeof engineReq.engineContext.withContext).toBe("object");
    expect(engineReq.engineContext.withContext.user).toBeDefined();
  });

  it("should call next with error on exception", () => {
    const middleware = withEngine({
      engine: mockEngine,
      extractContext: () => {
        throw new Error("Extraction failed");
      },
    });
    const req = createMockRequest({ messages: [] });
    const res = createMockResponse();

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it("should generate unique execution IDs", () => {
    const middleware = withEngine({ engine: mockEngine });
    const req1 = createMockRequest({ messages: [], userId: "user-1" });
    const req2 = createMockRequest({ messages: [], userId: "user-1" });
    const res = createMockResponse();

    middleware(req1 as Request, res as Response, next);
    middleware(req2 as Request, res as Response, next);

    const engineReq1 = req1 as unknown as EngineRequest;
    const engineReq2 = req2 as unknown as EngineRequest;
    expect(engineReq1.engineContext.executionId).not.toBe(engineReq2.engineContext.executionId);
  });
});

describe("withTransport middleware", () => {
  let transport: SSETransport;
  let next: NextFunction;

  beforeEach(() => {
    transport = new SSETransport();
    next = vi.fn();
  });

  afterEach(() => {
    transport.disconnect();
  });

  it("should error if withEngine not used first", async () => {
    const middleware = withTransport({ transport });
    const req = createMockRequest({});
    const res = createMockResponse();

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next as Mock).mock.calls[0][0].message).toContain("withEngine middleware first");
  });

  it("should attach transport to context", async () => {
    const middleware = withTransport({ transport });
    const req = createMockRequest({
      messages: [],
      userId: "user-1",
      threadId: "thread-1",
    }) as unknown as EngineRequest;

    // Simulate withEngine already ran
    req.engineContext = {
      engine: createMockEngine(),
      executionId: "exec-1",
      threadId: "thread-1",
      sessionId: "session-1",
      userId: "user-1",
      input: { messages: [] },
      withContext: {} as any,
    };

    const res = createMockResponse();

    await middleware(req as unknown as Request, res as Response, next);

    expect(req.engineContext.transport).toBe(transport);
    expect(next).toHaveBeenCalledWith();
  });

  it("should use custom room pattern", async () => {
    const joinSpy = vi.spyOn(transport, "join");
    const mockRes = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(() => true),
      on: vi.fn(),
    };

    // Connect the session first
    await transport.connect("session-1", {
      res: mockRes as unknown as Response,
    });

    const middleware = withTransport({
      transport,
      roomPattern: (ctx) => `org:${ctx.tenantId}:user:${ctx.userId}`,
    });

    const req = createMockRequest({}) as unknown as EngineRequest;
    req.engineContext = {
      engine: createMockEngine(),
      executionId: "exec-1",
      threadId: "thread-1",
      sessionId: "session-1",
      userId: "user-1",
      tenantId: "tenant-1",
      input: { messages: [] },
      withContext: {} as any,
    };

    const res = createMockResponse();

    await middleware(req as unknown as Request, res as Response, next);

    expect(joinSpy).toHaveBeenCalledWith("session-1", "org:tenant-1:user:user-1");
  });

  it("should not join room if session not connected", async () => {
    const joinSpy = vi.spyOn(transport, "join");
    const middleware = withTransport({ transport });

    const req = createMockRequest({}) as unknown as EngineRequest;
    req.engineContext = {
      engine: createMockEngine(),
      executionId: "exec-1",
      threadId: "thread-1",
      sessionId: "not-connected-session",
      userId: "user-1",
      input: { messages: [] },
      withContext: {} as any,
    };

    const res = createMockResponse();

    await middleware(req as unknown as Request, res as Response, next);

    expect(joinSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe("SSE Helper Functions", () => {
  describe("setupStreamingResponse", () => {
    it("should set correct headers", () => {
      const res = createMockResponse();

      setupStreamingResponse(res as Response);

      expect(res._headers["Content-Type"]).toBe("text/event-stream");
      expect(res._headers["Cache-Control"]).toBe("no-cache");
      expect(res._headers["Connection"]).toBe("keep-alive");
    });
  });

  describe("writeSSEEvent", () => {
    it("should write JSON-serialized event", () => {
      const res = createMockResponse();

      writeSSEEvent(res as Response, { type: "test", data: { key: "value" } });

      expect(res._written).toContainEqual('data: {"type":"test","data":{"key":"value"}}\n\n');
    });

    it("should handle primitive values", () => {
      const res = createMockResponse();

      writeSSEEvent(res as Response, "hello");
      writeSSEEvent(res as Response, 42);

      expect(res._written).toContainEqual('data: "hello"\n\n');
      expect(res._written).toContainEqual("data: 42\n\n");
    });
  });

  describe("writeSSEEventSafe", () => {
    it("should serialize Error objects", () => {
      const res = createMockResponse();
      const error = new Error("Something went wrong");

      writeSSEEventSafe(res as Response, {
        type: "error",
        error,
      });

      const written = res._written[0];
      expect(written).toContain('"error":{');
      expect(written).toContain('"message":"Something went wrong"');
      expect(written).toContain('"name":"Error"');
    });

    it("should pass through non-error objects", () => {
      const res = createMockResponse();

      writeSSEEventSafe(res as Response, { type: "data", value: 123 });

      expect(res._written).toContainEqual('data: {"type":"data","value":123}\n\n');
    });

    it("should handle objects without error property", () => {
      const res = createMockResponse();

      writeSSEEventSafe(res as Response, { type: "success", data: "ok" });

      expect(res._written).toContainEqual('data: {"type":"success","data":"ok"}\n\n');
    });
  });
});
