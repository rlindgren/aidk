import type { JSX } from "../jsx/jsx-runtime";
import { COM, type COMTickStatus, type COMTickDecision } from "../com/object-model";
import type { COMInput, COMOutput, COMTimelineEntry, EngineInput } from "../com/types";
import { FiberCompiler, type CompileStabilizationOptions, StructureRenderer } from "../compiler";
import { MarkdownRenderer, XMLRenderer, type ContentRenderer } from "../renderers";
import type { Renderer } from "../renderers/base";
import type { TickState, ComponentDefinition, RecoveryAction } from "../component/component";
import type { CompiledStructure } from "../compiler/types";
import type { ToolClass, ExecutableTool } from "../tool/tool";
import type { ModelInstance, ModelInput } from "../model/model";
import {
  ComponentHookRegistry,
  type ComponentHookName,
  type ComponentHookMiddleware,
} from "../component/component-hooks";
import {
  EngineLifecycleHookRegistry,
  type EngineLifecycleHookName,
  type EngineLifecycleHook,
  type EngineLifecycleHookArgs,
} from "../engine/engine-lifecycle-hooks";
import {
  MCPClient,
  MCPService,
  type MCPServerConfig,
  normalizeMCPConfig,
  type MCPConfig,
} from "../mcp";
import { ChannelService, type ChannelServiceConfig } from "../channels/service";
import { toolRegistry } from "./registry";
import { isAsyncIterable, Logger, Context, type KernelContext } from "aidk-kernel";
import { ensureElement } from "../jsx/jsx-runtime";
import type { ExecutionHandle, ExecutionMessage } from "../engine/execution-types";
import { getWaitHandles } from "../jsx/components/fork-spawn-helpers";
import type { EngineResponse } from "../engine/engine-response";
import type { AgentToolResult } from "aidk-shared";
import { AbortError, NotFoundError, StateError, ValidationError } from "aidk-shared";
import { createEngineProcedure } from "../procedure";

const log = Logger.for("CompileJSXService");

export interface CompileJSXServiceConfig {
  /**
   * Tools to register before compilation.
   * Tools are re-registered after each COM.clear() call.
   */
  tools?: (ToolClass | ExecutableTool | string)[];

  /**
   * MCP servers to initialize and discover tools from.
   */
  mcpServers?: Record<string, MCPServerConfig | MCPConfig>;

  /**
   * Channel service configuration (optional).
   */
  channels?: ChannelServiceConfig | ChannelService;

  /**
   * Renderers to use for formatting.
   */
  renderers?: {
    [key: string]: Renderer;
  };

  /**
   * Default renderer to use (defaults to markdown).
   * Can be overridden by model capabilities if modelGetter is provided.
   */
  defaultRenderer?: ContentRenderer;

  /**
   * Function to get model instance for renderer resolution.
   * If provided, will resolve preferred renderer from model capabilities.
   */
  modelGetter?: (com: COM) => ModelInstance | undefined;

  /**
   * Process methods for COM (fork/spawn support).
   * Required for components that use fork/spawn.
   */
  processMethods?: COM["process"];

  /**
   * Existing hook registries to use (instead of creating new ones).
   * If provided, hooks will be registered on these registries.
   * If not provided, new registries will be created.
   *
   * Note: Only component and lifecycle hooks are service concerns.
   * Model, tool, and engine hooks are Engine concerns and should be
   * registered directly on Engine.
   */
  hookRegistries?: {
    components?: ComponentHookRegistry;
    lifecycle?: EngineLifecycleHookRegistry;
  };

  /**
   * Component hooks to register.
   * Ignored if hookRegistries.components is provided.
   */
  componentHooks?: {
    [K in ComponentHookName]?: ComponentHookMiddleware<K>[];
  };

  /**
   * Lifecycle hooks to call during compilation.
   * These are called by the service for per-tick events (onTickStart, onAfterCompile, onTickEnd).
   * Ignored if hookRegistries.lifecycle is provided.
   *
   * Note: Execution-level hooks (onExecutionStart, onExecutionEnd, onExecutionError)
   * are Engine's responsibility and should be registered on Engine.
   */
  lifecycleHooks?: {
    [K in EngineLifecycleHookName]?: (
      | EngineLifecycleHook<K>
      | ((...args: EngineLifecycleHookArgs<K>) => Promise<void> | void)
    )[];
  };

  /**
   * Compilation stabilization options.
   */
  compileOptions?: CompileStabilizationOptions;

  /**
   * Function to check if compilation should be aborted.
   * Called before and after compilation (not during).
   * If returns true, compilation will throw an AbortError.
   *
   * @example
   * ```typescript
   * const service = new CompileJSXService({
   *   abortChecker: () => shouldAbort, // from Engine's abort signal
   * });
   * ```
   */
  abortChecker?: () => boolean;
}

export interface CompileJSXResult {
  /**
   * The compiled structure.
   */
  compiled: CompiledStructure;

  /**
   * The COM instance used for compilation.
   */
  com: COM;

  /**
   * The StructureRenderer instance used for formatting.
   */
  structureRenderer: StructureRenderer;

  /**
   * The formatted output (timeline, sections, etc.).
   */
  formatted: COMInput;

  /**
   * The final COM input state.
   */
  input: COMInput;

  /**
   * Compilation metadata (iterations, reasons, etc.).
   */
  metadata: {
    iterations: number;
    forcedStable: boolean;
    recompileReasons?: string[];
  };

  /**
   * Tick control decision from components (requestStop/requestContinue).
   * Engine should use this to determine if execution should continue.
   */
  tickControl: COMTickDecision;

  /**
   * Stop reason from TickState.stop() callback (if any).
   * Engine should check this to break the loop.
   */
  stopReason?: string | { reason: string; description?: string };
}

// ============================================================================
// Session-based Compilation API
// ============================================================================

/**
 * Configuration for creating a compilation session.
 */
export interface CompileSessionConfig {
  /**
   * Initial input state.
   */
  input: EngineInput;

  /**
   * Root JSX element to compile.
   */
  rootElement: JSX.Element;

  /**
   * Optional execution handle (for lifecycle hooks).
   */
  handle?: ExecutionHandle;

  /**
   * Maximum number of ticks (default: 10).
   */
  maxTicks?: number;
}

/**
 * Result of a tick compilation (pre-model execution).
 */
export interface CompileTickResult {
  /**
   * The compiled structure.
   */
  compiled: CompiledStructure;

  /**
   * Formatted input ready for the model.
   */
  formatted: COMInput;

  /**
   * Resolved model instance (if modelGetter is configured).
   */
  model?: ModelInstance;

  /**
   * Transformed model input (if model has fromEngineState).
   */
  modelInput?: ModelInput;

  /**
   * Available tools for this tick.
   */
  tools: (ToolClass | ExecutableTool)[];

  /**
   * Whether compilation resulted in a stop request (from TickState.stop()).
   * If true, Engine should skip model execution and call session.complete().
   */
  shouldStop: boolean;

  /**
   * Stop reason if shouldStop is true.
   */
  stopReason?: string;
}

/**
 * Input to ingestTickResult() - results from model and tool execution.
 */
export interface TickResultInput {
  /**
   * Complete model response.
   */
  response: EngineResponse;

  /**
   * Tool execution results (if any tools were called).
   */
  toolResults?: AgentToolResult[];
}

/**
 * Output from ingestTickResult() - session state after ingestion.
 */
export interface TickResultOutput {
  /**
   * Whether execution should continue to the next tick.
   * Based on tick control resolution (requestStop/requestContinue).
   */
  shouldContinue: boolean;

  /**
   * Stop reason if shouldContinue is false.
   */
  stopReason?: string;

  /**
   * The current state (model output + tool results) for this tick.
   * Engine can use this to yield events.
   */
  current: COMOutput;
}

// ============================================================================
// Streaming API Types
// ============================================================================

/**
 * Events yielded by runStream.
 * Generic TChunk allows adapters to define their own chunk types.
 */
export type SessionStreamEvent<TChunk = unknown> =
  | { type: "tick_start"; tick: number }
  | { type: "compiled"; tick: number; compiled: CompileTickResult }
  | { type: "chunk"; tick: number; chunk: TChunk }
  | { type: "tick_end"; tick: number; result: TickResultOutput }
  | { type: "complete"; output: COMInput };

/**
 * Simple tick executor function.
 * Can return a promise (non-streaming) or async iterable (streaming).
 *
 * For streaming, must return an async iterable that yields chunks.
 * The caller is responsible for accumulating chunks into TickResultInput.
 *
 * @example Non-streaming
 * ```typescript
 * const executeTick = async (compiled) => {
 *   const response = await model.generate(compiled.formatted);
 *   return { response };
 * };
 * ```
 *
 * @example Streaming
 * ```typescript
 * const executeTick = async function* (compiled) {
 *   for await (const chunk of model.stream(compiled.formatted)) {
 *     yield chunk;
 *   }
 * };
 * ```
 */
export type TickExecutor<TChunk = unknown> = (
  compiled: CompileTickResult,
  tick: number,
) => Promise<TickResultInput> | AsyncIterable<TChunk>;

/**
 * Callbacks for streaming execution.
 * Provides more control than the simple function form.
 */
export interface RunStreamCallbacks<TChunk = unknown> {
  /**
   * Execute a tick. Can be sync (returns TickResultInput) or streaming (returns AsyncIterable).
   */
  onTick: TickExecutor<TChunk>;

  /**
   * Convert accumulated chunks into TickResultInput.
   * Required when onTick returns an AsyncIterable.
   */
  finalizeChunks?: (chunks: TChunk[], tick: number) => Promise<TickResultInput> | TickResultInput;

  /**
   * Optional: Called when a tick starts (before compilation).
   */
  onTickStart?: (tick: number) => void | Promise<void>;

  /**
   * Optional: Called when a tick ends (after ingestion).
   */
  onTickEnd?: (tick: number, result: TickResultOutput) => void | Promise<void>;
}

/**
 * A long-lived compilation session that maintains state across ticks.
 *
 * The session handles:
 * - Pre-model compilation (compileTick)
 * - Post-model state ingestion (ingestTickResult)
 * - Component lifecycle hooks (notifyTickEnd, notifyComplete)
 * - Tick control resolution (shouldContinue)
 *
 * Engine retains responsibility for:
 * - Model execution (including streaming)
 * - Tool execution
 * - Event yielding
 * - Engine-level lifecycle hooks
 *
 * @example
 * ```typescript
 * const session = await service.createSession({
 *   input: engineInput,
 *   rootElement: <MyAgent />,
 * });
 *
 * while (session.shouldContinue() && session.tick <= maxTicks) {
 *   const { formatted, model, tools } = await session.compileTick();
 *
 *   // Engine executes model and tools
 *   const response = await model.generate(formatted);
 *   const toolResults = await executeTools(response.toolCalls, tools);
 *
 *   // Session ingests results
 *   const { shouldContinue } = await session.ingestTickResult({ response, toolResults });
 *
 *   session.advanceTick();
 * }
 *
 * const finalState = await session.complete();
 * ```
 */
export class CompileSession {
  private _tick = 1;
  private _previous?: COMInput;
  private _current?: COMOutput;
  private _shouldContinue = true;
  private _stopReason?: string;
  private _tickState?: TickState;
  private _lastCompiledInput?: COMInput; // Captured during compileTick for previous
  private _isComplete = false;

  /**
   * Captured kernel context from session creation time.
   * Used to ensure lifecycle hooks run in the correct execution context
   * (with proper executionHandle and procedureGraph).
   */
  private readonly kernelContext?: KernelContext;

  constructor(
    private readonly service: CompileJSXService,
    private readonly _com: COM,
    private readonly compiler: FiberCompiler,
    private readonly structureRenderer: StructureRenderer,
    private readonly rootElement: JSX.Element,
    private readonly handle?: ExecutionHandle,
    private readonly maxTicks: number = 10,
    kernelContext?: KernelContext,
  ) {
    this.kernelContext = kernelContext;
  }

  // === Context Helper ===

  /**
   * Run a function ensuring executionHandle is in context.
   *
   * This preserves the current context's procedurePid (for correct parent lookup)
   * while ensuring executionHandle is available (for executionId fallback).
   *
   * The logic:
   * 1. If current context has executionHandle, use it as-is
   * 2. If current context lacks executionHandle but we have one captured, add it
   * 3. If no current context, use the captured context
   * 4. Otherwise, run directly
   */
  private async runInContext<T>(fn: () => Promise<T>): Promise<T> {
    const currentContext = Context.tryGet();

    // Case 1: Current context already has executionHandle - use it
    if (currentContext?.executionHandle) {
      return fn();
    }

    // Case 2: Current context exists but lacks executionHandle - add it from captured
    if (currentContext && this.kernelContext?.executionHandle) {
      const contextWithHandle = {
        ...currentContext,
        executionHandle: this.kernelContext.executionHandle,
        // Also ensure procedureGraph is available for parent lookup
        procedureGraph: currentContext.procedureGraph || this.kernelContext.procedureGraph,
      };
      return Context.run(contextWithHandle, fn);
    }

    // Case 3: No current context - use captured context entirely
    if (this.kernelContext) {
      return Context.run(this.kernelContext, fn);
    }

    // Case 4: Fallback - run directly
    return fn();
  }

  // === State Accessors ===

  /**
   * Current tick number (1-based).
   */
  get tick(): number {
    return this._tick;
  }

  /**
   * Previous state (what was sent to the model in the last tick).
   */
  get previous(): COMInput | undefined {
    return this._previous;
  }

  /**
   * Current state (model output + tool results from the last tick).
   */
  get current(): COMOutput | undefined {
    return this._current;
  }

  /**
   * Current tick state (for lifecycle hooks and Engine access).
   */
  get tickState(): TickState | undefined {
    return this._tickState;
  }

  /**
   * Stop reason if execution has stopped.
   */
  get stopReason(): string | undefined {
    return this._stopReason;
  }

  /**
   * The COM instance (for Engine access if needed).
   */
  get com(): COM {
    return this._com;
  }

  // === Control Queries ===

  /**
   * Whether execution should continue to the next tick.
   */
  shouldContinue(): boolean {
    return this._shouldContinue && !this._isComplete;
  }

  /**
   * Whether execution is complete.
   */
  isComplete(): boolean {
    return this._isComplete || !this._shouldContinue;
  }

  // === Lifecycle Methods ===

  /**
   * Compile the current tick (pre-model execution).
   *
   * This method:
   * - Clears COM ephemeral state
   * - Re-registers tools
   * - Prepares tick state
   * - Calls onTickStart lifecycle hooks
   * - Compiles until stable
   * - Waits for forks/spawns
   * - Applies structures
   * - Returns formatted input for the model
   *
   * @returns Compilation result with formatted input, model, and tools
   */
  async compileTick(): Promise<CompileTickResult> {
    // Check if already complete
    if (this._isComplete) {
      throw new StateError(
        "complete",
        "running",
        "Session is complete. Cannot compile more ticks.",
      );
    }

    // Clear COM and re-register tools
    this.service.clearAndReRegisterTools(this._com);

    // Prepare tick state (snapshots queuedMessages from previous tick)
    this._tickState = this.service.prepareTickState(
      this._com,
      this._tick,
      this._previous,
      this._current,
    );

    // Clear queued messages AFTER prepareTickState snapshots them
    // This ensures messages from Tick N-1 are available in Tick N's TickState,
    // while messages arriving during Tick N will be available in Tick N+1
    this._com.clearQueuedMessages();

    // Set up stop callback on tickState
    let compilationStopReason: string | undefined;
    this._tickState.stop = (reason: string) => {
      compilationStopReason = reason;
      (this._tickState as any).stopReason = reason;
    };

    // Set channels from service
    this._tickState.channels = this.service.getChannelService();

    // Call onTickStart lifecycle hook
    await this.service.callLifecycleHooks("onTickStart", [
      this._tick,
      this._tickState,
      this.handle,
    ]);

    // Notify compiler that tick is starting.
    // Run in captured context to ensure lifecycle hooks inherit correct executionId.
    await this.runInContext(() => this.compiler.notifyTickStart(this._tickState!));

    // Check abort before compilation
    this.service.checkAbort();

    // Compile until stable.
    // Run in captured context to ensure component render procedures inherit correct executionId.
    // This is important for forks where the fork's executionHandle must be available.
    const compileOptions: CompileStabilizationOptions = {
      maxIterations: 50,
      trackMutations: process.env["NODE_ENV"] === "development",
      ...this.service["config"].compileOptions,
    };

    let { compiled, iterations, forcedStable, recompileReasons } = await this.runInContext(() =>
      this.compiler.compileUntilStable(this.rootElement, this._tickState!, compileOptions),
    );

    if (iterations > 1) {
      log.debug({ iterations, reasons: recompileReasons }, "Compilation stabilized");
    }
    if (forcedStable) {
      log.warn("Compilation forced stable at max iterations");
    }

    // Call onAfterCompile hook
    await this.service.callLifecycleHooks("onAfterCompile", [
      compiled,
      this._tickState,
      this.handle,
    ]);

    // Wait for forks/spawns and re-compile if needed.
    // Run in captured context because waitForForksAndRecompile may call compileUntilStable
    // again if forks completed, and those render procedures need the correct executionId.
    const { compiled: finalCompiled } = await this.runInContext(() =>
      this.service.waitForForksAndRecompile(
        this._com,
        this.compiler,
        this.rootElement,
        this._tickState!,
        compiled,
        this.handle,
      ),
    );

    // Apply compiled structure
    this.structureRenderer.apply(finalCompiled);

    // Check abort after compilation
    this.service.checkAbort();

    // Format input
    const formatted = this.structureRenderer.formatInput(this._com.toInput());

    // Call onAfterRender hook (tools are now available in formatted.tools)
    await this.service.callLifecycleHooks("onAfterRender", [
      formatted,
      this._tickState,
      this.handle,
    ]);

    // Capture what was sent to the model (for previous in next tick)
    const rawComInput = this._com.toInput();
    const { system: _sys, ...inputWithoutSystem } = rawComInput;
    this._lastCompiledInput = inputWithoutSystem as COMInput;

    // Get model and transform to model input (if modelGetter is provided)
    let model: ModelInstance | undefined;
    let modelInput: ModelInput | undefined;

    const modelGetter = this.service["config"].modelGetter;
    if (modelGetter) {
      model = modelGetter(this._com);
      if (model?.fromEngineState) {
        try {
          modelInput = await model.fromEngineState(formatted);
        } catch (error) {
          log.error({ err: error }, "Failed to transform COMInput to ModelInput");
        }
      } else if (model) {
        modelInput = formatted as unknown as ModelInput;
      }
    }

    // Handle compilation stop request
    if (compilationStopReason) {
      this._shouldContinue = false;
      this._stopReason = compilationStopReason;
    }

    return {
      compiled: finalCompiled,
      formatted,
      model,
      modelInput,
      tools: this.service.getTools(),
      shouldStop: !!compilationStopReason,
      stopReason: compilationStopReason,
    };
  }

  /**
   * Ingest model and tool execution results (post-model execution).
   *
   * This method:
   * - Applies state updates from response
   * - Adds model outputs to COM
   * - Adds tool results to COM
   * - Calls compiler.notifyTickEnd() (component lifecycle)
   * - Resolves tick control (updates shouldContinue)
   * - Throws if unrecoverable error (session remains valid)
   *
   * @param result Model response and tool results
   * @returns Session state after ingestion
   */
  async ingestTickResult(result: TickResultInput): Promise<TickResultOutput> {
    const { response, toolResults = [] } = result;

    // 1. Apply state updates from response
    if (response.updatedSections) {
      for (const section of response.updatedSections) {
        this._com.addSection(section);
      }
    }

    // 2. Build tool result entries for timeline
    const toolResultEntries: COMTimelineEntry[] =
      toolResults.length > 0
        ? [
            {
              kind: "message" as const,
              message: {
                role: "tool" as const,
                content: toolResults.map((r) => ({
                  id: r.id,
                  type: "tool_result" as const,
                  toolUseId: r.toolUseId,
                  name: r.name,
                  content: (r.content || []).map((block: any) => ({
                    ...block,
                    semantic: {
                      type: "preformatted" as const,
                      preformatted: true,
                    },
                  })),
                  metadata: r.metadata,
                  executedBy: r.executedBy || "engine",
                  isError: !r.success,
                  semantic: {
                    type: "preformatted" as const,
                    preformatted: true,
                  },
                })),
              },
              tags: ["tool_output"],
            },
          ]
        : [];

    // 3. Build COMOutput (model output + tool results)
    const current: COMOutput = {
      timeline: [...(response.newTimelineEntries || []), ...toolResultEntries],
      toolCalls: response.toolCalls,
      toolResults: toolResults,
    };

    // 4. Add model outputs to COM
    if (response.newTimelineEntries && response.newTimelineEntries.length > 0) {
      for (const entry of response.newTimelineEntries) {
        const wrappedEntry = {
          ...entry,
          message: {
            ...entry.message,
            content: entry.message.content.map((block) => ({
              ...block,
              semantic: { type: "preformatted" as const, preformatted: true },
            })),
          },
        };
        this._com.addTimelineEntry(wrappedEntry);
      }
    }

    // 5. Add tool results to COM
    if (toolResults.length > 0) {
      const resultMessage = {
        role: "tool" as const,
        content: toolResults.map((r) => ({
          type: "tool_result" as const,
          toolUseId: r.toolUseId,
          name: r.name,
          content: (r.content || []).map((block: any) => ({
            ...block,
            semantic: { type: "preformatted" as const, preformatted: true },
          })),
          isError: !r.success,
          semantic: { type: "preformatted" as const, preformatted: true },
        })),
      };
      this._com.addTimelineEntry({
        kind: "message",
        message: resultMessage,
        tags: ["tool_output"],
      });
    }

    // 6. Update tickState with current, stopReason, and usage
    if (this._tickState) {
      this._tickState.current = current;
      this._tickState.stopReason = response.stopReason;
      this._tickState.usage = response.usage;
    }

    // 7. Call component lifecycle hooks (notifyTickEnd).
    // Run in captured context to ensure lifecycle hooks inherit correct executionId.
    try {
      await this.runInContext(() => this.compiler.notifyTickEnd(this._tickState!));
    } catch (error: any) {
      // Try recovery via compiler.notifyError
      const errorState: TickState = {
        ...this._tickState!,
        stop: this._tickState!.stop,
        error: {
          error: error instanceof Error ? error : new Error(String(error)),
          phase: "tick_end",
          recoverable: true,
        },
      };

      const recovery = await this.runInContext(() => this.compiler.notifyError(errorState));
      if (recovery?.continue) {
        // Apply recovery modifications if any
        if (recovery.modifications) {
          await recovery.modifications(this._com);
        }
        // Add recovery message if provided
        if (recovery.recoveryMessage) {
          this._com.addTimelineEntry({
            kind: "message",
            message: {
              role: "event",
              content: [
                {
                  type: "system_event",
                  event: "error_recovery",
                  source: "error_recovery",
                  data: { recoveryMessage: recovery.recoveryMessage },
                },
              ],
            },
            tags: ["error_recovery"],
          });
        }
        // Continue - recovery handled
      } else {
        // Throw to Engine - session remains valid
        throw error;
      }
    }

    // 8. Call onTickEnd lifecycle hook (for consistency with onTickStart in compileTick)
    await this.service.callLifecycleHooks("onTickEnd", [
      this._tick,
      this._tickState!,
      response,
      this.handle,
    ]);

    // 10. Resolve tick control
    const defaultStatus: COMTickStatus = response.shouldStop ? "completed" : "continue";
    const tickControl = this._com._resolveTickControl(
      defaultStatus,
      response.stopReason?.reason,
      this._tick,
    );

    // 11. Update session state
    this._current = current;

    if (tickControl.status === "aborted" || tickControl.status === "completed") {
      this._shouldContinue = false;
      this._stopReason = tickControl.terminationReason;
    } else {
      this._shouldContinue = true;
    }

    return {
      shouldContinue: this._shouldContinue,
      stopReason: this._stopReason,
      current,
    };
  }

  /**
   * Advance to the next tick.
   * Called by Engine after all tick processing (events, persistence, etc.).
   *
   * - Updates previous from last compilation
   * - Increments tick counter
   *
   * Note: Queued messages are NOT cleared here. They are cleared at the START
   * of the next tick (in compileTick) after prepareTickState snapshots them.
   * This ensures messages that arrive during Tick N are available in Tick N+1's
   * TickState.queuedMessages.
   */
  advanceTick(): void {
    // Update previous to what was sent to the model
    this._previous = this._lastCompiledInput;

    // Reset abort state for next tick
    this._com._resetAbortState();

    // Increment tick
    this._tick++;
  }

  /**
   * Notify components about an error and collect recovery actions.
   * Called by Engine when model or tool execution fails.
   *
   * This method:
   * - Creates an error state with the error details
   * - Calls compiler.notifyError() to collect recovery actions
   * - If recovery is possible, applies modifications and adds recovery message
   * - Returns the recovery action (or null if no recovery)
   *
   * @param error The error that occurred
   * @param phase The phase where the error occurred
   * @param context Optional context about the error
   * @returns Recovery action if recovery is possible, null otherwise
   */
  async notifyError(
    error: Error,
    phase:
      | "render"
      | "model_execution"
      | "tool_execution"
      | "tick_start"
      | "tick_end"
      | "complete"
      | "unknown",
    context?: Record<string, unknown>,
  ): Promise<RecoveryAction | null> {
    const errorState: TickState = {
      ...this._tickState!,
      tick: this._tick,
      stop: this._tickState?.stop || (() => {}),
      error: {
        error,
        phase,
        recoverable: true,
        context,
      },
    };

    const recovery = await this.compiler.notifyError(errorState);

    if (recovery?.continue) {
      // Apply recovery modifications if any
      if (recovery.modifications) {
        await recovery.modifications(this._com);
      }
      // Add recovery message if provided
      if (recovery.recoveryMessage) {
        this._com.addTimelineEntry({
          kind: "message",
          message: {
            role: "event",
            content: [
              {
                type: "system_event",
                event: "error_recovery",
                source: "error_recovery",
                data: { recoveryMessage: recovery.recoveryMessage },
              },
            ],
          },
          tags: ["error_recovery"],
        });
      }
    }

    return recovery;
  }

  /**
   * Complete execution.
   * Called when the tick loop exits (shouldContinue is false or maxTicks reached).
   *
   * - Calls compiler.notifyComplete()
   * - Returns final formatted state
   *
   * @returns Final formatted state
   */
  async complete(): Promise<COMInput> {
    this._isComplete = true;

    // Get final state
    const finalOutput = this.structureRenderer.formatInput(this._com.toInput());

    // Notify components that execution is complete.
    // Run in captured context to ensure lifecycle hooks inherit correct executionId.
    try {
      await this.runInContext(() => this.compiler.notifyComplete(finalOutput));
    } catch (error: any) {
      // Try recovery
      const errorState: TickState = {
        tick: this._tick,
        previous: finalOutput,
        stop: () => {},
        error: {
          error: error instanceof Error ? error : new Error(String(error)),
          phase: "complete",
          recoverable: true,
        },
        queuedMessages: [],
      };

      const recovery = await this.runInContext(() => this.compiler.notifyError(errorState));
      if (!recovery?.continue) {
        log.error({ err: error }, "Error in onComplete, no recovery");
        // Don't throw - complete should be best-effort
      }
    }

    // Return final formatted state (may have been modified by onComplete)
    return this.structureRenderer.formatInput(this._com.toInput());
  }

  /**
   * Unmount the compiler (cleanup).
   * Called by Engine in finally block.
   * Run in captured context to ensure lifecycle hooks inherit correct executionId.
   */
  async unmount(): Promise<void> {
    try {
      await this.runInContext(() => this.compiler.unmount());
    } catch (error) {
      log.error({ err: error }, "Error during compiler unmount");
    }
  }

  // ============================================================================
  // Message API
  // ============================================================================

  // Serial message processing queue
  private _messageQueue: Array<() => Promise<void>> = [];
  private _messageProcessing = false;
  private _messageIdCounter = 0;

  /**
   * Send a message to the running session.
   *
   * The message is delivered immediately to component onMessage hooks,
   * then queued for availability in TickState.queuedMessages.
   *
   * Messages are processed serially (FIFO) but don't block the main execution.
   *
   * @param message The message to send (id and timestamp are auto-generated)
   * @returns Promise that resolves when message is processed by all components
   *
   * @example Direct programmatic injection
   * ```typescript
   * const session = await service.createSession(config);
   *
   * // Send a message during execution
   * await session.sendMessage({
   *   type: 'user_feedback',
   *   content: { priority: 'high', focus: 'security' }
   * });
   * ```
   */
  async sendMessage(message: Omit<ExecutionMessage, "id" | "timestamp">): Promise<void> {
    const fullMessage: ExecutionMessage = {
      ...message,
      id: `msg_${this._messageIdCounter++}`,
      timestamp: Date.now(),
    };

    // Add to processing queue for serial execution
    return new Promise((resolve, reject) => {
      this._messageQueue.push(async () => {
        try {
          // 1. Notify components immediately via onMessage hooks
          if (this._tickState) {
            await this.compiler.notifyOnMessage(fullMessage, this._tickState);
          }

          // 2. Queue for next tick's TickState.queuedMessages
          this._com.queueMessage(fullMessage);

          resolve();
        } catch (err) {
          log.error({ err }, "Error processing message");
          reject(err);
        }
      });

      // Process queue if not already processing
      this._processMessageQueue();
    });
  }

  /**
   * Process the message queue serially.
   */
  private async _processMessageQueue(): Promise<void> {
    if (this._messageProcessing) {
      return; // Already processing
    }

    this._messageProcessing = true;

    try {
      while (this._messageQueue.length > 0) {
        const task = this._messageQueue.shift()!;
        await task();
      }
    } finally {
      this._messageProcessing = false;
    }
  }
}

/**
 * Comprehensive compilation service for JSX elements.
 *
 * This service provides all the setup and compilation logic that Engine needs
 * before and after calling the model. Engine can delegate compilation and state
 * management to this service to simplify the tick loop.
 *
 * Features:
 * - Component hooks (for component lifecycle)
 * - Lifecycle hooks (onTickStart, onAfterCompile, onTickEnd)
 * - Tool registration and MCP server initialization
 * - Model-based renderer resolution
 * - Process methods support (fork/spawn abstraction)
 * - Session-based API for multi-tick execution
 * - Post-model state ingestion and component lifecycle hooks
 * - Tick control resolution
 *
 * Separation of Concerns:
 * - Service handles: component hooks, lifecycle hooks, compilation, state management
 * - Engine handles: model hooks, tool hooks, engine hooks, model/tool execution
 *
 * @example Session-based API (recommended)
 * ```typescript
 * const service = new CompileJSXService({
 *   tools: [MyTool],
 *   modelGetter: (com) => myModel,
 * });
 *
 * const session = await service.createSession({
 *   input: { timeline: [], sections: {} },
 *   rootElement: <MyAgent />,
 * });
 *
 * while (session.shouldContinue() && session.tick <= 10) {
 *   // Pre-model: compile and get input
 *   const { formatted, model, tools } = await session.compileTick();
 *
 *   // Model execution (caller's responsibility)
 *   const response = await model.generate(formatted);
 *
 *   // Tool execution (caller's responsibility)
 *   const toolResults = await executeTools(response.toolCalls, tools);
 *
 *   // Post-model: ingest results and run component lifecycle
 *   await session.ingestTickResult({ response, toolResults });
 *
 *   // Advance to next tick
 *   session.advanceTick();
 * }
 *
 * const finalState = await session.complete();
 * ```
 *
 * @example Single-tick compilation
 * ```typescript
 * const result = await service.compile(<MyComponent />, {
 *   timeline: [],
 *   sections: {}
 * });
 * console.log(result.formatted);
 * ```
 *
 * @example Engine integration with session
 * ```typescript
 * // Engine creates service with only the registries the service needs
 * // (component and lifecycle hooks are service concerns)
 * const compileService = new CompileJSXService({
 *   tools: this.getTools(),
 *   hookRegistries: {
 *     components: this.componentHooksRegistry,
 *     lifecycle: this.lifecycleHooksRegistry,
 *   },
 *   modelGetter: (com) => this.getRawModel(com),
 *   processMethods: { fork: ..., spawn: ..., ... }, // For fork/spawn support
 * });
 *
 * const session = await compileService.createSession({ input, rootElement });
 *
 * // Engine's tick loop is now much simpler:
 * // (Model, tool, and engine hooks are handled by Engine separately)
 * while (session.shouldContinue()) {
 *   const { model, modelInput, tools } = await session.compileTick();
 *   const response = await this.executeModel(model, modelInput);
 *   const toolResults = await this.executeTools(response.toolCalls, tools);
 *   await session.ingestTickResult({ response, toolResults });
 *   session.advanceTick();
 * }
 * ```
 */
export class CompileJSXService {
  public readonly componentHooksRegistry: ComponentHookRegistry;
  public readonly lifecycleHooksRegistry: EngineLifecycleHookRegistry;
  private mcpClient?: MCPClient;
  private mcpService?: MCPService;
  private channelService?: ChannelService;
  private renderers: { [key: string]: Renderer };
  private configTools: (ToolClass | ExecutableTool)[];

  constructor(private config: CompileJSXServiceConfig = {}) {
    // Initialize hook registries (use provided ones or create new)
    // Note: Only component and lifecycle hooks are service concerns
    this.componentHooksRegistry = config.hookRegistries?.components || new ComponentHookRegistry();
    this.lifecycleHooksRegistry =
      config.hookRegistries?.lifecycle || new EngineLifecycleHookRegistry();

    // Initialize renderers
    this.renderers = {
      markdown: new MarkdownRenderer(),
      xml: new XMLRenderer(),
      ...(config.renderers || {}),
    };

    // Initialize MCP client/service if configured
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      this.mcpClient = new MCPClient();
      this.mcpService = new MCPService(this.mcpClient);
    }

    // Initialize channel service if configured
    if (config.channels) {
      if (config.channels instanceof ChannelService) {
        this.channelService = config.channels;
      } else {
        this.channelService = new ChannelService(config.channels);
      }
    }

    // Register hooks from config
    this.registerHooks();

    // Pre-resolve tools for efficiency
    this.configTools = this.resolveTools();
  }

  /**
   * Resolve tools from config, caching the result.
   */
  private resolveTools(): (ToolClass | ExecutableTool)[] {
    if (!this.config.tools) {
      return [];
    }

    return this.config.tools.map((tool) => {
      if (typeof tool === "string") {
        const registered = toolRegistry.get(tool);
        if (!registered) {
          throw new NotFoundError("tool", tool, "Tool not found in registry");
        }
        return registered;
      }
      return tool;
    });
  }

  /**
   * Register all hooks from config.
   * Only registers hooks if registries were created (not provided via hookRegistries).
   *
   * Note: Only component and lifecycle hooks are service concerns.
   * Model, tool, and engine hooks are Engine concerns and should be
   * registered directly on Engine.
   */
  private registerHooks(): void {
    // Register component hooks
    if (this.config.componentHooks && !this.config.hookRegistries?.components) {
      for (const [hookName, middleware] of Object.entries(this.config.componentHooks)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            this.componentHooksRegistry.register(hookName as ComponentHookName, mw);
          }
        }
      }
    }

    // Register lifecycle hooks
    if (this.config.lifecycleHooks && !this.config.hookRegistries?.lifecycle) {
      for (const [hookName, hookArray] of Object.entries(this.config.lifecycleHooks)) {
        if (hookArray && Array.isArray(hookArray)) {
          for (const hook of hookArray) {
            this.lifecycleHooksRegistry.register(
              hookName as EngineLifecycleHookName,
              hook as EngineLifecycleHook<EngineLifecycleHookName>,
            );
          }
        }
      }
    }
  }

  /**
   * Get resolved tools (cached).
   */
  getTools(): (ToolClass | ExecutableTool)[] {
    return this.configTools;
  }

  /**
   * Register tools with COM.
   * Called during setup and after COM.clear() for multi-tick scenarios.
   */
  registerTools(com: COM): void {
    for (const tool of this.configTools) {
      com.addTool(tool);
    }
  }

  /**
   * Initialize MCP servers and discover their tools.
   */
  async registerMCPTools(com: COM): Promise<void> {
    if (!this.config.mcpServers || !this.mcpService) {
      return;
    }

    const initPromises = Object.entries(this.config.mcpServers).map(
      async ([serverName, config]) => {
        try {
          const mcpConfig = normalizeMCPConfig(serverName, config);
          await this.mcpService!.discoverAndRegister(mcpConfig, com);
        } catch (error) {
          log.error({ err: error, serverName }, "Failed to initialize MCP server");
        }
      },
    );

    await Promise.all(initPromises);
  }

  /**
   * Call lifecycle hooks.
   */
  async callLifecycleHooks<T extends EngineLifecycleHookName>(
    hookName: T,
    args: EngineLifecycleHookArgs<T>,
  ): Promise<void> {
    const hooks = this.lifecycleHooksRegistry.getMiddleware(hookName);

    for (const hook of hooks) {
      try {
        await (hook as any)(...args);
      } catch (error) {
        log.error({ err: error, hookName }, "Error in lifecycle hook");
        throw error;
      }
    }
  }

  /**
   * Setup compilation infrastructure (COM, FiberCompiler, StructureRenderer).
   * This is the core setup that Engine needs before compilation.
   *
   * @param input Initial COM input
   * @param rootElement Root JSX element to compile
   * @param handle Optional execution handle (for setting COM instance)
   * @returns Setup result with com, compiler, and structureRenderer exposed
   */
  async setup(
    input: EngineInput,
    rootElement: JSX.Element,
    handle?: ExecutionHandle,
  ): Promise<{
    com: COM;
    compiler: FiberCompiler;
    structureRenderer: StructureRenderer;
  }> {
    // Create COM with proper setup
    const com = new COM(
      {
        metadata: input.metadata || {},
        modelOptions: input.modelOptions || undefined,
      },
      input,
      this.channelService,
      this.config.processMethods,
    );

    // Create compiler with component hooks
    const compiler = new FiberCompiler(com, this.componentHooksRegistry, {
      defaultRenderer: this.config.defaultRenderer,
    });

    // Create structure renderer
    const structureRenderer = new StructureRenderer(com);

    // Resolve renderer from model capabilities if modelGetter is provided
    if (this.config.modelGetter) {
      const model = this.config.modelGetter(com);
      if (model?.metadata.capabilities) {
        const modelId = model.metadata.id || model.metadata.model || "";
        const provider = model.metadata.provider;

        // Find capability object with messageTransformation
        const capabilityWithTransformation = model.metadata.capabilities.find(
          (cap: any) => cap.messageTransformation !== undefined,
        ) as any;

        if (capabilityWithTransformation?.messageTransformation) {
          // Resolve transformation config (could be function or object)
          const transformation =
            typeof capabilityWithTransformation.messageTransformation === "function"
              ? capabilityWithTransformation.messageTransformation(modelId, provider)
              : capabilityWithTransformation.messageTransformation;

          // Resolve preferred renderer (could be function or string)
          const rendererType =
            typeof transformation.preferredRenderer === "function"
              ? transformation.preferredRenderer(modelId, provider)
              : transformation.preferredRenderer || "markdown";

          // Set renderer on StructureRenderer
          structureRenderer.setDefaultRenderer(
            this.renderers[rendererType] || this.renderers.markdown,
          );

          // Store transformation config on COM for later use
          com.addMetadata("messageTransformation", transformation);
        }
      }
    } else {
      // Use default renderer
      const defaultRenderer = this.config.defaultRenderer || this.renderers.markdown;
      structureRenderer.setDefaultRenderer(defaultRenderer);
    }

    // Set COM instance on handle if provided
    if (handle && "setComInstance" in handle) {
      (handle as any).setComInstance(com);
    }

    // Discover and register MCP tools
    await this.registerMCPTools(com);

    // Register tools
    this.registerTools(com);

    // Notify components that compilation is starting
    await compiler.notifyStart();

    return {
      com,
      compiler,
      structureRenderer,
    };
  }

  /**
   * Create a long-lived compilation session for multi-tick execution.
   *
   * The session maintains state across ticks and provides a clean API for:
   * - Pre-model compilation (compileTick)
   * - Post-model state ingestion (ingestTickResult)
   * - Component lifecycle hooks (notifyTickEnd, notifyComplete)
   * - Tick control resolution (shouldContinue)
   *
   * @example
   * ```typescript
   * const session = await service.createSession({
   *   input: engineInput,
   *   rootElement: <MyAgent />,
   * });
   *
   * while (session.shouldContinue() && session.tick <= maxTicks) {
   *   const { formatted, model, tools } = await session.compileTick();
   *
   *   // Engine executes model and tools
   *   const response = await model.generate(formatted);
   *   const toolResults = await executeTools(response.toolCalls, tools);
   *
   *   // Session ingests results and handles component lifecycle
   *   await session.ingestTickResult({ response, toolResults });
   *
   *   // Engine calls its own lifecycle hooks, yields events, etc.
   *   session.advanceTick();
   * }
   *
   * const finalState = await session.complete();
   * ```
   *
   * @param config Session configuration
   * @returns A long-lived CompileSession instance
   */
  async createSession(config: CompileSessionConfig): Promise<CompileSession> {
    const { input, rootElement, handle, maxTicks = 10 } = config;

    // Ensure element is a JSX.Element
    const element = ensureElement(rootElement);

    // Setup compilation infrastructure
    const { com, compiler, structureRenderer } = await this.setup(input, element, handle);

    // Note: onExecutionStart is NOT called here - it's an Engine lifecycle hook
    // that Engine should call with its own error handling

    // Capture the kernel context at session creation time.
    // This context has the correct executionHandle and procedureGraph.
    // We'll use it when running lifecycle hooks to ensure they inherit
    // the correct execution context.
    const kernelContext = Context.tryGet();

    // Create and return session
    return new CompileSession(
      this,
      com,
      compiler,
      structureRenderer,
      element,
      handle,
      maxTicks,
      kernelContext,
    );
  }

  /**
   * Prepare tick state for a given tick number.
   * Handles state semantics correctly (previous, current).
   *
   * @param com COM instance
   * @param tick Tick number (1-based)
   * @param previous Previous tick's state (undefined for tick 1)
   * @param current Current tick's state (userInput for tick 1, model output for tick 2+)
   * @returns TickState ready for compilation
   */
  prepareTickState(com: COM, tick: number, previous?: COMInput, current?: COMOutput): TickState {
    // For tick 1, use userInput if current not provided
    if (tick === 1 && !current) {
      const userInput = com.getUserInput();
      const sections = userInput?.sections;
      current = {
        timeline: userInput?.timeline || [],
        ...(sections ? { sections } : {}),
      };
    }

    return {
      tick,
      previous,
      current: current as COMInput,
      stopReason: undefined,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stop: (reason: string) => {
        throw new StateError("stopped", "running", `Compilation stopped: ${reason}`);
      },
      channels: undefined,
      queuedMessages: com.getQueuedMessages(),
    };
  }

  /**
   * Clear COM ephemeral state and re-register tools.
   * Called before each tick compilation to reset timeline/sections.
   *
   * @param com COM instance to clear
   */
  clearAndReRegisterTools(com: COM): void {
    // Clear ephemeral state (timeline, sections) from previous tick
    com.clear();

    // Re-register config tools after clear (they persist across ticks)
    this.registerTools(com);
  }

  /**
   * Check if compilation should be aborted and throw if so.
   * Called before and after compilation (not during).
   */
  checkAbort(): void {
    if (this.config.abortChecker?.()) {
      throw new AbortError();
    }
  }

  /**
   * Wait for forks/spawns to complete and re-compile if needed.
   *
   * This is part of the compilation phase - after compilation completes,
   * we check if any forks/spawns are waiting. If they complete, their
   * onComplete callbacks may modify COM state, so we re-compile to allow
   * components to see the fork results.
   *
   * This happens BEFORE applying structures so fork results are included
   * in the compiled structure that gets applied.
   *
   * @param com COM instance
   * @param compiler FiberCompiler instance
   * @param rootElement Root JSX element
   * @param tickState Current tick state
   * @param compiled Initial compiled structure
   * @param handle Optional execution handle (for lifecycle hooks)
   * @returns Final compiled structure (possibly recompiled) and metadata
   */
  async waitForForksAndRecompile(
    com: COM,
    compiler: FiberCompiler,
    rootElement: JSX.Element,
    tickState: TickState,
    compiled: CompiledStructure,
    handle?: ExecutionHandle,
  ): Promise<{
    compiled: CompiledStructure;
    hadWaitingForks: boolean;
    recompiled: boolean;
  }> {
    // Check for waiting forks/spawns (if waitUntilComplete is true)
    // Wait BEFORE applying structures so fork/spawn onComplete callbacks can modify COM state
    // before structures are applied and model input is built
    const waitHandles = getWaitHandles(com);
    let hadWaitingForks = false;

    if (waitHandles.size > 0) {
      // Wait for all waiting forks/spawns to complete before continuing tick
      const handlesArray = Array.from(waitHandles);
      const runningHandles = handlesArray.filter((h) => h.status === "running");

      if (runningHandles.length > 0) {
        hadWaitingForks = true;
        // Wait for all running handles to complete
        // Their onComplete callbacks will fire and may modify COM state
        await Promise.all(
          runningHandles.map((h) =>
            h.waitForCompletion().catch(() => {
              // Ignore errors - handle will be in failed/cancelled state
            }),
          ),
        );
      }
    }

    // If forks/spawns completed, their onComplete callbacks may have modified COM state.
    // Re-compile so components can see the fork results (e.g., to decide whether to create another fork).
    // The forkStarted/spawnStarted flags prevent forks/spawns from executing again during re-compilation.
    if (hadWaitingForks) {
      // Reset recompile tracking before re-compiling
      com._resetRecompileRequest();

      // Re-compile to allow components to see fork results
      const recompileResult = await compiler.compileUntilStable(rootElement, tickState, {
        maxIterations: 50,
        trackMutations: process.env["NODE_ENV"] === "development",
        ...this.config.compileOptions,
      });

      // Update compiled structure with recompiled result
      compiled = recompileResult.compiled;

      if (recompileResult.iterations > 1) {
        log.debug(
          {
            iterations: recompileResult.iterations,
            reasons: recompileResult.recompileReasons,
          },
          "Re-compilation after fork stabilized",
        );
      }

      // Call onAfterCompile hook again for the recompiled structure
      await this.callLifecycleHooks("onAfterCompile", [compiled, tickState, handle]);

      return {
        compiled,
        hadWaitingForks: true,
        recompiled: true,
      };
    }

    return {
      compiled,
      hadWaitingForks: false,
      recompiled: false,
    };
  }

  /**
   * Execute a program using a CompileSession.
   *
   * @param config Session configuration
   * @param fn Function to execute for each tick
   * @returns Final COM input
   */
  async _run(
    config: CompileSessionConfig,
    fn: (compiled: CompileTickResult) => Promise<TickResultInput>,
  ): Promise<COMInput> {
    const session = await this.createSession(config);

    while (session.shouldContinue() && session.tick <= (config.maxTicks ?? Infinity)) {
      const compiled = await session.compileTick();
      const result = await fn(compiled);
      await session.ingestTickResult(result);
      session.advanceTick();
    }

    return await session.complete();
  }

  run = createEngineProcedure(
    {
      name: "compile:run",
      metadata: {
        type: "compile",
        operation: "run",
      },
      // Internal compiler service - never creates execution boundary
      executionBoundary: false,
    },
    this._run.bind(this),
  );

  /**
   * Execute a program with streaming support.
   *
   * Supports two overloaded forms:
   * 1. Simple function: `runStream(config, executeTick)`
   * 2. Callbacks object: `runStream(config, callbacks)`
   *
   * When `executeTick` (or `callbacks.onTick`) returns an AsyncIterable:
   * - Chunks are yielded as `{ type: 'chunk', tick, chunk }` events
   * - `finalizeChunks` MUST be provided to convert chunks to TickResultInput
   *
   * When it returns a Promise<TickResultInput>:
   * - No chunks are yielded, result is used directly
   *
   * @example Simple function (non-streaming tick execution)
   * ```typescript
   * for await (const event of service.runStream(config, async (compiled) => {
   *   const response = await model.generate(compiled.formatted);
   *   return { response };
   * })) {
   *   console.log(event.type);
   * }
   * ```
   *
   * @example Callbacks with streaming
   * ```typescript
   * for await (const event of service.runStream(config, {
   *   onTick: async function* (compiled) {
   *     for await (const chunk of model.stream(compiled.formatted)) {
   *       yield chunk;
   *     }
   *   },
   *   finalizeChunks: (chunks) => {
   *     const response = mergeChunks(chunks);
   *     return { response };
   *   },
   * })) {
   *   if (event.type === 'chunk') {
   *     process.stdout.write(event.chunk.text);
   *   }
   * }
   * ```
   */
  async *_runStream<TChunk = unknown>(
    config: CompileSessionConfig,
    executorOrCallbacks: TickExecutor<TChunk> | RunStreamCallbacks<TChunk>,
  ): AsyncGenerator<SessionStreamEvent<TChunk>> {
    // Normalize to callbacks form
    const callbacks: RunStreamCallbacks<TChunk> =
      typeof executorOrCallbacks === "function"
        ? { onTick: executorOrCallbacks }
        : executorOrCallbacks;

    const session = await this.createSession(config);

    while (session.shouldContinue() && session.tick <= (config.maxTicks ?? Infinity)) {
      const tick = session.tick;

      // Optional tick start callback
      if (callbacks.onTickStart) {
        await callbacks.onTickStart(tick);
      }
      yield { type: "tick_start", tick };

      // Compile
      const compiled = await session.compileTick();
      yield { type: "compiled", tick, compiled };

      // Check if compilation requested a stop
      if (compiled.shouldStop) {
        const finalState = await session.complete();
        yield { type: "complete", output: finalState };
        return;
      }

      // Execute tick
      const tickResult = callbacks.onTick(compiled, tick);
      let result: TickResultInput;

      if (isAsyncIterable(tickResult)) {
        // Streaming: collect chunks and yield them
        const chunks: TChunk[] = [];

        for await (const chunk of tickResult) {
          chunks.push(chunk);
          yield { type: "chunk", tick, chunk };
        }

        // Must have finalizeChunks to convert chunks to TickResultInput
        if (!callbacks.finalizeChunks) {
          throw new ValidationError(
            "finalizeChunks",
            "runStream: onTick returned an AsyncIterable but finalizeChunks was not provided. " +
              "Provide finalizeChunks to convert chunks into TickResultInput.",
          );
        }

        result = await callbacks.finalizeChunks(chunks, tick);
      } else {
        // Non-streaming: await the promise
        result = await tickResult;
      }

      // Ingest result
      const ingestResult = await session.ingestTickResult(result);

      // Optional tick end callback
      if (callbacks.onTickEnd) {
        await callbacks.onTickEnd(tick, ingestResult);
      }
      yield { type: "tick_end", tick, result: ingestResult };

      session.advanceTick();
    }

    const finalState = await session.complete();
    yield { type: "complete", output: finalState };
  }

  /**
   * Streaming execution as a Procedure.
   * Supports context injection and middleware.
   *
   * @example
   * ```typescript
   * const events = await service.runStream
   *   .withContext({ userId: 'abc' })
   *   .run(config, executeTick);
   *
   * for await (const event of events) {
   *   // handle events
   * }
   * ```
   */
  runStream = createEngineProcedure(
    {
      name: "compile:runStream",
      metadata: {
        type: "compile",
        operation: "runStream",
      },
      // Internal compiler service - never creates execution boundary
      executionBoundary: false,
    },
    this._runStream.bind(this),
  );

  /**
   * Compile JSX with full setup (convenience method).
   *
   * This performs all the setup that Engine does before calling the model:
   * - Creates COM with proper metadata and services
   * - Initializes MCP servers and discovers tools
   * - Registers tools
   * - Sets up compiler with hooks
   * - Creates structure renderer
   * - Resolves renderer from model capabilities
   * - Calls lifecycle hooks
   * - Compiles until stable
   * - Applies and formats the result
   *
   * @param jsx The JSX element or component definition to compile
   * @param input Initial COM input (timeline, sections, metadata, etc.)
   * @param handle Optional execution handle
   * @returns Compilation result with compiled structure, formatted output, and metadata
   */
  async compile(
    jsx: JSX.Element | ComponentDefinition,
    input: Partial<EngineInput> = {},
    handle?: ExecutionHandle,
  ): Promise<CompileJSXResult> {
    // Ensure element is a JSX.Element
    const rootElement = ensureElement(jsx);

    // Prepare initial input
    const initialInput: EngineInput = {
      timeline: [],
      sections: {},
      ...input,
    };

    // Setup compilation infrastructure
    const { com, compiler, structureRenderer } = await this.setup(
      initialInput,
      rootElement,
      handle,
    );

    // Prepare tick state
    const tickState = this.prepareTickState(com, 1);

    // Call onTickStart hook
    await this.callLifecycleHooks("onTickStart", [1, tickState, handle]);

    // Check abort before compilation (not during - that would leave things inconsistent)
    this.checkAbort();

    // Compile until stable
    const compileOptions: CompileStabilizationOptions = {
      maxIterations: 50,
      trackMutations: process.env["NODE_ENV"] === "development",
      ...this.config.compileOptions,
    };

    const { compiled, iterations, forcedStable, recompileReasons } =
      await compiler.compileUntilStable(rootElement, tickState, compileOptions);

    // Call onAfterCompile hook
    await this.callLifecycleHooks("onAfterCompile", [compiled, tickState, handle]);

    // Wait for forks/spawns to complete and re-compile if needed
    // This happens BEFORE applying structures so fork results are included
    const { compiled: finalCompiled, recompiled: _recompiled } =
      await this.waitForForksAndRecompile(com, compiler, rootElement, tickState, compiled, handle);

    // Apply compiled structure (possibly recompiled after forks)
    structureRenderer.apply(finalCompiled);

    // Resolve tick control requests from COM (requestStop/requestContinue)
    // This happens AFTER applying structures so components can see the final state
    const tickControl = com._resolveTickControl(
      "continue", // Default status (Engine will override based on its state)
      undefined, // Default reason
      1, // Tick number
    );

    // Check abort after compilation completes (before returning)
    this.checkAbort();

    // Format input (event blocks will be formatted, native blocks will pass through)
    const formatted = structureRenderer.formatInput(com.toInput());

    // Get final COM input
    const finalInput = com.toInput();

    return {
      compiled: finalCompiled,
      com,
      structureRenderer,
      formatted,
      input: finalInput,
      metadata: {
        iterations,
        forcedStable,
        recompileReasons,
      },
      tickControl,
      stopReason:
        tickState.stopReason?.reason ||
        (typeof tickState.stopReason === "string" ? tickState.stopReason : undefined),
    };
  }

  /**
   * Compile a single tick (for use in Engine's tick loop).
   *
   * This method handles the full compilation flow for a single tick:
   * - Clears COM and re-registers tools
   * - Prepares tick state
   * - Compiles until stable
   * - Waits for forks/spawns and re-compiles if needed
   * - Applies structures
   * - Resolves tick control
   * - Returns formatted input and control decisions
   *
   * @param com COM instance
   * @param compiler FiberCompiler instance
   * @param structureRenderer StructureRenderer instance
   * @param rootElement Root JSX element
   * @param tick Tick number
   * @param previous Previous tick's state (undefined for tick 1)
   * @param current Current tick's state (userInput for tick 1, model output for tick 2+)
   * @param stopReason Stop reason from TickState.stop() callback (if any)
   * @param shouldContinue Whether execution should continue (for tick control resolution)
   * @param handle Optional execution handle
   * @returns Compilation result with formatted input and tick control
   */
  async compileTick(
    com: COM,
    compiler: FiberCompiler,
    structureRenderer: StructureRenderer,
    rootElement: JSX.Element,
    tick: number,
    previous?: COMInput,
    current?: COMOutput,
    stopReason?: string,
    shouldContinue: boolean = true,
    handle?: ExecutionHandle,
  ): Promise<{
    compiled: CompiledStructure;
    formatted: COMInput;
    tickControl: COMTickDecision;
    stopReason?: string;
    tickState: TickState;
    model?: ModelInstance;
    modelInput?: ModelInput;
  }> {
    // Clear COM and re-register tools
    this.clearAndReRegisterTools(com);

    // Prepare tick state
    const tickState = this.prepareTickState(com, tick, previous, current);
    tickState.stop = (reason: string) => {
      // Store stop reason - Engine will check this
      (tickState as any).stopReason = reason;
    };
    // Set channels from channel service (Engine needs this)
    tickState.channels = this.channelService;

    // Call onTickStart hook
    await this.callLifecycleHooks("onTickStart", [tick, tickState, handle]);

    // Notify compiler that tick is starting
    await compiler.notifyTickStart(tickState);

    // Check abort before compilation (not during - that would leave things inconsistent)
    this.checkAbort();

    // Compile until stable
    const compileOptions: CompileStabilizationOptions = {
      maxIterations: 50,
      trackMutations: process.env["NODE_ENV"] === "development",
      ...this.config.compileOptions,
    };

    let { compiled, iterations, forcedStable, recompileReasons } =
      await compiler.compileUntilStable(rootElement, tickState, compileOptions);

    if (iterations > 1) {
      log.debug({ iterations, reasons: recompileReasons }, "Compilation stabilized");
    }
    if (forcedStable) {
      log.warn("Compilation forced stable at max iterations");
    }

    // Call onAfterCompile hook
    await this.callLifecycleHooks("onAfterCompile", [compiled, tickState, handle]);

    // Wait for forks/spawns and re-compile if needed
    const { compiled: finalCompiled } = await this.waitForForksAndRecompile(
      com,
      compiler,
      rootElement,
      tickState,
      compiled,
      handle,
    );

    // Apply compiled structure
    structureRenderer.apply(finalCompiled);

    // Resolve tick control requests from COM (requestStop/requestContinue)
    // This happens AFTER applying structures so components can see the final state
    const tickControl = com._resolveTickControl(
      shouldContinue ? "continue" : "completed",
      stopReason,
      tick,
    );

    // Check abort after compilation completes (before returning)
    this.checkAbort();

    // Format input
    const formatted = structureRenderer.formatInput(com.toInput());

    // Get model and transform to model input (if modelGetter is provided)
    let model: ModelInstance | undefined;
    let modelInput: ModelInput | undefined;

    if (this.config.modelGetter) {
      model = this.config.modelGetter(com);
      if (model) {
        // Transform COMInput to ModelInput using model's fromEngineState
        // This is the final step of compilation - preparing input for the model
        if (model.fromEngineState) {
          try {
            modelInput = await model.fromEngineState(formatted);
          } catch (error) {
            log.error({ err: error }, "Failed to transform COMInput to ModelInput");
            // Don't throw - let Engine handle it
          }
        } else {
          // Fallback: use formatted as ModelInput (type cast)
          modelInput = formatted as unknown as ModelInput;
        }
      }
    }

    // Get stop reason from tick state (set by TickState.stop() callback)
    const finalStopReason = tickState.stopReason;
    const stopReasonString =
      finalStopReason?.reason ||
      (typeof finalStopReason === "string" ? finalStopReason : undefined);

    return {
      compiled: finalCompiled,
      formatted,
      tickControl,
      stopReason: stopReasonString,
      tickState, // Return tickState so Engine can update it after model execution
      model, // Return model so Engine can use it for execution
      modelInput, // Return model input so Engine can use it directly
    };
  }

  /**
   * Get hook registries for dynamic hook registration.
   *
   * Note: Only component and lifecycle hooks are service concerns.
   * Model, tool, and engine hooks are Engine concerns.
   */
  get hooks() {
    return {
      components: this.componentHooksRegistry,
      lifecycle: this.lifecycleHooksRegistry,
    };
  }

  /**
   * Add a renderer.
   */
  addRenderer(name: string, renderer: Renderer): void {
    this.renderers[name] = renderer;
  }

  /**
   * Get all renderers.
   */
  getRenderers(): { [key: string]: Renderer } {
    return this.renderers;
  }

  /**
   * Get MCP client (if initialized).
   */
  getMCPClient(): MCPClient | undefined {
    return this.mcpClient;
  }

  /**
   * Get MCP service (if initialized).
   */
  getMCPService(): MCPService | undefined {
    return this.mcpService;
  }

  /**
   * Get channel service (if initialized).
   */
  getChannelService(): ChannelService | undefined {
    return this.channelService;
  }
}
