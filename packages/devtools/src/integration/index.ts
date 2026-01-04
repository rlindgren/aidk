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
  type DevToolsOptions,
} from "../server";
import type { DevToolsEvent } from "../events";

export { type DevToolsOptions } from "../server";

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
 * NOTE: If the engine has `devTools: true` in its config (or auto-detected from
 * DEVTOOLS env var), lifecycle events (execution_start, tick_start, etc.) are
 * already emitted by the engine itself. This function only adds stream middleware
 * for streaming events (content_delta, tool_call, tool_result) which the engine
 * doesn't emit directly.
 *
 * @example
 * ```typescript
 * import { attachDevTools } from "aidk-devtools/integration";
 * import { Engine } from "aidk";
 *
 * const engine = new Engine({ ... });
 * const detach = attachDevTools(engine);
 *
 * // Later, to stop sending events:
 * detach();
 * ```
 */
export function attachDevTools(engine: DevToolsEngine, options: DevToolsOptions = {}): () => void {
  // Always log when attaching (helps debug)
  console.log("[DevTools] attachDevTools called", {
    engineId: engine.id,
    hasEngineHooks: !!engine.engineHooks,
    debug: options.debug,
  });

  // Initialize the server if not already running
  initDevTools(options);

  const unsubscribers: (() => void)[] = [];

  // Track discovered tools per execution (from tool_call events as fallback)
  const executionTools = new Map<string, Map<string, ToolDefinition>>();

  // Register stream middleware to capture content_delta, tool_call, tool_result events
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
  if (engine.engineHooks) {
    console.log("[DevTools] Registering stream middleware");
    const streamMiddleware = async (
      args: any[],
      envelope: any,
      next: () => Promise<AsyncIterable<any>>,
    ): Promise<AsyncIterable<any>> => {
      console.log("[DevTools] Stream middleware CALLED");

      // Get the stream from the next middleware
      const stream = await next();
      console.log("[DevTools] Stream obtained from next()");

      // Get execution context for this stream
      let executionId = engine.id;
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
              if (options.debug) {
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
          if (options.debug && event.type !== "content_delta") {
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
 */
export function initDevTools(options: DevToolsOptions = {}): void {
  getDevToolsServer(options);
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
