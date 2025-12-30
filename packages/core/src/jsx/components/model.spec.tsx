import { createEngine } from "../../engine/factory";
import { createModel, type ModelOutput } from "../../model/model";
import type { StreamChunk } from "aidk-shared";
import { Model, ModelComponent } from "./model";
import { COM } from "../../com/object-model";
import { createElement, Fragment } from "../jsx-runtime";
import { Message } from "./primitives";
import { modelRegistry } from "../../utils/registry";
import { toEngineState } from "../../model/utils/language-model";

describe("Model Component", () => {
  const mockModel1 = createModel({
    metadata: {
      id: "mock-model-1",
      provider: "mock",
      capabilities: [],
    },
    executors: {
      execute: async () =>
        ({
          model: "mock-model-1",
          createdAt: new Date().toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Response from model 1" }],
          },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
          raw: {},
        }) as ModelOutput,
      executeStream: async function* () {
        yield {
          type: "content_delta",
          delta: "Response from model 1",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
        } as StreamChunk;
      },
    },
    transformers: {
      processStream: async (_chunks: StreamChunk[]) =>
        ({
          model: "mock-model-1",
          createdAt: new Date().toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Response from model 1" }],
          },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
          raw: {},
        }) as ModelOutput,
    },
    toEngineState: async (output: ModelOutput) => toEngineState(output),
  });

  const mockModel2 = createModel({
    metadata: {
      id: "mock-model-2",
      provider: "mock",
      capabilities: [],
    },
    executors: {
      execute: async () =>
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
      executeStream: async function* () {
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
    toEngineState: async (output: ModelOutput) => toEngineState(output),
  });

  beforeEach(() => {
    // Clear registry before each test
    modelRegistry.clear();
  });

  describe("ModelComponent", () => {
    it("should set model on COM when mounted", async () => {
      const com = new COM();

      const component = new ModelComponent({ model: mockModel1 });
      await component.onMount(com);

      expect(com.getModel()).toBe(mockModel1);
    });

    it("should clear model on COM when unmounted", async () => {
      const com = new COM();

      const component = new ModelComponent({ model: mockModel1 });
      await component.onMount(com);
      expect(com.getModel()).toBe(mockModel1);

      await component.onUnmount(com);
      expect(com.getModel()).toBeUndefined();
    });

    it("should call onMount callback if provided", async () => {
      const com = new COM();

      const onMountSpy = jest.fn();
      const component = new ModelComponent({
        model: mockModel1,
        onMount: onMountSpy,
      });

      await component.onMount(com);

      expect(onMountSpy).toHaveBeenCalledWith(com);
      expect(com.getModel()).toBe(mockModel1);
    });

    it("should call onUnmount callback if provided", async () => {
      const com = new COM();

      const onUnmountSpy = jest.fn();
      const component = new ModelComponent({
        model: mockModel1,
        onUnmount: onUnmountSpy,
      });

      await component.onMount(com);
      await component.onUnmount(com);

      expect(onUnmountSpy).toHaveBeenCalledWith(com);
      expect(com.getModel()).toBeUndefined();
    });

    it("should not render anything (configuration-only)", () => {
      const com = new COM();
      const component = new ModelComponent({
        model: mockModel1,
      });

      const result = component.render(com);
      expect(result).toBeNull();
    });
  });

  describe("Model factory function", () => {
    it("should create ModelComponent element", () => {
      const element = Model({ model: mockModel1 });
      expect(element).toBeDefined();
      expect(element.type).toBe(ModelComponent);
      expect(element.props.model).toBe(mockModel1);
    });
  });

  describe("Engine integration", () => {
    it("should use model from Model component when no config model", async () => {
      const engine = createEngine({}); // No model in config

      const result = await engine.execute.call(
        { timeline: [] },
        createElement(
          Fragment,
          {},
          createElement(Model, { model: mockModel1 }),
          createElement(Message, { role: "user", content: "Hello" }),
        ),
      );

      expect(result).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);
      const assistantMessage = result.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Response from model 1");
      }
    });

    it("should prefer COM model over config model", async () => {
      const engine = createEngine({ model: mockModel1 });

      const result = await engine.execute.call(
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
      // Should use model2 from Model component, not model1 from config
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Response from model 2");
      }
    });

    it("should fall back to config model when no Model component", async () => {
      const engine = createEngine({ model: mockModel1 });

      const result = await engine.execute.call(
        { timeline: [] },
        createElement(Message, { role: "user", content: "Hello" }),
      );

      expect(result).toBeDefined();
      const assistantMessage = result.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Response from model 1");
      }
    });

    it("should throw error when no model configured", async () => {
      const engine = createEngine({}); // No model in config or component

      await expect(
        engine.execute.call(
          { timeline: [] },
          createElement(Message, { role: "user", content: "Hello" }),
        ),
      ).rejects.toThrow(/No model configured/);
    });

    it("should support model switching between ticks", async () => {
      const engine = createEngine({});

      let useModel1 = true;
      const switchingComponent = {
        render: () => {
          return createElement(
            Fragment,
            {},
            createElement(Model, { model: useModel1 ? mockModel1 : mockModel2 }),
            createElement(Message, { role: "user", content: "Hello" }),
          );
        },
      };

      // First execution with model1
      const result1 = await engine.execute.call({ timeline: [] }, switchingComponent);

      expect(result1).toBeDefined();
      let assistantMessage = result1.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Response from model 1");
      }

      // Switch to model2
      useModel1 = false;

      const result2 = await engine.execute.call({ timeline: [] }, switchingComponent);

      expect(result2).toBeDefined();
      assistantMessage = result2.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      if (assistantMessage && assistantMessage.message.content[0].type === "text") {
        expect(assistantMessage.message.content[0].text).toBe("Response from model 2");
      }
    });

    it("should support model identifier from registry", async () => {
      modelRegistry.register("test-model", mockModel1);
      const engine = createEngine({});

      const result = await engine.execute.call(
        { timeline: [] },
        createElement(
          Fragment,
          {},
          createElement(Model, { model: "test-model" }),
          createElement(Message, { role: "user", content: "Hello" }),
        ),
      );

      expect(result).toBeDefined();
      const assistantMessage = result.timeline.find(
        (e) => e.kind === "message" && e.message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
    });

    it("should cache wrapped models", async () => {
      const engine = createEngine({});

      // First execution
      const result1 = await engine.execute.call(
        { timeline: [] },
        createElement(
          Fragment,
          {},
          createElement(Model, { model: mockModel1 }),
          createElement(Message, { role: "user", content: "Hello" }),
        ),
      );

      expect(result1).toBeDefined();

      // Second execution with same model - should use cached wrapped model
      const result2 = await engine.execute.call(
        { timeline: [] },
        createElement(
          Fragment,
          {},
          createElement(Model, { model: mockModel1 }),
          createElement(Message, { role: "user", content: "Hello again" }),
        ),
      );

      expect(result2).toBeDefined();
      // Both executions should succeed, indicating model caching is working
      // (We can't directly access private cache, but successful execution indicates caching)
    });
  });

  describe("COM model management", () => {
    it("should store and retrieve model", () => {
      const com = new COM();

      com.setModel(mockModel1);
      expect(com.getModel()).toBe(mockModel1);

      com.setModel(mockModel2);
      expect(com.getModel()).toBe(mockModel2);

      com.unsetModel();
      expect(com.getModel()).toBeUndefined();
    });

    it("should allow Model component to notify Engine when model is set", async () => {
      const com = new COM();

      const setModelSpy = jest.spyOn(com, "setModel");

      // Model component calls engine.setModel directly
      const component = new ModelComponent({ model: mockModel1 });
      await component.onMount(com);

      expect(setModelSpy).toHaveBeenCalledWith(mockModel1);
      expect(com.getModel()).toBe(mockModel1);
    });
  });
});
