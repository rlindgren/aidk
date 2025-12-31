import { createEngine } from "../engine/factory";
import { type TickState, Component } from "../component/component";
import { COM } from "./object-model";
import { Fragment } from "../jsx/jsx-runtime";
import { Section, Message, Tool, Timeline, Model } from "../jsx/components/primitives";
import { Text, Code, Image } from "../jsx/components/content";
import { createTool } from "../tool/tool";
import { z } from "zod";
import { createModel, type ModelInput, type ModelOutput } from "../model/model";
import { type StreamChunk } from "aidk-shared";
import { fromEngineState } from "../model/utils/language-model";
import { signal } from "../state/signal";

// Mock models
vi.mock("../utils/registry", () => ({
  modelRegistry: {
    get: vi.fn(),
  },
  toolRegistry: {
    get: vi.fn(),
  },
}));

const executeMock = vi.fn();
const prepareInputMock = vi.fn((input) => ({ messages: [], tools: [], ...input }));
const processOutputMock = vi.fn((output) => output);
const processStreamMock = vi.fn(async (chunks: StreamChunk[]) => {
  // Extract text from chunks
  const text = chunks
    .filter((c) => c.delta)
    .map((c) => c.delta)
    .join("");
  return {
    model: "mock-model",
    createdAt: new Date().toISOString(),
    message: { role: "assistant", content: text ? [{ type: "text", text }] : [] },
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    raw: {},
  } as ModelOutput;
});

const toEngineStateMock = vi.fn(async (output: any) => {
  const hasToolCalls = output.toolCalls && output.toolCalls.length > 0;
  // Stop if: stopReason is 'stop' AND no tool calls
  // Continue if: tool calls exist OR no stopReason
  const shouldStop = output.stopReason === "stop" && !hasToolCalls;

  return {
    newTimelineEntries: output.message
      ? [
          {
            kind: "message" as const,
            message: output.message,
          },
        ]
      : [],
    toolCalls: output.toolCalls?.map((tc: any) => ({ id: tc.id, name: tc.name, input: tc.input })),
    shouldStop,
    stopReason: output.stopReason ? { reason: output.stopReason, recoverable: false } : undefined,
  };
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

describe("COMInput Validation", () => {
  let engine: ReturnType<typeof createEngine>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset executeMock - each test provides mockResolvedValueOnce
    executeMock.mockReset();

    // Restore mock implementations (resetMocks: true in vitest config clears them between tests)
    prepareInputMock.mockImplementation((input) => ({ messages: [], tools: [], ...input }));
    processOutputMock.mockImplementation((output) => output);
    processStreamMock.mockImplementation(async (chunks: StreamChunk[]) => {
      const text = chunks
        .filter((c) => c.delta)
        .map((c) => c.delta)
        .join("");
      return {
        model: "mock-model",
        createdAt: new Date().toISOString(),
        message: { role: "assistant", content: text ? [{ type: "text", text }] : [] },
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        raw: {},
      } as ModelOutput;
    });
    toEngineStateMock.mockImplementation(async (output: any) => {
      const hasToolCalls = output.toolCalls && output.toolCalls.length > 0;
      const shouldStop = output.stopReason === "stop" && !hasToolCalls;

      return {
        newTimelineEntries: output.message
          ? [
              {
                kind: "message" as const,
                message: output.message,
              },
            ]
          : [],
        toolCalls: output.toolCalls?.map((tc: any) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
        shouldStop,
        stopReason: output.stopReason
          ? { reason: output.stopReason, recoverable: false }
          : undefined,
      };
    });
  });

  afterEach(() => {
    if (engine) {
      engine.destroy();
    }
  });

  describe("Basic Structures", () => {
    it("should collect sections from Section components", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Section id="intro" content="Introduction" />
          <Section id="main" content="Main content" />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // Sections appear in both sections object AND system message
      expect(result.sections).toBeDefined();
      expect(result.sections["intro"]).toBeDefined();
      expect(result.sections["intro"].id).toBe("intro");
      expect(result.sections["intro"].content).toBe("Introduction");
      expect(result.sections["main"]).toBeDefined();
      expect(result.sections["main"].id).toBe("main");
      expect(result.sections["main"].content).toBe("Main content");

      // System messages are transient (rebuilt each tick, not persisted in result)
      // They're passed to the model via fromEngineState but excluded from previous
      // Verify sections were sent to model by checking prepareInputMock
      expect(prepareInputMock).toHaveBeenCalled();
      const modelInput = prepareInputMock.mock.calls[0][0];
      const systemMessage = modelInput.messages?.find((m: any) => m.role === "system");
      expect(systemMessage).toBeDefined();

      // Check that section content appears in system message sent to model
      const systemText =
        systemMessage?.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") || "";
      expect(systemText).toContain("Introduction");
      expect(systemText).toContain("Main content");
    });

    it("should collect messages from Message components", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user" content="First message" />
          <Message role="user" content="Second message" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(result.timeline).toHaveLength(3); // 2 user + 1 assistant
      expect(result.timeline[0].message.role).toBe("user");
      expect(result.timeline[0].message.content[0]).toEqual({
        type: "text",
        text: "First message",
      });
      expect(result.timeline[1].message.role).toBe("user");
      expect(result.timeline[1].message.content[0]).toEqual({
        type: "text",
        text: "Second message",
      });
    });

    it("should collect tools from Tool components", async () => {
      const testTool = createTool({
        name: "test-tool",
        description: "Test tool",
        input: z.undefined(),
        handler: async () => [],
      });

      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Tool definition={testTool} />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("test-tool");
    });

    it("should collect metadata from components", async () => {
      class MetadataComponent extends Component {
        render() {
          return (
            <Fragment>
              <Message role="user" content="Hello" />
            </Fragment>
          );
        }
        onMount(com: COM) {
          com.addMetadata("source", "test");
          com.addMetadata("version", "1.0");
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <MetadataComponent />);

      expect(result.metadata).toEqual({
        source: "test",
        version: "1.0",
      });
    });
  });

  describe("Timeline vs Non-Timeline Messages", () => {
    it("should collect messages inside Timeline component", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Timeline>
            <Message role="user" content="Timeline message 1" />
            <Message role="user" content="Timeline message 2" />
          </Timeline>
          <Message role="user" content="Outside timeline" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // All messages should be in timeline (Timeline is just a Fragment)
      expect(result.timeline.length).toBeGreaterThanOrEqual(3);
      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages).toHaveLength(3);
    });

    it("should preserve message order regardless of Timeline wrapper", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user" content="First" />
          <Timeline>
            <Message role="user" content="Second" />
          </Timeline>
          <Message role="user" content="Third" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages[0].message.content[0]).toEqual({ type: "text", text: "First" });
      expect(userMessages[1].message.content[0]).toEqual({ type: "text", text: "Second" });
      expect(userMessages[2].message.content[0]).toEqual({ type: "text", text: "Third" });
    });
  });

  describe("System Messages", () => {
    it("should collect system messages and send to model", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="system" content="You are a helpful assistant" />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // System messages are NOT in result.timeline - they're transient (rebuilt each tick)
      const systemMsgInTimeline = result.timeline.find((t) => t.message.role === "system");
      expect(systemMsgInTimeline).toBeUndefined();

      // But they ARE sent to the model
      expect(prepareInputMock).toHaveBeenCalled();
      const modelInput = prepareInputMock.mock.calls[0][0];
      const systemMessage = modelInput.messages?.find((m: any) => m.role === "system");
      expect(systemMessage).toBeDefined();
      expect(systemMessage?.content[0]).toEqual({
        type: "text",
        text: "You are a helpful assistant",
      });
    });

    it("should consolidate multiple system messages and send to model", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="system" content="First system message" />
          <Message role="user" content="User message" />
          <Message role="system" content="Second system message" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
        stopReason: "stop",
      });

      await engine.execute({ timeline: [] }, <Agent />);

      // System messages are consolidated and sent to model
      expect(prepareInputMock).toHaveBeenCalled();
      const modelInput = prepareInputMock.mock.calls[0][0];

      // Should have exactly one system message (consolidated)
      const systemMessages = modelInput.messages?.filter((m: any) => m.role === "system") || [];
      expect(systemMessages).toHaveLength(1);

      // Both system messages should appear in the consolidated text
      const systemContent = systemMessages[0]?.content || [];
      const systemText = systemContent
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      expect(systemText).toContain("First system message");
      expect(systemText).toContain("Second system message");
    });
  });

  describe("Multiple Components Contributing", () => {
    it("should merge sections from multiple components", async () => {
      class ComponentA extends Component {
        render() {
          return <Section id="section-a" content="From Component A" />;
        }
      }

      class ComponentB extends Component {
        render() {
          return <Section id="section-b" content="From Component B" />;
        }
      }

      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <ComponentA />
          <ComponentB />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(result.sections["section-a"]).toBeDefined();
      expect(result.sections["section-b"]).toBeDefined();
      expect(result.sections["section-a"].content).toBe("From Component A");
      expect(result.sections["section-b"].content).toBe("From Component B");
    });

    it("should merge messages from multiple components", async () => {
      class ComponentA extends Component {
        render() {
          return <Message role="user" content="From Component A" />;
        }
      }

      class ComponentB extends Component {
        render() {
          return <Message role="user" content="From Component B" />;
        }
      }

      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <ComponentA />
          <ComponentB />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].message.content[0]).toEqual({
        type: "text",
        text: "From Component A",
      });
      expect(userMessages[1].message.content[0]).toEqual({
        type: "text",
        text: "From Component B",
      });
    });

    it("should merge tools from multiple components", async () => {
      const toolA = createTool({
        name: "tool-a",
        description: "Tool A",
        input: z.undefined(),
        handler: async () => [],
      });

      const toolB = createTool({
        name: "tool-b",
        description: "Tool B",
        input: z.undefined(),
        handler: async () => [],
      });

      class ComponentA extends Component {
        render() {
          return <Tool definition={toolA} />;
        }
      }

      class ComponentB extends Component {
        render() {
          return <Tool definition={toolB} />;
        }
      }

      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <ComponentA />
          <ComponentB />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(result.tools).toHaveLength(2);
      expect(result.tools.find((t) => t.name === "tool-a")).toBeDefined();
      expect(result.tools.find((t) => t.name === "tool-b")).toBeDefined();
    });

    it("should merge metadata from multiple components", async () => {
      class ComponentA extends Component {
        onMount(com: COM) {
          com.addMetadata("source", "component-a");
          com.addMetadata("key1", "value1");
        }
        render() {
          return <Message role="user" content="Hello" />;
        }
      }

      class ComponentB extends Component {
        onMount(com: COM) {
          com.addMetadata("source", "component-b"); // Overwrites component-a
          com.addMetadata("key2", "value2");
        }
        render() {
          return null;
        }
      }

      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <ComponentA />
          <ComponentB />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // Later metadata overwrites earlier
      expect(result.metadata["source"]).toBe("component-b");
      expect(result.metadata["key1"]).toBe("value1");
      expect(result.metadata["key2"]).toBe("value2");
    });
  });

  describe("Conditional Rendering", () => {
    it("should only include conditionally rendered sections", async () => {
      class ConditionalSection {
        show = signal(true);

        render() {
          return (
            <Fragment>
              {this.show() && <Section id="conditional" content="Shown" />}
              <Message role="user" content="Hello" />
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <ConditionalSection />);

      expect(result.sections["conditional"]).toBeDefined();
      expect(result.sections["conditional"].content).toBe("Shown");
    });

    it("should exclude conditionally hidden sections", async () => {
      class ConditionalSection {
        show = signal(false);

        render() {
          return (
            <Fragment>
              {this.show() && <Section id="conditional" content="Hidden" />}
              <Message role="user" content="Hello" />
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <ConditionalSection />);

      expect(result.sections["conditional"]).toBeUndefined();
    });

    it("should handle conditionally rendered messages", async () => {
      class ConditionalMessage {
        include = signal(true);
        render() {
          return (
            <Fragment>
              <Message role="user" content="Always shown" />
              {this.include() && <Message role="user" content="Conditionally shown" />}
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <ConditionalMessage />);

      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].message.content[0]).toEqual({ type: "text", text: "Always shown" });
      expect(userMessages[1].message.content[0]).toEqual({
        type: "text",
        text: "Conditionally shown",
      });
    });
  });

  describe("Multiple Models Conditionally Rendered", () => {
    const fastModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
      metadata: { id: "fast-model", provider: "mock", capabilities: [] },
      executors: {
        execute: async () =>
          ({
            model: "fast-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: [{ type: "text", text: "Fast response" }] },
            toolCalls: [{ id: "1", name: "noop", input: {} }],
            stopReason: "tool_use",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            raw: {},
          }) as ModelOutput,
      },
      transformers: {
        prepareInput: prepareInputMock,
        processOutput: processOutputMock,
        processStream: async (chunks: StreamChunk[]) => {
          const text = chunks
            .filter((c) => c.delta)
            .map((c) => c.delta)
            .join("");
          return {
            model: "fast-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: text ? [{ type: "text", text }] : [] },
            stopReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            raw: {},
          } as ModelOutput;
        },
      },
      toEngineState: toEngineStateMock,
      fromEngineState,
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
            stopReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            raw: {},
          }) as ModelOutput,
      },
      transformers: {
        prepareInput: prepareInputMock,
        processOutput: processOutputMock,
        processStream: async (chunks: StreamChunk[]) => {
          const text = chunks
            .filter((c) => c.delta)
            .map((c) => c.delta)
            .join("");
          return {
            model: "accurate-model",
            createdAt: new Date().toISOString(),
            message: { role: "assistant", content: text ? [{ type: "text", text }] : [] },
            stopReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            raw: {},
          } as ModelOutput;
        },
      },
      toEngineState: toEngineStateMock,
      fromEngineState,
    });

    it("should use last model when multiple models render", async () => {
      engine = createEngine();

      const Agent = () => (
        <Fragment>
          <Model model={fastModel} />
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
        expect(assistantMsg.message.content[0].text).toBe("Accurate response");
      }
    });

    it("should switch models conditionally across ticks", async () => {
      class ModelSwitcher {
        useFast = signal(true);
        onTickStart(_com: COM, _state: TickState) {
          // Switch to accurate after first tick
          if (state.tick > 1 && this.useFast()) {
            this.useFast.set(false);
          }
        }
        render(com: COM, state: TickState) {
          // Render from previous + current (no tick checking needed!)
          const previousEntries = state.previous?.timeline || [];
          const currentEntries = state.current?.timeline || [];
          const allEntries = [...previousEntries, ...currentEntries];

          return (
            <Fragment>
              {allEntries.map((entry, idx) => (
                <Message
                  key={`entry-${idx}`}
                  role={entry.message.role}
                  content={entry.message.content}
                />
              ))}
              {this.useFast() ? <Model model={fastModel} /> : <Model model={accurateModel} />}
              <Message role="user" content="Hello" />
            </Fragment>
          );
        }
      }

      engine = createEngine();

      // Models use their own execute functions, so executeMock is not used here

      const noopTool = createTool({
        name: "noop",
        description: "No-op tool",
        input: z.undefined(),
        handler: async () => [],
      });

      const result = await engine.execute.call(
        { timeline: [] },
        <Fragment>
          <Tool definition={noopTool} />
          <ModelSwitcher />
        </Fragment>,
      );

      // Should have responses from both models
      const assistantMessages = result.timeline.filter((t) => t.message.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Section Merging", () => {
    it("should combine content from sections with same ID", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Section id="same-id" content="First" />
          <Section id="same-id" content="Second" />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // Should only have one section (merged by ID)
      expect(Object.keys(result.sections)).toHaveLength(1);
      // Content from both sections should be combined in render order
      expect(result.sections["same-id"].content).toBe("First\nSecond");
    });

    it("should combine content from multiple sections with same ID", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Section id="test" content="First" />
          <Section id="test" content="Second" />
          <Section id="test" content="Third" />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // All content should be combined in render order
      expect(result.sections["test"].content).toBe("First\nSecond\nThird");
    });
  });

  describe("Visibility and Tags", () => {
    it("should preserve visibility on timeline entries", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user" content="Visible to model" visibility="model" />
          <Message role="user" content="Visible to observer" visibility="observer" />
          <Message role="user" content="Log only" visibility="log" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages[0].visibility).toBe("model");
      expect(userMessages[1].visibility).toBe("observer");
      expect(userMessages[2].visibility).toBe("log");
    });

    it("should preserve tags on timeline entries", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user" content="Tagged message" tags={["important", "user-input"]} />
          <Message role="user" content="Untagged message" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const taggedMsg = result.timeline.find(
        (t) =>
          t.message.role === "user" &&
          t.message.content[0].type === "text" &&
          t.message.content[0].text === "Tagged message",
      );
      expect(taggedMsg?.tags).toEqual(["important", "user-input"]);
    });

    it("should preserve visibility and tags on sections", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Section
            id="test-section"
            content="Test content"
            visibility="model"
            tags={["section", "test"]}
          />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      expect(result.sections["test-section"].visibility).toBe("model");
      expect(result.sections["test-section"].tags).toEqual(["section", "test"]);
    });
  });

  describe("Content Blocks", () => {
    it("should collect text content blocks", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user">
            <Text>Hello</Text>
            <Text>World</Text>
          </Message>
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const userMsg = result.timeline.find((t) => t.message.role === "user");
      expect(userMsg?.message.content).toHaveLength(2);
      expect(userMsg?.message.content[0]).toEqual({ type: "text", text: "Hello" });
      expect(userMsg?.message.content[1]).toEqual({ type: "text", text: "World" });
    });

    it("should collect code content blocks", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user">
            <Code language="typescript">const x = 1;</Code>
          </Message>
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const userMsg = result.timeline.find((t) => t.message.role === "user");
      expect(userMsg?.message.content[0]).toEqual({
        type: "code",
        language: "typescript",
        text: "const x = 1;",
      });
    });

    it("should collect mixed content blocks", async () => {
      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Message role="user">
            <Text>Here's some code:</Text>
            <Code language="javascript">console.log('hello');</Code>
            <Text>And an image:</Text>
            <Image source={{ type: "url", url: "https://example.com/image.png" }} />
          </Message>
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      const userMsg = result.timeline.find((t) => t.message.role === "user");
      expect(userMsg?.message.content).toHaveLength(4);
      expect(userMsg?.message.content[0].type).toBe("text");
      expect(userMsg?.message.content[1].type).toBe("code");
      expect(userMsg?.message.content[2].type).toBe("text");
      expect(userMsg?.message.content[3].type).toBe("image");
    });
  });

  describe("Tool Deduplication", () => {
    it("should deduplicate tools with same name", async () => {
      const testTool = createTool({
        name: "duplicate-tool",
        description: "Duplicate tool",
        input: z.undefined(),
        handler: async () => [],
      });

      engine = createEngine({ model: mockModel });

      const Agent = () => (
        <Fragment>
          <Tool definition={testTool} />
          <Tool definition={testTool} />
          <Tool definition={testTool} />
          <Message role="user" content="Hello" />
        </Fragment>
      );

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Agent />);

      // Should only have one tool (last one wins)
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("duplicate-tool");
    });
  });

  describe("Multiple Ticks", () => {
    it("should accumulate timeline entries across ticks", async () => {
      class AccumulatingComponent extends Component {
        render(com: COM, state: TickState) {
          const tickNumber = state.tick || 1;
          // Render from previous + current (no tick checking needed!)
          const previousEntries = state.previous?.timeline || [];
          const currentEntries = state.current?.timeline || [];
          const allEntries = [...previousEntries, ...currentEntries];

          // Add new user message for this tick
          return (
            <Fragment>
              {allEntries.map((entry, idx) => (
                <Message
                  key={`entry-${idx}`}
                  role={entry.message.role}
                  content={entry.message.content}
                />
              ))}
              <Message role="user" content={`Tick ${tickNumber} message`} />
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock
        .mockResolvedValueOnce({
          model: "mock-model",
          message: { role: "assistant", content: [{ type: "text", text: "Response 1" }] },
          toolCalls: [{ id: "1", name: "noop", input: {} }],
        })
        .mockResolvedValueOnce({
          model: "mock-model",
          message: { role: "assistant", content: [{ type: "text", text: "Response 2" }] },
          stopReason: "stop",
        });

      const noopTool = createTool({
        name: "noop",
        description: "No-op tool",
        input: z.undefined(),
        handler: async () => [],
      });

      const result = await engine.execute.call(
        { timeline: [] },
        <Fragment>
          <Tool definition={noopTool} />
          <AccumulatingComponent />
        </Fragment>,
      );

      // Should have messages from both ticks
      // Tick 1: user message "Tick 1 message" + assistant response
      // Tick 2: user message "Tick 2 message" + assistant response
      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(2);

      const assistantMessages = result.timeline.filter((t) => t.message.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
    });

    it("should rebuild sections each tick", async () => {
      class DynamicSection {
        tick = signal(0);

        onTickStart(_com: COM, _state: TickState) {
          this.tick.update((t) => t + 1);
        }
        render() {
          return (
            <Fragment>
              <Section id="dynamic" content={`Tick ${this.tick()} content`} />
              <Message role="user" content="Hello" />
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock
        .mockResolvedValueOnce({
          model: "mock-model",
          message: { role: "assistant", content: [{ type: "text", text: "Response 1" }] },
          toolCalls: [{ id: "1", name: "noop", input: {} }],
        })
        .mockResolvedValueOnce({
          model: "mock-model",
          message: { role: "assistant", content: [{ type: "text", text: "Response 2" }] },
          stopReason: "stop",
        });

      const noopTool = createTool({
        name: "noop",
        description: "No-op tool",
        input: z.undefined(),
        handler: async () => [],
      });

      const result = await engine.execute.call(
        { timeline: [] },
        <Fragment>
          <Tool definition={noopTool} />
          <DynamicSection />
        </Fragment>,
      );

      // Section should reflect the last tick's content
      expect(result.sections["dynamic"]).toBeDefined();
      expect(result.sections["dynamic"].content).toBe("Tick 1 content");
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle complex nested component tree", async () => {
      class NestedA extends Component {
        render() {
          return (
            <Fragment>
              <Section id="nested-a" content="From NestedA" />
              <Message role="user" content="NestedA message" />
            </Fragment>
          );
        }
      }

      class NestedB extends Component {
        render() {
          return (
            <Fragment>
              <NestedA />
              <Section id="nested-b" content="From NestedB" />
              <Message role="user" content="NestedB message" />
            </Fragment>
          );
        }
      }

      class Root extends Component {
        render() {
          return (
            <Fragment>
              <Section id="root" content="From Root" />
              <NestedB />
              <Message role="user" content="Root message" />
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Response" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <Root />);

      // Should have all sections
      expect(result.sections["root"]).toBeDefined();
      expect(result.sections["nested-a"]).toBeDefined();
      expect(result.sections["nested-b"]).toBeDefined();

      // Should have all messages in order
      const userMessages = result.timeline.filter((t) => t.message.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle sections, messages, tools, and metadata together", async () => {
      const testTool = createTool({
        name: "test-tool",
        description: "Test tool",
        input: z.undefined(),
        handler: async () => [],
      });

      class ComprehensiveComponent extends Component {
        onMount(com: COM) {
          com.addMetadata("component", "comprehensive");
          com.addMetadata("version", "1.0");
        }
        render() {
          return (
            <Fragment>
              <Section id="intro" content="Introduction" />
              <Section id="main" content="Main content" />
              <Message role="system" content="You are helpful" />
              <Message role="user" content="Hello" tags={["greeting"]} />
              <Tool definition={testTool} />
            </Fragment>
          );
        }
      }

      engine = createEngine({ model: mockModel });

      executeMock.mockResolvedValueOnce({
        model: "mock-model",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        stopReason: "stop",
      });

      const result = await engine.execute({ timeline: [] }, <ComprehensiveComponent />);

      // Verify all structures are present
      expect(result.sections["intro"]).toBeDefined();
      expect(result.sections["main"]).toBeDefined();
      expect(result.tools).toHaveLength(1);
      expect(result.metadata["component"]).toBe("comprehensive");
      expect(result.metadata["version"]).toBe("1.0");

      // System messages are transient - verify they're sent to model
      expect(prepareInputMock).toHaveBeenCalled();
      const modelInput = prepareInputMock.mock.calls[0][0];
      const systemMessage = modelInput.messages?.find((m: any) => m.role === "system");
      expect(systemMessage).toBeDefined();

      const userMsg = result.timeline.find((t) => t.message.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg?.tags).toEqual(["greeting"]);
    });
  });
});
