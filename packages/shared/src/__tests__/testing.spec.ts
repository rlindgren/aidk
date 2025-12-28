/**
 * Tests for the testing utilities themselves
 */

import { EventEmitter } from "events";
import {
  // Fixtures
  testId,
  resetTestIds,
  createTextBlock,
  createImageBlock,
  createToolUseBlock,
  createToolResultBlock,
  createUserMessage,
  createAssistantMessage,
  createConversation,
  createToolDefinition,
  createTextStreamSequence,
  createToolCallStreamSequence,
  // Helpers
  waitForEvent,
  waitForEvents,
  waitFor,
  sleep,
  createDeferred,
  captureAsyncGenerator,
  arrayToAsyncGenerator,
  createControllableGenerator,
  parseSSEEvent,
  parseSSEBuffer,
  formatSSEEvent,
  createSpy,
  createMockSequence,
} from "../testing";
import { StreamChunkType, StopReason } from "../streaming";

describe("Fixtures", () => {
  beforeEach(() => {
    resetTestIds();
  });

  describe("testId", () => {
    it("should generate unique IDs", () => {
      const id1 = testId("test");
      const id2 = testId("test");
      const id3 = testId("other");

      expect(id1).toBe("test-1");
      expect(id2).toBe("test-2");
      expect(id3).toBe("other-3");
    });

    it("should reset counter", () => {
      testId("test");
      testId("test");
      resetTestIds();
      const id = testId("test");

      expect(id).toBe("test-1");
    });
  });

  describe("Content Block Fixtures", () => {
    it("should create text block", () => {
      const block = createTextBlock("Hello world");

      expect(block.type).toBe("text");
      expect(block.text).toBe("Hello world");
    });

    it("should create text block with overrides", () => {
      const block = createTextBlock("Hello", { id: "custom-id" });

      expect(block.id).toBe("custom-id");
    });

    it("should create image block", () => {
      const block = createImageBlock("https://example.com/img.png");

      expect(block.type).toBe("image");
      expect(block.source).toEqual({
        type: "url",
        url: "https://example.com/img.png",
      });
    });

    it("should create tool use block", () => {
      const block = createToolUseBlock("search", { query: "test" });

      expect(block.type).toBe("tool_use");
      expect(block.name).toBe("search");
      expect(block.input).toEqual({ query: "test" });
      expect(block.toolUseId).toMatch(/^tool-use-\d+$/);
    });

    it("should create tool result block", () => {
      const block = createToolResultBlock("tool-123", [
        createTextBlock("Result"),
      ]);

      expect(block.type).toBe("tool_result");
      expect(block.toolUseId).toBe("tool-123");
      expect(block.isError).toBe(false);
    });
  });

  describe("Message Fixtures", () => {
    it("should create user message from string", () => {
      const msg = createUserMessage("Hello");

      expect(msg.role).toBe("user");
      expect(msg.content).toEqual([{ type: "text", text: "Hello" }]);
      expect(msg.id).toMatch(/^msg-\d+$/);
    });

    it("should create assistant message", () => {
      const msg = createAssistantMessage("Hi there");

      expect(msg.role).toBe("assistant");
      expect(msg.content).toEqual([{ type: "text", text: "Hi there" }]);
    });

    it("should create conversation", () => {
      const messages = createConversation([
        { user: "Hello", assistant: "Hi!" },
        { user: "How are you?", assistant: "I am good!" },
      ]);

      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
      expect(messages[2].role).toBe("user");
      expect(messages[3].role).toBe("assistant");
    });
  });

  describe("Tool Fixtures", () => {
    it("should create tool definition", () => {
      const tool = createToolDefinition("search");

      expect(tool.name).toBe("search");
      expect(tool.description).toContain("search");
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("Stream Fixtures", () => {
    it("should create text stream sequence", () => {
      const chunks = createTextStreamSequence("Hello", 2);

      expect(chunks[0].type).toBe(StreamChunkType.MESSAGE_START);
      expect(chunks[chunks.length - 1].type).toBe(StreamChunkType.MESSAGE_END);
      expect(chunks[chunks.length - 1].stopReason).toBe(StopReason.STOP);

      // Should have content deltas in the middle
      const deltas = chunks.filter(
        (c) => c.type === StreamChunkType.CONTENT_DELTA,
      );
      expect(deltas.length).toBeGreaterThan(0);
    });

    it("should create tool call stream sequence", () => {
      const chunks = createToolCallStreamSequence(
        "search",
        { query: "test" },
        { results: [] },
      );

      expect(chunks[0].type).toBe(StreamChunkType.MESSAGE_START);
      expect(chunks.some((c) => c.type === StreamChunkType.TOOL_CALL)).toBe(
        true,
      );
      expect(chunks.some((c) => c.type === StreamChunkType.TOOL_RESULT)).toBe(
        true,
      );
      expect(chunks[chunks.length - 1].stopReason).toBe(StopReason.TOOL_USE);
    });
  });
});

describe("Helpers", () => {
  describe("waitForEvent", () => {
    it("should resolve when event is emitted", async () => {
      const emitter = new EventEmitter();
      const promise = waitForEvent<string>(emitter, "test");

      emitter.emit("test", "value");

      await expect(promise).resolves.toBe("value");
    });

    it("should reject on timeout", async () => {
      const emitter = new EventEmitter();
      const promise = waitForEvent(emitter, "test", 50);

      await expect(promise).rejects.toThrow("Timeout");
    });
  });

  describe("waitForEvents", () => {
    it("should collect multiple events", async () => {
      const emitter = new EventEmitter();
      const promise = waitForEvents<number>(emitter, "data", 3);

      emitter.emit("data", 1);
      emitter.emit("data", 2);
      emitter.emit("data", 3);

      await expect(promise).resolves.toEqual([1, 2, 3]);
    });
  });

  describe("waitFor", () => {
    it("should resolve when condition becomes true", async () => {
      let ready = false;
      setTimeout(() => (ready = true), 50);

      await expect(waitFor(() => ready)).resolves.toBeUndefined();
    });

    it("should reject on timeout", async () => {
      await expect(
        waitFor(() => false, { timeout: 50, message: "Never ready" }),
      ).rejects.toThrow("Never ready");
    });
  });

  describe("sleep", () => {
    it("should delay execution", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("createDeferred", () => {
    it("should resolve when resolve is called", async () => {
      const { promise, resolve } = createDeferred<string>();

      resolve("value");

      await expect(promise).resolves.toBe("value");
    });

    it("should reject when reject is called", async () => {
      const { promise, reject } = createDeferred<string>();

      reject(new Error("failed"));

      await expect(promise).rejects.toThrow("failed");
    });
  });

  describe("captureAsyncGenerator", () => {
    it("should capture all items", async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const items = await captureAsyncGenerator(gen());

      expect(items).toEqual([1, 2, 3]);
    });

    it("should timeout on infinite generator", async () => {
      async function* infinite() {
        while (true) {
          await sleep(100);
          yield 1;
        }
      }

      await expect(
        captureAsyncGenerator(infinite(), { timeout: 50 }),
      ).rejects.toThrow("timeout");
    });
  });

  describe("arrayToAsyncGenerator", () => {
    it("should yield items from array", async () => {
      const items = await captureAsyncGenerator(
        arrayToAsyncGenerator([1, 2, 3]),
      );

      expect(items).toEqual([1, 2, 3]);
    });

    it("should delay between items when specified", async () => {
      const start = Date.now();
      await captureAsyncGenerator(arrayToAsyncGenerator([1, 2], 50));
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("createControllableGenerator", () => {
    it("should yield pushed values", async () => {
      const { generator, push, complete } =
        createControllableGenerator<number>();

      const capturePromise = captureAsyncGenerator(generator);

      push(1);
      push(2);
      push(3);
      complete();

      const items = await capturePromise;
      expect(items).toEqual([1, 2, 3]);
    });

    it("should throw on error", async () => {
      const { generator, push, error } = createControllableGenerator<number>();

      const capturePromise = captureAsyncGenerator(generator);

      push(1);
      error(new Error("failed"));

      await expect(capturePromise).rejects.toThrow("failed");
    });
  });
});

describe("SSE Utilities", () => {
  describe("parseSSEEvent", () => {
    it("should parse event with data", () => {
      const result = parseSSEEvent("data: hello world");

      expect(result).toEqual({ data: "hello world" });
    });

    it("should parse event with type and data", () => {
      const result = parseSSEEvent("event: message\ndata: hello");

      expect(result).toEqual({ event: "message", data: "hello" });
    });

    it("should parse event with id", () => {
      const result = parseSSEEvent("id: 123\ndata: hello");

      expect(result).toEqual({ id: "123", data: "hello" });
    });

    it("should return null for empty string", () => {
      expect(parseSSEEvent("")).toBeNull();
      expect(parseSSEEvent("   ")).toBeNull();
    });
  });

  describe("parseSSEBuffer", () => {
    it("should parse multiple events", () => {
      const buffer = "data: one\n\ndata: two\n\ndata: three\n\n";
      const events = parseSSEBuffer(buffer);

      expect(events).toHaveLength(3);
      expect(events[0].data).toBe("one");
      expect(events[1].data).toBe("two");
      expect(events[2].data).toBe("three");
    });
  });

  describe("formatSSEEvent", () => {
    it("should format string data", () => {
      const result = formatSSEEvent("hello");

      expect(result).toBe("data: hello\n\n");
    });

    it("should format object as JSON", () => {
      const result = formatSSEEvent({ foo: "bar" });

      expect(result).toBe('data: {"foo":"bar"}\n\n');
    });

    it("should include event type", () => {
      const result = formatSSEEvent("hello", { event: "message" });

      expect(result).toBe("event: message\ndata: hello\n\n");
    });

    it("should include id", () => {
      const result = formatSSEEvent("hello", { id: "123" });

      expect(result).toBe("id: 123\ndata: hello\n\n");
    });
  });
});

describe("Mock Utilities", () => {
  describe("createSpy", () => {
    it("should track calls", () => {
      const spy = createSpy<(a: number, b: number) => number>((a, b) => a + b);

      spy(1, 2);
      spy(3, 4);

      expect(spy.callCount).toBe(2);
      expect(spy.calls).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it("should track results", () => {
      const spy = createSpy((x: number) => x * 2);

      spy(5);
      spy(10);

      expect(spy.results).toEqual([10, 20]);
    });

    it("should reset tracking", () => {
      const spy = createSpy(() => 1);

      spy();
      spy();
      spy.reset();

      expect(spy.callCount).toBe(0);
      expect(spy.calls).toEqual([]);
    });

    it("should allow changing implementation", () => {
      const spy = createSpy(() => 1);

      expect(spy()).toBe(1);

      spy.mockImplementation(() => 2);

      expect(spy()).toBe(2);
    });
  });

  describe("createMockSequence", () => {
    it("should return values in sequence", () => {
      const mock = createMockSequence(1, 2, 3);

      expect(mock()).toBe(1);
      expect(mock()).toBe(2);
      expect(mock()).toBe(3);
    });

    it("should repeat last value when exhausted", () => {
      const mock = createMockSequence(1, 2);

      mock();
      mock();
      expect(mock()).toBe(2);
      expect(mock()).toBe(2);
    });
  });
});
