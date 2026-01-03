/**
 * Tests for Server Execution Context
 *
 * Tests context extraction, input transformation, and request attachment.
 */

import {
  // ID Generators
  uuidV4Generator,
  createPrefixedIdGenerator,
  createIdGenerator,
  // Context Extractors
  defaultContextExtractor,
  createContextExtractor,
  // Input Transformers
  messagesToTimeline,
  defaultInputTransformer,
  createInputTransformer,
  // Engine Context
  buildEngineContext,
  // Config
  resolveConfig,
  // Request Context
  AIDK_CONTEXT_KEY,
  attachContext,
  getContext,
  requireContext,
  // Types
  type RequestContext,
  type StandardRequestBody,
} from "../execution-context";

// =============================================================================
// ID Generators
// =============================================================================

describe("ID Generators", () => {
  describe("uuidV4Generator", () => {
    it("should generate valid UUID v4 format", () => {
      const uuid = uuidV4Generator();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(uuidV4Generator());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("createPrefixedIdGenerator", () => {
    it("should create ID with prefix", () => {
      const generator = createPrefixedIdGenerator("exec");
      const id = generator();
      expect(id).toMatch(/^exec_[0-9a-f-]+$/);
    });

    it("should work with different prefixes", () => {
      const execGen = createPrefixedIdGenerator("exec");
      const threadGen = createPrefixedIdGenerator("thread");

      expect(execGen()).toMatch(/^exec_/);
      expect(threadGen()).toMatch(/^thread_/);
    });
  });

  describe("createIdGenerator", () => {
    it("should use provided function", () => {
      let counter = 0;
      const generator = createIdGenerator(() => `id-${++counter}`);

      expect(generator()).toBe("id-1");
      expect(generator()).toBe("id-2");
      expect(generator()).toBe("id-3");
    });
  });
});

// =============================================================================
// Context Extractors
// =============================================================================

describe("Context Extractors", () => {
  describe("defaultContextExtractor", () => {
    it("should extract all fields from body", () => {
      const body: StandardRequestBody = {
        threadId: "thread-123",
        sessionId: "session-456",
        userId: "user-789",
        tenantId: "tenant-abc",
        metadata: { key: "value" },
      };

      const ctx = defaultContextExtractor(body, {});

      expect(ctx.threadId).toBe("thread-123");
      expect(ctx.sessionId).toBe("session-456");
      expect(ctx.userId).toBe("user-789");
      expect(ctx.tenantId).toBe("tenant-abc");
      expect(ctx.metadata).toEqual({ key: "value" });
    });

    it("should use userId when userId not present", () => {
      const body: StandardRequestBody = {
        userId: "user-from-userId",
      };

      const ctx = defaultContextExtractor(body, {});
      expect(ctx.userId).toBe("user-from-userId");
    });

    it("should extract sessionId from header", () => {
      const body: StandardRequestBody = {};
      const headers = { "x-session-id": "header-session" };

      const ctx = defaultContextExtractor(body, headers);
      expect(ctx.sessionId).toBe("header-session");
    });

    it("should prefer body sessionId over header", () => {
      const body: StandardRequestBody = { sessionId: "body-session" };
      const headers = { "x-session-id": "header-session" };

      const ctx = defaultContextExtractor(body, headers);
      expect(ctx.sessionId).toBe("body-session");
    });

    it("should generate threadId if not provided", () => {
      const body: StandardRequestBody = {};
      const ctx = defaultContextExtractor(body, {});

      expect(ctx.threadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("should default userId to anonymous", () => {
      const body: StandardRequestBody = {};
      const ctx = defaultContextExtractor(body, {});

      expect(ctx.userId).toBe("anonymous");
    });

    it("should default tenantId to default", () => {
      const body: StandardRequestBody = {};
      const ctx = defaultContextExtractor(body, {});

      expect(ctx.tenantId).toBe("default");
    });
  });

  describe("createContextExtractor", () => {
    it("should use key-based extraction", () => {
      interface CustomBody {
        conversationId: string;
        clientId: string;
        orgId: string;
      }

      const extractor = createContextExtractor<CustomBody>({
        threadId: "conversationId",
        userId: "clientId",
        tenantId: "orgId",
      });

      const body: CustomBody = {
        conversationId: "conv-123",
        clientId: "client-456",
        orgId: "org-789",
      };

      const ctx = extractor(body, {});

      expect(ctx.threadId).toBe("conv-123");
      expect(ctx.userId).toBe("client-456");
      expect(ctx.tenantId).toBe("org-789");
    });

    it("should use function-based extraction", () => {
      interface CustomBody {
        user: { id: string; organization: { id: string } };
        thread: { uuid: string };
      }

      const extractor = createContextExtractor<CustomBody>({
        threadId: (body) => body.thread.uuid,
        userId: (body) => body.user.id,
        tenantId: (body) => body.user.organization.id,
      });

      const body: CustomBody = {
        user: { id: "user-nested", organization: { id: "org-nested" } },
        thread: { uuid: "thread-nested" },
      };

      const ctx = extractor(body, {});

      expect(ctx.threadId).toBe("thread-nested");
      expect(ctx.userId).toBe("user-nested");
      expect(ctx.tenantId).toBe("org-nested");
    });

    it("should support header-based session extraction", () => {
      interface CustomBody {
        userId: string;
      }

      const extractor = createContextExtractor<CustomBody>({
        userId: "userId",
        sessionId: (_body, headers) => headers?.["x-custom-session"],
      });

      const body: CustomBody = { userId: "user-1" };
      const headers = { "x-custom-session": "custom-session-id" };

      const ctx = extractor(body, headers);
      expect(ctx.sessionId).toBe("custom-session-id");
    });

    it("should use defaults for missing config", () => {
      const extractor = createContextExtractor<{ userId: string }>({
        userId: "userId",
      });

      const ctx = extractor({ userId: "user-1" }, {});

      // threadId should be generated
      expect(ctx.threadId).toMatch(/^[0-9a-f-]+$/);
      // tenantId should default
      expect(ctx.tenantId).toBe("default");
    });
  });
});

// =============================================================================
// Input Transformers
// =============================================================================

describe("Input Transformers", () => {
  describe("messagesToTimeline", () => {
    it("should transform messages to timeline entries", () => {
      const messages: StandardRequestBody["messages"] = [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
        },
      ];

      const timeline = messagesToTimeline(messages);

      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toEqual({
        kind: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
        metadata: {},
      });
      expect(timeline[1]).toEqual({
        kind: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
        },
        metadata: {},
      });
    });

    it("should handle image content", () => {
      const messages: StandardRequestBody["messages"] = [
        {
          role: "user",
          content: [{ type: "image", imageUrl: "https://example.com/image.png" }],
        },
      ];

      const timeline = messagesToTimeline(messages);

      expect(timeline[0].message.content[0]).toEqual({
        type: "image",
        text: "",
        imageUrl: "https://example.com/image.png",
      });
    });

    it("should default type to text", () => {
      const messages: StandardRequestBody["messages"] = [
        {
          role: "user",
          content: [{ text: "No type specified" }],
        },
      ];

      const timeline = messagesToTimeline(messages);

      expect(timeline[0].message.content[0].type).toBe("text");
    });

    it("should preserve metadata", () => {
      const messages: StandardRequestBody["messages"] = [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          metadata: { timestamp: 12345, source: "web" },
        },
      ];

      const timeline = messagesToTimeline(messages);

      expect(timeline[0].metadata).toEqual({ timestamp: 12345, source: "web" });
    });

    it("should return empty array for undefined messages", () => {
      expect(messagesToTimeline(undefined)).toEqual([]);
    });

    it("should return empty array for null messages", () => {
      expect(messagesToTimeline(null as any)).toEqual([]);
    });

    it("should return empty array for non-array messages", () => {
      expect(messagesToTimeline("not an array" as any)).toEqual([]);
    });
  });

  describe("defaultInputTransformer", () => {
    it("should transform body to engine input", () => {
      const body: StandardRequestBody = {
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      };
      const context: RequestContext = {
        threadId: "thread-123",
        sessionId: "session-789",
        userId: "user-456",
        metadata: { custom: "value" },
      };

      const input = defaultInputTransformer(body, context);

      expect(input.timeline).toHaveLength(1);
      expect(input.metadata).toEqual({
        threadId: "thread-123",
        sessionId: "session-789",
        userId: "user-456",
        custom: "value",
      });
    });

    it("should handle empty messages", () => {
      const body: StandardRequestBody = {};
      const context: RequestContext = {
        threadId: "thread-123",
        userId: "user-456",
      };

      const input = defaultInputTransformer(body, context);

      expect(input.timeline).toEqual([]);
    });
  });

  describe("createInputTransformer", () => {
    it("should use custom transformation", () => {
      interface CustomBody {
        conversation: Array<{ from: string; message: string }>;
      }

      const transformer = createInputTransformer<CustomBody>((body, context) => ({
        timeline: body.conversation.map((msg) => ({
          kind: "message" as const,
          message: {
            role: msg.from === "bot" ? "assistant" : "user",
            content: [{ type: "text", text: msg.message }],
          },
          metadata: {},
        })),
        metadata: { threadId: context.threadId },
      }));

      const body: CustomBody = {
        conversation: [
          { from: "human", message: "Hello" },
          { from: "bot", message: "Hi!" },
        ],
      };

      const input = transformer(body, {
        threadId: "thread-1",
        userId: "user-1",
      });

      expect(input.timeline).toHaveLength(2);
      expect(input.timeline?.[0].message.role).toBe("user");
      expect(input.timeline?.[1].message.role).toBe("assistant");
    });
  });
});

// =============================================================================
// Engine Context
// =============================================================================

describe("buildEngineContext", () => {
  it("should build context with user and metadata", () => {
    const ctx = buildEngineContext({
      threadId: "thread-123",
      sessionId: "session-456",
      userId: "user-789",
      tenantId: "tenant-abc",
      executionId: "exec-xyz",
      metadata: { custom: "value" },
    });

    expect(ctx.user).toEqual({ id: "user-789" });
    expect(ctx.metadata).toEqual({
      userId: "user-789",
      tenantId: "tenant-abc",
      threadId: "thread-123",
      sessionId: "session-456",
      executionId: "exec-xyz",
      custom: "value",
    });
  });

  it("should handle minimal context", () => {
    const ctx = buildEngineContext({
      threadId: "thread-1",
      userId: "user-1",
      executionId: "exec-1",
    });

    expect(ctx.user).toEqual({ id: "user-1" });
    expect(ctx.metadata.userId).toBe("user-1");
    expect(ctx.metadata.executionId).toBe("exec-1");
  });
});

// =============================================================================
// Config Resolution
// =============================================================================

describe("resolveConfig", () => {
  const mockEngine = {} as any;

  it("should use provided values", () => {
    const customGenerator = () => "custom-id";
    const customExtractor = () => ({
      threadId: "t",
      userId: "u",
    });
    const customTransformer = () => ({ timeline: [] });

    const resolved = resolveConfig({
      engine: mockEngine,
      generateId: customGenerator,
      extractContext: customExtractor,
      transformInput: customTransformer,
    });

    expect(resolved.engine).toBe(mockEngine);
    expect(resolved.generateId).toBe(customGenerator);
    expect(resolved.extractContext).toBe(customExtractor);
    expect(resolved.transformInput).toBe(customTransformer);
  });

  it("should use defaults for missing values", () => {
    const resolved = resolveConfig({ engine: mockEngine });

    expect(resolved.engine).toBe(mockEngine);
    expect(resolved.generateId).toBe(uuidV4Generator);
    expect(resolved.extractContext).toBe(defaultContextExtractor);
    expect(resolved.transformInput).toBe(defaultInputTransformer);
  });

  it("should support engine factory function", () => {
    const engineFactory = () => mockEngine;
    const resolved = resolveConfig({ engine: engineFactory });

    expect(resolved.engine).toBe(engineFactory);
  });
});

// =============================================================================
// Request Context Attachment
// =============================================================================

describe("Request Context Attachment", () => {
  describe("AIDK_CONTEXT_KEY", () => {
    it("should be a symbol", () => {
      expect(typeof AIDK_CONTEXT_KEY).toBe("symbol");
    });

    it("should have consistent identity", () => {
      expect(AIDK_CONTEXT_KEY).toBe(Symbol.for("aidk.context"));
    });
  });

  describe("attachContext", () => {
    it("should attach context to request object", () => {
      const request: any = {};
      const context: RequestContext = {
        threadId: "thread-123",
        userId: "user-456",
      };

      attachContext(request, context);

      expect(request[AIDK_CONTEXT_KEY]).toBe(context);
    });

    it("should overwrite existing context", () => {
      const request: any = {};
      const context1: RequestContext = {
        threadId: "thread-1",
        userId: "user-1",
      };
      const context2: RequestContext = {
        threadId: "thread-2",
        userId: "user-2",
      };

      attachContext(request, context1);
      attachContext(request, context2);

      expect(request[AIDK_CONTEXT_KEY]).toBe(context2);
    });
  });

  describe("getContext", () => {
    it("should retrieve attached context", () => {
      const request: any = {};
      const context: RequestContext = {
        threadId: "thread-123",
        userId: "user-456",
      };

      attachContext(request, context);
      const retrieved = getContext(request);

      expect(retrieved).toBe(context);
    });

    it("should return undefined if no context attached", () => {
      const request: any = {};
      expect(getContext(request)).toBeUndefined();
    });

    it("should return undefined for empty object", () => {
      expect(getContext({})).toBeUndefined();
    });
  });

  describe("requireContext", () => {
    it("should return context when present", () => {
      const request: any = {};
      const context: RequestContext = {
        threadId: "thread-123",
        userId: "user-456",
      };

      attachContext(request, context);
      const retrieved = requireContext(request);

      expect(retrieved).toBe(context);
    });

    it("should throw when context not present", () => {
      const request: any = {};

      expect(() => requireContext(request)).toThrow("AIDK context not found on request");
    });

    it("should include helpful error message", () => {
      expect(() => requireContext({})).toThrow(/middleware\/interceptor/);
    });
  });
});
