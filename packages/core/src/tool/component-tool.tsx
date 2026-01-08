/**
 * Component Tool
 *
 * Creates a tool that executes a component as a sub-agent.
 * The model can call this tool to delegate work to specialized components.
 */

import { z } from "zod";
// import { createElement } from "../jsx/jsx-runtime";
import { createTool, ToolExecutionType } from "./tool";
import { createEngine } from "../engine/factory";
import { Context } from "../context";
import { Logger } from "aidk-kernel";
import type { ComponentDefinition } from "../component/component";
import type { EngineModel } from "../model/model";
import type { EngineConfig } from "../engine/engine";
import type { EngineInput, COMInput, COMTimelineEntry } from "../com/types";
import type { ContentBlock, Message } from "aidk-shared";

// Create logger for this module
const log = Logger.for("ComponentTool");

/**
 * Source schema for media attachments (images, documents, etc.)
 */
export const mediaBlockSchema = z.object({
  type: z.enum(["image", "document", "audio", "video"]),
  source: z.object({
    type: z.enum(["base64", "url"]),
    mediaType: z.string().optional(),
    data: z.string().optional(),
    url: z.string().optional(),
  }),
});

/**
 * Content block schema for attachments (images, files, etc.)
 * Supports text, image, document, audio, and video blocks that can be passed to sub-agents.
 * Uses discriminatedUnion with literal types for proper Zod validation.
 */
const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  mediaBlockSchema,
]);

/**
 * Base input schema for component tools (without options).
 * - `prompt`: The primary instruction or question (required)
 * - `attachments`: Optional images, files, or other content blocks
 */
const baseInputSchema = z.object({
  prompt: z.string().describe("The task or question for this agent"),
  attachments: z
    .array(contentBlockSchema)
    .optional()
    .describe("Optional images, files, or other content to include with the request"),
});

/**
 * Default input schema for component tools (exported for backwards compatibility).
 * When no options schema is provided, this is the schema used.
 */
export const componentToolInputSchema = baseInputSchema;

export type ComponentToolInput = z.infer<typeof baseInputSchema> & {
  options?: Record<string, unknown>;
};

/**
 * Minimal interface for Zod-like schemas (version-agnostic).
 * Allows different Zod versions to work together.
 */
interface ZodLike {
  optional: () => ZodLike;
}

/**
 * Build the input schema based on whether an options schema is provided.
 * - If options schema provided: { prompt, attachments?, options? }
 * - If no options schema: { prompt, attachments? }
 */
function buildInputSchema<TOptions extends ZodLike | undefined>(
  optionsSchema: TOptions,
): typeof baseInputSchema {
  if (optionsSchema) {
    return z.object({
      prompt: z.string().describe("The task or question for this agent"),
      attachments: z
        .array(contentBlockSchema)
        .optional()
        .describe("Optional images, files, or other content to include with the request"),
      options: (optionsSchema.optional() as z.ZodType).describe(
        "Configuration options for this agent",
      ),
    }) as typeof baseInputSchema;
  }
  return baseInputSchema;
}

/**
 * Options for creating a component tool
 */
export interface ComponentToolOptions<
  TInput extends z.ZodType = typeof componentToolInputSchema,
  TOptions extends ZodLike | undefined = undefined,
> {
  /** Tool name (used by model to call it) */
  name: string;

  /** Description of what this component/agent does */
  description: string;

  /** The component to execute */
  component: ComponentDefinition;

  /**
   * Input schema - defaults to { prompt, attachments?, options? }
   * Custom schemas are JSON-serialized into the user message.
   * When provided, this overrides the default schema entirely.
   */
  input?: TInput;

  /**
   * Options schema for component configuration.
   * When provided, adds an `options` field to the default input schema.
   * The options are passed as props to the component.
   * Ignored if custom `input` schema is provided.
   *
   * @example
   * ```typescript
   * options: z.object({
   *   maxIterations: z.number().default(3),
   *   depth: z.enum(["shallow", "deep"]).default("shallow"),
   * })
   * ```
   */
  options?: TOptions;

  /**
   * Model for the sub-engine execution.
   * Component can override via <Model> in its JSX.
   */
  model?: EngineModel;

  /** Additional engine configuration */
  engineConfig?: Partial<EngineConfig>;

  /**
   * Transform the tool input before processing.
   * Use this to add/modify fields, e.g., mapping `prompt` to a component prop.
   *
   * The transformed input is used for:
   * 1. Creating the user message (from `prompt` and `attachments`)
   * 2. Extracting component props (from `options`)
   *
   * @example
   * ```typescript
   * // Add task to options (component expects task as a prop)
   * transformInput: (input) => ({
   *   ...input,
   *   options: { ...input.options, task: input.prompt },
   * })
   * ```
   */
  transformInput?: (input: Record<string, unknown>) => Record<string, unknown>;

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
 * The default input schema accepts:
 * - `prompt`: The task or question (required)
 * - `attachments`: Optional images, files, or content blocks
 * - `options`: Optional configuration (only when `options` schema is provided)
 *
 * @example
 * ```typescript
 * // Simple prompt-based tool (model can pass text and images)
 * const ResearchTool = createComponentTool({
 *   name: "research",
 *   description: "Research a topic. Can include images for visual research.",
 *   component: ResearchAgent,
 * });
 * // Model calls: { prompt: "Research AI safety" }
 * // Or with images: { prompt: "Analyze this chart", attachments: [{ type: "image", ... }] }
 *
 * // With typed options (passed as props to component)
 * const ConfigurableAgent = ({ maxIterations = 3, depth = "standard" }) => (
 *   <System>Run up to {maxIterations} iterations with {depth} analysis.</System>
 * );
 *
 * const ConfigurableTool = createComponentTool({
 *   name: "configurable_task",
 *   description: "A configurable task with iteration and depth options.",
 *   component: ConfigurableAgent,
 *   options: z.object({
 *     maxIterations: z.number().describe("Maximum iterations to run"),
 *     depth: z.enum(["shallow", "standard", "deep"]).describe("Analysis depth"),
 *   }),
 * });
 * // Model calls: { prompt: "Do the task", options: { maxIterations: 5, depth: "deep" } }
 *
 * // With transformInput to add component props
 * // Component expects: { task: string, k?: number, numVoters?: number }
 * const VotingTool = createComponentTool({
 *   name: "voting_agent",
 *   description: "Run a voting consensus on a task",
 *   component: VotingAgent,
 *   options: z.object({
 *     k: z.number().describe("Lead required for consensus"),
 *     numVoters: z.number().describe("Number of voters"),
 *   }),
 *   transformInput: (input) => ({
 *     ...input,
 *     options: { ...input.options, task: input.prompt },  // Add task to options
 *   }),
 * });
 * // Model calls: { prompt: "What is 2+2?", options: { k: 2, numVoters: 5 } }
 * // After transform: { prompt: "...", options: { k: 2, numVoters: 5, task: "What is 2+2?" } }
 * // Component receives props from options: { task: "What is 2+2?", k: 2, numVoters: 5 }
 *
 * // With custom input schema (for structured tasks)
 * const CodeReviewTool = createComponentTool({
 *   name: "review_code",
 *   description: "Review code for issues",
 *   input: z.object({
 *     code: z.string(),
 *     language: z.string(),
 *     focusAreas: z.array(z.string()).optional(),
 *   }),
 *   component: CodeReviewAgent,
 * });
 * ```
 */
export function createComponentTool<
  TInput extends z.ZodType = typeof componentToolInputSchema,
  TOptions extends ZodLike | undefined = undefined,
>(options: ComponentToolOptions<TInput, TOptions>) {
  // Build input schema: use custom input if provided, otherwise build from options
  const inputSchema = options.input
    ? (options.input as z.ZodType<z.infer<TInput>>)
    : (buildInputSchema(options.options) as unknown as z.ZodType<z.infer<TInput>>);

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

      // Transform input if transformer provided
      const transformedInput = options.transformInput
        ? options.transformInput(input as Record<string, unknown>)
        : input;

      // Execute the component in a fresh context WITHOUT the parent's executionHandle.
      // This is critical: if we inherit the parent's executionHandle, the standalone engine
      // will try to use it for fork operations but won't find it in its own executionGraph.
      // By running in a fresh context, the standalone engine creates its own handle.
      const currentCtx = Context.tryGet();

      // Capture parent's executionId for DevTools execution tree linking (Phase 3)
      // This uses the new first-class context field instead of executionHandle.pid
      const parentExecutionId = currentCtx?.executionId;

      // Convert input to EngineInput (user message with optional attachments)
      // Pass parentExecutionId and tool name for DevTools execution tree
      const engineInput = toEngineInput(transformedInput, parentExecutionId, options.name);

      // Extract options/props from the (possibly transformed) input
      const componentProps = extractOptions(transformedInput);

      // Create component element, passing props if provided
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // const componentElement = componentProps
      //   ? createElement(options.component as any, componentProps)
      //   : options.component;
      const Component = options.component as any;

      const componentElement = <Component {...(componentProps || {})} />;

      log.debug(
        {
          hasContext: !!currentCtx,
          parentExecutionId,
          currentExecutionId: currentCtx?.executionId,
          currentParentExecutionId: currentCtx?.parentExecutionId,
          traceId: currentCtx?.traceId,
          procedurePid: currentCtx?.procedurePid,
        },
        "Component tool context state",
      );

      const freshContext = Context.create({
        // Inherit tracing context for observability
        traceId: currentCtx?.traceId,
        // Inherit user context
        user: currentCtx?.user,
        // Inherit metadata (but not execution-specific fields)
        metadata: currentCtx?.metadata,
        // Set parentExecutionId for DevTools execution tree linking (Phase 3)
        // This is now a first-class field, not stored in metadata
        parentExecutionId,
        // Do NOT inherit: executionHandle, executionId, executionType, procedurePid, procedureGraph, etc.
        // These are execution-specific and must be created fresh by the standalone engine
      });

      const result = await Context.run(freshContext, async () => {
        return engine.execute(engineInput, componentElement);
      });

      // Transform result (default: extract last assistant content)
      return options.transformResult?.(result) ?? extractLastAssistantContent(result);
    },
  });
}

/**
 * Convert tool input to EngineInput.
 * Input becomes a user message with:
 * - Text content from prompt (or JSON-serialized custom input)
 * - Optional attachment content blocks (images, files, etc.)
 *
 * @param input - The tool input
 * @param parentExecutionId - Optional parent execution ID for DevTools linking
 * @param toolName - Optional tool name for DevTools display
 */
function toEngineInput(input: unknown, parentExecutionId?: string, toolName?: string): EngineInput {
  const content: ContentBlock[] = [];

  if (typeof input === "string") {
    // Simple string input
    content.push({ type: "text", text: input });
  } else if (typeof input === "object" && input !== null && "prompt" in input) {
    // Default schema - use prompt as text
    const typedInput = input as ComponentToolInput;
    content.push({ type: "text", text: typedInput.prompt });

    // Add any attachments as additional content blocks
    if (typedInput.attachments && typedInput.attachments.length > 0) {
      for (const attachment of typedInput.attachments) {
        content.push(attachment as ContentBlock);
      }
    }
  } else {
    // Custom schema - serialize as JSON
    content.push({ type: "text", text: JSON.stringify(input, null, 2) });
  }

  const message: Message = {
    role: "user",
    content,
  };

  const entry: COMTimelineEntry = {
    kind: "message",
    message,
  };

  return {
    timeline: [entry],
    // Include parentExecutionId for DevTools execution tree linking
    ...(parentExecutionId ? { parentExecutionId } : {}),
    // Include tool name for DevTools display
    ...(toolName ? { agentName: toolName } : {}),
  };
}

/**
 * Extract options from input if using the default schema.
 * Options are passed as props to the component.
 */
function extractOptions(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === "object" && input !== null && "options" in input) {
    const options = (input as ComponentToolInput).options;
    return options && Object.keys(options).length > 0 ? options : undefined;
  }
  return undefined;
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
