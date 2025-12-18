import type { JSX } from "../jsx/jsx-runtime";
import { ContextObjectModel, type COMTickStatus, type COMTickDecision } from "../com/object-model";
import type { COMInput, COMOutput, EngineInput } from "../com/types";
import { FiberCompiler, type CompileStabilizationOptions } from "../compiler";
import { StructureRenderer } from "../structure-renderer/structure-renderer";
import { MarkdownRenderer, XMLRenderer, type ContentRenderer } from "../renderers";
import type { Renderer } from "../renderers/base";
import type { TickState, ComponentDefinition } from "../component/component";
import type { CompiledStructure } from "../compiler/types";
import type { ToolClass, ExecutableTool } from "../tool/tool";
import type { ModelInstance, ModelInput } from "../model/model";
import { ComponentHookRegistry, type ComponentHookName, type ComponentHookMiddleware } from "../component/component-hooks";
import { ModelHookRegistry, type ModelHookName, type ModelHookMiddleware } from "../model/model-hooks";
import { ToolHookRegistry, type ToolHookName, type ToolHookMiddleware } from "../tool/tool-hooks";
import { EngineHookRegistry, type EngineHookName, type EngineHookMiddleware } from "../engine/engine-hooks";
import { EngineLifecycleHookRegistry, type EngineLifecycleHookName, type EngineLifecycleHook, type EngineLifecycleHookArgs } from "../engine/engine-lifecycle-hooks";
import { MCPClient, MCPService, type MCPServerConfig, normalizeMCPConfig, type MCPConfig } from "../mcp";
import { ChannelService, type ChannelServiceConfig } from "../channels/service";
import { toolRegistry } from "../registry";
import { Logger } from "aidk-kernel";
import { ensureElement } from "../jsx/jsx-runtime";
import type { ExecutionHandle } from "../engine/execution-types";
import { getWaitHandles } from "../jsx/components/fork-spawn-helpers";

const log = Logger.for('CompileJSXService');

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
  modelGetter?: (com: ContextObjectModel) => ModelInstance | undefined;
  
  /**
   * Process methods for COM (fork/spawn support).
   * Required for components that use fork/spawn.
   */
  processMethods?: ContextObjectModel['process'];
  
  /**
   * Existing hook registries to use (instead of creating new ones).
   * If provided, hooks will be registered on these registries.
   * If not provided, new registries will be created.
   */
  hookRegistries?: {
    components?: ComponentHookRegistry;
    models?: ModelHookRegistry;
    tools?: ToolHookRegistry;
    engine?: EngineHookRegistry;
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
   * Model hooks to register.
   * Ignored if hookRegistries.models is provided.
   */
  modelHooks?: {
    [K in ModelHookName]?: ModelHookMiddleware<K>[];
  };
  
  /**
   * Tool hooks to register.
   * Ignored if hookRegistries.tools is provided.
   */
  toolHooks?: {
    [K in ToolHookName]?: ToolHookMiddleware<K>[];
  };
  
  /**
   * Engine hooks to register.
   * Ignored if hookRegistries.engine is provided.
   */
  engineHooks?: {
    [K in EngineHookName]?: EngineHookMiddleware<K>[];
  };
  
  /**
   * Lifecycle hooks to call during compilation.
   * Ignored if hookRegistries.lifecycle is provided.
   */
  lifecycleHooks?: {
    [K in EngineLifecycleHookName]?: (EngineLifecycleHook<K> | ((...args: EngineLifecycleHookArgs<K>) => Promise<void> | void))[];
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
   * The ContextObjectModel instance used for compilation.
   */
  com: ContextObjectModel;
  
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

/**
 * Comprehensive compilation service for JSX elements.
 * 
 * This service provides all the setup and compilation logic that Engine needs
 * before calling the model. Engine can delegate compilation setup to this service
 * to avoid code duplication.
 * 
 * Features:
 * - Full hook system (component, model, tool, engine, lifecycle)
 * - Tool registration and MCP server initialization
 * - Model-based renderer resolution
 * - Process methods support (fork/spawn)
 * - Proper tick state management
 * - COM clearing and tool re-registration for multi-tick scenarios
 * 
 * @example Standalone usage
 * ```typescript
 * const service = new CompileJSXService({
 *   tools: [MyTool],
 *   defaultRenderer: new MarkdownRenderer(),
 *   lifecycleHooks: {
 *     onTickStart: [(tick, state) => console.log(`Tick ${tick}`)]
 *   }
 * });
 * 
 * const result = await service.compile(<MyComponent />, {
 *   timeline: [],
 *   sections: {}
 * });
 * ```
 * 
 * @example Engine integration
 * ```typescript
 * // Engine can use this service for compilation setup
 * const service = new CompileJSXService({
 *   tools: this.getTools(),
 *   mcpServers: this.config.mcpServers,
 *   channels: this._channelService,
 *   hookRegistries: {
 *     components: this.componentHooksRegistry,
 *     models: this.modelHooksRegistry,
 *     tools: this.toolHooksRegistry,
 *     engine: this.engineHooksRegistry,
 *     lifecycle: this.lifecycleHooksRegistry,
 *   },
 *   modelGetter: (com) => this.getRawModel(com),
 *   processMethods: { fork: ..., spawn: ..., ... }
 * });
 * 
 * const { com, compiler, structureRenderer } = await service.setup(input, rootElement);
 * // Engine can then use com, compiler, structureRenderer for its tick loop
 * 
 * // For multi-tick scenarios:
 * service.clearAndReRegisterTools(com);
 * const tickState = service.prepareTickState(com, tick, previousState, currentState);
 * ```
 */
export class CompileJSXService {
  public readonly componentHooksRegistry: ComponentHookRegistry;
  public readonly modelHooksRegistry: ModelHookRegistry;
  public readonly toolHooksRegistry: ToolHookRegistry;
  public readonly engineHooksRegistry: EngineHookRegistry;
  public readonly lifecycleHooksRegistry: EngineLifecycleHookRegistry;
  private mcpClient?: MCPClient;
  private mcpService?: MCPService;
  private channelService?: ChannelService;
  private renderers: { [key: string]: Renderer };
  private configTools: (ToolClass | ExecutableTool)[];
  
  constructor(private config: CompileJSXServiceConfig = {}) {
    // Initialize hook registries (use provided ones or create new)
    this.componentHooksRegistry = config.hookRegistries?.components || new ComponentHookRegistry();
    this.modelHooksRegistry = config.hookRegistries?.models || new ModelHookRegistry();
    this.toolHooksRegistry = config.hookRegistries?.tools || new ToolHookRegistry();
    this.engineHooksRegistry = config.hookRegistries?.engine || new EngineHookRegistry();
    this.lifecycleHooksRegistry = config.hookRegistries?.lifecycle || new EngineLifecycleHookRegistry();
    
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
    
    return this.config.tools.map(tool => {
      if (typeof tool === 'string') {
        const registered = toolRegistry.get(tool);
        if (!registered) {
          throw new Error(`Tool "${tool}" not found in registry`);
        }
        return registered;
      }
      return tool;
    });
  }
  
  /**
   * Register all hooks from config.
   * Only registers hooks if registries were created (not provided via hookRegistries).
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
    
    // Register model hooks
    if (this.config.modelHooks && !this.config.hookRegistries?.models) {
      for (const [hookName, middleware] of Object.entries(this.config.modelHooks)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            this.modelHooksRegistry.register(hookName as ModelHookName, mw);
          }
        }
      }
    }
    
    // Register tool hooks
    if (this.config.toolHooks && !this.config.hookRegistries?.tools) {
      for (const [hookName, middleware] of Object.entries(this.config.toolHooks)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            this.toolHooksRegistry.register(hookName as ToolHookName, mw);
          }
        }
      }
    }
    
    // Register engine hooks
    if (this.config.engineHooks && !this.config.hookRegistries?.engine) {
      for (const [hookName, middleware] of Object.entries(this.config.engineHooks)) {
        if (middleware && Array.isArray(middleware)) {
          for (const mw of middleware) {
            this.engineHooksRegistry.register(hookName as EngineHookName, mw);
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
              hook as EngineLifecycleHook<EngineLifecycleHookName>
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
  registerTools(com: ContextObjectModel): void {
    for (const tool of this.configTools) {
      com.addTool(tool);
    }
  }
  
  /**
   * Initialize MCP servers and discover their tools.
   */
  async registerMCPTools(com: ContextObjectModel): Promise<void> {
    if (!this.config.mcpServers || !this.mcpService) {
      return;
    }
    
    const initPromises = Object.entries(this.config.mcpServers).map(async ([serverName, config]) => {
      try {
        const mcpConfig = normalizeMCPConfig(serverName, config);
        await this.mcpService!.discoverAndRegister(mcpConfig, com);
      } catch (error) {
        log.error({ err: error, serverName }, 'Failed to initialize MCP server');
      }
    });
    
    await Promise.all(initPromises);
  }
  
  /**
   * Call lifecycle hooks.
   */
  private async callLifecycleHooks<T extends EngineLifecycleHookName>(
    hookName: T,
    args: EngineLifecycleHookArgs<T>
  ): Promise<void> {
    const hooks = this.lifecycleHooksRegistry.getMiddleware(hookName);
    
    for (const hook of hooks) {
      try {
        await (hook as any)(...args);
      } catch (error) {
        log.error({ err: error, hookName }, 'Error in lifecycle hook');
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
    handle?: ExecutionHandle
  ): Promise<{
    com: ContextObjectModel;
    compiler: FiberCompiler;
    structureRenderer: StructureRenderer;
  }> {
    // Create COM with proper setup
    const com = new ContextObjectModel(
      {
        metadata: input.metadata || {},
        modelOptions: input.modelOptions || undefined,
      },
      input,
      this.channelService,
      this.config.processMethods
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
        const modelId = model.metadata.id || model.metadata.model || '';
        const provider = model.metadata.provider;
        
        // Find capability object with messageTransformation
        const capabilityWithTransformation = model.metadata.capabilities.find(
          (cap: any) => cap.messageTransformation !== undefined
        ) as any;
        
        if (capabilityWithTransformation?.messageTransformation) {
          // Resolve transformation config (could be function or object)
          const transformation = typeof capabilityWithTransformation.messageTransformation === 'function'
            ? capabilityWithTransformation.messageTransformation(modelId, provider)
            : capabilityWithTransformation.messageTransformation;
          
          // Resolve preferred renderer (could be function or string)
          const rendererType = typeof transformation.preferredRenderer === 'function'
            ? transformation.preferredRenderer(modelId, provider)
            : transformation.preferredRenderer || 'markdown';
          
          // Set renderer on StructureRenderer
          structureRenderer.setDefaultRenderer(this.renderers[rendererType] || this.renderers.markdown);
          
          // Store transformation config on COM for later use
          com.addMetadata('messageTransformation', transformation);
        }
      }
    } else {
      // Use default renderer
      const defaultRenderer = this.config.defaultRenderer || this.renderers.markdown;
      structureRenderer.setDefaultRenderer(defaultRenderer);
    }
    
    // Set COM instance on handle if provided
    if (handle && 'setComInstance' in handle) {
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
   * Prepare tick state for a given tick number.
   * Handles state semantics correctly (previousState, currentState).
   * 
   * @param com COM instance
   * @param tick Tick number (1-based)
   * @param previousState Previous tick's state (undefined for tick 1)
   * @param currentState Current tick's state (userInput for tick 1, model output for tick 2+)
   * @returns TickState ready for compilation
   */
  prepareTickState(
    com: ContextObjectModel,
    tick: number,
    previousState?: COMInput,
    currentState?: COMOutput
  ): TickState {
    // For tick 1, use userInput if currentState not provided
    if (tick === 1 && !currentState) {
      const userInput = com.getUserInput();
      const sections = userInput?.sections;
      currentState = {
        timeline: userInput?.timeline || [],
        ...(sections ? { sections } : {}),
      };
    }
    
    return {
      tick,
      previousState,
      currentState: currentState as COMInput,
      stopReason: undefined,
      stop: (reason: string) => {
        throw new Error(`Compilation stopped: ${reason}`);
      },
      channels: undefined,
    };
  }
  
  /**
   * Clear COM ephemeral state and re-register tools.
   * Called before each tick compilation to reset timeline/sections.
   * 
   * @param com COM instance to clear
   */
  clearAndReRegisterTools(com: ContextObjectModel): void {
    // Clear ephemeral state (timeline, sections) from previous tick
    com.clear();
    
    // Re-register config tools after clear (they persist across ticks)
    this.registerTools(com);
  }
  
  /**
   * Check if compilation should be aborted and throw if so.
   * Called before and after compilation (not during).
   */
  private checkAbort(): void {
    if (this.config.abortChecker?.()) {
      const abortError = new Error('Operation aborted');
      abortError.name = 'AbortError';
      throw abortError;
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
    com: ContextObjectModel,
    compiler: FiberCompiler,
    rootElement: JSX.Element,
    tickState: TickState,
    compiled: CompiledStructure,
    handle?: ExecutionHandle
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
      const runningHandles = handlesArray.filter(h => h.status === 'running');
      
      if (runningHandles.length > 0) {
        hadWaitingForks = true;
        // Wait for all running handles to complete
        // Their onComplete callbacks will fire and may modify COM state
        await Promise.all(
          runningHandles.map(h => 
            h.waitForCompletion().catch(() => {
              // Ignore errors - handle will be in failed/cancelled state
            })
          )
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
      const recompileResult = await compiler.compileUntilStable(
        rootElement,
        tickState,
        {
          maxIterations: 50,
          trackMutations: process.env['NODE_ENV'] === 'development',
          ...this.config.compileOptions,
        }
      );
      
      // Update compiled structure with recompiled result
      compiled = recompileResult.compiled;
      
      if (recompileResult.iterations > 1) {
        log.debug(
          { iterations: recompileResult.iterations, reasons: recompileResult.recompileReasons },
          'Re-compilation after fork stabilized'
        );
      }
      
      // Call onAfterCompile hook again for the recompiled structure
      await this.callLifecycleHooks('onAfterCompile', [
        compiled,
        tickState,
        handle
      ]);
      
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
    handle?: ExecutionHandle
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
    const { com, compiler, structureRenderer } = await this.setup(initialInput, rootElement, handle);
    
    // Call onExecutionStart hook
    await this.callLifecycleHooks('onExecutionStart', [
      initialInput,
      jsx as ComponentDefinition,
      handle
    ]);
    
    // Prepare tick state
    const tickState = this.prepareTickState(com, 1);
    
    // Call onTickStart hook
    await this.callLifecycleHooks('onTickStart', [
      1,
      tickState,
      handle
    ]);
    
    // Check abort before compilation (not during - that would leave things inconsistent)
    this.checkAbort();
    
    // Compile until stable
    const compileOptions: CompileStabilizationOptions = {
      maxIterations: 50,
      trackMutations: process.env['NODE_ENV'] === 'development',
      ...this.config.compileOptions,
    };
    
    const { compiled, iterations, forcedStable, recompileReasons } = await compiler.compileUntilStable(
      rootElement,
      tickState,
      compileOptions
    );
    
    // Call onAfterCompile hook
    await this.callLifecycleHooks('onAfterCompile', [
      compiled,
      tickState,
      handle
    ]);
    
    // Wait for forks/spawns to complete and re-compile if needed
    // This happens BEFORE applying structures so fork results are included
    const { compiled: finalCompiled, recompiled } = await this.waitForForksAndRecompile(
      com,
      compiler,
      rootElement,
      tickState,
      compiled,
      handle
    );
    
    // Apply compiled structure (possibly recompiled after forks)
    structureRenderer.apply(finalCompiled);
    
    // Resolve tick control requests from COM (requestStop/requestContinue)
    // This happens AFTER applying structures so components can see the final state
    const tickControl = com._resolveTickControl(
      'continue', // Default status (Engine will override based on its state)
      undefined,  // Default reason
      1           // Tick number
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
      stopReason: tickState.stopReason?.reason || (typeof tickState.stopReason === 'string' ? tickState.stopReason : undefined),
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
   * @param previousState Previous tick's state (undefined for tick 1)
   * @param currentState Current tick's state (userInput for tick 1, model output for tick 2+)
   * @param stopReason Stop reason from TickState.stop() callback (if any)
   * @param shouldContinue Whether execution should continue (for tick control resolution)
   * @param handle Optional execution handle
   * @returns Compilation result with formatted input and tick control
   */
  async compileTick(
    com: ContextObjectModel,
    compiler: FiberCompiler,
    structureRenderer: StructureRenderer,
    rootElement: JSX.Element,
    tick: number,
    previousState?: COMInput,
    currentState?: COMOutput,
    stopReason?: string,
    shouldContinue: boolean = true,
    handle?: ExecutionHandle
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
    const tickState = this.prepareTickState(com, tick, previousState, currentState);
    tickState.stop = (reason: string) => {
      // Store stop reason - Engine will check this
      (tickState as any).stopReason = reason;
    };
    // Set channels from channel service (Engine needs this)
    tickState.channels = this.channelService;
    
    // Call onTickStart hook
    await this.callLifecycleHooks('onTickStart', [
      tick,
      tickState,
      handle
    ]);
    
    // Notify compiler that tick is starting
    await compiler.notifyTickStart(tickState);
    
    // Check abort before compilation (not during - that would leave things inconsistent)
    this.checkAbort();
    
    // Compile until stable
    const compileOptions: CompileStabilizationOptions = {
      maxIterations: 50,
      trackMutations: process.env['NODE_ENV'] === 'development',
      ...this.config.compileOptions,
    };
    
    let { compiled, iterations, forcedStable, recompileReasons } = await compiler.compileUntilStable(
      rootElement,
      tickState,
      compileOptions
    );
    
    if (iterations > 1) {
      log.debug({ iterations, reasons: recompileReasons }, 'Compilation stabilized');
    }
    if (forcedStable) {
      log.warn('Compilation forced stable at max iterations');
    }
    
    // Call onAfterCompile hook
    await this.callLifecycleHooks('onAfterCompile', [
      compiled,
      tickState,
      handle
    ]);
    
    // Wait for forks/spawns and re-compile if needed
    const { compiled: finalCompiled } = await this.waitForForksAndRecompile(
      com,
      compiler,
      rootElement,
      tickState,
      compiled,
      handle
    );
    
    // Apply compiled structure
    structureRenderer.apply(finalCompiled);
    
    // Resolve tick control requests from COM (requestStop/requestContinue)
    // This happens AFTER applying structures so components can see the final state
    const tickControl = com._resolveTickControl(
      shouldContinue ? 'continue' : 'completed',
      stopReason,
      tick
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
            log.error({ err: error }, 'Failed to transform COMInput to ModelInput');
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
    const stopReasonString = finalStopReason?.reason || (typeof finalStopReason === 'string' ? finalStopReason : undefined);
    
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
   */
  get hooks() {
    return {
      components: this.componentHooksRegistry,
      models: this.modelHooksRegistry,
      tools: this.toolHooksRegistry,
      engine: this.engineHooksRegistry,
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

