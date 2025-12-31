/**
 * Tests for ExecutionHandler and StreamProcessor
 */

import type { Mock } from "vitest";
import {
  ExecutionHandler,
  StreamProcessor,
  generateMessageId,
  createMessage,
  normalizeMessageInput,
} from "../execution-handler";
import type { Message, ContentBlock } from "../types";

// Mock EngineClient
const createMockClient = () => ({
  stream: vi.fn(),
  execute: vi.fn(),
  sendToolResult: vi.fn(),
  config: {
    baseUrl: "http://localhost:3000",
    agentId: "test-agent",
  },
});

describe("Message Helpers", () => {
  describe("generateMessageId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_\d+_\d+$/);
    });
  });

  describe("createMessage", () => {
    it("should create message with text content", () => {
      const msg = createMessage("user", "Hello");

      expect(msg.role).toBe("user");
      expect(msg.content).toEqual([{ type: "text", text: "Hello" }]);
      expect(msg.id).toBeDefined();
      expect(msg.createdAt).toBeDefined();
    });

    it("should create message with ContentBlock array", () => {
      const blocks: ContentBlock[] = [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ];
      const msg = createMessage("assistant", blocks);

      expect(msg.content).toBe(blocks);
    });

    it("should include metadata", () => {
      const msg = createMessage("user", "Hello", { custom: "value" });

      expect(msg.metadata).toEqual({ custom: "value" });
    });
  });

  describe("normalizeMessageInput", () => {
    it("should convert string to user message", () => {
      const result = normalizeMessageInput("Hello");

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("should convert string to specified role", () => {
      const result = normalizeMessageInput("Hello", "assistant");

      expect(result[0].role).toBe("assistant");
    });

    it("should wrap single ContentBlock in message", () => {
      const block: ContentBlock = { type: "text", text: "Hello" };
      const result = normalizeMessageInput(block);

      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual([block]);
    });

    it("should wrap ContentBlock array in message", () => {
      const blocks: ContentBlock[] = [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ];
      const result = normalizeMessageInput(blocks);

      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual(blocks);
    });

    it("should wrap single Message in array", () => {
      const msg: Message = {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      };
      const result = normalizeMessageInput(msg);

      expect(result).toEqual([msg]);
    });

    it("should return Message array unchanged", () => {
      const messages: Message[] = [
        { id: "1", role: "user", content: [{ type: "text", text: "Hello" }] },
        { id: "2", role: "assistant", content: [{ type: "text", text: "Hi" }] },
      ];
      const result = normalizeMessageInput(messages);

      expect(result).toBe(messages);
    });

    it("should handle non-standard input gracefully", () => {
      // The shared normalizeMessageInput is permissive and doesn't throw for invalid input
      // It relies on TypeScript for type safety at compile time
      const result = normalizeMessageInput(123 as any);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
    });
  });
});

describe("StreamProcessor", () => {
  let processor: StreamProcessor;
  let onMessagesChange: Mock;
  let onThreadIdChange: Mock;
  let onComplete: Mock;
  let onError: Mock;

  beforeEach(() => {
    onMessagesChange = vi.fn();
    onThreadIdChange = vi.fn();
    onComplete = vi.fn();
    onError = vi.fn();

    processor = new StreamProcessor({
      onMessagesChange,
      onThreadIdChange,
      onComplete,
      onError,
    });
  });

  describe("getMessages", () => {
    it("should return empty array initially", () => {
      expect(processor.getMessages()).toEqual([]);
    });

    it("should return copy of messages", () => {
      const msg = createMessage("user", "Hello");
      processor.addMessage(msg);

      const messages = processor.getMessages();
      expect(messages).not.toBe(processor.getMessages());
    });
  });

  describe("addMessage", () => {
    it("should add message and notify", () => {
      const msg = createMessage("user", "Hello");
      processor.addMessage(msg);

      expect(processor.getMessages()).toHaveLength(1);
      expect(onMessagesChange).toHaveBeenCalledWith([msg]);
    });
  });

  describe("updateMessage", () => {
    it("should update message by ID", () => {
      const msg = createMessage("user", "Hello");
      processor.addMessage(msg);

      processor.updateMessage(msg.id!, (m) => ({
        ...m,
        content: [{ type: "text", text: "Updated" }],
      }));

      const messages = processor.getMessages();
      expect(messages[0].content).toEqual([{ type: "text", text: "Updated" }]);
    });
  });

  describe("processEvent", () => {
    const createContext = () => {
      const assistantMessage = createMessage("assistant", []);
      return {
        assistantMessage,
        assistantMessageId: assistantMessage.id!,
      };
    };

    it("should handle execution_start with threadId", () => {
      const context = createContext();

      processor.processEvent(
        { type: "execution_start", threadId: "thread-123" } as any,
        context,
        false,
      );

      expect(onThreadIdChange).toHaveBeenCalledWith("thread-123");
    });

    it("should handle tool_call event", () => {
      const context = createContext();
      processor.addMessage(context.assistantMessage);

      processor.processEvent(
        {
          type: "tool_call",
          id: "evt_1",
          tick: 1,
          timestamp: new Date().toISOString(),
          callId: "tool-1",
          name: "search",
          input: { query: "test" },
          blockIndex: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as any,
        context,
        true,
      );

      const messages = processor.getMessages();
      const assistantContent = messages.find((m) => m.id === context.assistantMessageId)?.content;

      expect(assistantContent).toContainEqual(
        expect.objectContaining({
          type: "tool_use",
          toolUseId: "tool-1",
          name: "search",
        }),
      );
    });

    it("should handle tool_result event", () => {
      const context = createContext();
      processor.addMessage(context.assistantMessage);

      // First add a tool call
      processor.processEvent(
        {
          type: "tool_call",
          id: "evt_1",
          tick: 1,
          timestamp: new Date().toISOString(),
          callId: "tool-1",
          name: "search",
          input: {},
          blockIndex: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as any,
        context,
        true,
      );

      // Then add the result
      processor.processEvent(
        {
          type: "tool_result",
          id: "evt_2",
          tick: 1,
          timestamp: new Date().toISOString(),
          callId: "tool-1",
          name: "search",
          result: [{ type: "text", text: "Result" }],
          isError: false,
          executedBy: "engine",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } as any,
        context,
        true,
      );

      // Should have added a tool message
      const messages = processor.getMessages();
      const toolMessage = messages.find((m) => m.role === "tool");
      expect(toolMessage).toBeDefined();
      expect(toolMessage?.content[0].type).toBe("tool_result");
    });

    it("should handle execution_end event", () => {
      const context = createContext();
      const result = { output: "done" };

      processor.processEvent({ type: "execution_end", output: result } as any, context, false);

      expect(onComplete).toHaveBeenCalledWith(result);
    });

    it("should handle error event", () => {
      const context = createContext();

      processor.processEvent(
        {
          type: "error",
          id: "evt_1",
          tick: 1,
          timestamp: new Date().toISOString(),
          error: { message: "Something went wrong" },
        } as any,
        context,
        false,
      );

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("Something went wrong");
    });
  });

  describe("clear", () => {
    it("should reset all state", () => {
      processor.addMessage(createMessage("user", "Hello"));
      processor.clear();

      expect(processor.getMessages()).toEqual([]);
      expect(onMessagesChange).toHaveBeenLastCalledWith([]);
      expect(onThreadIdChange).toHaveBeenCalledWith(null);
    });
  });
});

describe("ExecutionHandler", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let handler: ExecutionHandler;
  let onMessagesChange: Mock;
  let onStreamingChange: Mock;
  let onThreadIdChange: Mock;
  let onErrorChange: Mock;

  beforeEach(() => {
    mockClient = createMockClient();
    onMessagesChange = vi.fn();
    onStreamingChange = vi.fn();
    onThreadIdChange = vi.fn();
    onErrorChange = vi.fn();

    handler = new ExecutionHandler({
      client: mockClient as any,
      onMessagesChange,
      onStreamingChange,
      onThreadIdChange,
      onErrorChange,
    });
  });

  describe("initialization", () => {
    it("should start with empty messages", () => {
      expect(handler.getMessages()).toEqual([]);
    });

    it("should not be streaming initially", () => {
      expect(handler.getIsStreaming()).toBe(false);
    });

    it("should have no thread ID initially", () => {
      expect(handler.getThreadId()).toBeNull();
    });
  });

  describe("sendMessage", () => {
    it("should add user message to messages", async () => {
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "Hello");

      const messages = handler.getMessages();
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("should set streaming state during execution", async () => {
      let streamingDuringCall = false;

      mockClient.stream.mockImplementation(async function* () {
        streamingDuringCall = handler.getIsStreaming();
        yield { type: "execution_start" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "Hello");

      expect(streamingDuringCall).toBe(true);
      expect(handler.getIsStreaming()).toBe(false);
    });

    it("should call onStreamingChange", async () => {
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "Hello");

      expect(onStreamingChange).toHaveBeenCalledWith(true);
      expect(onStreamingChange).toHaveBeenCalledWith(false);
    });

    it("should set error on stream error", async () => {
      const streamError = new Error("Stream failed");
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start" };
        throw streamError;
      });

      await expect(handler.sendMessage("test-agent", "Hello")).rejects.toThrow("Stream failed");

      expect(onErrorChange).toHaveBeenCalledWith(streamError);
      expect(handler.getIsStreaming()).toBe(false);
    });

    it("should pass threadId to client", async () => {
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "Hello", {
        threadId: "my-thread",
      });

      expect(mockClient.stream).toHaveBeenCalledWith(
        "test-agent",
        expect.objectContaining({ threadId: "my-thread" }),
      );
    });

    it("should accept different input types", async () => {
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start" };
        yield { type: "execution_end", output: {} };
      });

      // String
      await handler.sendMessage("test-agent", "Hello");

      // ContentBlock
      await handler.sendMessage("test-agent", { type: "text", text: "World" });

      // ContentBlock[]
      await handler.sendMessage("test-agent", [
        { type: "text", text: "Multiple" },
        { type: "text", text: "Blocks" },
      ]);

      expect(mockClient.stream).toHaveBeenCalledTimes(3);
    });
  });

  describe("updateClient", () => {
    it("should update the client instance", () => {
      const newClient = createMockClient();
      handler.updateClient(newClient as any);

      // Verify new client is used
      newClient.stream.mockImplementation(async function* () {
        yield { type: "execution_end", output: {} };
      });

      handler.sendMessage("test-agent", "Test");

      expect(newClient.stream).toHaveBeenCalled();
      expect(mockClient.stream).not.toHaveBeenCalled();
    });
  });

  describe("thread management", () => {
    it("should update threadId from execution_start", async () => {
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start", threadId: "new-thread" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "Hello");

      expect(handler.getThreadId()).toBe("new-thread");
      expect(onThreadIdChange).toHaveBeenCalledWith("new-thread");
    });

    it("should use existing threadId for subsequent calls", async () => {
      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start", threadId: "first-thread" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "First");

      mockClient.stream.mockImplementation(async function* () {
        yield { type: "execution_start" };
        yield { type: "execution_end", output: {} };
      });

      await handler.sendMessage("test-agent", "Second");

      expect(mockClient.stream).toHaveBeenLastCalledWith(
        "test-agent",
        expect.objectContaining({ threadId: "first-thread" }),
      );
    });
  });
});
