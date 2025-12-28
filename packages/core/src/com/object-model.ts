import type {
  COMInput,
  COMSection,
  COMTimelineEntry,
  TimelineTag,
  TimelineVisibility,
  EngineInput,
  EphemeralEntry,
  EphemeralPosition,
} from "./types";
import type { ToolDefinition, ExecutableTool } from "../tool/tool";
import type { Message, ContentBlock } from "aidk-shared";
import type { ModelConfig, ModelInstance } from "../model/model";
import { ChannelService } from "../channels";
import { EventEmitter } from "node:events";
import z, { ZodObject } from "zod";
import type {
  ExecutionHandle,
  ExecutionMessage,
  ForkInheritanceOptions,
  SignalType,
} from "../engine/execution-types";
import type { ComponentDefinition } from "../component/component";
import type { EngineConfig } from "../engine/engine";

/**
 * Event payload types for COM events
 */
export interface COMEventMap {
  "message:added": [
    message: Message,
    options: {
      tags?: TimelineTag[];
      visibility?: TimelineVisibility;
      metadata?: Record<string, unknown>;
    },
  ];
  "timeline:modified": [entry: COMTimelineEntry, action: "add" | "remove"];
  "tool:registered": [tool: ExecutableTool];
  "tool:added": [toolName: string];
  "tool:removed": [toolName: string];
  "state:changed": [key: string, value: unknown, previousValue: unknown];
  "state:cleared": [];
  "model:changed": [model: ModelInstance | string | undefined];
  "model:unset": [];
  "section:updated": [section: COMSection, action: "add" | "update"];
  "metadata:changed": [key: string, value: unknown, previousValue: unknown];
  "execution:message": [message: ExecutionMessage];
}

/**
 * Tick control status
 */
export type COMTickStatus = "continue" | "completed" | "aborted";

/**
 * Request to stop execution
 */
export interface COMStopRequest {
  ownerId?: string | object;
  priority?: number;
  reason?: string;
  terminationReason?: string;
  status?: COMTickStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Request to continue execution
 */
export interface COMContinueRequest {
  ownerId?: string | object;
  priority?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Control request (internal)
 */
interface COMControlRequest {
  kind: "stop" | "continue";
  ownerId?: string | object;
  priority: number;
  reason?: string;
  terminationReason?: string;
  status?: COMTickStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Decision resolved from control requests
 */
export interface COMTickDecision {
  status: COMTickStatus;
  terminationReason?: string;
  decidedBy?: COMControlRequest;
}

export interface COMProcess {
  /**
   * Fork a new execution with inherited state from parent.
   * Creates a child execution that shares context with the parent.
   */
  fork(
    input: EngineInput,
    agent?: ComponentDefinition,
    options?: {
      parentPid?: string;
      inherit?: ForkInheritanceOptions;
      engineConfig?: Partial<EngineConfig>;
    },
  ): ExecutionHandle;

  /**
   * Spawn a new independent execution.
   * Creates a completely independent child execution.
   */
  spawn(
    input: EngineInput,
    agent?: ComponentDefinition,
    options?: {
      engineConfig?: Partial<EngineConfig>;
    },
  ): ExecutionHandle;

  /**
   * Send a signal to an execution.
   * Signals propagate to child executions.
   *
   * @param pid - Execution PID to signal
   * @param signal - Signal type ('abort', 'interrupt', 'pause', 'resume')
   * @param reason - Optional reason for the signal
   */
  signal(pid: string, signal: SignalType, reason?: string): void;

  /**
   * Terminate an execution immediately.
   * Equivalent to signal(pid, 'abort').
   *
   * @param pid - Execution PID to kill
   * @param reason - Optional reason for termination
   */
  kill(pid: string, reason?: string): void;

  /**
   * List all active child executions of the current execution.
   * Returns only running executions (not completed/failed/cancelled).
   */
  list(): ExecutionHandle[];

  /**
   * Get an execution handle by PID.
   * Returns undefined if the PID is not found.
   *
   * @param pid - Execution PID to look up
   */
  get(pid: string): ExecutionHandle | undefined;
}

/**
 * The Context Object Model (COM).
 *
 * Represents the mutable state of the context for an execution.
 * Components interact with this model to compose the final context
 * that will be sent to the model (rendered as COMInput).
 *
 * This is analogous to the DOM in a browser, where components
 * manipulate the structure before it is "painted" (sent to the model).
 *
 * COM extends EventEmitter to emit events when mutations occur,
 * allowing components to reactively respond to changes.
 *
 * @example
 * ```typescript
 * // Listen for new messages
 * com.on('message:added', (message, options) => {
 *   console.log('New message:', message);
 * });
 *
 * // Listen for tool registration
 * com.on('tool:registered', (tool) => {
 *   console.log('Tool registered:', tool.metadata.name);
 * });
 *
 * // Listen for state changes
 * com.on('state:changed', (key, value, previousValue) => {
 *   console.log(`State changed: ${key} = ${value}`);
 * });
 * ```
 */
export class ContextObjectModel extends EventEmitter {
  private timeline: COMTimelineEntry[] = [];
  private sections = new Map<string, COMSection>();
  private tools = new Map<string, ExecutableTool>(); // Store ExecutableTool instances for execution
  private toolDefinitions = new Map<string, ToolDefinition>(); // Store ToolDefinition for provider compatibility
  private metadata: Record<string, unknown> = {};
  private state: Record<string, unknown> = {}; // COM-level state shared across components
  private modelOptions?: ModelConfig; // Model options from EngineInput

  // Ephemeral entries - transient content rebuilt each tick, NOT persisted
  private ephemeral: EphemeralEntry[] = [];

  // System messages - consolidated from sections each tick, NOT persisted in previousState
  // Rebuilt fresh each tick to maintain declarative principle
  // Uses COMTimelineEntry envelope for consistency
  private systemMessages: COMTimelineEntry[] = [];

  // Component references (separate from state)
  private refs = new Map<string, any>();

  // Tick control requests
  private controlRequests: COMControlRequest[] = [];

  // Recompile tracking for compilation stabilization loop
  private _recompileRequested = false;
  private _recompileReasons: string[] = [];

  // Message queue for execution messages
  // Messages are delivered immediately to onMessage hooks, then queued here
  // for availability in TickState.queuedMessages during the next tick
  private _queuedMessages: ExecutionMessage[] = [];

  // Abort control - allows components to request execution abort via onMessage
  private _shouldAbort = false;
  private _abortReason?: string;

  /**
   * The current model adapter for this execution.
   * Can be set dynamically via Model components.
   */
  private model?: ModelInstance | string;

  /**
   * Process operations interface for creating and managing child executions.
   * Set by Engine when creating COM.
   *
   * Provides Unix-like process management semantics:
   * - fork/spawn: Create child executions
   * - signal: Send signals to executions (like kill -SIGTERM)
   * - kill: Terminate an execution (like kill -9)
   * - list: List all child executions (like ps)
   * - get: Get execution by PID
   *
   * Note: ExecutionHandle already manages PID, signaling, and lifecycle.
   * This API provides a higher-level interface for components to interact
   * with the execution graph.
   */
  public process?: COMProcess;

  /**
   * The original user input for this execution (static, doesn't change).
   * Components can access this via com.getUserInput().
   */
  private userInput?: EngineInput;

  /**
   * Channel service for bidirectional communication (optional).
   * Components and tools can publish/subscribe to channels.
   */
  private channelService?: ChannelService;

  constructor(
    initial?: Partial<COMInput>,
    userInput?: EngineInput,
    channelService?: ChannelService,
    process?: ContextObjectModel["process"],
  ) {
    super(); // Initialize EventEmitter
    if (initial) {
      // We don't copy timeline, sections, or tools from initial input because
      // Components are responsible for building them declaratively each tick.
      // Components have access to previousState and currentState
      // to make decisions about what to render.
      // Initial metadata is fine.
      if (initial.metadata) Object.assign(this.metadata, initial.metadata);
      if (initial.modelOptions) this.modelOptions = initial.modelOptions;
    }
    // Also get modelOptions from userInput if not already set
    if (userInput?.modelOptions && !this.modelOptions) {
      this.modelOptions = userInput.modelOptions;
    }
    this.userInput = userInput;
    this.channelService = channelService;
    this.process = process;
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof COMEventMap>(
    event: K,
    listener: (...args: COMEventMap[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  /**
   * Type-safe one-time event listener registration
   */
  once<K extends keyof COMEventMap>(
    event: K,
    listener: (...args: COMEventMap[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  /**
   * Type-safe event emission
   */
  emit<K extends keyof COMEventMap>(
    event: K,
    ...args: COMEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Get the original user input for this execution.
   */
  getUserInput(): EngineInput | undefined {
    return this.userInput;
  }

  /**
   * Get the channel service (if available).
   */
  getChannelService(): ChannelService | undefined {
    return this.channelService;
  }

  /**
   * Convenience property accessor for channel service.
   * Allows `com.channels` instead of `com.getChannelService()`.
   */
  get channels(): ChannelService | undefined {
    return this.channelService;
  }

  /**
   * Set the model adapter for this execution.
   * Can be called by Model components to dynamically set the model.
   * This only updates the COM's internal model state - Engine.setModel handles the actual model switching.
   */
  setModel(model: ModelInstance | string | undefined): void {
    this.model = model;
    // Emit event synchronously
    this.emit("model:changed", model);
  }

  /**
   * Get the current model adapter (or model identifier).
   * Returns undefined if no model is set.
   */
  getModel(): ModelInstance | string | undefined {
    return this.model;
  }

  /**
   * Clear the current model.
   * Called when Model component unmounts.
   */
  unsetModel(): void {
    this.model = undefined;
    // Emit event synchronously
    this.emit("model:unset");
  }

  /**
   * Set or merge model options (messageTransformation, temperature, etc.).
   * These are passed through to fromEngineState for content transformation.
   */
  setModelOptions(options: Partial<ModelConfig>): void {
    this.modelOptions = {
      ...this.modelOptions,
      ...options,
    };
  }

  /**
   * Get the current model options.
   */
  getModelOptions(): ModelConfig | undefined {
    return this.modelOptions;
  }

  /**
   * Clears all state to prepare for a new render pass.
   * Components are responsible for managing what persists across ticks
   * by accessing previousInput in their render methods.
   *
   * Note: This does NOT remove event listeners. Components are responsible
   * for cleaning up their own listeners in onUnmount().
   *
   * Note: This does NOT clear refs - refs persist across ticks until components unmount.
   * Note: This does NOT clear control requests - they are consumed per tick.
   */
  clear() {
    this.timeline = [];
    this.sections.clear();
    this.tools.clear();
    this.toolDefinitions.clear();
    this.metadata = {};
    this.ephemeral = []; // Always cleared - rebuilt fresh each tick
    this.systemMessages = []; // Always cleared - rebuilt fresh each tick from sections
    this.controlRequests = [];
    // Emit state cleared event
    this.emit("state:cleared");
  }

  /**
   * @deprecated Use clear() instead. Timeline is now managed by components.
   */
  clearEphemeral() {
    this.clear();
  }

  /**
   * Adds a message to the timeline (or system array for system messages).
   * Convenience method that maintains model semantics (role, content).
   * This is the intuitive API for developers thinking in terms of "user messages", "assistant messages", etc.
   *
   * System messages go to a separate array (not timeline) because:
   * - They are declarative (rebuilt each tick from sections)
   * - They should not be persisted in previousState
   * - This prevents duplicate system messages across ticks
   */
  addMessage(
    message: Message,
    options: {
      tags?: TimelineTag[];
      visibility?: TimelineVisibility;
      metadata?: Record<string, unknown>;
    } = {},
  ): void {
    if (message.role === "system") {
      // System messages go to separate array, not timeline
      // They are rebuilt fresh each tick from sections
      this.addSystemMessage(message);
      this.emit("message:added", message, options);
    } else {
      // Non-system messages go to timeline (conversation history)
      this.addTimelineEntry({
        kind: "message",
        message,
        tags: options.tags,
        visibility: options.visibility,
        metadata: options.metadata,
      });
      this.emit("message:added", message, options);
    }
  }

  /**
   * Adds a system message to the system messages array.
   * System messages are kept separate from timeline to maintain declarative principle.
   * They are rebuilt fresh each tick from sections.
   */
  addSystemMessage(message: Message): void {
    if (message.role !== "system") {
      console.warn(
        "addSystemMessage called with non-system message, adding anyway",
      );
    }
    // Wrap in COMTimelineEntry envelope for consistency
    this.systemMessages.push({
      kind: "message",
      message,
    });
  }

  /**
   * Get all system messages as timeline entries.
   * These are rebuilt fresh each tick from sections.
   */
  getSystemMessages(): COMTimelineEntry[] {
    return [...this.systemMessages];
  }

  /**
   * Adds a generic timeline entry.
   * Use this for events or other non-message timeline entries.
   * For messages, prefer `addMessage()` for better semantics.
   */
  addTimelineEntry(entry: COMTimelineEntry): void {
    this.timeline.push(entry);
    // Emit event synchronously
    this.emit("timeline:modified", entry, "add");
  }

  /**
   * Get all timeline entries.
   */
  getTimeline(): COMTimelineEntry[] {
    return [...this.timeline];
  }

  /**
   * Adds or updates a section in the context.
   * Combines content from sections with the same ID.
   * Last section's metadata wins.
   */
  addSection(section: COMSection): void {
    const existing = this.sections.get(section.id);
    if (!existing) {
      this.sections.set(section.id, section);
      // Emit event for new section
      this.emit("section:updated", section, "add");
      return;
    }

    // Combine content based on type
    let combinedContent: unknown;
    if (
      typeof existing.content === "string" &&
      typeof section.content === "string"
    ) {
      // Both strings: combine with newline
      combinedContent = `${existing.content}\n${section.content}`;
    } else if (
      Array.isArray(existing.content) &&
      Array.isArray(section.content)
    ) {
      // Both arrays: concatenate
      combinedContent = [...existing.content, ...section.content];
    } else if (
      typeof existing.content === "object" &&
      typeof section.content === "object" &&
      existing.content !== null &&
      section.content !== null &&
      !Array.isArray(existing.content) &&
      !Array.isArray(section.content)
    ) {
      // Both objects: merge
      combinedContent = { ...existing.content, ...section.content };
    } else {
      // Mixed types or other: convert to array
      combinedContent = [existing.content, section.content];
    }

    // Last section's metadata wins (including formatted content)
    const mergedSection: COMSection = {
      id: section.id,
      content: combinedContent,
      // Last section wins for metadata and formatted content
      title: section.title || existing.title,
      tags: section.tags || existing.tags,
      visibility: section.visibility || existing.visibility,
      audience: section.audience || existing.audience,
      metadata: section.metadata || existing.metadata,
      formattedContent: section.formattedContent || existing.formattedContent,
      formattedWith: section.formattedWith || existing.formattedWith,
    };

    this.sections.set(section.id, mergedSection);
    // Emit event for updated section
    this.emit("section:updated", mergedSection, "update");
  }

  /**
   * Get a section by ID.
   */
  getSection(id: string): COMSection | undefined {
    return this.sections.get(id);
  }

  /**
   * Get all sections.
   */
  getSections(): { [id: string]: COMSection } {
    return Object.fromEntries(this.sections);
  }

  /**
   * Adds a tool definition to the context.
   * Uses tool name as key to prevent duplicates.
   * Converts Zod schema to JSON Schema for provider compatibility.
   */
  addTool(tool: ExecutableTool): void {
    const name = tool.metadata.name;
    if (name) {
      // Store ExecutableTool for execution
      this.tools.set(name, tool);

      // Convert to ToolDefinition (provider-compatible format with JSON Schema)
      const jsonSchema = this.convertParametersToJSONSchema(
        tool.metadata.parameters,
      );
      this.toolDefinitions.set(name, {
        name: tool.metadata.name,
        description: tool.metadata.description,
        parameters: jsonSchema as Record<string, unknown>,
        type: tool.metadata.type, // Preserve execution type
        providerOptions: tool.metadata.providerOptions, // Preserve provider-specific options
        mcpConfig: tool.metadata.mcpConfig, // Preserve MCP configuration
      });
      // Emit event synchronously
      this.emit("tool:registered", tool);
    }
  }

  /**
   * Converts Zod schema or JSON Schema to JSON Schema format.
   * Handles ZodUndefined as empty object.
   */
  private convertParametersToJSONSchema(
    parameters: unknown,
  ): Record<string, unknown> {
    if (parameters instanceof ZodObject) {
      if (parameters instanceof z.ZodUndefined) {
        return {};
      }
      const schema = z.toJSONSchema(parameters);
      delete schema["$schema"];
      delete schema["additionalProperties"];
      return schema as Record<string, unknown>;
    }
    // Already JSON Schema or other format
    return (parameters as Record<string, unknown>) || {};
  }

  /**
   * Remove a tool from the context.
   */
  removeTool(name: string): void {
    const hadTool = this.tools.has(name);
    this.tools.delete(name);
    this.toolDefinitions.delete(name);
    // Emit event if tool was actually removed
    if (hadTool) {
      this.emit("tool:removed", name);
    }
  }

  /**
   * Gets a registered tool instance by name.
   */
  getTool(name: string): ExecutableTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getTools(): ExecutableTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Gets a tool definition by name.
   * Returns the provider-compatible definition (JSON Schema parameters).
   */
  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.toolDefinitions.get(name);
  }

  /**
   * Adds a tool definition without an executable implementation.
   * Used for client tools that are executed on the client side.
   *
   * @param definition - Tool definition with JSON Schema parameters
   */
  addToolDefinition(definition: ToolDefinition): void {
    const name = definition.name;
    if (name) {
      this.toolDefinitions.set(name, definition);
      this.emit("tool:added", name);
    }
  }

  /**
   * Adds metadata to the context.
   */
  addMetadata(key: string, value: unknown): void {
    const previousValue = this.metadata[key];
    this.metadata[key] = value;
    // Emit event synchronously
    this.emit("metadata:changed", key, value, previousValue);
  }

  // ============================================================================
  // Ephemeral Content API
  // ============================================================================

  /**
   * Adds ephemeral content to be included in the model input.
   *
   * Ephemeral content is NOT persisted - it's rebuilt fresh each tick.
   * It provides current state/context to the model but is not part of
   * the conversation history.
   *
   * @param content - Content blocks to include
   * @param position - Where to position in the message stream
   * @param order - Secondary sort order (lower = earlier, default 0)
   * @param metadata - Optional metadata
   * @param id - Optional identifier for debugging
   * @param tags - Optional tags for categorization
   * @param type - Optional type for semantic categorization (used by model config)
   *
   * @example
   * ```typescript
   * // Add current account balance at the start
   * com.addEphemeral(
   *   [{ type: 'text', text: `Current balance: $${balance}` }],
   *   'start'
   * );
   *
   * // Add inventory context before user message with type
   * com.addEphemeral(
   *   [{ type: 'text', text: `Available items: ${items.join(', ')}` }],
   *   'before-user',
   *   10, // order
   *   undefined, // metadata
   *   undefined, // id
   *   undefined, // tags
   *   'inventory' // type
   * );
   * ```
   */
  addEphemeral(
    content: ContentBlock[],
    position: EphemeralPosition = "end",
    order = 0,
    metadata?: Record<string, unknown>,
    id?: string,
    tags?: string[],
    type?: string,
  ): void {
    this.ephemeral.push({
      type,
      content,
      position,
      order,
      metadata,
      id,
      tags,
    });
  }

  /**
   * Get all ephemeral entries.
   * These are cleared on each tick via clear().
   */
  getEphemeral(): EphemeralEntry[] {
    return [...this.ephemeral];
  }

  /**
   * Gets COM-level state value.
   * COM state is shared across all components and persists across ticks.
   */
  getState<T = unknown>(key: string): T | undefined {
    return this.state[key] as T | undefined;
  }

  /**
   * Sets COM-level state value.
   * COM state is shared across all components and persists across ticks.
   * Use this for shared state that multiple components need to access.
   */
  setState(key: string, value: unknown): void {
    const previousValue = this.state[key];
    this.state[key] = value;
    // Emit event synchronously
    this.emit("state:changed", key, value, previousValue);
  }

  /**
   * Updates COM-level state with a partial object.
   * Merges the provided state into the existing state.
   * Emits a 'state:changed' event for each key that changed.
   */
  setStatePartial(partial: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(partial)) {
      const previousValue = this.state[key];
      this.state[key] = value;
      // Emit event for each changed key
      this.emit("state:changed", key, value, previousValue);
    }
  }

  /**
   * Gets all COM-level state.
   */
  getStateAll(): Record<string, unknown> {
    return { ...this.state };
  }

  /**
   * Get a component reference by name
   *
   * Components can expose themselves via the `ref` prop.
   * Use this to access component instances from other components.
   *
   * @param refName Reference name (from component's `ref` prop)
   * @returns Component instance or undefined
   *
   * @example
   * ```typescript
   * const fork = com.getRef<ForkComponent>('myFork');
   * const handle = fork?.getHandle();
   * ```
   */
  getRef<T = any>(refName: string): T | undefined {
    return this.refs.get(refName) as T | undefined;
  }

  /**
   * Set a component reference
   * Called by compiler when components mount with a ref prop.
   * @internal
   */
  _setRef(refName: string, instance: any): void {
    this.refs.set(refName, instance);
  }

  /**
   * Remove a component reference
   * Called by components when they unmount.
   * @internal
   */
  _removeRef(refName: string): void {
    this.refs.delete(refName);
  }

  /**
   * Get all component references
   *
   * @returns Map of all component references
   */
  getRefs(): Record<string, any> {
    return Object.fromEntries(this.refs);
  }

  /**
   * Renders the Object Model into the final COMInput structure.
   */
  toInput(): COMInput {
    return {
      timeline: [...this.timeline],
      sections: Object.fromEntries(this.sections),
      ephemeral: [...this.ephemeral],
      system: [...this.systemMessages],
      // Return ToolDefinition[] (provider-compatible format with JSON Schema)
      tools: Array.from(this.toolDefinitions.values()),
      metadata: { ...this.metadata },
      modelOptions: this.modelOptions,
    };
  }

  // ============================================================================
  // Tick Control API
  // ============================================================================

  /**
   * Request that execution stop after this tick.
   * Components can call this to signal that execution should terminate.
   *
   * @param details Stop request details
   *
   * @example
   * ```typescript
   * class ResponseVerifier extends Component {
   *   render(com: ContextObjectModel, state: TickState) {
   *     const response = state.currentState?.timeline.find(e => e.message.role === 'assistant');
   *     if (response && this.isComplete(response)) {
   *       com.requestStop({ reason: 'response-complete', status: 'completed' });
   *     }
   *   }
   * }
   * ```
   */
  requestStop(details: COMStopRequest = {}): void {
    this.controlRequests.push({
      kind: "stop",
      ownerId: details.ownerId,
      priority: details.priority ?? 0,
      reason: details.reason,
      terminationReason: details.terminationReason,
      status: details.status ?? "aborted",
      metadata: details.metadata,
    });
  }

  /**
   * Request that execution continue to the next tick.
   * Useful when a component wants to override a default stop condition.
   *
   * @param details Continue request details
   *
   * @example
   * ```typescript
   * class RetryHandler extends Component {
   *   render(com: ContextObjectModel, state: TickState) {
   *     if (state.stopReason?.reason === 'error' && this.shouldRetry(state.error)) {
   *       com.requestContinue({ reason: 'retrying-after-error' });
   *     }
   *   }
   * }
   * ```
   */
  requestContinue(details: COMContinueRequest = {}): void {
    this.controlRequests.push({
      kind: "continue",
      ownerId: details.ownerId,
      priority: details.priority ?? 0,
      reason: details.reason,
      status: "continue",
      metadata: details.metadata,
    });
  }

  /**
   * Resolve tick control decision from pending requests.
   * Called by Engine at the end of each tick to determine if execution should continue.
   *
   * Priority: stop requests > continue requests > default status
   *
   * @param defaultStatus Default status if no requests
   * @param defaultReason Default reason if no requests
   * @param tickNumber Current tick number (for telemetry)
   * @returns Decision with status and reason
   * @internal
   */
  _resolveTickControl(
    defaultStatus: COMTickStatus,
    defaultReason?: string,
    tickNumber?: number,
  ): COMTickDecision {
    // Sort by priority (higher priority first)
    const sortedRequests = [...this.controlRequests].sort(
      (a, b) => b.priority - a.priority,
    );

    // Find highest priority stop request
    const stopRequest = sortedRequests.find((r) => r.kind === "stop");

    // Find highest priority continue request
    const continueRequest = sortedRequests.find((r) => r.kind === "continue");

    // Clear requests (consumed)
    this.controlRequests = [];

    // Stop requests take precedence
    if (stopRequest) {
      return {
        status: stopRequest.status ?? "aborted",
        terminationReason:
          stopRequest.reason ?? stopRequest.terminationReason ?? defaultReason,
        decidedBy: stopRequest,
      };
    }

    // Continue requests override default stop (but not explicit stops)
    if (defaultStatus !== "continue" && continueRequest) {
      return {
        status: "continue",
        terminationReason: continueRequest.reason ?? defaultReason,
        decidedBy: continueRequest,
      };
    }

    // Default decision
    return {
      status: defaultStatus,
      terminationReason: defaultReason,
    };
  }

  // ============================================================================
  // Compilation Stabilization API
  // ============================================================================

  /**
   * Request a re-compilation of the component tree.
   *
   * Call this in `onAfterCompile` when you've modified COM state and need
   * the compilation to reflect those changes. The compiler will re-run
   * the compile loop until no component requests recompilation (or max
   * iterations is reached).
   *
   * @param reason Optional reason for the recompile (for debugging/logging)
   *
   * @example
   * ```typescript
   * class ContextManager extends Component {
   *   onAfterCompile(com: ContextObjectModel, compiled: CompiledStructure, state: TickState) {
   *     const tokens = this.estimateTokens(compiled);
   *     if (tokens > MAX_TOKENS) {
   *       com.setTimeline(this.summarize(com.getTimeline()));
   *       com.requestRecompile('context-too-large');
   *     }
   *   }
   * }
   * ```
   */
  requestRecompile(reason?: string): void {
    this._recompileRequested = true;
    if (reason) {
      this._recompileReasons.push(reason);
    }
  }

  /**
   * Check if recompile was requested.
   * Called by the compiler after onAfterCompile hooks.
   * @internal
   */
  _wasRecompileRequested(): boolean {
    return this._recompileRequested;
  }

  /**
   * Get the reasons for recompile requests.
   * @internal
   */
  _getRecompileReasons(): string[] {
    return [...this._recompileReasons];
  }

  /**
   * Reset recompile tracking for the next iteration.
   * Called by the compiler before each compile iteration.
   * @internal
   */
  _resetRecompileRequest(): void {
    this._recompileRequested = false;
    this._recompileReasons = [];
  }

  // ============================================================================
  // Message Queue API
  // ============================================================================

  /**
   * Queue a message for availability in the next tick's TickState.queuedMessages.
   *
   * This is called by CompileSession.sendMessage() after notifying onMessage hooks.
   * Messages are queued here and made available to components during render.
   *
   * @param message The message to queue
   * @internal Called by CompileSession
   */
  queueMessage(message: ExecutionMessage): void {
    this._queuedMessages.push(message);
    this.emit("execution:message", message);
  }

  /**
   * Get all queued messages (snapshot).
   *
   * Returns a copy of the queued messages array.
   * Used by prepareTickState() to populate TickState.queuedMessages.
   *
   * @returns Copy of queued messages
   * @internal Called by CompileSession
   */
  getQueuedMessages(): ExecutionMessage[] {
    return [...this._queuedMessages];
  }

  /**
   * Clear all queued messages.
   *
   * Called after tick completes to reset the queue for the next tick.
   *
   * @internal Called by CompileSession
   */
  clearQueuedMessages(): void {
    this._queuedMessages = [];
  }

  // ============================================================================
  // Abort Control API
  // ============================================================================

  /**
   * Request immediate abort of execution.
   *
   * Called from onMessage hooks when a component needs to interrupt execution.
   * The abort will be processed at the next checkpoint in the tick loop
   * (between chunks during streaming, before/after operations, etc.).
   *
   * @param reason Optional reason for the abort
   *
   * @example
   * ```typescript
   * class InteractiveAgent extends Component {
   *   onMessage(com, message, state) {
   *     if (message.type === 'stop') {
   *       com.abort('User requested stop');
   *     }
   *   }
   * }
   * ```
   */
  abort(reason?: string): void {
    this._shouldAbort = true;
    this._abortReason = reason;
  }

  /**
   * Check if abort was requested.
   *
   * Used by the engine tick loop to check if a component requested abort.
   *
   * @returns true if abort was requested
   */
  get shouldAbort(): boolean {
    return this._shouldAbort;
  }

  /**
   * Get the reason for the abort request.
   *
   * @returns The abort reason, or undefined if not set
   */
  get abortReason(): string | undefined {
    return this._abortReason;
  }

  /**
   * Reset abort state.
   *
   * Called at the start of each tick to reset abort tracking.
   *
   * @internal Called by CompileSession/Engine
   */
  _resetAbortState(): void {
    this._shouldAbort = false;
    this._abortReason = undefined;
  }
}
