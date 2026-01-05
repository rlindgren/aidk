import type { Middleware, MiddlewarePipeline, Procedure, HandleFactory } from "aidk-kernel";
import { Logger } from "aidk-kernel";
import { Context } from "../context";
import type { EngineContext } from "../types";
import { createEngineProcedure, applyRegistryMiddleware, isProcedure } from "../procedure";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ModelInstance, ModelInput, ModelOutput } from "../model/model";
import { type ToolClass } from "../tool/tool";
import { toolRegistry, modelRegistry } from "../utils/registry";
import type { TickState, ComponentDefinition } from "../component/component";
import type { COMInput, EngineInput } from "../com/types";
import { COM } from "../com/object-model";
import type { ToolExecutionOptions } from "../types";
import { ToolExecutionType, type ExecutableTool, type ToolConfirmationResult } from "../tool/tool";
import type { AgentToolCall, AgentToolResult, StreamEvent } from "aidk-shared";
import { ToolExecutor } from "./tool-executor";
import { type JSX, createElement, Fragment, ensureElement } from "../jsx/jsx-runtime";
import { MarkdownRenderer, XMLRenderer } from "../renderers";
import {
  type EngineStreamEvent,
  createEventBase,
  createTickStartEvent,
  createTickEndEvent,
  createToolCallEvent,
  createToolResultEvent,
  createToolConfirmationRequiredEvent,
  createToolConfirmationResultEvent,
  createEngineErrorEvent,
} from "./engine-events";
import { type EngineResponse } from "./engine-response";
import {
  ComponentHookRegistry,
  type ComponentHookName,
  type ComponentHookMiddleware,
} from "../component/component-hooks";
import {
  ModelHookRegistry,
  type ModelHookName,
  type ModelHookMiddleware,
} from "../model/model-hooks";
import { ToolHookRegistry, type ToolHookName, type ToolHookMiddleware } from "../tool/tool-hooks";
import { EngineHookRegistry, type EngineHookName, type EngineHookMiddleware } from "./engine-hooks";
import {
  EngineLifecycleHookRegistry,
  type EngineLifecycleHookName,
  type EngineLifecycleHook,
  type EngineLifecycleHookArgs,
} from "./engine-lifecycle-hooks";
import {
  MCPClient,
  MCPService,
  type MCPServerConfig,
  normalizeMCPConfig,
  type MCPConfig,
} from "../mcp";
import { ChannelService, type ChannelServiceConfig } from "../channels/service";
import { ExecutionGraph } from "./execution-graph";
import {
  type ExecutionHandle,
  type ExecutionState,
  type ExecutionTreeNode,
  type EngineMetrics,
  type ForkInheritanceOptions,
  generatePid,
  type SignalType,
  type SignalEvent,
} from "./execution-types";
import { createEngineHandleFactory, ExecutionHandleImpl } from "./execution-handle";
import type { CompiledStructure } from "../compiler/types";
import type { Renderer } from "../renderers/base";
import { isAbortError, mergeAbortSignals, AbortError } from "../utils/abort-utils";
import {
  NotFoundError,
  StateError,
  ValidationError,
  type DevToolsConfig,
  type DevToolsEvent,
  devToolsEmitter,
  normalizeDevToolsConfig,
} from "aidk-shared";

/**
 * Check if DevTools should be enabled based on environment variables.
 *
 * Supported environment variables:
 * - DEVTOOLS=true or AIDK_DEVTOOLS=true - Enable DevTools
 * - DEVTOOLS_REMOTE_URL - Remote server URL
 * - DEVTOOLS_DEBUG=true - Enable debug logging
 *
 * @returns DevToolsConfig or undefined if not enabled via env
 * @internal
 */
function getDevToolsConfigFromEnv(): DevToolsConfig | undefined {
  const enabled = process.env.DEVTOOLS === "true" || process.env.AIDK_DEVTOOLS === "true";

  if (!enabled) return undefined;

  const remoteUrl = process.env.DEVTOOLS_REMOTE_URL;

  return {
    enabled: true,
    remote: !!remoteUrl,
    remoteUrl,
    secret: process.env.DEVTOOLS_SECRET,
    debug: process.env.DEVTOOLS_DEBUG === "true",
  };
}
import { CompileJSXService, type CompileSession } from "../utils/compile-jsx-service";

// Module-level logger for Engine
const log = Logger.for("Engine");

// Helper to check for async iterable
function isAsyncIterable(obj: any): obj is AsyncIterable<any> {
  return obj != null && typeof obj[Symbol.asyncIterator] === "function";
}

export interface EngineLifecycleHooks {
  // Hooks can be Procedures or async functions (will be wrapped in Procedures)
  onInit?: (EngineLifecycleHook<"onInit"> | ((engine: Engine) => Promise<void> | void))[];
  onShutdown?: (
    | EngineLifecycleHook<"onShutdown">
    | ((engine: Engine, reason?: string) => Promise<void> | void)
  )[];
  onDestroy?: (EngineLifecycleHook<"onDestroy"> | ((engine: Engine) => Promise<void> | void))[];
  onExecutionStart?: (
    | EngineLifecycleHook<"onExecutionStart">
    | ((
        input: EngineInput,
        root?: ComponentDefinition,
        handle?: ExecutionHandle,
      ) => Promise<void> | void)
  )[];
  onExecutionEnd?: (
    | EngineLifecycleHook<"onExecutionEnd">
    | ((output: COMInput, handle?: ExecutionHandle) => Promise<void> | void)
  )[];
  onExecutionError?: (
    | EngineLifecycleHook<"onExecutionError">
    | ((error: Error, handle?: ExecutionHandle) => Promise<void> | void)
  )[];
  onTickStart?: (
    | EngineLifecycleHook<"onTickStart">
    | ((tick: number, state: TickState, handle?: ExecutionHandle) => Promise<void> | void)
  )[];
  onTickEnd?: (
    | EngineLifecycleHook<"onTickEnd">
    | ((
        tick: number,
        state: TickState,
        response: EngineResponse,
        handle?: ExecutionHandle,
      ) => Promise<void> | void)
  )[];
  onAfterCompile?: (
    | EngineLifecycleHook<"onAfterCompile">
    | ((
        compiled: CompiledStructure,
        state: TickState,
        handle?: ExecutionHandle,
      ) => Promise<void> | void)
  )[];
  onAfterRender?: (
    | EngineLifecycleHook<"onAfterRender">
    | ((formatted: COMInput, state: TickState, handle?: ExecutionHandle) => Promise<void> | void)
  )[];
}

export interface EngineConfig {
  id?: string; // Optional, auto-generated if not provided (required for telemetry)
  name?: string;
  tools?: (ToolClass | ExecutableTool | string)[];
  model?: ModelInstance | string;
  maxTicks?: number;
  mcpServers?: Record<string, MCPServerConfig | MCPConfig>;
  channels?: ChannelServiceConfig | ChannelService;
  root?: JSX.Element | ComponentDefinition;
  components?: ComponentDefinition[];
  persistExecutionState?: (state: ExecutionState) => Promise<void>;
  loadExecutionState?: (pid: string) => Promise<ExecutionState | undefined>;
  lifecycleHooks?: EngineLifecycleHooks;
  hooks?: EngineStaticHooks;
  /**
   * Tool execution configuration.
   * Controls parallel execution, timeouts, and error handling.
   */
  toolExecution?: ToolExecutionOptions;
  renderers?: {
    [key: string]: Renderer;
  };
  /**
   * DevTools configuration for execution visualization.
   *
   * - `true` - Enable with defaults (inherit on fork/spawn)
   * - `false` - Disable
   * - `DevToolsConfig` - Enable with custom settings
   *
   * Can also be enabled via environment variables:
   * - DEVTOOLS=true or AIDK_DEVTOOLS=true
   * - DEVTOOLS_REMOTE_URL for cross-process mode
   *
   * @example
   * ```typescript
   * const engine = createEngine({
   *   devTools: true, // Enable with defaults
   * });
   *
   * const engine = createEngine({
   *   devTools: {
   *     enabled: true,
   *     inheritOnFork: true,
   *     inheritOnSpawn: true,
   *     debug: true,
   *   },
   * });
   * ```
   */
  devTools?: boolean | DevToolsConfig;
}

export interface EngineStaticHooks {
  execute?: EngineHookMiddleware<"execute">[];
  stream?: EngineHookMiddleware<"stream">[];
  component?: {
    [K in ComponentHookName]?: ComponentHookMiddleware<K>[];
  };
  model?: {
    [K in ModelHookName]?: ModelHookMiddleware<K>[];
  };
  tool?: {
    [K in ToolHookName]?: ToolHookMiddleware<K>[];
  };
  lifecycle?: EngineLifecycleHooks;
}

/**
 * Engine - Built with Procedures
 *
 * Key features:
 * - execute() and stream() are Procedures (via factory)
 * - Full type safety with .use(), .withHandle(), etc.
 * - Maintains feature parity with Engine v1
 */
export class Engine extends EventEmitter {
  // Static middleware support (like ProcedureBase, but we can't extend both EventEmitter and ProcedureBase)
  static middleware?: {
    execute?: Middleware<[EngineInput, ComponentDefinition?]>[];
    stream?: Middleware<[EngineInput, ComponentDefinition?]>[];
    "stream:chunk"?: Middleware<[any]>[];
  };
  public readonly id: string; // Required for telemetry span attributes
  private toolExecutor: ToolExecutor;
  private componentHooksRegistry: ComponentHookRegistry;
  private modelHooksRegistry: ModelHookRegistry;
  private toolHooksRegistry: ToolHookRegistry;
  private engineHooksRegistry: EngineHookRegistry;
  private lifecycleHooksRegistry: EngineLifecycleHookRegistry;
  private unregisteredLifecycleHooks: WeakSet<EngineLifecycleHook<EngineLifecycleHookName>> =
    new WeakSet();
  private mcpClient?: MCPClient;
  private mcpService?: MCPService;
  private _channelService?: ChannelService;
  private executionGraph: ExecutionGraph;
  private wrappedModelCache = new WeakMap<ModelInstance, ModelInstance>();
  private renderers: {
    [key: string]: Renderer;
  };
  /** DevTools configuration (false if disabled) */
  private devToolsConfig: DevToolsConfig | false;
  // Internal Procedure implementations
  // For execute: handler returns Promise<COMInput>, so TOutput = COMInput
  // For stream: handler returns AsyncIterable<EngineStreamEvent>, so TOutput = AsyncIterable<EngineStreamEvent>
  // Initialized in constructor via buildProcedures()
  private executeProc!: Procedure<
    (input: EngineInput, root?: ComponentDefinition) => Promise<COMInput>
  >;
  private streamProc!: Procedure<
    (input: EngineInput, root?: ComponentDefinition) => AsyncIterable<EngineStreamEvent>
  >;

  get model(): ModelInstance | undefined {
    return this.getWrappedModel();
  }

  get tools(): (ToolClass | ExecutableTool)[] {
    return this.getTools();
  }

  get hooks() {
    return Object.assign(this.engineHooks, {
      components: this.componentHooks,
      models: this.modelHooks,
      tools: this.toolHooks,
    });
  }

  get componentHooks(): ComponentHookRegistry {
    return this.componentHooksRegistry;
  }

  get modelHooks(): ModelHookRegistry {
    return this.modelHooksRegistry;
  }

  get toolHooks(): ToolHookRegistry {
    return this.toolHooksRegistry;
  }

  get engineHooks(): EngineHookRegistry {
    return this.engineHooksRegistry;
  }

  get lifecycleHooks(): EngineLifecycleHookRegistry {
    return this.lifecycleHooksRegistry;
  }

  /**
   * Get the channel service for external access (e.g., HTTP/SSE bridges).
   * Returns undefined if channels are not configured.
   */
  get channels(): ChannelService | undefined {
    return this._channelService;
  }

  // Expose Procedures directly
  // Procedures always return Promise<TOutput>
  // For execute: TOutput = COMInput, so await returns COMInput
  // For stream: TOutput = AsyncIterable<EngineStreamEvent>, so await returns AsyncIterable<EngineStreamEvent>
  get execute() {
    // Read hooks dynamically at call time to pick up hooks registered after construction
    const dynamicExecuteMw = this.engineHooks.getMiddleware("execute");
    if (dynamicExecuteMw.length > 0) {
      // Apply dynamic hooks on top of base procedure
      // Cast to correct type - hooks are typed as Middleware<any[]> but work with our procedure signature
      return this.executeProc.use(...(normalizeEngineMiddleware(dynamicExecuteMw) as any));
    }
    return this.executeProc;
  }

  get stream() {
    // Read hooks dynamically at call time to pick up hooks registered after construction
    const dynamicStreamMw = this.engineHooks.getMiddleware("stream");
    if (dynamicStreamMw.length > 0) {
      // Apply dynamic hooks on top of base procedure
      // Cast to correct type - hooks are typed as Middleware<any[]> but work with our procedure signature
      return this.streamProc.use(...(normalizeEngineMiddleware(dynamicStreamMw) as any));
    }
    return this.streamProc;
  }

  constructor(private config: EngineConfig = {}) {
    super();
    // Generate ID if not provided (required for telemetry span attributes)
    this.id = config.id || config.name || `engine_${randomUUID()}`;
    this.componentHooksRegistry = new ComponentHookRegistry();
    this.modelHooksRegistry = new ModelHookRegistry();
    this.toolHooksRegistry = new ToolHookRegistry();
    this.engineHooksRegistry = new EngineHookRegistry();
    this.lifecycleHooksRegistry = new EngineLifecycleHookRegistry();
    this.toolExecutor = new ToolExecutor(this.toolHooksRegistry);
    this.executionGraph = new ExecutionGraph();
    this.renderers = {
      markdown: new MarkdownRenderer(),
      xml: new XMLRenderer(),
      ...(config.renderers || {}),
    };

    // Initialize DevTools config (check env vars if not explicitly configured)
    const devToolsFromEnv = config.devTools === undefined ? getDevToolsConfigFromEnv() : undefined;
    this.devToolsConfig = normalizeDevToolsConfig(config.devTools ?? devToolsFromEnv);

    if (this.devToolsConfig && this.devToolsConfig.debug) {
      devToolsEmitter.setDebug(true);
      log.info("DevTools enabled", { config: this.devToolsConfig });
    }

    // Initialize MCP client/service if MCP servers are configured
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      this.mcpClient = new MCPClient();
      this.mcpService = new MCPService(this.mcpClient);
      this.connectMCPServers();
    }

    // Initialize channel service if configured
    if (config.channels) {
      if (config.channels instanceof ChannelService) {
        this._channelService = config.channels;
      } else {
        this._channelService = new ChannelService(config.channels);
      }
    }

    // Auto-register static hooks from Engine subclass
    this.registerStaticHooks();

    // Register lifecycle hooks from config
    if (config.lifecycleHooks) {
      this.registerLifecycleHooks(this, config.lifecycleHooks);
    }

    // Register static lifecycle hooks
    this.registerStaticLifecycleHooks();

    // Create procedures with only static middleware initially
    // Dynamic hooks (from registries) are read dynamically in the getters
    this.buildProcedures({ includeDynamic: false });

    // Call onInit hooks after initialization
    // Note: We don't await this - onInit hooks are side effects and shouldn't block construction
    // If hooks need to complete before engine is used, they should handle that internally
    this.callLifecycleHooks("onInit", [this]).catch((error) => {
      log.error({ err: error }, "Error in onInit hooks");
    });
  }

  addRenderer(name: string, renderer: Renderer): void {
    this.renderers[name] = renderer;
  }

  getRenderers(): { [key: string]: Renderer } {
    return this.renderers;
  }

  /**
   * Check if DevTools is enabled for this engine
   */
  get isDevToolsEnabled(): boolean {
    return this.devToolsConfig !== false && this.devToolsConfig.enabled !== false;
  }

  /**
   * Get the DevTools configuration (for fork/spawn inheritance)
   * @internal
   */
  getDevToolsConfig(): DevToolsConfig | false {
    return this.devToolsConfig;
  }

  /**
   * Emit a DevTools event.
   *
   * This is a no-op if DevTools is disabled. Events are emitted to the
   * singleton DevToolsEmitter which the DevTools UI subscribes to.
   *
   * @param event - Event to emit (timestamp will be added automatically)
   * @internal
   */
  protected emitDevToolsEvent(
    event: { type: string; executionId: string } & Record<string, unknown>,
  ): void {
    if (!this.devToolsConfig) return;

    const fullEvent = {
      ...event,
      timestamp: Date.now(),
      engineId: this.id,
    } as DevToolsEvent;

    if (this.devToolsConfig.remote && this.devToolsConfig.remoteUrl) {
      // Cross-process: POST to remote server
      this.postToRemoteDevTools(fullEvent);
    } else {
      // In-process: emit to singleton
      devToolsEmitter.emitEvent(fullEvent);
    }
  }

  /**
   * POST event to remote DevTools server
   * @internal
   */
  private async postToRemoteDevTools(event: DevToolsEvent): Promise<void> {
    if (!this.devToolsConfig || !this.devToolsConfig.remoteUrl) return;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.devToolsConfig.secret) {
        headers["Authorization"] = `Bearer ${this.devToolsConfig.secret}`;
      }

      await fetch(`${this.devToolsConfig.remoteUrl}/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
      });
    } catch (error) {
      // Silent failure - devtools is optional, don't break execution
      if (this.devToolsConfig.debug) {
        log.warn({ err: error }, "[DevTools] Failed to POST event");
      }
    }
  }

  /**
   * Internal execute implementation (called by Procedure)
   */
  private async executeInternal(input: EngineInput, root?: ComponentDefinition): Promise<COMInput> {
    // Get handle from context (created by handle factory)
    const ctx = Context.get();
    if (!ctx?.executionHandle) {
      throw new StateError(
        "missing",
        "present",
        "Execution handle not found in context",
        "STATE_NOT_READY",
      );
    }
    const handle = ctx.executionHandle as ExecutionHandleImpl;

    // Create the actual execute implementation
    const executeImpl = async (): Promise<COMInput> => {
      const rootElement = this.getRootElement(root);
      const iterator = this.iterateTicks(input, rootElement, false, handle, this._channelService);
      let lastComInput: COMInput | undefined;

      for await (const event of iterator) {
        if (event.type === "engine_error") {
          throw new Error(event.error.message);
        }
        if (event.type === "execution_end") {
          lastComInput = event.output as COMInput;
        }
      }

      // Check if handle was cancelled during execution (race condition check)
      if (handle.status === "cancelled") {
        throw new AbortError("Execution cancelled");
      }

      const result = lastComInput || {
        timeline: [],
        sections: {},
        tools: [],
        ephemeral: [],
        metadata: {},
        system: [],
      };
      handle.complete(result);
      const graphToUpdate = handle.executionGraphForStatus || this.executionGraph;
      if (graphToUpdate && typeof graphToUpdate.updateStatus === "function") {
        graphToUpdate.updateStatus(handle.pid, "completed");
      } else {
        this.executionGraph.updateStatus(handle.pid, "completed");
      }
      return result;
    };

    // Middleware is now applied at procedure creation time, not here
    // Just execute the implementation directly
    return executeImpl();
  }

  /**
   * Internal stream implementation (called by Procedure)
   */
  private async *streamInternal(
    input: EngineInput,
    root?: ComponentDefinition,
  ): AsyncIterable<EngineStreamEvent> {
    // Get handle from context (created by handle factory)
    const ctx = Context.get();
    if (!ctx?.executionHandle) {
      throw new StateError(
        "missing",
        "present",
        "Execution handle not found in context",
        "STATE_NOT_READY",
      );
    }
    const handle = ctx.executionHandle as ExecutionHandleImpl;

    const streamImpl = async function* (this: Engine): AsyncIterable<EngineStreamEvent> {
      const rootElement = this.getRootElement(root);
      const iterator = this.iterateTicks(input, rootElement, true, handle, this._channelService);

      // Set iterator on handle so handle.stream() works
      handle.setStreamIterator(iterator);

      let streamError: Error | undefined;
      try {
        for await (const event of iterator) {
          yield event;
        }
      } catch (error: any) {
        streamError = error instanceof Error ? error : new Error(String(error));
        const isAbort = isAbortError(error);
        if (isAbort) {
          handle.cancel();
          this.executionGraph.updateStatus(handle.pid, "cancelled", error);
        } else {
          handle.fail(streamError);
          this.executionGraph.updateStatus(handle.pid, "failed", error);
        }
        throw error;
      } finally {
        // Only mark as completed if no error occurred
        if (!streamError) {
          handle.complete({
            timeline: [],
            sections: {},
            tools: [],
            ephemeral: [],
            metadata: {},
            system: [],
          });
          const graphToUpdate = handle.executionGraphForStatus || this.executionGraph;
          if (graphToUpdate && typeof graphToUpdate.updateStatus === "function") {
            graphToUpdate.updateStatus(handle.pid, "completed");
          } else {
            this.executionGraph.updateStatus(handle.pid, "completed");
          }
        }
      }
    };

    // Middleware is now applied at procedure creation time, not here
    // Just execute the implementation directly
    yield* streamImpl.call(this);
  }

  private async connectMCPServers(): Promise<void> {
    if (!this.config.mcpServers || !this.mcpService) {
      return;
    }
    const clientPromises = Object.entries(this.config.mcpServers).map(
      async ([serverName, config]) => {
        try {
          const mcpConfig = normalizeMCPConfig(serverName, config);
          await this.mcpService!.connect(mcpConfig);
        } catch (error) {
          log.error({ err: error, serverName }, "Failed to initialize MCP server");
          // Continue with other servers even if one fails
        }
      },
    );

    await Promise.all(clientPromises);
  }

  /**
   * Get current execution PID from EngineContext (if available)
   */
  private getCurrentExecutionPid(): string | undefined {
    const ctx = Context.tryGet();
    if (ctx?.executionHandle && "pid" in ctx.executionHandle) {
      return (ctx.executionHandle as ExecutionHandle).pid;
    }
    return undefined;
  }

  /**
   * Get the tool executor for the engine.
   * @returns ToolExecutor
   */
  getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  /**
   * Register graceful shutdown hook for the engine.
   * Hooks are called when shutdown() is called, before aborting executions.
   *
   * @param handler Shutdown hook function
   * @returns Unsubscribe function
   */
  /**
   * Register onShutdown lifecycle hook.
   * @param handler Async function that receives the engine instance and optional reason
   * @returns Unregister function
   */
  onShutdown(handler: (engine: Engine, reason?: string) => Promise<void> | void): () => void {
    const procedure = createEngineProcedure(
      {
        name: "engine:onShutdown",
        metadata: {
          type: "engine",
          id: this.id,
          operation: "onShutdown",
        },
      },
      async (engine: Engine, reason?: string) => {
        await handler(engine, reason);
      },
    );
    this.lifecycleHooksRegistry.register("onShutdown", procedure);
    // Return unsubscribe function that marks hook as unregistered
    return () => {
      this.unregisteredLifecycleHooks.add(procedure);
    };
  }

  /**
   * Listen for signals at engine level.
   *
   * @param signal Signal type to listen for
   * @param handler Signal handler
   * @returns Unsubscribe function
   */
  onSignal(signal: SignalType, handler: (event: SignalEvent) => void): () => void {
    this.on(signal, handler);
    return () => this.off(signal, handler);
  }

  /**
   * Graceful shutdown of the engine.
   * - Runs shutdown hooks
   * - Aborts all running executions
   * - Emits shutdown signal
   *
   * @param reason Reason for shutdown
   */
  async shutdown(reason?: string): Promise<void> {
    // Emit shutdown signal
    this.emit("shutdown", {
      type: "shutdown",
      source: "engine",
      reason,
      timestamp: Date.now(),
    } as SignalEvent);

    // Call lifecycle hooks
    await this.callLifecycleHooks("onShutdown", [this, reason]);

    // Abort all running executions
    const activeExecutions = this.executionGraph.getActiveExecutions();
    for (const handle of activeExecutions) {
      handle.cancel(reason || "Engine shutdown");
    }

    // Wait for executions to complete cancellation
    await Promise.all(
      activeExecutions.map((handle) =>
        handle.waitForCompletion({ timeout: 1000 }).catch(() => {
          // Expected - executions are being cancelled
        }),
      ),
    );
  }

  /**
   * Clean up resources.
   * Call this when the engine is no longer needed.
   */
  destroy(): void {
    // Call lifecycle hooks before cleanup
    this.callLifecycleHooks("onDestroy", [this]).catch((error) => {
      log.error({ err: error }, "Error in onDestroy hooks");
    });

    // Destroy channel service (cleans up intervals and connections)
    if (this._channelService) {
      this._channelService.destroy();
    }

    // Clear all executions
    this.executionGraph.clear();
  }

  /**
   * Register static hooks defined on Engine subclass.
   * Called automatically in constructor.
   */
  private registerStaticHooks(): void {
    const engineClass = this.constructor as typeof Engine & {
      hooks?: EngineStaticHooks;
    };
    const staticHooks = engineClass.hooks;

    if (!staticHooks) {
      return;
    }

    this.registerHooks(this, staticHooks);
  }

  /**
   * Build execute and stream procedures with middleware.
   * @param includeDynamic Whether to include dynamic middleware from registries
   */
  private buildProcedures({ includeDynamic }: { includeDynamic: boolean }): void {
    const handleFactory = createEngineHandleFactory(this.executionGraph);

    // Get static middleware from class
    const staticExecuteMw = (this.constructor as typeof Engine).middleware?.execute || [];
    const staticStreamMw = (this.constructor as typeof Engine).middleware?.stream || [];

    // Get dynamic middleware from registries if requested
    const dynamicExecuteMw = includeDynamic ? this.engineHooks.getMiddleware("execute") : [];
    const dynamicStreamMw = includeDynamic ? this.engineHooks.getMiddleware("stream") : [];

    // Build execute procedure
    // Cast handleFactory for compatibility - createEngineProcedure expects HandleFactory<any> (KernelContext by default)
    const executeProcBase = createEngineProcedure(
      {
        name: "engine:execute",
        metadata: {
          type: "engine",
          id: this.id,
          operation: "execute",
        },
        handleFactory: handleFactory as HandleFactory<any>,
      },
      async (input: EngineInput, root?: ComponentDefinition): Promise<COMInput> => {
        return this.executeInternal(input, root);
      },
    ) as Procedure<(input: EngineInput, root?: ComponentDefinition) => Promise<COMInput>>;

    this.executeProc = applyRegistryMiddleware(
      executeProcBase,
      ...normalizeEngineMiddleware(staticExecuteMw),
      ...(includeDynamic ? normalizeEngineMiddleware(dynamicExecuteMw) : []),
    );

    // Build stream procedure
    const streamInternalBound = this.streamInternal.bind(this);
    // Cast handleFactory for compatibility - createEngineProcedure expects HandleFactory<any> (KernelContext by default)
    const streamProcBase = createEngineProcedure(
      {
        name: "engine:stream",
        metadata: {
          type: "engine",
          id: this.id,
          operation: "stream",
        },
        handleFactory: handleFactory as HandleFactory<any>,
      },
      async function* (
        input: EngineInput,
        root?: ComponentDefinition,
      ): AsyncIterable<EngineStreamEvent> {
        yield* streamInternalBound(input, root);
      },
    ) as Procedure<
      (input: EngineInput, root?: ComponentDefinition) => AsyncIterable<EngineStreamEvent>
    >;

    this.streamProc = applyRegistryMiddleware(
      streamProcBase,
      ...normalizeEngineMiddleware(staticStreamMw),
      ...(includeDynamic ? normalizeEngineMiddleware(dynamicStreamMw) : []),
    );
  }

  /**
   * Register hooks from EngineStaticHooks structure.
   * Used for both static hooks (from Engine subclass) and fork-specific hooks.
   *
   * @param targetEngine - The engine to register hooks on
   * @param hooks - The hooks structure to register
   */
  private registerHooks(targetEngine: Engine, hooks: EngineStaticHooks): void {
    // Register top-level engine hooks
    if (hooks.execute) {
      for (const mw of hooks.execute) {
        targetEngine.engineHooks.register("execute", mw);
      }
    }
    if (hooks.stream) {
      for (const mw of hooks.stream) {
        targetEngine.engineHooks.register("stream", mw);
      }
    }

    // Register component hooks
    if (hooks.component) {
      for (const [hookName, middleware] of Object.entries(hooks.component)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            targetEngine.componentHooks.register(hookName as ComponentHookName, mw);
          }
        }
      }
    }

    // Register model hooks
    if (hooks.model) {
      for (const [hookName, middleware] of Object.entries(hooks.model)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            targetEngine.modelHooks.register(hookName as ModelHookName, mw);
          }
        }
      }
    }

    // Register tool hooks
    if (hooks.tool) {
      for (const [hookName, middleware] of Object.entries(hooks.tool)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            targetEngine.toolHooks.register(hookName as ToolHookName, mw);
          }
        }
      }
    }

    // Register lifecycle hooks
    if (hooks.lifecycle) {
      this.registerLifecycleHooks(targetEngine, hooks.lifecycle);
    }
  }

  private registerLifecycleHook(
    targetEngine: Engine,
    hookName: EngineLifecycleHookName,
    hook: EngineLifecycleHook<EngineLifecycleHookName>,
  ): EngineLifecycleHook<EngineLifecycleHookName> {
    if (isProcedure(hook)) {
      // Hook is already a Procedure - register it directly
      targetEngine.lifecycleHooksRegistry.register(
        hookName as EngineLifecycleHookName,
        hook as EngineLifecycleHook<EngineLifecycleHookName>,
      );

      return hook as EngineLifecycleHook<EngineLifecycleHookName>;
    }

    // Hook is a plain function - wrap it in a Procedure with generic name and metadata
    const procedure = createEngineProcedure(
      {
        name: `engine:${hookName}`, // Generic span name
        metadata: {
          type: "engine",
          id: targetEngine.id, // Identifier in metadata
          operation: hookName,
        },
      },
      hook,
    );

    targetEngine.lifecycleHooksRegistry.register(
      hookName as EngineLifecycleHookName,
      procedure as EngineLifecycleHook<EngineLifecycleHookName>,
    );

    return procedure;
  }

  /**
   * Register lifecycle hooks from EngineLifecycleHooks structure.
   * Hooks in the config can be either Procedures or async functions.
   * If they're functions, we wrap them in Procedures.
   */
  private registerLifecycleHooks(targetEngine: Engine, hooks: EngineLifecycleHooks): void {
    for (const [hookName, hookArray] of Object.entries(hooks)) {
      if (hookArray && Array.isArray(hookArray)) {
        for (const hook of hookArray) {
          this.registerLifecycleHook(
            targetEngine,
            hookName as EngineLifecycleHookName,
            hook as EngineLifecycleHook<EngineLifecycleHookName>,
          );
        }
      }
    }
  }

  /**
   * Register static lifecycle hooks from Engine subclass.
   */
  private registerStaticLifecycleHooks(): void {
    const engineClass = this.constructor as typeof Engine & {
      lifecycle?: EngineLifecycleHooks;
    };
    const staticLifecycleHooks = engineClass.lifecycle;

    if (!staticLifecycleHooks) {
      return;
    }

    this.registerLifecycleHooks(this, staticLifecycleHooks);
  }

  /**
   * Create a lifecycle hook.
   * @param hookName - The name of the hook
   * @param handler - The handler function for the hook
   * @returns An unregister function
   */
  private createLifecycleHook<T extends EngineLifecycleHookName>(
    hookName: T,
    handler:
      | EngineLifecycleHook<T>
      | ((...args: EngineLifecycleHookArgs<T>) => Promise<void> | void),
  ): () => void {
    const procedure = this.registerLifecycleHook(
      this,
      hookName as EngineLifecycleHookName,
      handler as EngineLifecycleHook<EngineLifecycleHookName>,
    );
    return () =>
      this.unregisteredLifecycleHooks.add(
        procedure as EngineLifecycleHook<EngineLifecycleHookName>,
      );
  }

  /**
   * Call lifecycle hooks for a specific hook name.
   * Hooks are Procedures - call them directly.
   * Hooks are called sequentially and awaited.
   */
  private async callLifecycleHooks<T extends EngineLifecycleHookName>(
    hookName: T,
    args: EngineLifecycleHookArgs<T>,
  ): Promise<void> {
    const hooks = this.lifecycleHooksRegistry.getMiddleware(hookName);

    for (const hook of hooks) {
      // Skip unregistered hooks
      if (this.unregisteredLifecycleHooks.has(hook)) {
        continue;
      }

      try {
        // Hooks are Procedures - call them directly (they're callable functions)
        await hook(...args);
      } catch (error) {
        log.error({ err: error, hookName }, "Error in lifecycle hook");
        // Don't throw - lifecycle hooks are side effects only
      }
    }
  }

  /**
   * Register onInit lifecycle hook.
   * @param handler Async function that receives the engine instance
   * @returns Unregister function
   */
  onInit(handler: (engine: Engine) => Promise<void> | void): () => void {
    return this.createLifecycleHook("onInit", handler);
  }

  /**
   * Register onDestroy lifecycle hook.
   * @param handler Async function that receives the engine instance
   * @returns Unregister function
   */
  onDestroy(handler: (engine: Engine) => Promise<void> | void): () => void {
    return this.createLifecycleHook("onDestroy", handler);
  }

  /**
   * Register onExecutionStart lifecycle hook.
   * @param handler Async function that receives input, root, and handle
   * @returns Unregister function
   */
  onExecutionStart(
    handler: (
      input: EngineInput,
      root?: ComponentDefinition,
      handle?: ExecutionHandle,
    ) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onExecutionStart", handler);
  }

  /**
   * Register onExecutionEnd lifecycle hook.
   * @param handler Async function that receives output and handle
   * @returns Unregister function
   */
  onExecutionEnd(
    handler: (output: COMInput, handle?: ExecutionHandle) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onExecutionEnd", handler);
  }

  /**
   * Register onExecutionError lifecycle hook.
   * @param handler Async function that receives error and handle
   * @returns Unregister function
   */
  onExecutionError(
    handler: (error: Error, handle?: ExecutionHandle) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onExecutionError", handler);
  }

  /**
   * Register onTickStart lifecycle hook.
   * @param handler Async function that receives tick, state, and handle
   * @returns Unregister function
   */
  onTickStart(
    handler: (tick: number, state: TickState, handle?: ExecutionHandle) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onTickStart", handler);
  }

  /**
   * Register onTickEnd lifecycle hook.
   * @param handler Async function that receives tick, state, response, and handle
   * @returns Unregister function
   */
  onTickEnd(
    handler: (
      tick: number,
      state: TickState,
      response: EngineResponse,
      handle?: ExecutionHandle,
    ) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onTickEnd", handler);
  }

  /**
   * Register onAfterCompile lifecycle hook.
   * Called after JSX compilation, BEFORE structure is rendered to COMInput.
   * NOTE: compiled.tools will be empty here - use onAfterRender for tools.
   *
   * @param handler Async function that receives compiled, state, and handle
   * @returns Unregister function
   */
  onAfterCompile(
    handler: (
      compiled: CompiledStructure,
      state: TickState,
      handle?: ExecutionHandle,
    ) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onAfterCompile", handler);
  }

  /**
   * Register onAfterRender lifecycle hook.
   * Called after structure is rendered to COMInput, BEFORE model execution.
   * The formatted COMInput includes tools, timeline, system message, etc.
   *
   * @param handler Async function that receives formatted COMInput, state, and handle
   * @returns Unregister function
   */
  onAfterRender(
    handler: (
      formatted: COMInput,
      state: TickState,
      handle?: ExecutionHandle,
    ) => Promise<void> | void,
  ): () => void {
    return this.createLifecycleHook("onAfterRender", handler);
  }

  /**
   * Resolves a model from COM, config, or registry.
   * @param com Optional COM to get model from. If not provided, uses config.
   */
  private getRawModel(com?: COM): ModelInstance | undefined {
    // First check COM (set by Model component)
    if (com) {
      const comModel = com.getModel();
      if (comModel) {
        if (typeof comModel === "string") {
          const model = modelRegistry.get(comModel);
          if (!model) {
            throw new NotFoundError("model", comModel, "Model not found in registry");
          }
          return model;
        }
        return comModel;
      }
    }

    // Fall back to config model
    if (this.config.model) {
      if (typeof this.config.model === "string") {
        const model = modelRegistry.get(this.config.model);
        if (!model) {
          throw new NotFoundError("model", this.config.model, "Model not found in registry");
        }
        return model;
      }
      return this.config.model;
    }

    // No model configured
    return undefined;
  }

  /**
   * Gets the wrapped model with hooks applied.
   * Wraps once and caches the result per model instance.
   * @param com Optional COM to get model from.
   */
  private getWrappedModel(com?: COM): ModelInstance | undefined {
    const rawModel = this.getRawModel(com);
    if (!rawModel) {
      return undefined;
    }

    // Check cache first
    const cached = this.wrappedModelCache.get(rawModel);
    if (cached) {
      return cached;
    }

    // Wrap and cache
    const wrapped = this.wrapModel(rawModel);
    this.wrappedModelCache.set(rawModel, wrapped);
    return wrapped;
  }

  /**
   * Wraps model methods with hooks.
   * Note: generate and stream are already Procedures, so we add middleware via .use()
   */
  private wrapModel(model: ModelInstance): ModelInstance {
    const wrapped = Object.create(model);

    // Wrap fromEngineState (not a Procedure - create one with middleware)
    if (model.fromEngineState) {
      const original = model.fromEngineState.bind(model);
      const middleware = this.modelHooks.getMiddleware("fromEngineState");
      const modelId = model.metadata?.id || "unknown";
      if (middleware.length > 0) {
        wrapped.fromEngineState = applyRegistryMiddleware(
          createEngineProcedure(
            {
              name: "model:fromEngineState",
              metadata: {
                type: "model",
                id: modelId,
                operation: "fromEngineState",
              },
            },
            original,
          ),
          ...normalizeModelHookMiddleware(middleware),
        );
      } else {
        wrapped.fromEngineState = original;
      }
    }

    // Wrap generate (already a Procedure - add middleware via applyRegistryMiddleware)
    const generateMiddleware = this.modelHooks.getMiddleware("generate");
    if (generateMiddleware.length > 0) {
      // model.generate is a Procedure, use type-safe helper
      wrapped.generate = applyRegistryMiddleware(
        model.generate as Procedure<(input: ModelInput) => Promise<ModelOutput>>,
        ...normalizeModelHookMiddleware(generateMiddleware),
      );
    } else {
      wrapped.generate = model.generate;
    }

    // Wrap stream (already a Procedure - add middleware via applyRegistryMiddleware)
    const streamMiddleware = this.modelHooks.getMiddleware("stream");
    if (streamMiddleware.length > 0) {
      // model.stream is a Procedure, use type-safe helper
      wrapped.stream = applyRegistryMiddleware(
        model.stream as unknown as Procedure<(input: ModelInput) => AsyncIterable<StreamEvent>>,
        ...normalizeModelHookMiddleware(streamMiddleware),
      );
    } else {
      wrapped.stream = model.stream;
    }

    // Wrap toEngineState (not a Procedure - create one with middleware)
    if (model.toEngineState) {
      const original = model.toEngineState.bind(model);
      const middleware = this.modelHooks.getMiddleware("toEngineState");
      const modelId = model.metadata?.id || "unknown";
      if (middleware.length > 0) {
        wrapped.toEngineState = applyRegistryMiddleware(
          createEngineProcedure(
            {
              name: "model:toEngineState",
              metadata: {
                type: "model",
                id: modelId,
                operation: "toEngineState",
              },
            },
            original,
          ),
          ...normalizeModelHookMiddleware(middleware),
        );
      } else {
        wrapped.toEngineState = original;
      }
    }

    return wrapped;
  }

  /**
   * Resolves tools from the config or registry.
   */
  private getTools(): (ToolClass | ExecutableTool)[] {
    if (!this.config.tools) {
      return [];
    }
    return this.config.tools.map((t) => {
      if (typeof t === "string") {
        const tool = toolRegistry.get(t);
        if (!tool) {
          throw new NotFoundError("tool", t, "Tool not found in registry");
        }
        return tool;
      }
      return t;
    });
  }

  /**
   * Resolves the root element for execution.
   * Priority:
   * 1. Root passed to execute/stream (highest priority)
   * 2. Engine's default root component (from config)
   * 3. Empty Fragment (fallback)
   */
  private getRootElement(
    rootArg?: JSX.Element | ComponentDefinition | ComponentDefinition[],
  ): JSX.Element {
    // If root is provided, use it (overrides config root)
    if (rootArg !== undefined) {
      return ensureElement(rootArg);
    }

    // Fall back to Engine's default root component
    let root = this.config.root;
    const legacyComponents = this.config.components || [];

    if (legacyComponents.length > 0) {
      // Convert legacy components to elements
      const children = legacyComponents.map((c) => ensureElement(c));

      if (root) {
        // Merge config root with legacy components
        root = createElement(Fragment, {}, ensureElement(root), ...children);
      } else {
        root = createElement(Fragment, {}, ...children);
      }
    }

    if (!root) {
      // No root configured - return empty Fragment
      return createElement(Fragment, {});
    }

    // Ensure root is an Element (ensureElement always returns JSX.Element, never undefined)
    return ensureElement(root);
  }

  /**
   * Runs a task through the engine.
   * Ensures context is propagated.
   */
  async run<T>(
    task: (context: EngineContext) => Promise<T>,
    options?: Partial<EngineContext>,
  ): Promise<T> {
    const context = Context.create({
      ...options,
      metadata: {
        ...options?.metadata,
        engineName: this.config.name || "default",
      },
      channels: this._channelService, // Inject channel service into context
    });

    return Context.run(context, async () => {
      return task(Context.get());
    });
  }

  /**
   * Determine if a model error is recoverable.
   */
  private isRecoverableModelError(error: any): boolean {
    log.debug({ err: error }, "Checking if model error is recoverable");
    // Network errors are usually recoverable
    if (error.code === "ETIMEDOUT" || error.code === "ECONNRESET" || error.code === "ENOTFOUND") {
      return true;
    }

    // Rate limiting might be recoverable with backoff
    if (error.status === 429) {
      return true;
    }

    // Authentication errors are usually not recoverable without intervention
    if (error.status === 401 || error.status === 403) {
      return false;
    }

    // Default: assume recoverable for transient errors
    return false;
  }

  /**
   * Persist partial message from accumulated chunks.
   */
  private async persistPartialMessage(
    com: COM,
    chunks: unknown[],
    handle: ExecutionHandleImpl,
    tick: number,
    rootElement: JSX.Element,
    input: EngineInput,
    _previous?: COMInput,
  ): Promise<void> {
    if (!this.config.persistExecutionState || chunks.length === 0) {
      return;
    }

    try {
      // Try to extract text from chunks (model-specific)
      let partialText = "";
      for (const chunk of chunks) {
        if (chunk && typeof chunk === "object") {
          // Check for common chunk formats
          if ("delta" in chunk && typeof chunk.delta === "string") {
            partialText += chunk.delta;
          } else if ("text" in chunk && typeof chunk.text === "string") {
            partialText += chunk.text;
          } else if ("content" in chunk && Array.isArray(chunk.content)) {
            // Try to extract text from content array
            const content = chunk.content;
            for (const item of content) {
              if (item?.type === "text" && item?.text) {
                partialText += item.text;
              }
            }
          }
        }
      }

      // Only persist if we extracted some text
      if (partialText.trim().length > 0) {
        // Add partial message to COM timeline
        com.addTimelineEntry({
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: partialText,
                semantic: {
                  type: "preformatted",
                  preformatted: true,
                },
              },
            ],
          },
          metadata: {
            partial: true,
            interrupted: true,
            tick,
            chunkCount: chunks.length,
          },
        } as any);

        // Persist state with partial message
        const currentComInput = com.toInput();
        const state = handle.toState(
          rootElement as ComponentDefinition,
          input,
          tick,
          currentComInput,
        );
        await this.config.persistExecutionState(state);
      }
    } catch (error) {
      log.error({ err: error }, "Failed to persist partial message");
      // Don't throw - abort should still proceed
    }
  }

  /**
   * Core tick loop - executes the root component across multiple ticks
   * Ported from Engine v1 - maintains full feature parity
   */
  private async *iterateTicks(
    input: EngineInput,
    rootElement: JSX.Element,
    streamModel: boolean,
    handle: ExecutionHandleImpl,
    channelService?: ChannelService,
  ): AsyncGenerator<EngineStreamEvent> {
    // Setup abort signal listeners
    let shouldAbort = false;
    let abortListener: ((event: any) => void) | undefined;
    let contextSignalListener: (() => void) | undefined;

    // Listen to handle abort signals
    // The event listener will catch all aborts, including:
    // 1. Aborts from handle.cancel()
    // 2. Aborts from handle.emitSignal('abort')
    // 3. Aborts from controller.signal.abort() (via setCancelController listener)
    // The listener is set up synchronously at the start of iterateTicks, so there's minimal
    // window for missed events. If emitSignal('abort') is called before iterateTicks starts,
    // the event will be emitted but the listener won't catch it. We check wasAbortEmitted()
    // to catch this case, but only if the handle is still running to avoid false positives.
    if (handle) {
      const implHandle = handle;

      // Set up the listener FIRST so we catch any abort events that fire during this setup
      abortListener = () => {
        shouldAbort = true;
      };
      implHandle.on("abort", abortListener);

      // Check if abort was already emitted before iterateTicks started (before listeners were set up)
      // This catches cases where emitSignal('abort') was called before iterateTicks began execution
      // Only check if handle is still running to avoid false positives from cancelled handles
      if (implHandle.status === "running" && implHandle.wasAbortEmitted?.()) {
        shouldAbort = true;
      }

      // Mark that listeners are set up (prevents _abortEmitted from being set in future emitSignal calls)
      implHandle.markListenersSetup?.();
    }

    // Listen to abort signal from ExecutionHandle (not Context)
    // Signal ownership: ExecutionHandle owns signal lifecycle, Context is for cross-cutting concerns only
    const handleSignal = handle.getCancelSignal();
    if (handleSignal) {
      if (handleSignal.aborted) {
        shouldAbort = true;
      } else {
        contextSignalListener = () => {
          shouldAbort = true;
        };
        handleSignal.addEventListener("abort", contextSignalListener);
      }
    }

    // Also check Context signal for external aborts (e.g., from user code)
    // But ExecutionHandle signal takes precedence
    const ctx = Context.tryGet();
    if (ctx?.signal && ctx.signal !== handleSignal) {
      if (ctx.signal.aborted) {
        shouldAbort = true;
      } else {
        const externalSignalListener = () => {
          shouldAbort = true;
        };
        ctx.signal.addEventListener("abort", externalSignalListener);
      }
    }

    // Track session and channel subscription for cleanup in finally block
    let session: CompileSession | undefined;
    let channelUnsubscribe: (() => void) | undefined;

    try {
      // Call onExecutioonStart hook
      // Call onExecutionStart hook (Engine lifecycle - errors are caught by outer try/catch)
      await this.callLifecycleHooks("onExecutionStart", [
        input,
        rootElement as ComponentDefinition,
        handle,
      ]);

      // Create compile service with Engine's configuration
      const compileService = new CompileJSXService({
        tools: this.getTools(),
        mcpServers: this.config.mcpServers,
        channels: channelService ?? this._channelService,
        renderers: this.getRenderers(),
        // Only pass hook registries that the service actually uses
        // Model, tool, and engine hooks are Engine concerns (handled by Engine directly)
        hookRegistries: {
          components: this.componentHooksRegistry,
          lifecycle: this.lifecycleHooksRegistry,
        },
        modelGetter: (com) => this.getRawModel(com),
        abortChecker: () => shouldAbort,
        processMethods: {
          fork: (forkInput, root, options) => {
            return this.fork(
              root || rootElement,
              forkInput,
              options
                ? {
                    parentPid: options.parentPid,
                    inherit: options.inherit,
                    engineConfig: options.engineConfig,
                  }
                : undefined,
            );
          },
          spawn: (spawnInput, root, options) => {
            return this.spawn(
              root || rootElement,
              spawnInput,
              options
                ? {
                    engineConfig: options.engineConfig,
                  }
                : undefined,
            );
          },
          signal: (pid, signal, reason) => {
            const targetHandle = this.executionGraph.getHandle(pid);
            if (targetHandle) {
              targetHandle.emitSignal(signal, reason);
            }
          },
          kill: (pid, reason) => {
            const targetHandle = this.executionGraph.getHandle(pid);
            if (targetHandle) {
              targetHandle.cancel(reason);
            }
          },
          list: () => {
            const currentPid = handle?.pid;
            if (currentPid) {
              return this.executionGraph.getOutstandingForks(currentPid);
            }
            return this.executionGraph.getActiveExecutions();
          },
          get: (pid) => {
            return this.executionGraph.getHandle(pid);
          },
        } as COM["process"],
      });

      // Create long-lived session (replaces setup + tick loop state management)
      // Session internally manages: COM, compiler, structureRenderer, tick, previous, current
      session = await compileService.createSession({
        input,
        rootElement,
        handle,
        maxTicks: this.config.maxTicks || 10,
      });

      // Wire session to handle for message sending
      if (handle && "setSession" in handle) {
        (handle as any).setSession(session);
      }

      // Subscribe to channel events targeting this execution
      // This enables sending messages to running executions via channels (e.g., HTTP/SSE)
      //
      // Routing: Messages are routed by sessionId (implicit via channel subscription).
      // Optionally, targetPid can be specified to target a specific execution within a session
      // (useful when multiple executions run concurrently in the same session).
      if (channelService && handle) {
        const ctx = Context.tryGet();
        if (ctx) {
          // Subscribe to 'execution' channel for message events
          // The subscription is already scoped to this session via channelService.subscribe()
          channelUnsubscribe = channelService.subscribe(ctx, "execution", async (event) => {
            // Handle message events for this session
            if (event.type === "message" && session) {
              // Check if targetPid is specified - if so, only handle if it matches
              // If no targetPid, accept all messages for this session
              const targetPid = event.metadata?.["targetPid"] || (event.payload as any)?.targetPid;
              if (targetPid && targetPid !== handle.pid) {
                return; // Skip - message is for a different execution in this session
              }

              try {
                await session.sendMessage({
                  type: (event.payload as any)?.type || "channel",
                  content: (event.payload as any)?.content ?? event.payload,
                });
              } catch (err) {
                log.error({ err, pid: handle.pid }, "Error processing channel message");
              }
            }
          });
        }
      }

      // Emit execution_start (replaces legacy agent_start)
      // sessionId can come from top level OR metadata
      const sessionId = (input.metadata?.sessionId as string | undefined) || input.sessionId;
      yield {
        type: "execution_start",
        ...createEventBase(1),
        executionId: handle.pid,
        componentName: this.config.name || "engine",
        sessionId,
        metadata: input.metadata,
      } as EngineStreamEvent;

      // Emit DevTools execution_start event
      // Try to get agent name from: 1) config.name, 2) root component name, 3) "Engine"
      const componentName =
        typeof rootElement.type === "function"
          ? rootElement.type.name || (rootElement.type as any).displayName
          : typeof rootElement.type === "string"
            ? rootElement.type
            : undefined;
      const agentName = this.config.name || componentName || "Engine";
      this.emitDevToolsEvent({
        type: "execution_start",
        executionId: handle.pid,
        agentName,
        sessionId,
        executionType: handle.parentPid ? (handle.type === "fork" ? "fork" : "spawn") : "root",
        parentExecutionId: handle.parentPid,
        rootExecutionId: handle.rootPid,
      });

      // Check abort flag immediately after setup (before entering tick loop)
      if (shouldAbort) {
        throw new AbortError();
      }

      const maxTicks = this.config.maxTicks || 10;

      try {
        // === TICK LOOP (Session-based) ===
        // Session manages: tick, previous, current, COM, compiler
        // Engine handles: model execution, tool execution, events, lifecycle hooks

        while (session.shouldContinue() && session.tick <= maxTicks) {
          // Check abort flag (set by signal listeners or COM.abort())
          if (shouldAbort || session.com.shouldAbort) {
            await this.persistExecutionState(
              handle,
              rootElement,
              input,
              session.tick,
              session.previous,
            );
            throw new AbortError(session.com.abortReason || "Operation aborted");
          }

          yield createTickStartEvent(session.tick);

          // Emit DevTools tick_start event
          this.emitDevToolsEvent({
            type: "tick_start",
            executionId: handle.pid,
            tick: session.tick,
          });

          // 1. Pre-model compilation (Session handles internally)
          let compilationResult;
          try {
            compilationResult = await session.compileTick();
          } catch (error: any) {
            if (error.name === "AbortError") {
              throw error;
            }
            throw error;
          }

          const {
            formatted,
            model: compilationModel,
            modelInput: compilationModelInput,
            shouldStop,
            stopReason: _compilationStopReason,
          } = compilationResult;

          // Emit DevTools compiled event with context sent to model
          // Extract system prompt text from COMTimelineEntry[] structure
          let systemForDevTools: unknown = formatted.system;
          if (Array.isArray(formatted.system)) {
            // formatted.system is COMTimelineEntry[] - extract text content
            const systemTexts: string[] = [];
            for (const entry of formatted.system) {
              if (entry && typeof entry === "object" && "message" in entry) {
                const message = entry.message as { content?: unknown[] };
                if (Array.isArray(message?.content)) {
                  for (const block of message.content) {
                    if (
                      block &&
                      typeof block === "object" &&
                      "type" in block &&
                      block.type === "text" &&
                      "text" in block
                    ) {
                      systemTexts.push(String(block.text));
                    }
                  }
                }
              } else if (typeof entry === "string") {
                systemTexts.push(entry);
              }
            }
            systemForDevTools =
              systemTexts.length > 0 ? systemTexts.join("\n\n") : formatted.system;
          }
          this.emitDevToolsEvent({
            type: "compiled",
            executionId: handle.pid,
            tick: session.tick,
            messages: formatted.timeline || [],
            tools: formatted.tools || [],
            system: systemForDevTools,
          });

          // Handle compilation stop request (from TickState.stop() callback)
          if (shouldStop) {
            break;
          }

          // 2. Model Execution (Engine's responsibility)
          let response: EngineResponse;
          // Track tool_call events emitted by the adapter to avoid duplicates
          const emittedToolCallIds = new Set<string>();
          try {
            // Use model and modelInput from compilation if available
            let model: ModelInstance | undefined;
            let modelInput: ModelInput | undefined;

            if (compilationModel && compilationModelInput) {
              model = this.getWrappedModel(session.com) || compilationModel;
              modelInput = compilationModelInput;
            } else {
              model = this.getWrappedModel(session.com);
              if (!model) {
                throw new ValidationError(
                  "model",
                  "No model configured. Add a <Model> component or configure model in EngineConfig.",
                );
              }
              modelInput = model.fromEngineState
                ? await model.fromEngineState(formatted)
                : (formatted as unknown as ModelInput);
            }

            if (!model) {
              throw new ValidationError(
                "model",
                "No model configured. Add a <Model> component or configure model in EngineConfig.",
              );
            }

            if (shouldAbort) {
              throw new AbortError();
            }

            // Emit model_start to DevTools
            const modelMetadata = model.metadata;
            this.emitDevToolsEvent({
              type: "model_start",
              executionId: handle.pid,
              tick: session.tick,
              modelId: modelMetadata?.id || "unknown",
              provider: modelMetadata?.provider,
            });

            Context.emit("tick:model:request", {
              tick: session.tick,
              input: modelInput,
            });

            // Execute model (with streaming support)
            let modelOutput: unknown;
            if (streamModel && model.stream) {
              const rawResult = model.stream(modelInput);
              let iterable: AsyncIterable<unknown>;

              if (isAsyncIterable(rawResult)) {
                iterable = rawResult;
              } else {
                const resolved = await rawResult;
                if (isAsyncIterable(resolved)) {
                  iterable = resolved;
                } else {
                  iterable = {
                    async *[Symbol.asyncIterator]() {
                      yield resolved;
                    },
                  };
                }
              }

              const chunks: unknown[] = [];
              for await (const chunk of iterable) {
                if (shouldAbort || session.com.shouldAbort) {
                  await this.persistPartialMessage(
                    session.com,
                    chunks,
                    handle!,
                    session.tick,
                    rootElement,
                    input,
                    session.previous,
                  );
                  throw new AbortError(
                    session.com.abortReason || "Operation aborted during model streaming",
                  );
                }

                // Pass through model stream events directly
                // Add base fields if not present (adapters may emit legacy StreamChunk)
                const streamEvent = {
                  ...(chunk as object),
                  id: (chunk as any).id || createEventBase(session.tick).id,
                  tick: (chunk as any).tick ?? session.tick,
                  timestamp: (chunk as any).timestamp || new Date().toISOString(),
                } as EngineStreamEvent;

                // Track tool_call events from the adapter
                if ((chunk as any).type === "tool_call" && (chunk as any).callId) {
                  emittedToolCallIds.add((chunk as any).callId);
                }

                yield streamEvent;
                chunks.push(chunk);
              }

              if (!model.processStream) {
                throw new ValidationError(
                  "model.processStream",
                  "Model does not implement processStream for streaming responses.",
                );
              }
              modelOutput = await model.processStream(chunks as StreamEvent[]);
            } else {
              const result = await model.generate(modelInput);
              if (isAsyncIterable(result)) {
                throw new ValidationError(
                  "model.generate",
                  "Model generate method returned an async iterable. Use stream() instead.",
                );
              }
              modelOutput = result;
            }

            if (!model.toEngineState) {
              throw new ValidationError(
                "model.toEngineState",
                "Model must implement toEngineState to convert outputs.",
              );
            }
            response = await model.toEngineState(modelOutput as ModelOutput);

            if (shouldAbort) {
              throw new AbortError();
            }
          } catch (error: any) {
            const isAbort = isAbortError(error);
            if (isAbort) {
              await this.persistExecutionState(
                handle,
                rootElement,
                input,
                session.tick,
                session.previous,
              );
              throw error;
            }

            // Use session's notifyError for recovery
            const recovery = await session.notifyError(
              error instanceof Error ? error : new Error(String(error)),
              "model_execution",
              {
                tick: session.tick,
                model: this.getRawModel(session.com)?.metadata.id || "unknown",
              },
            );

            if (recovery?.continue) {
              response = {
                shouldStop: false,
                newTimelineEntries: [],
              };
            } else {
              throw error;
            }
          }

          Context.emit("tick:model:response", { tick: session.tick, response });

          // 3. Tool Execution (Engine's responsibility)
          let toolResults: AgentToolResult[] = response.executedToolResults || [];

          // Yield events for already-executed tools (from provider/adapter)
          for (const result of toolResults) {
            // Emit to DevTools
            this.emitDevToolsEvent({
              type: "tool_result",
              executionId: handle.pid,
              tick: session.tick,
              toolUseId: result.toolUseId,
              result: result.content,
              isError: !result.success,
            });

            yield createToolResultEvent({
              callId: result.toolUseId,
              name: result.name,
              result: result.content,
              isError: !result.success,
              executedBy: result.executedBy || "adapter",
              tick: session.tick,
              startedAt: new Date().toISOString(), // Not tracked for provider-executed
            });
          }

          if (response.toolCalls && response.toolCalls.length > 0) {
            if (shouldAbort) {
              throw new AbortError();
            }

            try {
              const configTools = this.getTools();

              // Yield tool_call events for calls not already emitted by the adapter
              // Track start times for each call
              const callStartTimes = new Map<string, string>();
              let blockIndex = 0;
              for (const call of response.toolCalls) {
                const startedAt = new Date().toISOString();
                callStartTimes.set(call.id, startedAt);
                // Skip if already emitted by the adapter during streaming
                if (!emittedToolCallIds.has(call.id)) {
                  // Emit to DevTools
                  this.emitDevToolsEvent({
                    type: "tool_call",
                    executionId: handle.pid,
                    tick: session.tick,
                    toolName: call.name,
                    toolUseId: call.id,
                    input: call.input,
                  });

                  yield createToolCallEvent({
                    callId: call.id,
                    name: call.name,
                    input: call.input as Record<string, unknown>,
                    blockIndex: blockIndex++,
                    tick: session.tick,
                    startedAt,
                  });
                }
              }

              // Collect events that occur during parallel processing
              // Events are stored per-tool to maintain order within each tool's flow
              type ToolProcessingEvent =
                | {
                    type: "tool_confirmation_required";
                    call: AgentToolCall;
                    message: string;
                  }
                | {
                    type: "tool_confirmation_result";
                    confirmation: ToolConfirmationResult;
                    call: AgentToolCall;
                  };

              const toolEvents: Map<string, ToolProcessingEvent[]> = new Map();

              // Capture session.com for use in async callbacks (TypeScript narrowing)
              const com = session.com;

              // Process all tools in parallel - each tool independently handles
              // its confirmation flow (if needed) and execution
              const processingResults = await Promise.all(
                response.toolCalls.map(async (call) => {
                  const events: ToolProcessingEvent[] = [];
                  toolEvents.set(call.id, events);

                  const {
                    result,
                    confirmCheck,
                    confirmation: _confirmation,
                  } = await this.toolExecutor.processToolWithConfirmation(call, com, configTools, {
                    onConfirmationRequired: async (call, message) => {
                      events.push({
                        type: "tool_confirmation_required",
                        call,
                        message,
                      });
                    },
                    onConfirmationResult: async (confirmation, call) => {
                      events.push({
                        type: "tool_confirmation_result",
                        confirmation,
                        call,
                      });
                      // Call lifecycle hooks for confirmation
                      await this.callLifecycleHooks("onToolConfirmation", [
                        confirmation,
                        call,
                        handle,
                      ]);
                    },
                  });

                  // Mark as executed by engine
                  result.executedBy = "engine";

                  // Call lifecycle hooks for client tool results
                  if (
                    confirmCheck?.tool?.metadata?.type === ToolExecutionType.CLIENT &&
                    confirmCheck?.tool?.metadata?.requiresResponse === true
                  ) {
                    await this.callLifecycleHooks("onClientToolResult", [result, call, handle]);
                  }

                  return { call, result, events };
                }),
              );

              if (shouldAbort) {
                throw new AbortError();
              }

              // Yield all collected events and results in order
              // We yield events per-tool to maintain the logical flow:
              // confirmation_required -> confirmation_result -> tool_result
              for (const { call, result, events } of processingResults) {
                // Yield confirmation events for this tool
                for (const event of events) {
                  if (event.type === "tool_confirmation_required") {
                    yield createToolConfirmationRequiredEvent({
                      callId: event.call.id,
                      name: event.call.name,
                      input: event.call.input as Record<string, unknown>,
                      message: event.message,
                      tick: session.tick,
                    });
                  } else if (event.type === "tool_confirmation_result") {
                    yield createToolConfirmationResultEvent({
                      callId: event.call.id,
                      confirmed: event.confirmation.confirmed,
                      always: event.confirmation.always,
                      tick: session.tick,
                    });
                  }
                }

                // Add to results array
                toolResults.push(result);

                // Emit to DevTools
                this.emitDevToolsEvent({
                  type: "tool_result",
                  executionId: handle.pid,
                  tick: session.tick,
                  toolUseId: result.toolUseId,
                  result: result.content,
                  isError: !result.success,
                });

                // Yield tool_result event
                yield createToolResultEvent({
                  callId: result.toolUseId,
                  name: result.name,
                  result: result.content,
                  isError: !result.success,
                  executedBy: result.executedBy || "engine",
                  tick: session.tick,
                  startedAt: callStartTimes.get(call.id) || new Date().toISOString(),
                });
              }

              if (shouldAbort) {
                throw new AbortError();
              }
            } catch (error: any) {
              const isAbort = isAbortError(error);
              if (isAbort) {
                await this.persistExecutionState(
                  handle,
                  rootElement,
                  input,
                  session.tick,
                  session.previous,
                );
                throw error;
              }

              // Use session's notifyError for recovery
              const recovery = await session.notifyError(
                error instanceof Error ? error : new Error(String(error)),
                "tool_execution",
                { toolCalls: response.toolCalls },
              );

              if (!recovery?.continue) {
                throw error;
              }
              // Continue with only already-executed results
            }
          }

          // 4. Post-model state injection (Session handles component lifecycle)
          let _tickResult;
          try {
            _tickResult = await session.ingestTickResult({
              response,
              toolResults,
            });
          } catch (error: any) {
            const isAbort = isAbortError(error);
            if (isAbort) {
              await this.persistExecutionState(
                handle,
                rootElement,
                input,
                session.tick,
                session.previous,
              );
              throw error;
            }
            // Session couldn't recover - rethrow
            throw error;
          }

          // tick_end with usage stats and new timeline entries (for persistence)
          yield createTickEndEvent(session.tick, response.usage, response.newTimelineEntries);

          // Emit DevTools tick_end event
          this.emitDevToolsEvent({
            type: "tick_end",
            executionId: handle.pid,
            tick: session.tick,
            usage: response.usage,
            stopReason: response.stopReason?.reason || response.stopReason,
            model: this.getRawModel(session.com)?.metadata?.id,
          });

          // Note: onTickEnd lifecycle hook is called by session.ingestTickResult()
          // for consistency with onTickStart being called by session.compileTick()

          if (shouldAbort) {
            throw new AbortError();
          }

          // 6. Advance to next tick
          session.advanceTick();

          if (handle) {
            (handle as ExecutionHandleImpl).incrementTick();
          }

          await this.persistExecutionState(
            handle,
            rootElement,
            input,
            session.tick - 1,
            session.previous,
          );

          if (shouldAbort) {
            throw new AbortError();
          }
        }

        // === COMPLETION ===
        if (shouldAbort) {
          await this.persistExecutionState(
            handle,
            rootElement,
            input,
            session.tick,
            session.previous,
          );
          throw new AbortError();
        }

        // Session handles notifyComplete internally
        const finalOutput = await session.complete();

        if (shouldAbort) {
          throw new AbortError();
        }

        // Emit execution_end (replaces legacy agent_end)
        yield {
          type: "execution_end",
          ...createEventBase(session.tick),
          executionId: handle.pid,
          output: finalOutput,
          sessionId: (input.metadata?.sessionId as string | undefined) || input.sessionId,
          metadata: input.metadata,
        } as EngineStreamEvent;

        // Emit DevTools execution_end event
        this.emitDevToolsEvent({
          type: "execution_end",
          executionId: handle.pid,
          totalUsage: (finalOutput as any)?.metadata?.totalUsage || {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
          finalState: "completed",
        });

        await this.callLifecycleHooks("onExecutionEnd", [finalOutput, handle]);
      } catch (error: any) {
        const isAbort = isAbortError(error);

        if (isAbort && session) {
          await this.persistExecutionState(
            handle,
            rootElement,
            input,
            session.tick,
            session.previous,
          );
        }

        if (isAbort && handle) {
          handle.cancel();
          this.executionGraph.updateStatus(handle.pid, "cancelled", error);
        }

        yield createEngineErrorEvent(error, session?.tick || 1);

        // Emit DevTools execution_end with error state
        this.emitDevToolsEvent({
          type: "execution_end",
          executionId: handle.pid,
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finalState: isAbort ? "cancelled" : "error",
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { name: "Error", message: String(error) },
        });

        await this.callLifecycleHooks("onExecutionError", [
          error instanceof Error ? error : new Error(String(error)),
          handle,
        ]);
        return;
      }
    } catch (error: any) {
      const isAbort = isAbortError(error);

      if (isAbort && handle) {
        handle.cancel();
        this.executionGraph.updateStatus(handle.pid, "cancelled", error);
      }

      yield createEngineErrorEvent(error, 1);

      await this.callLifecycleHooks("onExecutionError", [
        error instanceof Error ? error : new Error(String(error)),
        handle,
      ]);
      return;
    } finally {
      // Cleanup abort signal listeners
      if (handle && abortListener) {
        handle.off("abort", abortListener);
      }
      if (contextSignalListener) {
        const handleSignal = handle.getCancelSignal();
        if (handleSignal) {
          handleSignal.removeEventListener("abort", contextSignalListener);
        }
      }

      // Cleanup channel subscription
      if (channelUnsubscribe) {
        channelUnsubscribe();
      }

      // Session handles compiler unmount
      if (session) {
        try {
          await session.unmount();
        } catch (error: any) {
          const isAbort = isAbortError(error);
          if (!isAbort) {
            throw error;
          }
        }
      }
    }
  }

  /**
   * Prepare input with inherited state from parent
   */
  private prepareInheritedInput(
    input: EngineInput,
    parentHandle: ExecutionHandle,
    inherit?: ForkInheritanceOptions,
  ): EngineInput {
    if (!inherit) {
      return input;
    }

    const parentResult = parentHandle.getResult();
    if (!parentResult) {
      return input;
    }

    const inherited: EngineInput = { ...input };

    // Inherit timeline
    if (inherit.timeline === "copy" && parentResult.timeline) {
      inherited.timeline = [
        ...(inherited.timeline || []),
        ...JSON.parse(JSON.stringify(parentResult.timeline)),
      ];
    } else if (inherit.timeline === "reference" && parentResult.timeline) {
      inherited.timeline = [...(inherited.timeline || []), ...parentResult.timeline];
    }

    // Inherit sections
    if (inherit.sections === "copy" && parentResult["sections"]) {
      inherited["sections"] = JSON.parse(JSON.stringify(parentResult["sections"]));
    } else if (inherit.sections === "reference" && parentResult["sections"]) {
      inherited["sections"] = parentResult["sections"];
    }

    return inherited;
  }

  /**
   * Prepare inherited EngineContext from parent execution
   */
  private prepareInheritedContext(
    options:
      | ({
          inherit?: ForkInheritanceOptions;
        } & Partial<Omit<EngineContext, "channels">> & {
            channels?: ChannelServiceConfig;
          })
      | undefined,
    _parentHandle: ExecutionHandle,
  ): Partial<Omit<EngineContext, "channels">> {
    const inherit = options?.inherit;
    const { channels: _channelsConfig, ...restOptions } = options || {};
    const inherited: Partial<Omit<EngineContext, "channels">> = {
      ...restOptions,
    };

    const parentContext = Context.tryGet();

    // Inherit traceId
    if (inherit?.traceId && parentContext?.traceId) {
      inherited.traceId = parentContext.traceId;
    }

    // Inherit context properties (metadata, user, traceId, etc.)
    // BUT: Don't inherit signal from parent context if parent has completed
    // The signal will be set explicitly via mergedSignal in runForkExecution
    if (inherit?.context && parentContext) {
      inherited.metadata = { ...parentContext.metadata };
      inherited.user = parentContext.user;
      if (!inherited.traceId) {
        inherited.traceId = parentContext.traceId;
      }
      // Explicitly exclude signal - it will be set via mergedSignal
      // This prevents inheriting an aborted signal from the parent's context
      inherited.signal = undefined;
    }

    inherited.requestId = undefined;

    return inherited;
  }

  /**
   * Spawn a new independent execution.
   */
  spawn(
    root: JSX.Element | ComponentDefinition | ComponentDefinition[],
    input: EngineInput,
    options?: {
      engineClass?: typeof Engine;
      engineConfig?: Partial<EngineConfig>;
    } & Partial<Omit<EngineContext, "channels">> & {
        channels?: ChannelServiceConfig;
      },
  ): ExecutionHandle {
    const pid = generatePid("spawn");
    const rootPid = pid;

    const EngineClass = options?.engineClass || (this.constructor as typeof Engine);

    // Handle devTools inheritance
    const shouldInheritDevTools =
      this.devToolsConfig !== false && this.devToolsConfig.inheritOnSpawn !== false;
    const devToolsOverride = shouldInheritDevTools ? {} : { devTools: false as const };

    const childEngine = new EngineClass({
      ...this.config,
      ...devToolsOverride,
      ...options?.engineConfig,
    });

    const handle = new ExecutionHandleImpl(
      pid,
      rootPid,
      "spawn",
      undefined,
      undefined,
      this.executionGraph,
    );
    handle.setExecutionGraph(this.executionGraph);
    handle.setExecutionGraphForStatus(this.executionGraph);

    this.executionGraph.register(handle);

    this.runForkSpawnExecution(childEngine, handle, root, input, options)
      .catch((error) => {
        handle.fail(error);
        this.executionGraph.updateStatus(pid, "failed", error);
        childEngine.destroy();
      })
      .then(() => {
        if (handle.status !== "running") {
          childEngine.destroy();
        }
      });

    return handle;
  }

  /**
   * Fork a new execution with inherited state from parent.
   */
  fork(
    root: JSX.Element | ComponentDefinition | ComponentDefinition[],
    input: EngineInput,
    options?: {
      parentPid?: string;
      inherit?: ForkInheritanceOptions;
      engineClass?: typeof Engine;
      engineConfig?: Partial<EngineConfig>;
      hooks?: EngineStaticHooks;
    } & Partial<Omit<EngineContext, "channels">> & {
        channels?: ChannelServiceConfig;
      },
  ): ExecutionHandle {
    const parentPid = options?.parentPid || this.getCurrentExecutionPid();
    if (!parentPid) {
      throw new StateError(
        "no_parent",
        "running",
        "Cannot fork: no parent execution found. Provide parentPid or call fork from within an execution context.",
      );
    }

    const parentHandle = this.executionGraph.getHandle(parentPid);
    if (!parentHandle) {
      throw new NotFoundError("execution", parentPid, "Parent execution not found");
    }

    const EngineClass = options?.engineClass || (this.constructor as typeof Engine);
    const shouldInheritHooks = options?.inherit?.hooks !== false;
    const shouldInheritModel = options?.inherit?.model !== false;

    // Get parent's model if inheriting
    let inheritedModel: EngineConfig["model"] | undefined;
    if (shouldInheritModel) {
      const parentCom = (parentHandle as ExecutionHandleImpl).getComInstance?.();
      if (parentCom) {
        inheritedModel = parentCom.getModel();
      }
    }

    // Handle devTools inheritance
    const shouldInheritDevTools =
      this.devToolsConfig !== false && this.devToolsConfig.inheritOnFork !== false;
    const devToolsOverride = shouldInheritDevTools ? {} : { devTools: false as const };

    // Build child engine config - exclude lifecycle hooks if not inheriting
    const childConfig: EngineConfig = {
      ...this.config,
      ...devToolsOverride,
      ...options?.engineConfig,
      // Inherit model from parent if not explicitly set in engineConfig
      ...(inheritedModel && !options?.engineConfig?.model ? { model: inheritedModel } : {}),
    };

    // If not inheriting hooks, exclude lifecycle hooks from parent config
    if (!shouldInheritHooks && this.config.lifecycleHooks) {
      delete childConfig.lifecycleHooks;
    }

    const childEngine = new EngineClass(childConfig);

    if (shouldInheritHooks) {
      childEngine.componentHooksRegistry.copyHooksFrom(this.componentHooksRegistry);
      childEngine.modelHooksRegistry.copyHooksFrom(this.modelHooksRegistry);
      childEngine.toolHooksRegistry.copyHooksFrom(this.toolHooksRegistry);
      childEngine.engineHooksRegistry.copyHooksFrom(this.engineHooksRegistry);
      childEngine.lifecycleHooksRegistry.copyHooksFrom(this.lifecycleHooksRegistry);
    }

    if (options?.hooks) {
      this.registerHooks(childEngine, options.hooks);
      // Rebuild procedures to pick up newly registered hooks
      childEngine.buildProcedures({ includeDynamic: true });
    }

    // Register fork-specific lifecycle hooks (composed with inherited hooks)
    if (options?.engineConfig?.lifecycleHooks) {
      this.registerLifecycleHooks(childEngine, options.engineConfig.lifecycleHooks);
    }

    const pid = generatePid("fork");
    const rootPid = parentHandle.rootPid;

    const handle = new ExecutionHandleImpl(
      pid,
      rootPid,
      "fork",
      parentPid,
      parentHandle,
      this.executionGraph,
    );
    handle.setExecutionGraph(this.executionGraph);
    handle.setExecutionGraphForStatus(this.executionGraph);

    const forkController = new AbortController();
    handle.setCancelController(forkController);

    // Only include parent signal if parent is still running and signal is not already aborted
    // If parent has already completed, fork runs independently (orphaned fork)
    const parentSignalRaw = parentHandle.getCancelSignal();
    const parentSignal =
      parentHandle.status === "running" && parentSignalRaw && !parentSignalRaw.aborted
        ? parentSignalRaw
        : undefined;

    const mergedSignal = mergeAbortSignals(
      [forkController.signal, parentSignal, options?.signal].filter(Boolean) as AbortSignal[],
    );

    this.executionGraph.register(handle, parentPid);

    const inheritedInput = this.prepareInheritedInput(input, parentHandle, options?.inherit);
    const inheritedContext = this.prepareInheritedContext(options, parentHandle);

    this.runForkSpawnExecution(
      childEngine,
      handle,
      root,
      inheritedInput,
      {
        ...inheritedContext,
        signal: mergedSignal,
        ...options,
      },
      parentHandle,
    )
      .catch((error) => {
        handle.fail(error);
        this.executionGraph.updateStatus(handle.pid, "failed", error);
        childEngine.destroy();
      })
      .then(() => {
        if (handle.status !== "running") {
          childEngine.destroy();
        }
      });

    return handle;
  }

  private async runForkSpawnExecution(
    childEngine: Engine,
    handle: ExecutionHandleImpl,
    root: JSX.Element | ComponentDefinition | ComponentDefinition[],
    input: EngineInput,
    options?: {
      parentPid?: string;
      inherit?: ForkInheritanceOptions;
      engineClass?: typeof Engine;
      engineConfig?: Partial<EngineConfig>;
    } & Partial<Omit<EngineContext, "channels">> & {
        channels?: ChannelServiceConfig;
      },
    _parentHandle?: ExecutionHandle,
  ) {
    try {
      const {
        engineClass: _engineClass,
        engineConfig: _engineConfig,
        channels: _channels,
        ...kernelOptions
      } = options || {};

      // Note: Engine's execute method is a Procedure, so we call it directly
      // Normalize root to single ComponentDefinition or undefined
      const normalizedRoot: ComponentDefinition | undefined = Array.isArray(root)
        ? undefined // Arrays handled by getRootElement
        : (root as ComponentDefinition | undefined);

      // Pass the fork handle in context so the handle factory reuses it instead of creating a new one
      // This ensures abort signals propagate correctly to the fork execution
      // Use EngineContext cast to include executionHandle and other Engine-specific properties
      //
      // IMPORTANT: Clear procedurePid to ensure the fork's first procedure becomes an execution
      // boundary (not a child of the parent's current procedure). This is essential for correct
      // executionId assignment - fork procedures should get the fork's executionId, not the parent's.
      const result = await childEngine.execute
        .withContext({
          ...kernelOptions,
          executionHandle: handle, // Pass fork handle so it's reused by handle factory
          procedurePid: undefined, // Clear parent procedure - this is a new execution boundary
          procedureGraph: undefined, // Clear parent's procedure graph - fork has its own
        } as Partial<EngineContext>)
        .call(input, normalizedRoot);

      // Ensure result is COMInput (not AsyncIterable)
      if (isAsyncIterable(result)) {
        throw new StateError(
          "async_iterable",
          "promise",
          "execute returned async iterable instead of Promise",
        );
      }

      handle.complete(result as COMInput);
      this.executionGraph.updateStatus(handle.pid, "completed");
    } catch (error: any) {
      const isAbort = isAbortError(error);
      if (isAbort) {
        handle.cancel();
        this.executionGraph.updateStatus(handle.pid, "cancelled", error);
      } else {
        handle.fail(error instanceof Error ? error : new Error(String(error)));
        this.executionGraph.updateStatus(handle.pid, "failed", error);
      }
      throw error;
    }
  }

  /**
   * Persist execution state
   */
  async persistExecutionState(
    handle: ExecutionHandleImpl,
    rootElement: JSX.Element,
    input: EngineInput,
    tick: number,
    previous?: COMInput,
  ): Promise<void> {
    if (!handle || !this.config.persistExecutionState) {
      return;
    }

    try {
      const stateToPersist = handle.toState(
        rootElement as ComponentDefinition,
        input,
        tick,
        previous,
      );
      await this.config.persistExecutionState(stateToPersist);
    } catch (persistError) {
      log.error({ err: persistError }, "Failed to persist state on abort");
    }
  }

  /**
   * Get execution metrics for the engine
   */
  getMetrics(): EngineMetrics {
    const allExecutions = this.executionGraph.getAllExecutions();
    const activeExecutions = this.executionGraph.getActiveCount();
    const totalExecutions = this.executionGraph.getCount();

    const executionsByStatus: Record<string, number> = {
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    const executionsByType: Record<string, number> = {
      root: 0,
      spawn: 0,
      fork: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;

    for (const handle of allExecutions) {
      executionsByStatus[handle.status] = (executionsByStatus[handle.status] || 0) + 1;
      executionsByType[handle.type] = (executionsByType[handle.type] || 0) + 1;

      if (
        handle.status === "completed" ||
        handle.status === "failed" ||
        handle.status === "cancelled"
      ) {
        const duration = handle.getDuration();
        totalDuration += duration;
        completedCount++;
      }
    }

    const averageExecutionTime = completedCount > 0 ? totalDuration / completedCount : 0;

    return {
      activeExecutions,
      totalExecutions,
      executionsByStatus: executionsByStatus as Record<
        "running" | "completed" | "failed" | "cancelled" | "pending",
        number
      >,
      executionsByType: executionsByType as Record<"root" | "spawn" | "fork", number>,
      averageExecutionTime,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date(),
    };
  }

  /**
   * Get execution tree starting from a root PID
   */
  getExecutionTree(rootPid: string): ExecutionTreeNode | undefined {
    return this.executionGraph.getExecutionTree(rootPid);
  }

  /**
   * Get outstanding forks/spawns for a parent execution
   */
  getOutstandingForks(parentPid: string): ExecutionHandle[] {
    return this.executionGraph.getOutstandingForks(parentPid);
  }

  /**
   * Get orphaned forks/spawns (parent completed but child still running)
   */
  getOrphanedForks(): ExecutionHandle[] {
    return this.executionGraph.getOrphanedForks();
  }

  /**
   * Get execution handle by PID
   */
  getExecutionHandle(pid: string): ExecutionHandle | undefined {
    return this.executionGraph.getHandle(pid);
  }

  /**
   * Resume an execution from persisted state
   */
  async resumeExecution(state: ExecutionState): Promise<ExecutionHandle> {
    if (!this.config.loadExecutionState) {
      throw new ValidationError(
        "loadExecutionState",
        "loadExecutionState not configured. Cannot resume execution.",
      );
    }

    const handle = new ExecutionHandleImpl(
      state.pid,
      state.rootPid,
      state.type,
      state.parentPid,
      undefined,
      this.executionGraph,
    );
    handle.setExecutionGraph(this.executionGraph);
    handle.status = state.status;
    handle.completedAt = state.completedAt;

    if (state.error) {
      handle.fail(new StateError("failed", "running", state.error.message));
    }

    this.executionGraph.register(handle, state.parentPid);

    if (state.status === "running") {
      const error = new StateError(
        "running",
        "resumable",
        "Execution resumption not yet implemented",
      );
      handle.fail(error);
      this.executionGraph.updateStatus(state.pid, "failed", error);
      throw error;
    }

    return handle;
  }

  /**
   * Get recoverable executions (for crash recovery)
   */
  async getRecoverableExecutions(): Promise<ExecutionState[]> {
    if (!this.config.loadExecutionState) {
      return [];
    }

    return [];
  }
}

// ============================================================================
// Middleware Normalization Helpers
// ============================================================================

/**
 * Normalize engine hook middleware to the generic Middleware<any[]>[] format
 * required by applyRegistryMiddleware.
 *
 * Similar to normalizeToolMiddleware and normalizeModelMiddleware, but for
 * engine hooks (execute, stream).
 *
 * Handles both static middleware (Middleware<[EngineInput, ComponentDefinition?]>[])
 * and hook registry middleware (EngineHookMiddleware<'execute' | 'stream'>[]).
 */
function normalizeEngineMiddleware<T extends EngineHookName>(
  middleware?: Middleware<[EngineInput, ComponentDefinition?]>[] | EngineHookMiddleware<T>[],
): (Middleware<any[]> | MiddlewarePipeline)[] {
  if (!middleware || middleware.length === 0) {
    return [];
  }
  return middleware as unknown as (Middleware<any[]> | MiddlewarePipeline)[];
}

/**
 * Normalize model hook middleware to the generic Middleware<any[]>[] format
 * required by applyRegistryMiddleware.
 *
 * Similar to normalizeMiddleware in model.ts, but for
 * middleware retrieved from ModelHookRegistry.
 */
function normalizeModelHookMiddleware(
  middleware: ModelHookMiddleware<ModelHookName>[],
): (Middleware<any[]> | MiddlewarePipeline)[] {
  if (!middleware || middleware.length === 0) {
    return [];
  }
  return middleware as unknown as (Middleware<any[]> | MiddlewarePipeline)[];
}
