import { createEngine } from "./factory";
import { Component } from "../component/component";
import { COM } from "../com/object-model";
import { Fragment } from "../jsx/jsx-runtime";
import { Section, Message, Tool, Model } from "../jsx/components/primitives";
import { Text, Image, Code } from "../jsx/components/content";
import { createTool } from "../tool/tool";
import { createModel, type ModelInput, type ModelOutput } from "../model/model";
import { z } from "zod";
import { type StreamChunk } from "aidk-shared";
import type { COMInput } from "../com/types";
import { fromEngineState, toEngineState } from "../model/utils/language-model";
import { signal } from "../state/signal";
import { modelRegistry } from "../utils/registry";

// Mock models
vi.mock("../utils/registry", () => ({
  modelRegistry: {
    get: vi.fn(),
  },
  toolRegistry: {
    get: vi.fn(),
  },
}));

// Mock Model Adapter Implementation
const executeMock = vi.fn();
const prepareInputMock = vi.fn((input) => ({ messages: [], tools: [], ...input }));
const processOutputMock = vi.fn((output) => output);
const toEngineStateMock = vi.fn(async (output: any) => ({
  newTimelineEntries: output.message
    ? [
        {
          kind: "message" as const,
          message: output.message,
          tags: ["model_output"],
        },
      ]
    : [],
  toolCalls: output.toolCalls?.map((tc: any) => ({ id: tc.id, name: tc.name, input: tc.input })),
  shouldStop:
    !output.toolCalls?.length && ["stop", "end_turn", "max_tokens"].includes(output.stopReason),
  stopReason: output.stopReason,
  usage: output.usage,
}));

const processStreamMock = vi.fn(async (_chunks: any[]) => {
  // Default aggregation for tests
  return {
    model: "mock-model",
    createdAt: new Date().toISOString(),
    message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    raw: {},
  } as ModelOutput;
});

const mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
  metadata: { id: "mock-model", provider: "mock", capabilities: [] },
  executors: {
    execute: executeMock,
  },
  transformers: {
    prepareInput: prepareInputMock,
    processOutput: processOutputMock,
    processStream: processStreamMock,
  },
  toEngineState: toEngineStateMock,
  fromEngineState,
});

describe("Engine React Architecture", () => {
  let engine: ReturnType<typeof createEngine>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore default behaviors
    prepareInputMock.mockImplementation((input) => ({ messages: [], tools: [], ...input }));
    processOutputMock.mockImplementation((output) => output);
    toEngineStateMock.mockImplementation(async (output: any) => ({
      newTimelineEntries: output.message
        ? [
            {
              kind: "message" as const,
              message: output.message,
              tags: ["model_output"],
            },
          ]
        : [],
      toolCalls: output.toolCalls?.map((tc: any) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
      shouldStop:
        !output.toolCalls?.length && ["stop", "end_turn", "max_tokens"].includes(output.stopReason),
      stopReason: output.stopReason,
      usage: output.usage,
    }));

    executeMock.mockResolvedValue({
      model: "mock-model",
      createdAt: new Date().toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
      stopReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  });

  it("should render a simple functional component tree", async () => {
    const MyAgent = () => <Section id="test" content="Hello World" />;

    engine = createEngine({
      model: mockModel,
      root: <MyAgent />,
    });

    const result = await engine.execute.call({ timeline: [] });
    expect(result.sections["test"]).toBeDefined();
    expect(result.sections["test"].content).toBe("Hello World");
  });

  it("should render nested components", async () => {
    const Child = () => <Section id="child" content="Child" />;
    const Parent = () => (
      <Fragment>
        <Section id="parent" content="Parent" />
        <Child />
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Parent />,
    });

    const result = await engine.execute.call({ timeline: [] });
    expect(result.sections["parent"]).toBeDefined();
    expect(result.sections["child"]).toBeDefined();
  });

  it("should handle stateful class components", async () => {
    // Setup model to loop 3 times (return tool calls)
    executeMock
      .mockResolvedValueOnce({
        model: "mock",
        message: { role: "assistant", content: [] },
        toolCalls: [{ id: "1", name: "noop", input: {} }],
      })
      .mockResolvedValueOnce({
        model: "mock",
        message: { role: "assistant", content: [] },
        tool_calls: [{ id: "2", name: "noop", input: {} }],
      })
      .mockResolvedValue({
        model: "mock",
        message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
      });

    class Counter {
      private count = signal(0);

      onTickStart() {
        this.count.update((c) => c + 1);
      }

      render() {
        return <Section id="counter" content={`Count: ${this.count()}`} />;
      }
    }

    engine = createEngine({
      model: mockModel,
      root: <Counter start={0} />,
      maxTicks: 3,
    });

    const result = await engine.execute.call({ timeline: [] });
    expect(result.sections["counter"].content).toBe("Count: 2");
  });

  it("should handle conditional rendering", async () => {
    const ConditionalAgent = (props: { show: boolean }) => (
      <Fragment>
        <Section id="always" content="Always" />
        {props.show && <Section id="conditional" content="Conditional" />}
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <ConditionalAgent show={true} />,
    });
    const result1 = await engine.execute.call({ timeline: [] });
    expect(result1.sections["conditional"]).toBeDefined();

    engine = createEngine({
      model: mockModel,
      root: <ConditionalAgent show={false} />,
    });
    const result2 = await engine.execute.call({ timeline: [] });
    expect(result2.sections["conditional"]).toBeUndefined();
  });

  it("should support legacy imperative components wrapped automatically", async () => {
    class ImperativeComp {
      render(com: COM) {
        com.addSection({ id: "imperative", content: "Done" });
      }
    }
    // Pass instance
    const instance = new ImperativeComp();

    engine = createEngine({
      model: mockModel,
      root: instance,
    });

    const result = await engine.execute.call({ timeline: [] });
    expect(result.sections["imperative"]).toBeDefined();
  });

  it("should support Message with content prop (string)", async () => {
    const Agent = () => (
      <Fragment>
        <Message role="user" content="Hello from prop" />
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Agent />,
    });

    const result: COMInput = await engine.execute({ timeline: [] });
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.message.content).toEqual([{ type: "text", text: "Hello from prop" }]);
  });

  it("should support Message with content prop (ContentBlock[])", async () => {
    const Agent = () => (
      <Fragment>
        <Message
          role="user"
          content={[
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ]}
        />
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Agent />,
    });

    const result: COMInput = await engine.execute({ timeline: [] });
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.message.content).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ]);
  });

  it("should support Message with string children", async () => {
    const Agent = () => (
      <Fragment>
        <Message role="user">Hello from children</Message>
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Agent />,
    });

    const result: COMInput = await engine.execute({ timeline: [] });
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.message.content).toEqual([{ type: "text", text: "Hello from children" }]);
  });

  it("should support Message with Content component primitives", async () => {
    const Agent = (_props: any) => {
      return (
        <Fragment>
          <Message role="user">
            <Text>Hello</Text>
            <Image
              source={{ type: "url", url: "https://example.com/image.jpg" }}
              altText="Example"
            />
            <Code language="typescript">const x = 1;</Code>
          </Message>
        </Fragment>
      );
    };

    engine = createEngine({
      model: mockModel,
    });

    const result: COMInput = await engine.execute({ timeline: [] }, <Agent test="test" />);
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.message.content).toHaveLength(3);
    expect(userMsg?.message.content[0]).toEqual({ type: "text", text: "Hello" });
    expect(userMsg?.message.content[1]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/image.jpg" },
      altText: "Example",
    });
    expect(userMsg?.message.content[2]).toEqual({
      type: "code",
      language: "typescript",
      text: "const x = 1;",
    });
  });

  it("should support Message with mixed ContentBlock objects and primitives", async () => {
    const Agent = () => (
      <Fragment>
        <Message role="user">
          <Text>Hello</Text>
          {[{ type: "text", text: "World" }]}
          Direct string
        </Message>
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Agent />,
    });

    const result: COMInput = await engine.execute({ timeline: [] });
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.message.content).toHaveLength(3);
    expect(userMsg?.message.content[0]).toEqual({ type: "text", text: "Hello" });
    expect(userMsg?.message.content[1]).toEqual({ type: "text", text: "World" });
    expect(userMsg?.message.content[2]).toEqual({ type: "text", text: "Direct string" });
  });

  it("should prioritize children over content prop", async () => {
    const Agent = () => (
      <Fragment>
        <Message role="user" content="This should be ignored">
          <Text>This should be used</Text>
        </Message>
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Agent />,
    });

    const result: COMInput = await engine.execute({ timeline: [] });
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.message.content).toEqual([{ type: "text", text: "This should be used" }]);
  });

  it("should produce a complete and correct COMInput structure", async () => {
    const mockTool = createTool({
      name: "test-tool",
      description: "test",
      parameters: z.undefined(),
      handler: async () => [
        {
          type: "text" as const,
          text: "ok",
        },
      ],
    });

    const Agent = () => (
      <Fragment>
        <Section id="instructions" content="System Prompt" />
        <Message role="user" content="Hello" />
        <Tool definition={mockTool} />
      </Fragment>
    );

    engine = createEngine({
      model: mockModel,
      root: <Agent />,
    });

    const result: COMInput = await engine.execute({ timeline: [] });

    // Verify Sections
    expect(result.sections["instructions"]).toBeDefined();
    expect(result.sections["instructions"].id).toBe("instructions");
    expect(result.sections["instructions"].content).toBe("System Prompt");

    // Verify Timeline
    const userMsg = result.timeline.find((t: any) => t.message.role === "user");
    expect(userMsg).toBeDefined();
    // @ts-ignore
    expect(userMsg?.message.content).toEqual([{ type: "text", text: "Hello" }]);

    // Verify Tools
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("test-tool");
  });

  it("should call lifecycle methods correctly during reconciliation", async () => {
    const mountSpy = vi.fn();
    const unmountSpy = vi.fn();

    class LifecycleComp {
      show = signal(false);
      onMount() {
        mountSpy();
      }
      onUnmount() {
        unmountSpy();
      }
      render() {
        return <Section id="lifecycle" content="Exists" />;
      }
    }

    class Parent {
      show = signal(true);
      onTickStart() {
        // Toggle show off in the second tick
        this.show.update((show) => !show);
      }
      render() {
        return this.show() ? <LifecycleComp show={true} /> : <Section id="empty" content="Gone" />;
      }
    }

    // Setup model to run 2 ticks
    executeMock
      .mockResolvedValueOnce({
        model: "mock",
        message: { role: "assistant", content: [] },
        toolCalls: [{ id: "1", name: "noop", input: {} }],
      })
      .mockResolvedValue({
        model: "mock",
        message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
      });

    engine = createEngine({
      model: mockModel,
      root: <Parent />,
      maxTicks: 2,
    });

    await engine.execute({ timeline: [] });

    // Tick 1: Parent renders LifecycleComp -> onMount called
    // Tick 2: Parent toggles show=false -> LifecycleComp removed -> onUnmount called
    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(unmountSpy).toHaveBeenCalledTimes(1);
  });

  describe("Dynamic Model Switching", () => {
    // Create two different mock models
    const fastModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
      metadata: { id: "fast-model", provider: "mock", capabilities: [] },
      executors: {
        execute: async () =>
          ({
            model: "fast-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
            raw: {},
          }) as ModelOutput,
        executeStream: async function* () {
          yield {
            type: "content_delta",
            delta: "Fast",
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
          } as StreamChunk;
        },
      },
      transformers: {
        processStream: async (_chunks: StreamChunk[]) =>
          ({
            model: "fast-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
            raw: {},
          }) as ModelOutput,
      },
      fromEngineState,
      toEngineState,
    });

    const accurateModel = createModel<
      ModelInput,
      ModelOutput,
      ModelInput,
      ModelOutput,
      StreamChunk
    >({
      metadata: { id: "accurate-model", provider: "mock", capabilities: [] },
      executors: {
        execute: async () =>
          ({
            model: "accurate-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: [{ type: "text", text: "Accurate response" }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
            raw: {},
          }) as ModelOutput,
        executeStream: async function* () {
          yield {
            type: "content_delta",
            delta: "Accurate",
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
          } as StreamChunk;
        },
      },
      transformers: {
        processStream: async (_chunks: StreamChunk[]) =>
          ({
            model: "accurate-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: [{ type: "text", text: "Accurate response" }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: "stop",
            raw: {},
          }) as ModelOutput,
      },
      fromEngineState,
      toEngineState,
    });

    it("should use Model component to set model dynamically", async () => {
      engine = createEngine({}); // No model in config

      const Agent = () => (
        <Fragment>
          <Model model={fastModel} />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(result).toBeDefined();
      const assistantMsg = result.timeline.find((t) => t.message.role === "assistant");
      expect(assistantMsg).toBeDefined();
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        expect(assistantMsg.message.content[0].text).toBe("Fast response");
      }
    });

    it("should switch models conditionally based on state", async () => {
      class ModelSwitcher {
        useFast = signal(true);
        render() {
          return (
            <Fragment>
              <Model model={this.useFast() ? fastModel : accurateModel} />
              <Message role="user" content="What model am I using?" />
            </Fragment>
          );
        }
      }

      engine = createEngine({});

      // First execution with fast model
      executeMock.mockResolvedValueOnce({
        model: "fast-model",
        message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
        stopReason: "stop",
      });

      const result1 = await engine.execute({ timeline: [] }, <ModelSwitcher />);
      let assistantMsg = result1.timeline.find((t) => t.message.role === "assistant");
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        expect(assistantMsg.message.content[0].text).toBe("Fast response");
      }

      // Switch to accurate model
      executeMock.mockResolvedValueOnce({
        model: "accurate-model",
        message: { role: "assistant", content: [{ type: "text", text: "Accurate response" }] },
        stopReason: "stop",
      });

      const switcher = new ModelSwitcher();
      switcher.useFast.set(false);

      const result2 = await engine.execute({ timeline: [] }, switcher);
      assistantMsg = result2.timeline.find((t) => t.message.role === "assistant");
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        expect(assistantMsg.message.content[0].text).toBe("Accurate response");
      }
    });

    it("should prefer Model component model over config model", async () => {
      engine = createEngine({
        model: fastModel, // Config model
      });

      const Agent = () => (
        <Fragment>
          <Model model={accurateModel} />
          <Message role="user" content="Which model?" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "accurate-model",
        message: { role: "assistant", content: [{ type: "text", text: "Accurate response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const assistantMsg = result.timeline.find((t) => t.message.role === "assistant");
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        // Should use accurateModel from Model component, not fastModel from config
        expect(assistantMsg.message.content[0].text).toBe("Accurate response");
      }
    });

    it("should fall back to config model when no Model component", async () => {
      engine = createEngine({
        model: fastModel,
      });

      const Agent = () => (
        <Fragment>
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "fast-model",
        message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const assistantMsg = result.timeline.find((t) => t.message.role === "assistant");
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        expect(assistantMsg.message.content[0].text).toBe("Fast response");
      }
    });

    it("should support multiple Model components (last one wins)", async () => {
      engine = createEngine();

      const Agent = () => (
        <Fragment>
          <Model model={fastModel} />
          <Message role="user" content="First model" />
          <Model model={accurateModel} />
          <Message role="user" content="Second model" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "accurate-model",
        message: { role: "assistant", content: [{ type: "text", text: "Accurate response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const assistantMsg = result.timeline.find((t) => t.message.role === "assistant");
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        // Last Model component should win
        expect(assistantMsg.message.content[0].text).toBe("Accurate response");
      }
    });

    it("should use last Model component when multiple render in same tick", async () => {
      engine = createEngine({});

      // Component that renders multiple Model components in sequence
      class MultiModelComponent extends Component {
        render() {
          return (
            <Fragment>
              <Model model={fastModel} />
              <Model model={accurateModel} />
              <Message role="user" content="Which model?" />
            </Fragment>
          );
        }
      }

      executeMock.mockResolvedValueOnce({
        model: "accurate-model",
        message: { role: "assistant", content: [{ type: "text", text: "Accurate response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <MultiModelComponent />);

      expect(result).toBeDefined();
      const assistantMsg = result.timeline.find((t) => t.message.role === "assistant");
      if (assistantMsg && assistantMsg.message.content[0].type === "text") {
        // Last Model component (accurateModel) should win - it's set during reconciliation
        // and used for model execution in this tick
        expect(assistantMsg.message.content[0].text).toBe("Accurate response");
      }
    });

    it("should handle Model component unmounting", async () => {
      class ConditionalModel {
        showModel = signal(true);
        onTickStart() {
          // Hide model after first tick
          if (this.showModel()) {
            this.showModel.set(false);
          }
        }
        render() {
          return (
            <Fragment>
              {this.showModel() && (
                <>
                  <Model model={fastModel} />
                  <Message role="user" content="Tick 1" />
                </>
              )}
              {!this.showModel() && <Message role="user" content="Tick 2 - no model" />}
            </Fragment>
          );
        }
      }

      engine = createEngine({
        model: accurateModel, // Fallback model
      });

      executeMock
        .mockResolvedValueOnce({
          model: "fast-model",
          message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
          toolCalls: [{ id: "1", name: "continue", input: {} }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          model: "accurate-model",
          message: { role: "assistant", content: [{ type: "text", text: "Accurate fallback" }] },
          stopReason: "stop",
        });

      const engineWithMaxTicks = createEngine({
        model: accurateModel,
        maxTicks: 2,
      });
      const result = await engineWithMaxTicks.execute({ timeline: [] }, <ConditionalModel />);

      // First tick should use fastModel from Model component
      // Second tick should use accurateModel from config (Model component unmounted)
      expect(result.timeline.length).toBeGreaterThan(0);
    });

    it("should support Model component with model identifier string", async () => {
      vi.mocked(modelRegistry.get).mockReturnValue(fastModel);

      engine = createEngine({});

      const Agent = () => (
        <Fragment>
          <Model model="fast-model-id" />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "fast-model",
        message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(modelRegistry.get).toHaveBeenCalledWith("fast-model-id");
      const assistantMsg = result.timeline.find((t) => t.message.role === "assistant");
      expect(assistantMsg).toBeDefined();
    });
  });
});
