/**
 * Component Tool
 *
 * Creates a tool that executes a component as a sub-agent.
 * The model can call this tool to delegate work to specialized components.
 */

import { z } from "zod";
import { createTool, ToolExecutionType } from "./tool";
import { createEngine } from "../engine/factory";
import type { ComponentDefinition } from "../component/component";
import type { EngineModel } from "../model/model";
import type { EngineConfig } from "../engine/engine";
import type { EngineInput, COMInput, COMTimelineEntry } from "../com/types";
import type { ContentBlock, Message } from "aidk-shared";

/**
 * Default input schema - simple prompt-based
 */
export const componentToolInputSchema = z.object({
  prompt: z.string().describe("The task or question for this agent"),
});

export type ComponentToolInput = z.infer<typeof componentToolInputSchema>;

/**
 * Options for creating a component tool
 */
export interface ComponentToolOptions<TInput extends z.ZodType = typeof componentToolInputSchema> {
  /** Tool name (used by model to call it) */
  name: string;

  /** Description of what this component/agent does */
  description: string;

  /** The component to execute */
  component: ComponentDefinition;

  /**
   * Input schema - defaults to { prompt: string }
   * Custom schemas are JSON-serialized into the user message
   */
  input?: TInput;

  /**
   * Model for the sub-engine execution.
   * Component can override via <Model> in its JSX.
   */
  model?: EngineModel;

  /** Additional engine configuration */
  engineConfig?: Partial<EngineConfig>;

  /**
   * Transform the component output into tool result content blocks.
   * Defaults to extracting the last assistant message content.
   */
  transformResult?: (output: COMInput) => ContentBlock[];

  /** Require user confirmation before executing */
  requiresConfirmation?: boolean | ((input: z.infer<TInput>) => boolean);

  /** Confirmation message to show user */
  confirmationMessage?: string | ((input: z.infer<TInput>) => string);
}

/**
 * Create a tool that executes a component as a sub-agent.
 *
 * @example
 * ```typescript
 * // Simple prompt-based tool
 * const ResearchTool = createComponentTool({
 *   name: "research",
 *   description: "Research a topic in depth",
 *   component: ResearchAgent,
 * });
 *
 * // With custom input schema
 * const CodeReviewTool = createComponentTool({
 *   name: "review_code",
 *   description: "Review code for issues. Expects JSON with code and language.",
 *   input: z.object({
 *     code: z.string(),
 *     language: z.string(),
 *   }),
 *   component: CodeReviewAgent,
 * });
 *
 * // Use in an agent
 * const OrchestratorAgent = () => (
 *   <>
 *     <System>You orchestrate tasks. Use tools to delegate to specialists.</System>
 *     <ResearchTool />
 *     <CodeReviewTool />
 *   </>
 * );
 * ```
 */
export function createComponentTool<TInput extends z.ZodType = typeof componentToolInputSchema>(
  options: ComponentToolOptions<TInput>,
) {
  const inputSchema = (options.input ?? componentToolInputSchema) as z.ZodType<z.infer<TInput>>;

  return createTool({
    name: options.name,
    description: options.description,
    input: inputSchema,
    type: ToolExecutionType.SERVER,
    requiresConfirmation: options.requiresConfirmation,
    confirmationMessage: options.confirmationMessage,

    handler: async (input: z.infer<TInput>): Promise<ContentBlock[]> => {
      // Create engine for sub-execution
      const engine = createEngine({
        ...options.engineConfig,
        model: options.model,
      });

      // Convert input to EngineInput (user message)
      const engineInput = toEngineInput(input);

      // Execute the component
      const result = await engine.execute(engineInput, options.component);

      // Transform result (default: extract last assistant content)
      return options.transformResult?.(result) ?? extractLastAssistantContent(result);
    },
  });
}

/**
 * Convert tool input to EngineInput.
 * Input becomes a user message - either the prompt text directly,
 * or JSON-serialized for structured inputs.
 */
function toEngineInput(input: unknown): EngineInput {
  let text: string;

  if (typeof input === "string") {
    text = input;
  } else if (typeof input === "object" && input !== null && "prompt" in input) {
    // Default schema - use prompt directly
    text = (input as ComponentToolInput).prompt;
  } else {
    // Custom schema - serialize as JSON
    text = JSON.stringify(input, null, 2);
  }

  const message: Message = {
    role: "user",
    content: [{ type: "text", text }],
  };

  const entry: COMTimelineEntry = {
    kind: "message",
    message,
  };

  return {
    timeline: [entry],
  };
}

/**
 * Extract content blocks from the last assistant message.
 * This is the default result transformer.
 */
function extractLastAssistantContent(output: COMInput): ContentBlock[] {
  const assistantEntries = output.timeline.filter(
    (entry): entry is COMTimelineEntry & { message: Message } =>
      entry.kind === "message" && entry.message?.role === "assistant",
  );

  const last = assistantEntries.at(-1);

  if (!last?.message?.content || last.message.content.length === 0) {
    return [{ type: "text", text: "No response from agent" }];
  }

  return last.message.content;
}
