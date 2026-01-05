/**
 * Engine Integration for DevTools
 *
 * This module provides the integration point between the AIDK engine
 * and the devtools server. Import from 'aidk-devtools/integration'.
 */
import type { TokenUsage, Message, ToolDefinition } from "aidk-shared";
import {
  getDevToolsServer,
  emitDevToolsEvent,
  isDevToolsActive,
  type DevToolsOptions as BaseDevToolsOptions,
} from "../server/index.js";
import type { DevToolsEvent } from "../events.js";
import {
  startKernelSubscriber,
  stopKernelSubscriber,
  isKernelSubscriberActive,
} from "../kernel-subscriber.js";

/**
 * Remote DevTools configuration.
 * When set, events are POSTed to an external DevTools server instead of
 * starting an embedded server.
 */
export interface RemoteDevToolsConfig {
  /** URL of the remote DevTools server (e.g., "http://localhost:3004") */
  url: string;
  /** Optional secret for authentication */
  secret?: string;
}

/**
 * DevTools configuration options.
 */
export interface DevToolsOptions extends BaseDevToolsOptions {
  /**
   * Remote mode configuration. When set, the engine will POST events to
   * an external DevTools server instead of running an embedded server.
   * In remote mode, no engine is required.
   */
  remote?: RemoteDevToolsConfig;

  /**
   * Engine instance to attach devtools to.
   * This is used to attach stream middleware to the engine.
   * In embedded mode only.
   * Remote mode uses kernel subscriber instead.
   */
  instance?: DevToolsEngine;
}

/**
 * Engine hook registry interface for devtools integration.
 */
export interface DevToolsHookRegistry {
  register: (hookName: string, middleware: any) => void;
}

/**
 * Engine interface for devtools integration.
 * This is a minimal interface to avoid circular dependencies with aidk.
 *
 * NOTE: Lifecycle events (execution_start, tick_start, etc.) are now emitted by
 * the engine itself when devTools is enabled. This interface only requires the
 * hook registry for stream middleware (content_delta, tool_call, etc.).
 */
export interface DevToolsEngine {
  id: string;
  // Hook registries for stream middleware
  engineHooks?: DevToolsHookRegistry;
}

/**
 * Attaches devtools instrumentation to an engine.
 * Returns an unsubscribe function to remove all hooks.
 *
 * Supports two modes:
 *
 * **Embedded mode** (default): Starts a DevTools server in the same process.
 * Requires an engine to attach stream middleware.
 *
 * **Remote mode**: Sends events to an external DevTools server (e.g., `npx aidk-devtools`).
 * Engine is optional in this mode - if provided, stream middleware is attached.
 *
 * @example Embedded mode
 * ```typescript
 * import { attachDevTools } from "aidk-devtools";
 * import { createEngine } from "aidk";
 *
 * const engine = createEngine();
 * const detach = attachDevTools(engine, { port: 3004, open: true });
 *
 * // Later, to stop:
 * detach();
 * ```
 *
 * @example Remote mode (with engine)
 * ```typescript
 * import { attachDevTools } from "aidk-devtools";
 * import { createEngine } from "aidk";
 *
 * const engine = createEngine({ devTools: { remote: true, remoteUrl: "http://localhost:3004" } });
 * const detach = attachDevTools(engine, {
 *   remote: { url: "http://localhost:3004", secret: process.env.DEVTOOLS_SECRET }
 * });
 * ```
 *
 * @example Remote mode (no engine - just kernel observability)
 * ```typescript
 * import { attachDevTools } from "aidk-devtools";
 *
 * // Start kernel subscriber for remote mode without an engine reference
 * const detach = attachDevTools({
 *   remote: { url: "http://localhost:3004" },
 *   debug: true
 * });
 * ```
 */
export function attachDevTools(options: DevToolsOptions = {}): () => void {
  // Handle overloaded signatures:
  // attachDevTools(options) - remote mode without engine
  // attachDevTools(engine, options) - with engine
  const engine: DevToolsEngine | null = options?.instance ?? null;
  const isRemoteMode = !!options?.remote;

  if (options?.debug) {
    console.log("[DevTools] attachDevTools called", {
      engineId: engine?.id ?? "(no engine)",
      hasEngineHooks: !!engine?.engineHooks,
      mode: isRemoteMode ? "remote" : "embedded",
    });
  }

  const unsubscribers: (() => void)[] = [];

  if (isRemoteMode) {
    if (engine) {
      throw new Error("attachDevTools: engine is not allowed for remote mode.");
    }
    // Remote mode: start kernel subscriber to POST events to remote server
    if (!isKernelSubscriberActive()) {
      const stopSubscriber = startKernelSubscriber({
        debug: options?.debug,
        remote: {
          url: options?.remote!.url,
          secret: options?.remote!.secret,
        },
      });
      unsubscribers.push(stopSubscriber);
    }
  } else {
    if (!engine) {
      throw new Error("attachDevTools: engine is required for embedded mode.");
    }
    // Embedded mode: start local server + kernel subscriber
    initDevTools(options);
  }

  // Track discovered tools per execution (from tool_call events as fallback)
  const executionTools = new Map<string, Map<string, ToolDefinition>>();

  // Register stream middleware to capture content_delta, tool_call, tool_result events
  // Only if we have an engine with hooks
  //
  // IMPORTANT: Middleware pattern for async iterable procedures (like engine.stream)
  // ================================================================================
  // Middleware signature is: (args, envelope, next) => Promise<result>
  //
  // For async iterable procedures:
  //   1. Call `const stream = await next()` to get the AsyncIterable
  //   2. Return a NEW async generator that iterates over `stream`
  //   3. Yield each event (optionally modified) from within the generator
  //
  // WRONG (causes "next is not a function"):
  //   async function middleware(next, input) { ... }  // ❌ Wrong arg order
  //
  // CORRECT:
  //   async function middleware(args, envelope, next) {
  //     const stream = await next();  // ✅ next is third arg
  //     return (async function* () {
  //       for await (const event of stream) { yield event; }
  //     })();
  //   }
  //
  if (engine?.engineHooks) {
    const engineId = engine.id;
    const streamMiddleware = async (
      _args: any[],
      _envelope: any,
      next: () => Promise<AsyncIterable<any>>,
    ): Promise<AsyncIterable<any>> => {
      // Get the stream from the next middleware
      const stream = await next();

      // Get execution context for this stream
      let executionId = engineId;
      // Track current tick ourselves - don't rely on event.tick which may be stale
      let currentTick = 1;

      // Return an async generator that intercepts events
      return (async function* () {
        for await (const event of stream) {
          // Extract executionId from event if available
          if (event.executionId) {
            executionId = event.executionId;
          }

          // Update current tick from tick_start events (authoritative source)
          if (event.type === "tick_start" && typeof event.tick === "number") {
            currentTick = event.tick;
          }

          switch (event.type) {
            case "content_delta":
              if (event.delta) {
                devtools.contentDelta(executionId, currentTick, event.delta);
              }
              break;

            case "tool_call":
              // Track discovered tools for this execution
              if (!executionTools.has(executionId)) {
                executionTools.set(executionId, new Map());
              }
              const toolsMap = executionTools.get(executionId)!;
              if (event.name && !toolsMap.has(event.name)) {
                // Record this tool (we only have name and input from the call)
                toolsMap.set(event.name, {
                  name: event.name,
                  description: "", // Not available from tool_call event
                  input: event.input ? { example: event.input } : {},
                });
              }
              devtools.toolCall(executionId, currentTick, event.name, event.callId, event.input);
              break;

            case "tool_result":
              devtools.toolResult(
                executionId,
                currentTick,
                event.callId,
                event.result,
                event.isError,
              );
              break;

            case "execution_start":
              executionId = event.executionId || executionId;
              break;

            // tick_end and message_end events are now handled by the engine's
            // internal devTools emission, so we don't emit them here to avoid duplicates

            case "model_start":
              // Capture when model execution starts
              if (event.modelId) {
                devtools.modelStart(executionId, currentTick, event.modelId, event.provider);
              }
              break;

            case "message":
              // Capture the final model output message with raw provider response
              if (options?.debug) {
                console.log("[DevTools] message event:", {
                  hasMessage: !!event.message,
                  hasUsage: !!event.usage,
                  usage: event.usage,
                  model: event.model,
                  tick: currentTick,
                });
              }
              if (event.message) {
                devtools.modelOutput(executionId, currentTick, event.message, event.raw);
              }
              // Note: tick_end is emitted by the engine, not here (to avoid duplicates)
              break;
          }

          // Debug log all events if needed
          if (options?.debug && event.type !== "content_delta") {
            console.log("[DevTools] Stream event:", event.type, { tick: currentTick, executionId });
          }

          // Pass through the event unchanged
          yield event;
        }
      })();
    };

    engine.engineHooks.register("stream", streamMiddleware);
  }

  // Return detach function
  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
    unsubscribers.length = 0;
    executionTools.clear();
  };
}

/**
 * Initialize devtools. Call this when engine is created with devTools option.
 * This starts both the DevTools server and the kernel-level event subscriber.
 */
export function initDevTools(options: DevToolsOptions = {}): void {
  // Start the DevTools server
  getDevToolsServer(options);

  // Start kernel-level event subscriber (captures all procedure events)
  if (!isKernelSubscriberActive()) {
    startKernelSubscriber({ debug: options.debug });
  }
}

/**
 * Initialize kernel subscriber for remote mode.
 *
 * @deprecated Use `attachDevTools({ remote: { url, secret }, debug })` instead.
 * This provides a unified API for both embedded and remote modes.
 *
 * @example
 * ```typescript
 * // OLD (deprecated):
 * import { initKernelSubscriberRemote } from "aidk-devtools";
 * const stop = initKernelSubscriberRemote({ url: "http://localhost:3004" });
 *
 * // NEW (preferred):
 * import { attachDevTools } from "aidk-devtools";
 * const detach = attachDevTools({ remote: { url: "http://localhost:3004" } });
 * ```
 */
export function initKernelSubscriberRemote(options: {
  url: string;
  secret?: string;
  debug?: boolean;
}): () => void {
  if (isKernelSubscriberActive()) {
    console.log("[DevTools] Kernel subscriber already active");
    return () => stopKernelSubscriber();
  }

  console.log("[DevTools] Starting kernel subscriber for remote mode", { url: options.url });

  return startKernelSubscriber({
    debug: options.debug,
    remote: {
      url: options.url,
      secret: options.secret,
    },
  });
}

/**
 * Check if devtools is currently active
 */
export { isDevToolsActive };

/**
 * DevTools event emitter - provides typed helpers for emitting events.
 * All methods are no-ops if devtools is not initialized.
 */
export const devtools = {
  /**
   * Emit when an execution starts
   */
  executionStart(executionId: string, agentName: string, sessionId?: string): void {
    emitDevToolsEvent({
      type: "execution_start",
      executionId,
      agentName,
      sessionId,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when an execution ends
   */
  executionEnd(executionId: string, totalUsage: TokenUsage): void {
    emitDevToolsEvent({
      type: "execution_end",
      executionId,
      totalUsage,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when a tick starts
   */
  tickStart(executionId: string, tick: number): void {
    emitDevToolsEvent({
      type: "tick_start",
      executionId,
      tick,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when a tick ends
   */
  tickEnd(
    executionId: string,
    tick: number,
    usage?: TokenUsage,
    stopReason?: string,
    model?: string,
  ): void {
    emitDevToolsEvent({
      type: "tick_end",
      executionId,
      tick,
      usage,
      stopReason,
      model,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when JSX is compiled to messages/tools
   */
  compiled(
    executionId: string,
    tick: number,
    messages: Message[],
    tools: ToolDefinition[],
    system?: string,
  ): void {
    emitDevToolsEvent({
      type: "compiled",
      executionId,
      tick,
      messages,
      tools,
      system,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when model execution starts
   */
  modelStart(executionId: string, tick: number, modelId: string, provider?: string): void {
    emitDevToolsEvent({
      type: "model_start",
      executionId,
      tick,
      modelId,
      provider,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit final model output message
   */
  modelOutput(executionId: string, tick: number, message: Message, raw?: unknown): void {
    emitDevToolsEvent({
      type: "model_output",
      executionId,
      tick,
      message,
      raw,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit streaming content delta
   */
  contentDelta(executionId: string, tick: number, delta: string): void {
    emitDevToolsEvent({
      type: "content_delta",
      executionId,
      tick,
      delta,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when a tool is called
   */
  toolCall(
    executionId: string,
    tick: number,
    toolName: string,
    toolUseId: string,
    input: unknown,
  ): void {
    emitDevToolsEvent({
      type: "tool_call",
      executionId,
      tick,
      toolName,
      toolUseId,
      input,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when a tool returns a result
   */
  toolResult(
    executionId: string,
    tick: number,
    toolUseId: string,
    result: unknown,
    isError?: boolean,
  ): void {
    emitDevToolsEvent({
      type: "tool_result",
      executionId,
      tick,
      toolUseId,
      result,
      isError,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit when state changes (signals, COM state)
   */
  stateChange(
    executionId: string,
    tick: number,
    key: string,
    oldValue: unknown,
    newValue: unknown,
  ): void {
    emitDevToolsEvent({
      type: "state_change",
      executionId,
      tick,
      key,
      oldValue,
      newValue,
      timestamp: Date.now(),
    });
  },

  /**
   * Emit a raw event (for custom events)
   */
  emit(event: DevToolsEvent): void {
    emitDevToolsEvent(event);
  },
};
