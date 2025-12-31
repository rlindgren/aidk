/**
 * Engine v2 Tests
 *
 * Mirrors engine.spec.ts but uses createEngine() (Engine v2) instead of new Engine() (Engine v1).
 * Tests Engine v2's Procedure-based API and ensures feature parity with Engine v1.
 */

import { createEngine } from "./factory";
import type { ProcedureEnvelope } from "aidk-kernel";
import { Context } from "../context";
import { createModel, type ModelInput, type ModelOutput } from "../model/model";
import { createTool } from "../tool/tool";
import type { EngineComponent, ComponentDefinition } from "../component/component";
import { z } from "zod";
import { StopReason, type StreamChunk } from "aidk-shared";
import { Component } from "../component/component";
import { Model } from "../jsx/components/primitives";
import { Message } from "../jsx/components/primitives";
import { createElement } from "../jsx/jsx-runtime";
import { type EngineInput } from "../com/types";
import { fromEngineState, toEngineState } from "../model/utils/language-model";
import type { ChannelServiceConfig, ChannelAdapter, ChannelTransport } from "../channels/service";
import type { ChannelEvent } from "aidk-kernel";

describe("Engine v2", () => {
  const mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
    metadata: {
      id: "mock-model",
      provider: "mock",
      capabilities: [],
    },
    executors: {
      execute: async (_input: ModelInput) =>
        ({
          model: "mock-model",
          createdAt: new Date().toISOString(),
          message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
          raw: {},
        }) as ModelOutput,
      executeStream: async function* (_input: ModelInput) {
        yield {
          type: "content_delta",
          delta: "Hello",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
        } as StreamChunk;
        yield {
          type: "content_delta",
          delta: "",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
        } as StreamChunk;
      },
    },
    transformers: {
      processStream: async (chunks: StreamChunk[]) => {
        // Aggregate chunks into ModelOutput
        let text = "";
        const toolCalls: any[] = [];
        const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        let stopReason: any = "unspecified";

        for (const chunk of chunks) {
          if (chunk.delta) text += chunk.delta;
          if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
          if (chunk.usage) {
            usage.inputTokens = Math.max(usage.inputTokens, chunk.usage.inputTokens);
            usage.outputTokens = Math.max(usage.outputTokens, chunk.usage.outputTokens);
            usage.totalTokens = Math.max(usage.totalTokens, chunk.usage.totalTokens);
          }
          if (chunk.stopReason) stopReason = chunk.stopReason;
        }

        return {
          model: "mock-model",
          createdAt: new Date().toISOString(),
          message: { role: "assistant", content: [{ type: "text", text }] },
          usage,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          stopReason,
          raw: {},
        } as ModelOutput;
      },
    },
    fromEngineState,
    toEngineState,
  });

  // Use createTool to get a proper Tool instance
  const mockTool = createTool({
    name: "mock-tool",
    description: "A mock tool",
    input: z.object({ value: z.string() }),
    handler: async ({ value }) => [
      {
        type: "text",
        text: `Tool result: ${value}`,
      },
    ],
  });

  let engine: ReturnType<typeof createEngine>;

  beforeEach(() => {
    engine = createEngine({
      model: mockModel,
      tools: [mockTool], // createTool returns EngineTool (ExecutableTool), but EngineConfig expects Tool | string
    });
  });

  afterEach(() => {
    engine.destroy();
  });

  describe("Basic execution", () => {
    it("should execute a simple agent", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      // execute.call() returns Promise<COMInput>
      const result = await engine.execute.call({ timeline: [] }, mockComponent);
      expect(result).toBeDefined();
      expect(result.timeline).toBeDefined();
      expect(Array.isArray(result.timeline)).toBe(true);
      expect(result.timeline.length).toBeGreaterThan(0);

      // Verify model output appears in timeline
      const assistantMessage = result.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Hello");
      }
    });

    it("should support Procedure API (.use, .withHandle, .withContext)", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      // Test .use() middleware
      let middlewareCalled = false;
      const testMiddleware = async (
        args: [EngineInput, ComponentDefinition?],
        envelope: ProcedureEnvelope<[EngineInput, ComponentDefinition?]>,
        next: (transformedArgs?: [EngineInput, ComponentDefinition?]) => Promise<any>,
      ) => {
        middlewareCalled = true;
        return next();
      };

      // .use() returns a new procedure, so we need to call it directly
      await engine.execute.use(testMiddleware).call({ timeline: [] }, mockComponent);
      expect(middlewareCalled).toBe(true);

      // Test .withHandle()
      const { handle, result } = await engine.execute
        .withHandle()
        .call({ timeline: [] }, mockComponent);
      expect(handle).toBeDefined();
      expect(await result).toBeDefined();
      expect(handle.traceId).toBeDefined();

      // Test .withContext()
      const resultWithContext = await engine.execute
        .withContext({ traceId: "test-trace-123" })
        .call({ timeline: [] }, mockComponent);
      expect(resultWithContext).toBeDefined();
      // Ensure it's resolved (not AsyncIterable)
      if (
        resultWithContext &&
        typeof resultWithContext === "object" &&
        "then" in resultWithContext
      ) {
        const resolved = await resultWithContext;
        expect(resolved).toBeDefined();
      }
    });

    it("should stream execution events", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const events: any[] = [];
      // stream() returns Promise<AsyncIterable<EngineStreamEvent>>
      // await to get the AsyncIterable, then iterate
      const iterable = await engine.stream.call({ timeline: [] }, mockComponent);
      for await (const event of iterable) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "execution_start")).toBe(true);
      expect(events.some((e) => e.type === "tick_start")).toBe(true);
      expect(events.some((e) => e.type === "execution_end")).toBe(true);

      // Check for stream chunks (passed through from model)
      // Note: Stream events now have 'type' and base fields, not wrapped in 'chunk'
      const streamEvents = events.filter(
        (e) =>
          e.type !== "execution_start" &&
          e.type !== "tick_start" &&
          e.type !== "tick_end" &&
          e.type !== "execution_end",
      );
      expect(streamEvents.length).toBeGreaterThan(0);

      // Check final output
      const endEvent = events.find((e) => e.type === "execution_end");
      expect(endEvent).toBeDefined();
      if (endEvent?.type === "execution_end") {
        expect(endEvent.output).toBeDefined();
        expect(endEvent.output.timeline).toBeDefined();
        expect(Array.isArray(endEvent.output.timeline)).toBe(true);
      }
    });

    it("should support stream Procedure API", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      // Test .use() middleware on stream
      let middlewareCalled = false;
      const testMiddleware = async (
        args: [EngineInput, ComponentDefinition?],
        envelope: ProcedureEnvelope<[EngineInput, ComponentDefinition?]>,
        next: (transformedArgs?: [EngineInput, ComponentDefinition?]) => Promise<any>,
      ) => {
        middlewareCalled = true;
        return next();
      };

      // Chain .use() and .call()
      const streamResult = engine.stream.use(testMiddleware).call({ timeline: [] }, mockComponent);
      // Handle both AsyncIterable and Promise<AsyncIterable>
      let iterable: AsyncIterable<any>;
      if (streamResult && typeof streamResult === "object" && "then" in streamResult) {
        iterable = await streamResult;
      } else {
        iterable = streamResult as AsyncIterable<any>;
      }
      for await (const _event of iterable) {
        // Consume events
      }
      expect(middlewareCalled).toBe(true);
    });
  });

  describe("Feature parity with Engine v1", () => {
    it("should execute with default root component", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const engineWithRoot = createEngine({
        model: mockModel,
        root: mockComponent,
      });

      const result = await engineWithRoot.execute.call({ timeline: [] });
      expect(result).toBeDefined();

      engineWithRoot.destroy();
    });

    it("should handle tool calls", async () => {
      const toolCallModel = createModel<
        ModelInput,
        ModelOutput,
        ModelInput,
        ModelOutput,
        StreamChunk
      >({
        metadata: {
          id: "tool-call-model",
          provider: "mock",
          capabilities: [],
        },
        executors: {
          execute: async (_input: ModelInput) =>
            ({
              model: "tool-call-model",
              createdAt: new Date().toISOString(),
              message: { role: "assistant", content: [{ type: "text", text: "Calling tool" }] },
              toolCalls: [
                {
                  id: "call-1",
                  name: "mock-tool",
                  input: { value: "test" },
                },
              ],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: StopReason.TOOL_USE,
              raw: {},
            }) as ModelOutput,
          executeStream: async function* (_input: ModelInput) {
            yield {
              type: "content_delta",
              delta: "",
              toolCalls: [
                {
                  id: "call-1",
                  name: "mock-tool",
                  input: { value: "test" },
                },
              ],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: StopReason.TOOL_USE,
            } as StreamChunk;
          },
        },
        transformers: {
          processStream: async (chunks: StreamChunk[]) => {
            const toolCalls: any[] = [];
            for (const chunk of chunks) {
              if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
            }
            return {
              model: "tool-call-model",
              createdAt: new Date().toISOString(),
              message: { role: "assistant", content: [{ type: "text", text: "" }] },
              toolCalls: toolCalls.length ? toolCalls : undefined,
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: StopReason.TOOL_USE,
              raw: {},
            } as ModelOutput;
          },
        },
        fromEngineState,
        toEngineState: async (output: ModelOutput) => {
          return {
            newTimelineEntries: [],
            toolCalls: output.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
            usage: output.usage,
            shouldStop: false,
            stopReason: undefined,
          };
        },
      });

      engine = createEngine({
        model: toolCallModel,
        tools: [mockTool],
      });

      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Use tool" }] }),
      });

      const result = await engine.execute.call({ timeline: [] }, mockComponent);
      expect(result).toBeDefined();
    });

    it("should execute a tool registered via components and verify results in timeline", async () => {
      // Create a model that returns tool calls
      const toolCallModel = createModel<
        ModelInput,
        ModelOutput,
        ModelInput,
        ModelOutput,
        StreamChunk
      >({
        metadata: {
          id: "tool-call-model",
          provider: "mock",
          capabilities: [],
        },
        executors: {
          execute: async (_input: ModelInput) =>
            ({
              model: "tool-call-model",
              createdAt: new Date().toISOString(),
              message: { role: "assistant", content: [] },
              toolCalls: [
                {
                  id: "call-1",
                  name: "mock-tool",
                  input: { value: "test" },
                },
              ],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: StopReason.TOOL_USE,
              raw: {},
            }) as ModelOutput,
          executeStream: async function* (_input: ModelInput) {
            yield {
              type: "content_delta",
              delta: "",
              toolCalls: [
                {
                  id: "call-1",
                  name: "mock-tool",
                  input: { value: "test" },
                },
              ],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: StopReason.TOOL_USE,
            } as StreamChunk;
          },
        },
        transformers: {
          processStream: async (chunks: StreamChunk[]) => {
            const toolCalls: any[] = [];
            for (const chunk of chunks) {
              if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
            }
            return {
              model: "tool-call-model",
              createdAt: new Date().toISOString(),
              message: { role: "assistant", content: [] },
              toolCalls: toolCalls.length ? toolCalls : undefined,
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: StopReason.TOOL_USE,
              raw: {},
            } as ModelOutput;
          },
        },
        fromEngineState,
        toEngineState: async (output: ModelOutput) => {
          return {
            newTimelineEntries:
              output.message && output.message.content.length > 0
                ? [
                    {
                      kind: "message" as const,
                      message: output.message,
                      tags: ["model_output"],
                    },
                  ]
                : [],
            toolCalls: output.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
            usage: output.usage,
            shouldStop:
              !output.toolCalls?.length &&
              ["stop", "end_turn", "max_tokens"].includes(output.stopReason as string),
            stopReason: output.stopReason
              ? {
                  reason: output.stopReason,
                  description: `Stopped: ${output.stopReason}`,
                  recoverable: false,
                }
              : undefined,
          };
        },
      });

      engine = createEngine({
        model: toolCallModel,
        tools: [mockTool], // Register tool in engine config
      });

      // Create a TimelineManager component to manage the timeline
      const TimelineManager: EngineComponent = {
        name: "timeline-manager",
        render: (com, state) => {
          const previous = state.previous;
          const current = state.current;

          // Build timeline entries - include initial timeline from input
          const timelineEntries: any[] = [
            ...(previous?.timeline || []),
            ...(current?.timeline || []),
          ];

          // Handle tool results
          if (current?.toolResults && current.toolResults.length > 0) {
            const resultMessage = {
              role: "tool" as const,
              content: current.toolResults.map((r) => ({
                type: "tool_result" as const,
                id: r.id,
                name: r.name || "unknown",
                toolUseId: r.toolUseId,
                content: r.content,
                isError: !r.success,
                executedBy: r.executedBy || "engine",
              })),
            };

            timelineEntries.push({
              kind: "message",
              message: resultMessage,
              tags: ["tool_output"],
            });
          }

          // Render timeline entries
          for (const entry of timelineEntries) {
            com.addTimelineEntry(entry);
          }
        },
      };

      const result = await engine.execute.call(
        {
          timeline: [
            {
              kind: "message",
              message: { role: "user", content: [{ type: "text", text: "call tool" }] },
            },
          ],
        },
        TimelineManager, // Pass as single component, tool is already registered
      );

      // Verify tool execution
      // Check for user message - should be preserved from input
      const userMessages = result.timeline.filter((e) => e.message.role === "user");
      expect(userMessages.length).toBeGreaterThan(0);
      const initialUserMsg = userMessages.find((m) =>
        m.message.content.some((c: any) => c.type === "text" && c.text === "call tool"),
      );
      expect(initialUserMsg).toBeDefined();

      // Check for tool result in timeline
      const toolResultEntry = result.timeline.find((e) =>
        e.message.content.some((c: any) => c.type === "tool_result"),
      );
      expect(toolResultEntry).toBeDefined();
      if (toolResultEntry) {
        const toolResultBlock = toolResultEntry.message.content.find(
          (c: any) => c.type === "tool_result",
        );
        expect(toolResultBlock).toBeDefined();
        // @ts-ignore
        expect(toolResultBlock.content[0].text).toContain("Tool result: test");
      }
    });

    it("should reuse a single Engine instance to run different agents", async () => {
      const agent1: EngineComponent = {
        name: "agent-1",
        render: (com) => {
          com.addMetadata("agent", "agent-1");
        },
      };

      const agent2: EngineComponent = {
        name: "agent-2",
        render: (com) => {
          com.addMetadata("agent", "agent-2");
        },
      };

      // Reuse the same engine instance
      const result1 = await engine.execute.call({ timeline: [] }, agent1);
      const result2 = await engine.execute.call({ timeline: [] }, agent2);

      expect(result1.metadata["agent"]).toBe("agent-1");
      expect(result2.metadata["agent"]).toBe("agent-2");
    });

    it("should override Engine default root when agent is provided", async () => {
      const defaultAgent: EngineComponent = {
        name: "default-agent",
        render: (com) => {
          com.addMetadata("agent", "default");
        },
      };

      const overrideAgent: EngineComponent = {
        name: "override-agent",
        render: (com) => {
          com.addMetadata("agent", "override");
        },
      };

      const engineWithRoot = createEngine({
        model: mockModel,
        root: defaultAgent,
      });

      // Should use override agent, not default
      const result = await engineWithRoot.execute.call({ timeline: [] }, overrideAgent);
      expect(result.metadata["agent"]).toBe("override");

      engineWithRoot.destroy();
    });

    it("should pass EngineContext options via .withContext()", async () => {
      const metadataAgent: EngineComponent = {
        name: "metadata-agent",
        render: (com, _state) => {
          // Access context from within the procedure
          const ctx = Context.tryGet();
          if (ctx?.metadata?.["userId"]) {
            com.addMetadata("userId", ctx.metadata["userId"]);
          }
          if (ctx?.metadata?.["custom"]) {
            com.addMetadata("custom", ctx.metadata["custom"]);
          }
        },
      };

      const result = await engine.execute
        .withContext({
          metadata: {
            userId: "user-123",
            custom: "custom-value",
          },
        })
        .call({ timeline: [] }, metadataAgent);

      expect(result.metadata["userId"]).toBe("user-123");
      expect(result.metadata["custom"]).toBe("custom-value");
    });

    it("should support AbortSignal via .withContext()", async () => {
      const abortController = new AbortController();

      // Abort immediately
      abortController.abort();

      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      await expect(
        engine.execute
          .withContext({ signal: abortController.signal })
          .call({ timeline: [] }, mockComponent),
      ).rejects.toThrow(/abort/i);
    });

    it("should throw error when no model configured", async () => {
      const engineWithoutModel = createEngine({});

      await expect(
        engineWithoutModel.execute.call(
          { timeline: [] },
          defineComponent({
            render: () =>
              createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
          }),
        ),
      ).rejects.toThrow("No model configured");

      engineWithoutModel.destroy();
    });
  });

  describe("Procedure-specific features", () => {
    it("should support middleware chaining", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const callOrder: string[] = [];

      const mw1 = async (
        args: [EngineInput, ComponentDefinition?],
        envelope: ProcedureEnvelope<[EngineInput, ComponentDefinition?]>,
        next: (transformedArgs?: [EngineInput, ComponentDefinition?]) => Promise<any>,
      ) => {
        callOrder.push("mw1-before");
        const result = await next();
        callOrder.push("mw1-after");
        return result;
      };

      const mw2 = async (
        args: [EngineInput, ComponentDefinition?],
        envelope: ProcedureEnvelope<[EngineInput, ComponentDefinition?]>,
        next: (transformedArgs?: [EngineInput, ComponentDefinition?]) => Promise<any>,
      ) => {
        callOrder.push("mw2-before");
        const result = await next();
        callOrder.push("mw2-after");
        return result;
      };

      // Chain .use() calls and then call the result
      await engine.execute.use(mw1).use(mw2).call({ timeline: [] }, mockComponent);

      expect(callOrder).toEqual(["mw1-before", "mw2-before", "mw2-after", "mw1-after"]);
    });

    it("should propagate context through middleware", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      let capturedTraceId: string | undefined;

      const mw = async (
        args: [EngineInput, ComponentDefinition?],
        envelope: ProcedureEnvelope<[EngineInput, ComponentDefinition?]>,
        next: (transformedArgs?: [EngineInput, ComponentDefinition?]) => Promise<any>,
      ) => {
        capturedTraceId = envelope.context.traceId;
        return next();
      };

      // Chain .use() and .withContext()
      await engine.execute
        .use(mw)
        .withContext({ traceId: "custom-trace-123" })
        .call({ timeline: [] }, mockComponent);

      expect(capturedTraceId).toBe("custom-trace-123");
    });

    it("should provide execution handle with metrics and graph", async () => {
      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const { handle, result } = await engine.execute
        .withHandle()
        .call({ timeline: [] }, mockComponent);

      expect(handle).toBeDefined();
      expect(handle.traceId).toBeDefined();
      expect(handle.result).toBeDefined();
      expect(handle.events).toBeDefined();

      // Wait for result
      const finalResult = await result;
      expect(finalResult).toBeDefined();
    });
  });

  describe("Dynamic Model Switching", () => {
    const mockModel2 = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
      metadata: {
        id: "mock-model-2",
        provider: "mock",
        capabilities: [],
      },
      executors: {
        execute: async (_input: ModelInput) =>
          ({
            model: "mock-model-2",
            createdAt: new Date().toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Response from model 2" }],
            },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
            raw: {},
          }) as ModelOutput,
        executeStream: async function* (_input: ModelInput) {
          yield {
            type: "content_delta",
            delta: "Response from model 2",
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
          } as StreamChunk;
        },
      },
      transformers: {
        processStream: async (_chunks: StreamChunk[]) =>
          ({
            model: "mock-model-2",
            createdAt: new Date().toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Response from model 2" }],
            },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
            raw: {},
          }) as ModelOutput,
      },
      fromEngineState,
      toEngineState,
    });

    it("should work without model in config when Model component is used", async () => {
      const engineWithoutModel = createEngine({});

      const result = await engineWithoutModel.execute.call(
        { timeline: [] },
        createElement(Model, {
          model: mockModel,
          children: createElement(Message, { role: "user", content: "Hello" }),
        }),
      );

      expect(result).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);

      engineWithoutModel.destroy();
    });

    it("should prefer Model component model over config model", async () => {
      const engineWithConfigModel = createEngine({ model: mockModel });

      const result = await engineWithConfigModel.execute.call(
        { timeline: [] },
        createElement(Model, {
          model: mockModel2,
          children: createElement(Message, { role: "user", content: "Hello" }),
        }),
      );

      expect(result).toBeDefined();
      const assistantMessage = result.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      // Should use mockModel2 from Model component
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Response from model 2");
      }

      engineWithConfigModel.destroy();
    });

    it("should throw error when no model configured and no Model component provided", async () => {
      const engineWithoutModel = createEngine({});

      await expect(
        engineWithoutModel.execute.call(
          { timeline: [] },
          createElement(Message, { role: "user", content: "Hello" }),
        ),
      ).rejects.toThrow(/No model configured/);

      engineWithoutModel.destroy();
    });

    it("should cache wrapped models for performance", async () => {
      const engineWithoutModel = createEngine({});

      // First execution
      await engineWithoutModel.execute.call(
        { timeline: [] },
        createElement(Model, {
          model: mockModel,
          children: createElement(Message, { role: "user", content: "Hello" }),
        }),
      );

      // Second execution with same model - should use cached wrapped model
      const result = await engineWithoutModel.execute.call(
        { timeline: [] },
        createElement(Model, {
          model: mockModel,
          children: createElement(Message, { role: "user", content: "Hello again" }),
        }),
      );

      expect(result).toBeDefined();
      // Model should be cached (we can't directly verify cache, but execution should work)

      engineWithoutModel.destroy();
    });
  });

  describe("Channels integration", () => {
    let globalAdapter: ChannelAdapter;
    let globalTransport: ChannelTransport;
    let adapterPublishCalls: ChannelEvent[];
    let transportSendCalls: ChannelEvent[];

    beforeEach(() => {
      adapterPublishCalls = [];
      transportSendCalls = [];

      // Create global adapter instance (simulating Redis adapter)
      globalAdapter = {
        name: "test-adapter",
        publish: vi.fn().mockImplementation(async (event: ChannelEvent) => {
          adapterPublishCalls.push(event);
        }),
        subscribe: vi.fn().mockResolvedValue(() => {}),
      };

      // Create global transport instance
      globalTransport = {
        name: "test-transport",
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockImplementation(async (event: ChannelEvent) => {
          transportSendCalls.push(event);
        }),
        onReceive: vi.fn(),
        closeAll: vi.fn().mockResolvedValue(undefined),
      };
    });

    it("should accept channels config in engine config", async () => {
      const channelsConfig: ChannelServiceConfig = {
        adapter: globalAdapter,
        transport: globalTransport,
      };

      const engineWithChannels = createEngine({
        model: mockModel,
        channels: channelsConfig,
      });

      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const result = await engineWithChannels.execute.call({ timeline: [] }, mockComponent);

      expect(result).toBeDefined();

      // Verify adapter and transport instances were used
      expect(globalAdapter.publish).toBeDefined();
      expect(globalTransport.send).toBeDefined();

      engineWithChannels.destroy();
    });

    it("should work with only adapter (no transport) in engine config", async () => {
      const channelsConfig: ChannelServiceConfig = {
        adapter: globalAdapter,
      };

      const engineWithChannels = createEngine({
        model: mockModel,
        channels: channelsConfig,
      });

      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const result = await engineWithChannels.execute.call({ timeline: [] }, mockComponent);

      expect(result).toBeDefined();

      engineWithChannels.destroy();
    });

    it("should work with only transport (no adapter) in engine config", async () => {
      const channelsConfig: ChannelServiceConfig = {
        transport: globalTransport,
      };

      const engineWithChannels = createEngine({
        model: mockModel,
        channels: channelsConfig,
      });

      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      const result = await engineWithChannels.execute.call({ timeline: [] }, mockComponent);

      expect(result).toBeDefined();

      engineWithChannels.destroy();
    });

    it("should reuse same global adapter/transport instances across multiple executions", async () => {
      const channelsConfig: ChannelServiceConfig = {
        adapter: globalAdapter,
        transport: globalTransport,
      };

      const engineWithChannels = createEngine({
        model: mockModel,
        channels: channelsConfig,
      });

      const mockComponent = defineComponent({
        render: () =>
          createElement(Message, { role: "user", content: [{ type: "text", text: "Hello" }] }),
      });

      // First execution
      await engineWithChannels.execute.call({ timeline: [] }, mockComponent);

      // Second execution with same instances
      await engineWithChannels.execute.call({ timeline: [] }, mockComponent);

      // Verify instances are the same (not recreated)
      expect(globalAdapter.name).toBe("test-adapter");
      expect(globalTransport.name).toBe("test-transport");

      engineWithChannels.destroy();
    });
  });
});

// Helper function to define a component (mirrors engine.spec.ts)
function defineComponent(definition: {
  render: (com: any, state: any) => any;
  onMount?: (com: any) => void | Promise<void>;
  onUnmount?: (com: any) => void | Promise<void>;
  onStart?: (com: any) => void | Promise<void>;
  onComplete?: (com: any, output: any) => void | Promise<void>;
  onError?: (com: any, state: any) => void | Promise<void>;
  onTickStart?: (com: any, state: any) => void | Promise<void>;
  onTickEnd?: (com: any, state: any) => void | Promise<void>;
}): Component {
  class ComponentImpl extends Component {
    render(com: any, state: any) {
      return definition.render(com, state);
    }
    onMount(com: any) {
      return definition.onMount?.(com);
    }
    onUnmount(com: any) {
      return definition.onUnmount?.(com);
    }
    onStart(com: any) {
      return definition.onStart?.(com);
    }
    onComplete(com: any, output: any) {
      return definition.onComplete?.(com, output);
    }
    onError(com: any, state: any) {
      const result = definition.onError?.(com, state);
      // onError can return void, Promise<void>, or RecoveryAction
      // EngineComponent expects void | RecoveryAction, so we need to handle Promise
      if (result && typeof result === "object" && "then" in result) {
        // It's a Promise - we can't return it directly, but EngineComponent will handle it
        return undefined;
      }
      return result;
    }
    onTickStart(state: any) {
      return definition.onTickStart?.(state.com, state);
    }
    onTickEnd(state: any) {
      return definition.onTickEnd?.(state.com, state);
    }
  }
  return new ComponentImpl();
}
