/**
 * ============================================================================
 * AI SDK Compiler Adapter
 * ============================================================================
 *
 * This adapter provides progressive adoption for AI SDK users who want to use
 * our JSX compilation without fully committing to our Engine.
 *
 * Direction of adaptation: Engine → ai-sdk
 * (For ai-sdk → Engine direction, use adapter.ts directly)
 *
 * ============================================================================
 * PROGRESSIVE ADOPTION LEVELS
 * ============================================================================
 *
 * Level 1: compile() only
 * Returns library-native input. User calls generateText themselves.
 *
 * @example
 * ```typescript
 * import { compile } from '@aidk/ai-sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const compiled = await compile(<MyAgent />);
 *
 * const result = await generateText({
 *   model: compiled.model ?? openai('gpt-4o'),
 *   messages: compiled.messages,
 *   tools: compiled.tools,
 *   system: compiled.system,
 * });
 * ```
 *
 * Level 2: run() with executor
 * User controls model execution, we handle the tick loop.
 *
 * @example
 * ```typescript
 * import { createCompiler } from '@aidk/ai-sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const compiler = createCompiler();
 *
 * const result = await compiler.run(<MyAgent />, async (input) => {
 *   return await generateText({
 *     model: openai('gpt-4o'),
 *     ...input,
 *   });
 * });
 * ```
 *
 * Level 3: run() / stream() - managed execution
 * We handle everything. Model comes from <Model> component or config.
 *
 * @example
 * ```typescript
 * import { createCompiler } from '@aidk/ai-sdk';
 * import { openai } from '@ai-sdk/openai';
 *
 * const compiler = createCompiler({ model: openai('gpt-4o') });
 *
 * const result = await compiler.run(<MyAgent />);
 *
 * // Or streaming:
 * for await (const chunk of compiler.stream(<MyAgent />)) {
 *   process.stdout.write(chunk.textDelta ?? '');
 * }
 * ```
 *
 * Level 4: generateText() / streamText() - mirror library API
 * Same API as ai-sdk, but with JSX as the first argument.
 *
 * @example
 * ```typescript
 * import { generateText, streamText } from '@aidk/ai-sdk';
 * import { openai } from '@ai-sdk/openai';
 *
 * // createCompiler run internally
 *
 * // Exact same return type as ai-sdk's generateText
 * const result = await generateText(<MyAgent />, {
 *   temperature: 0.8,
 * });
 *
 * // Exact same return type as ai-sdk's streamText
 * const { fullStream, text } = streamText(<MyAgent />);
 * for await (const chunk of fullStream) {
 *   // Native ai-sdk chunks
 * }
 * ```
 *
 * ============================================================================
 * COMPONENT PORTABILITY
 * ============================================================================
 *
 * All adapter packages export the same component names:
 * - Model: Configure the model declaratively
 * - Tool: Define tools in JSX
 * - Message, System, User, Assistant: Message components
 *
 * Switch adapters without changing agent code.
 *
 * ============================================================================
 */

import {
  CompileJSXService,
  type CompileJSXServiceConfig,
  type CompileSessionConfig,
  type CompileTickResult,
  type TickResultInput,
  type COMProcess,
  type EngineInput,
  type ExecutionHandle,
  type SignalType,
  type JSX,
  type ComponentDefinition,
  type EngineConfig,
  type ForkInheritanceOptions,
  type EngineResponse,
} from "aidk";
import type { LanguageModel, ModelMessage as AiSdkMessage, ToolSet, TextStreamPart } from "ai";
import { generateText as aiSdkGenerateText, streamText as aiSdkStreamText } from "ai";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  createAiSdkModel,
  aiSdkMessagesToEngineInput,
  toAiSdkCompiledInput,
  fromAiSdkMessages,
} from "./adapter";
import { AbortError, ValidationError } from "aidk-shared";

// ============================================================================
// Types
// ============================================================================

/**
 * Library-native compiled output.
 * This is what compile() returns - ready to pass to generateText/streamText.
 */
export interface CompiledInput {
  /** Messages in ai-sdk CoreMessage format */
  messages: AiSdkMessage[];

  /** Tools in ai-sdk ToolSet format (definitions only, no execute) */
  tools?: ToolSet;

  /** System prompt (extracted from system messages) */
  system?: string;

  /** Model extracted from <Model> component (if present) */
  model?: LanguageModel;

  /** Current tick number (for multi-tick execution) */
  tick: number;
}

/**
 * Executor function signature.
 * User provides this to control model execution.
 */
export type Executor = (
  input: CompiledInput,
) => Promise<Awaited<ReturnType<typeof aiSdkGenerateText>>>;

/**
 * Stream executor function signature.
 */
export type StreamExecutor = (input: CompiledInput) => ReturnType<typeof aiSdkStreamText>;

/**
 * Configuration for the compiler.
 */
export interface CompilerConfig {
  /** Default model (used when no <Model> component and no executor provided) */
  model?: LanguageModel;

  /** Default temperature */
  temperature?: number;

  /** Default max tokens */
  maxTokens?: number;

  /** Maximum ticks per execution (default: 10) */
  maxTicks?: number;

  /** Additional service config */
  serviceConfig?: Partial<Omit<CompileJSXServiceConfig, "modelGetter" | "processMethods">>;
}

/**
 * Options for generateText/streamText methods.
 * Matches ai-sdk's options interface.
 */
export type GenerateOptions = Partial<
  Omit<Parameters<typeof aiSdkGenerateText>[0], "messages" | "prompt">
>;

/**
 * Events emitted during streaming.
 */
export type CompilerStreamEvent =
  | { type: "tick_start"; tick: number }
  | { type: "compiled"; tick: number; input: CompiledInput }
  | { type: "chunk"; tick: number; chunk: TextStreamPart<ToolSet> }
  | { type: "tick_end"; tick: number }
  | { type: "complete"; result: any };

// ============================================================================
// Conversion Utilities
// ============================================================================

// Use adapter functions for conversions - see adapter.ts for implementations:
// - aiSdkMessagesToEngineInput: AI SDK messages → EngineInput
// - toAiSdkCompiledInput: CompileTickResult → CompiledInput

/**
 * Convert compiled output to library-native CompiledInput.
 * Wraps the adapter function with the CompiledInput interface.
 */
function toCompiledInput(
  compiled: CompileTickResult,
  tick: number,
  extractedModel?: LanguageModel,
): CompiledInput {
  const result = toAiSdkCompiledInput(compiled.formatted, compiled.tools, tick, extractedModel);
  return result as CompiledInput;
}

/**
 * Convert ai-sdk result to TickResultInput for state ingestion.
 * Uses adapter's fromAiSdkMessages for content conversion.
 */
function toTickResultInput(result: Awaited<ReturnType<typeof aiSdkGenerateText>>): TickResultInput {
  // Use adapter's conversion for response messages
  const messages = fromAiSdkMessages(result.response?.messages);

  // Find the assistant message
  const assistantMessage = messages.find((m) => m.role === "assistant");

  // Build timeline entries from converted messages
  const newTimelineEntries = assistantMessage
    ? [
        {
          kind: "message" as const,
          message: assistantMessage,
        },
      ]
    : undefined;

  const response: EngineResponse = {
    shouldStop: !result.toolCalls || result.toolCalls.length === 0,
    newTimelineEntries: newTimelineEntries as any,
    toolCalls: result.toolCalls?.map((tc: any) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      input: (tc as any).args || {},
    })),
  };

  return { response };
}

// ============================================================================
// Process Handle (for Fork/Spawn support)
// ============================================================================

class ProcessHandle {
  readonly pid: string;
  readonly rootPid: string;
  readonly type: "root" | "fork" | "spawn";
  readonly parentPid?: string;

  private _status: "pending" | "running" | "completed" | "failed" | "cancelled" = "pending";
  private _result?: any;
  private _events = new EventEmitter();
  private _completionPromise: Promise<any>;
  private _resolve!: (value: any) => void;
  private _reject!: (error: Error) => void;
  private _abortController = new AbortController();

  constructor(type: "root" | "fork" | "spawn", parentPid?: string, rootPid?: string) {
    this.pid = `aisdk-${type}-${randomUUID().slice(0, 8)}`;
    this.type = type;
    this.parentPid = parentPid;
    this.rootPid = rootPid || this.pid;

    this._completionPromise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get status() {
    return this._status;
  }
  get result() {
    return this._result;
  }
  get tick() {
    return 0;
  }

  start() {
    this._status = "running";
    this._events.emit("start");
  }

  complete(result: any) {
    this._status = "completed";
    this._result = result;
    this._events.emit("complete", result);
    this._resolve(result);
  }

  fail(error: Error) {
    this._status = "failed";
    this._events.emit("error", error);
    this._reject(error);
  }

  cancel(): void {
    if (this._status === "running" || this._status === "pending") {
      this._status = "cancelled";
      this._abortController.abort();
      this._events.emit("cancelled");
      this._reject(new AbortError("Execution cancelled"));
    }
  }

  getCancelSignal(): AbortSignal {
    return this._abortController.signal;
  }

  waitForCompletion(): Promise<any> {
    return this._completionPromise;
  }

  on(event: string, handler: (...args: any[]) => void): this {
    this._events.on(event, handler);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void): this {
    this._events.off(event, handler);
    return this;
  }
}

// ============================================================================
// Standalone compile() function (Level 1)
// ============================================================================

/**
 * Compile JSX to library-native input.
 *
 * This is the simplest entry point. You get back messages, tools, and system
 * in ai-sdk format, ready to pass to generateText/streamText.
 *
 * @example
 * ```typescript
 * import { compile } from '@aidk/ai-sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const { messages, tools, system, model } = await compile(<MyAgent />);
 *
 * const result = await generateText({
 *   model: model ?? openai('gpt-4o'),
 *   messages,
 *   tools,
 *   system,
 * });
 * ```
 */
export async function compile(
  jsx: JSX.Element,
  initialMessages?: AiSdkMessage[],
): Promise<CompiledInput> {
  const service = new CompileJSXService();
  const engineInput = aiSdkMessagesToEngineInput(initialMessages);

  const { formatted } = await service.compile(jsx, engineInput);

  // Extract model from COM if <Model> component was used
  // TODO: Need to expose model extraction from COM
  const extractedModel = undefined; // com.getModel()?.raw as LanguageModel | undefined;

  const compiled: CompileTickResult = {
    compiled: {} as any,
    formatted,
    tools: service.getTools(),
    shouldStop: false,
  };

  return toCompiledInput(compiled, 1, extractedModel);
}

// ============================================================================
// Compiler Class (Levels 2-4)
// ============================================================================

/**
 * AI SDK Compiler.
 *
 * Provides progressive adoption from simple compilation to full execution management.
 *
 * @example Level 2: User-controlled execution
 * ```typescript
 * const compiler = createCompiler();
 *
 * const result = await compiler.run(<MyAgent />, async (input) => {
 *   return await generateText({ model: openai('gpt-4o'), ...input });
 * });
 * ```
 *
 * @example Level 3: Managed execution
 * ```typescript
 * const compiler = createCompiler({ model: openai('gpt-4o') });
 * const result = await compiler.run(<MyAgent />);
 * ```
 *
 * @example Level 4: Library-mirroring API
 * ```typescript
 * const compiler = createCompiler({ model: openai('gpt-4o') });
 * const result = await compiler.generateText(<MyAgent />, { temperature: 0.8 });
 * ```
 */
export class AiSdkCompiler {
  private service: CompileJSXService;
  private defaultModel?: LanguageModel;
  private defaultOptions: GenerateOptions;
  private maxTicks: number;
  private executions = new Map<string, ProcessHandle>();
  private currentExecutor?: Executor;

  constructor(config: CompilerConfig = {}) {
    this.defaultModel = config.model;
    this.defaultOptions = {
      temperature: config.temperature,
      maxOutputTokens: config.maxTokens,
    };
    this.maxTicks = config.maxTicks ?? 10;

    // Create process methods for Fork/Spawn
    const processMethods = this.createProcessMethods();

    // Create service with model getter
    const modelGetter = this.defaultModel
      ? () => createAiSdkModel({ model: this.defaultModel! })
      : undefined;

    this.service = new CompileJSXService({
      ...config.serviceConfig,
      modelGetter,
      processMethods,
    });
  }

  private createProcessMethods(): COMProcess {
    return {
      fork: (
        input: EngineInput,
        agent?: ComponentDefinition,
        options?: {
          parentPid?: string;
          inherit?: ForkInheritanceOptions;
          engineConfig?: Partial<EngineConfig>;
        },
      ): ExecutionHandle => {
        const parentHandle = options?.parentPid
          ? this.executions.get(options.parentPid)
          : undefined;
        const handle = new ProcessHandle("fork", options?.parentPid, parentHandle?.rootPid);
        this.executions.set(handle.pid, handle);

        if (agent && this.currentExecutor) {
          const element =
            typeof agent === "function" ? { type: agent, props: {}, key: null } : agent;
          const messages = this.engineInputToMessages(input);

          this.runInternal(element as JSX.Element, messages, this.currentExecutor)
            .then((result) => handle.complete(result))
            .catch((error) =>
              handle.fail(error instanceof Error ? error : new Error(String(error))),
            );
        }

        return handle as unknown as ExecutionHandle;
      },

      spawn: (
        input: EngineInput,
        agent?: ComponentDefinition,
        _options?: {
          engineConfig?: Partial<EngineConfig>;
        },
      ): ExecutionHandle => {
        const handle = new ProcessHandle("spawn");
        this.executions.set(handle.pid, handle);

        if (agent && this.currentExecutor) {
          const element =
            typeof agent === "function" ? { type: agent, props: {}, key: null } : agent;
          const messages = this.engineInputToMessages(input);

          this.runInternal(element as JSX.Element, messages, this.currentExecutor)
            .then((result) => handle.complete(result))
            .catch((error) =>
              handle.fail(error instanceof Error ? error : new Error(String(error))),
            );
        }

        return handle as unknown as ExecutionHandle;
      },

      signal: (pid: string, signal: SignalType): void => {
        const handle = this.executions.get(pid);
        if (handle && signal === "abort") {
          handle.cancel();
        }
      },

      kill: (pid: string): void => {
        this.executions.get(pid)?.cancel();
      },

      list: (): ExecutionHandle[] => {
        return Array.from(this.executions.values()).filter(
          (h) => h.status === "running",
        ) as unknown as ExecutionHandle[];
      },

      get: (pid: string): ExecutionHandle | undefined => {
        return this.executions.get(pid) as unknown as ExecutionHandle | undefined;
      },
    };
  }

  private engineInputToMessages(input: EngineInput): AiSdkMessage[] {
    return (input.timeline || [])
      .filter((entry: any) => entry.kind === "message")
      .map((entry: any) => {
        const msg = entry.message;
        const content = msg.content.map((c: any) => {
          if (c.type === "text") return { type: "text", text: c.text };
          return { type: "text", text: JSON.stringify(c) };
        });
        return { role: msg.role, content } as AiSdkMessage;
      });
  }

  // ============================================================================
  // Level 2-3: run() - with or without executor
  // ============================================================================

  /**
   * Execute a JSX program.
   *
   * If executor is provided (Level 2), user controls model execution.
   * If not provided (Level 3), we manage execution using configured model.
   *
   * @param jsx Root JSX element
   * @param executorOrMessages Optional executor function OR initial messages
   * @param maybeExecutor Optional executor (if second arg was messages)
   */
  async run(
    jsx: JSX.Element,
    executorOrMessages?: Executor | AiSdkMessage[],
    maybeExecutor?: Executor,
  ): Promise<Awaited<ReturnType<typeof aiSdkGenerateText>>> {
    // Parse overloaded arguments
    let initialMessages: AiSdkMessage[] | undefined;
    let executor: Executor | undefined;

    if (typeof executorOrMessages === "function") {
      executor = executorOrMessages;
    } else if (Array.isArray(executorOrMessages)) {
      initialMessages = executorOrMessages;
      executor = maybeExecutor;
    }

    // If no executor, use managed execution
    if (!executor) {
      executor = this.createManagedExecutor();
    }

    return this.runInternal(jsx, initialMessages, executor);
  }

  private async runInternal(
    jsx: JSX.Element,
    initialMessages: AiSdkMessage[] | undefined,
    executor: Executor,
  ): Promise<Awaited<ReturnType<typeof aiSdkGenerateText>>> {
    // Store executor for fork/spawn
    this.currentExecutor = executor;

    const engineInput = aiSdkMessagesToEngineInput(initialMessages);
    const config: CompileSessionConfig = {
      input: engineInput,
      rootElement: jsx,
      maxTicks: this.maxTicks,
    };

    let tick = 1;
    let lastResult: Awaited<ReturnType<typeof aiSdkGenerateText>> | undefined;

    await this.service._run(config, async (compiled) => {
      const input = toCompiledInput(compiled, tick);
      const result = await executor(input);
      lastResult = result;
      tick++;
      return toTickResultInput(result);
    });

    return lastResult!;
  }

  private createManagedExecutor(): Executor {
    if (!this.defaultModel) {
      throw new ValidationError(
        "model",
        "No model configured. Either pass an executor function, " +
          "configure a model in createCompiler(), or use a <Model> component.",
      );
    }

    return async (input) => {
      return await aiSdkGenerateText({
        model: input.model ?? this.defaultModel!,
        messages: input.messages,
        system: input.system,
        ...this.defaultOptions,
        tools: Object.assign({}, input.tools, this.defaultOptions?.tools || {}),
      });
    };
  }

  // ============================================================================
  // Level 2-3: stream() - with or without executor
  // ============================================================================

  /**
   * Execute a JSX program with streaming.
   *
   * @param jsx Root JSX element
   * @param executorOrMessages Optional executor function OR initial messages
   * @param maybeExecutor Optional executor (if second arg was messages)
   */
  async *stream(
    jsx: JSX.Element,
    executorOrMessages?: StreamExecutor | AiSdkMessage[],
    maybeExecutor?: StreamExecutor,
  ): AsyncGenerator<CompilerStreamEvent> {
    // Parse overloaded arguments
    let initialMessages: AiSdkMessage[] | undefined;
    let executor: StreamExecutor | undefined;

    if (typeof executorOrMessages === "function") {
      executor = executorOrMessages;
    } else if (Array.isArray(executorOrMessages)) {
      initialMessages = executorOrMessages;
      executor = maybeExecutor;
    }

    // If no executor, use managed execution
    if (!executor) {
      executor = this.createManagedStreamExecutor();
    }

    yield* this.streamInternal(jsx, initialMessages, executor);
  }

  private async *streamInternal(
    jsx: JSX.Element,
    initialMessages: AiSdkMessage[] | undefined,
    executor: StreamExecutor,
  ): AsyncGenerator<CompilerStreamEvent> {
    const engineInput = aiSdkMessagesToEngineInput(initialMessages);
    const config: CompileSessionConfig = {
      input: engineInput,
      rootElement: jsx,
      maxTicks: this.maxTicks,
    };

    for await (const event of this.service._runStream(config, {
      onTick: async function* (compiled, tick) {
        const input = toCompiledInput(compiled, tick);

        yield { type: "compiled", tick, input } as any;

        const streamResult = executor(input);

        for await (const chunk of streamResult.fullStream) {
          yield chunk;
        }

        // Mark end with the accumulated result
        const result = await streamResult;
        yield { __result: result } as any;
      },

      finalizeChunks: (chunks) => {
        // Find the result marker
        const resultMarker = chunks.find((c: any) => c?.__result);
        if (resultMarker) {
          return toTickResultInput((resultMarker as any).__result);
        }

        // Fallback: aggregate chunks
        let text = "";
        const toolCalls: any[] = [];

        for (const chunk of chunks as any[]) {
          if (chunk?.type === "text-delta") {
            text += chunk.textDelta ?? "";
          }
          if (chunk?.type === "tool-call") {
            toolCalls.push({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: chunk.args,
            });
          }
        }

        const response: EngineResponse = {
          shouldStop: toolCalls.length === 0,
          newTimelineEntries: text
            ? ([
                {
                  kind: "message",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text }],
                  },
                },
              ] as any)
            : undefined,
          toolCalls:
            toolCalls.length > 0
              ? toolCalls.map((tc) => ({
                  id: tc.toolCallId,
                  name: tc.toolName,
                  input: tc.args,
                }))
              : undefined,
        };

        return { response };
      },
    })) {
      // Transform internal events to our public event type
      if (event.type === "tick_start") {
        yield { type: "tick_start", tick: event.tick };
      } else if (event.type === "chunk") {
        yield { type: "chunk", tick: event.tick, chunk: event.chunk as any };
      } else if (event.type === "tick_end") {
        yield { type: "tick_end", tick: event.tick };
      } else if (event.type === "complete") {
        yield { type: "complete", result: event.output };
      }
    }
  }

  private createManagedStreamExecutor(): StreamExecutor {
    if (!this.defaultModel) {
      throw new ValidationError(
        "model",
        "No model configured. Either pass an executor function, " +
          "configure a model in createCompiler(), or use a <Model> component.",
      );
    }

    return (input) => {
      return aiSdkStreamText({
        model: input.model ?? this.defaultModel!,
        messages: input.messages,
        system: input.system,
        ...this.defaultOptions,
        tools: Object.assign({}, input.tools, this.defaultOptions?.tools || {}),
      });
    };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  async destroy(): Promise<void> {
    for (const handle of this.executions.values()) {
      if (handle.status === "running") {
        handle.cancel();
      }
    }
    this.executions.clear();
  }
}

// ============================================================================
// Level 4: generateText() / streamText() - mirror library API
// ============================================================================

/**
 * Generate text using JSX.
 *
 * Mirrors ai-sdk's generateText API exactly.
 * Returns the same type for seamless integration.
 *
 * @param jsx Root JSX element
 * @param options Additional options (merged with defaults and JSX config)
 */
export async function generateText(
  jsx: JSX.Element,
  options?: GenerateOptions,
): Promise<Awaited<ReturnType<typeof aiSdkGenerateText>>> {
  const compiled = await compile(jsx);

  const model = compiled.model ?? options?.model;
  if (!model) {
    throw new ValidationError(
      "model",
      "No model available. Configure via createCompiler({ model }), " +
        "<Model> component, or options.model parameter.",
    );
  }

  return await aiSdkGenerateText({
    model,
    messages: compiled.messages,
    system: compiled.system,
    ...options,
    tools: Object.assign({}, compiled.tools, options?.tools || {}),
  });
}

/**
 * Stream text using JSX.
 *
 * Mirrors ai-sdk's streamText API exactly.
 * Returns the same type for seamless integration.
 *
 * @param jsx Root JSX element
 * @param options Additional options (merged with defaults and JSX config)
 */
export function streamText(
  jsx: JSX.Element,
  options?: GenerateOptions,
): ReturnType<typeof aiSdkStreamText> {
  // We need to compile synchronously to return the stream immediately
  // This is a limitation - compile() is async but streamText expects sync
  // Solution: Return a proxy that starts compilation

  // Create a deferred stream that compiles first
  const streamPromise = (async () => {
    const compiled = await compile(jsx);

    const model = compiled.model ?? options?.model;
    if (!model) {
      throw new ValidationError(
        "model",
        "No model available. Configure via createCompiler({ model }), " +
          "<Model> component, or options.model parameter.",
      );
    }

    return aiSdkStreamText({
      model,
      messages: compiled.messages,
      system: compiled.system,
      ...options,
      tools: Object.assign({}, compiled.tools, options?.tools || {}),
    });
  })();

  // Return a proxy object that looks like StreamTextResult
  // but waits for compilation before accessing properties
  return {
    get fullStream() {
      return (async function* () {
        const stream = await streamPromise;
        for await (const chunk of stream.fullStream) {
          yield chunk;
        }
      })();
    },
    get text() {
      return streamPromise.then((s) => s.text);
    },
    get toolCalls() {
      return streamPromise.then((s) => s.toolCalls);
    },
    get toolResults() {
      return streamPromise.then((s) => s.toolResults);
    },
    get usage() {
      return streamPromise.then((s) => s.usage);
    },
    get finishReason() {
      return streamPromise.then((s) => s.finishReason);
    },
    get response() {
      return streamPromise.then((s) => s.response);
    },
    get steps() {
      return streamPromise.then((s) => s.steps);
    },
    // ... other StreamTextResult properties
  } as unknown as ReturnType<typeof aiSdkStreamText>;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an AI SDK compiler.
 *
 * @example Without model (requires executor or <Model> component)
 * ```typescript
 * const compiler = createCompiler();
 *
 * // Use with executor
 * const result = await compiler.run(<MyAgent />, async (input) => {
 *   return await generateText({ model: openai('gpt-4o'), ...input });
 * });
 * ```
 *
 * @example With model (managed execution)
 * ```typescript
 * const compiler = createCompiler({ model: openai('gpt-4o') });
 *
 * const result = await compiler.run(<MyAgent />);
 * ```
 */
export function createCompiler(config?: CompilerConfig): AiSdkCompiler {
  return new AiSdkCompiler(config);
}

// Also export as createAiSdkCompiler for backward compatibility
export { createCompiler as createAiSdkCompiler };
