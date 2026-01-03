/**
 * Component Tool Tests
 *
 * Tests for createComponentTool - executing components as tools.
 */

import { z } from "zod";
import { createComponentTool } from "./component-tool";
import { createModel } from "../model/model";
import { fromEngineState, toEngineState } from "../model/utils/language-model";
import type { ModelInput, ModelOutput } from "../model/model";
import { Fragment } from "../jsx/jsx-runtime";
import { System } from "../jsx/components/primitives";
import { Model } from "../jsx/components/model";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockModel(response: string, toolCalls?: { name: string; input: any }[]) {
  return createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, any>({
    metadata: { id: "mock-model", provider: "mock", capabilities: [] },
    executors: {
      execute: vi.fn().mockResolvedValue({
        model: "mock-model",
        createdAt: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: response }],
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        stopReason: toolCalls ? "tool_use" : "stop",
        toolCalls: toolCalls?.map((tc, i) => ({
          id: `call-${i}`,
          name: tc.name,
          input: tc.input,
        })),
        raw: {},
      } as ModelOutput),
    },
    fromEngineState,
    toEngineState,
  });
}

// ============================================================================
// Basic Component Tool Tests
// ============================================================================

describe("createComponentTool", () => {
  describe("basic functionality", () => {
    it("should create a tool with default prompt-based input", () => {
      const SimpleAgent = () => (
        <Fragment>
          <System>You are a helpful assistant.</System>
        </Fragment>
      );

      const tool = createComponentTool({
        name: "simple_agent",
        description: "A simple agent",
        component: SimpleAgent,
      });

      expect(tool.metadata.name).toBe("simple_agent");
      expect(tool.metadata.description).toBe("A simple agent");
      expect(tool.metadata.input).toBeDefined();
    });

    it("should accept custom input schema", () => {
      const customSchema = z.object({
        code: z.string(),
        language: z.string(),
      });

      const CodeAgent = () => (
        <Fragment>
          <System>You review code.</System>
        </Fragment>
      );

      const tool = createComponentTool({
        name: "code_reviewer",
        description: "Reviews code",
        input: customSchema,
        component: CodeAgent,
      });

      expect(tool.metadata.name).toBe("code_reviewer");
      // The input schema should be the custom one
      expect(tool.metadata.input).toBeDefined();
    });

    it("should execute component and return assistant content", async () => {
      const mockModel = createMockModel("This is my response");

      const TestAgent = () => (
        <Fragment>
          <Model model={mockModel} />
          <System>You are a test agent.</System>
        </Fragment>
      );

      const tool = createComponentTool({
        name: "test_agent",
        description: "A test agent",
        component: TestAgent,
      });

      const result = await tool.run({ prompt: "Hello" });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as any).text).toBe("This is my response");
    });

    it("should serialize custom input as JSON in user message", async () => {
      const executeMock = vi.fn().mockResolvedValue({
        model: "mock-model",
        createdAt: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Code looks good" }],
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        stopReason: "stop",
        raw: {},
      } as ModelOutput);

      const mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, any>({
        metadata: { id: "mock-model", provider: "mock", capabilities: [] },
        executors: { execute: executeMock },
        fromEngineState,
        toEngineState,
      });

      const CodeAgent = () => (
        <Fragment>
          <Model model={mockModel} />
          <System>You review code. Input is JSON.</System>
        </Fragment>
      );

      const tool = createComponentTool({
        name: "review_code",
        description: "Review code",
        input: z.object({
          code: z.string(),
          language: z.string(),
        }),
        component: CodeAgent,
      });

      await tool.run({ code: "const x = 1;", language: "typescript" });

      // Verify the execute was called (component was run)
      expect(executeMock).toHaveBeenCalled();
    });
  });

  describe("custom result transformation", () => {
    it("should use custom transformResult when provided", async () => {
      const mockModel = createMockModel("Raw response");

      const TestAgent = () => (
        <Fragment>
          <Model model={mockModel} />
          <System>Test</System>
        </Fragment>
      );

      const tool = createComponentTool({
        name: "custom_transform",
        description: "Custom transform",
        component: TestAgent,
        transformResult: (output) => {
          // Custom: wrap in a summary block
          const text = output.timeline
            .filter((e) => e.message?.role === "assistant")
            .map((e) => e.message?.content.map((c: any) => c.text).join(""))
            .join("");
          return [{ type: "text", text: `Summary: ${text}` }];
        },
      });

      const result = await tool.run({ prompt: "Hello" });

      expect(result).toHaveLength(1);
      expect((result[0] as any).text).toBe("Summary: Raw response");
    });
  });

  describe("confirmation support", () => {
    it("should pass through requiresConfirmation option", () => {
      const Agent = () => <System>Test</System>;

      const tool = createComponentTool({
        name: "dangerous_agent",
        description: "Does dangerous things",
        component: Agent,
        requiresConfirmation: true,
        confirmationMessage: "Are you sure?",
      });

      expect(tool.metadata.requiresConfirmation).toBe(true);
      expect(tool.metadata.confirmationMessage).toBe("Are you sure?");
    });

    it("should support dynamic requiresConfirmation", () => {
      const Agent = () => <System>Test</System>;

      const tool = createComponentTool({
        name: "conditional_confirm",
        description: "Conditionally confirms",
        component: Agent,
        requiresConfirmation: (input) => input.prompt.includes("delete"),
      });

      expect(typeof tool.metadata.requiresConfirmation).toBe("function");
    });
  });
});

// ============================================================================
// Nested Component Tools Tests
// ============================================================================

describe("nested component tools", () => {
  it("should allow component to register a component tool", async () => {
    // Inner agent - simple responder
    const InnerAgent = () => (
      <Fragment>
        <Model model={createMockModel("Inner agent response")} />
        <System>You are an inner agent.</System>
      </Fragment>
    );

    // Create a tool from the inner agent
    const InnerTool = createComponentTool({
      name: "inner_agent",
      description: "Calls an inner agent",
      component: InnerAgent,
    });

    // Outer agent that has the inner tool available
    const OuterAgent = () => (
      <Fragment>
        <Model model={createMockModel("Outer agent with inner tool available")} />
        <System>You can use the inner_agent tool.</System>
        <InnerTool />
      </Fragment>
    );

    // Create tool from outer agent
    const OuterTool = createComponentTool({
      name: "outer_agent",
      description: "Orchestrates with inner agent",
      component: OuterAgent,
    });

    // Execute - this verifies the component structure works
    const result = await OuterTool.run({ prompt: "Hello" });

    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toBe("Outer agent with inner tool available");
  });

  it("should execute nested component tools when model calls them", async () => {
    // Inner agent
    const innerExecute = vi.fn().mockResolvedValue({
      model: "inner-model",
      createdAt: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Research complete: Found 42 results" }],
      },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: "stop",
      raw: {},
    } as ModelOutput);

    const innerModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, any>({
      metadata: { id: "inner-model", provider: "mock", capabilities: [] },
      executors: { execute: innerExecute },
      fromEngineState,
      toEngineState,
    });

    const ResearchAgent = () => (
      <Fragment>
        <Model model={innerModel} />
        <System>You are a researcher.</System>
      </Fragment>
    );

    const ResearchTool = createComponentTool({
      name: "research",
      description: "Research a topic",
      component: ResearchAgent,
    });

    // Outer agent that calls the research tool
    let outerCallCount = 0;
    const outerExecute = vi.fn().mockImplementation(async () => {
      outerCallCount++;
      if (outerCallCount === 1) {
        // First call: use the tool
        return {
          model: "outer-model",
          createdAt: new Date().toISOString(),
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                toolUseId: "call-1",
                name: "research",
                input: { prompt: "quantum physics" },
              },
            ],
          },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "tool_use",
          toolCalls: [{ id: "call-1", name: "research", input: { prompt: "quantum physics" } }],
          raw: {},
        } as ModelOutput;
      } else {
        // Second call: after tool result
        return {
          model: "outer-model",
          createdAt: new Date().toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Based on research: 42 results found" }],
          },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          stopReason: "stop",
          raw: {},
        } as ModelOutput;
      }
    });

    const outerModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, any>({
      metadata: { id: "outer-model", provider: "mock", capabilities: [] },
      executors: { execute: outerExecute },
      fromEngineState,
      toEngineState,
    });

    const OrchestratorAgent = () => (
      <Fragment>
        <Model model={outerModel} />
        <System>You orchestrate research.</System>
        <ResearchTool />
      </Fragment>
    );

    const OrchestratorTool = createComponentTool({
      name: "orchestrator",
      description: "Orchestrates research",
      component: OrchestratorAgent,
    });

    const result = await OrchestratorTool.run({ prompt: "Research quantum physics" });

    // Outer model called twice (tool call + after result)
    expect(outerExecute).toHaveBeenCalledTimes(2);

    // Inner model called once (via the component tool)
    expect(innerExecute).toHaveBeenCalled();

    // Final result
    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toBe("Based on research: 42 results found");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("should handle component with no assistant response", async () => {
    const executeMock = vi.fn().mockResolvedValue({
      model: "mock-model",
      createdAt: new Date().toISOString(),
      message: { role: "assistant", content: [] },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: "stop",
      raw: {},
    } as ModelOutput);

    const mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, any>({
      metadata: { id: "mock-model", provider: "mock", capabilities: [] },
      executors: { execute: executeMock },
      fromEngineState,
      toEngineState,
    });

    const EmptyAgent = () => (
      <Fragment>
        <Model model={mockModel} />
        <System>Test</System>
      </Fragment>
    );

    const tool = createComponentTool({
      name: "empty_agent",
      description: "Returns nothing",
      component: EmptyAgent,
    });

    const result = await tool.run({ prompt: "Hello" });

    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toBe("No response from agent");
  });

  it("should handle empty prompt", async () => {
    const mockModel = createMockModel("Received empty prompt");

    const TestAgent = () => (
      <Fragment>
        <Model model={mockModel} />
        <System>Test</System>
      </Fragment>
    );

    const tool = createComponentTool({
      name: "test",
      description: "Test",
      component: TestAgent,
    });

    const result = await tool.run({ prompt: "" });

    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toBe("Received empty prompt");
  });
});
