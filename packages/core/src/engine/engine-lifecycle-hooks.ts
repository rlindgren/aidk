import type { Procedure } from "aidk-kernel";
import { BaseHookRegistry } from "../hooks/base-hook-registry";
import { Engine } from "./engine";
import type { EngineInput, COMInput } from "../com/types";
import type { ComponentDefinition } from "../component/component";
import type { ExecutionHandle } from "./execution-types";
import type { TickState } from "../component/component";
import type { EngineResponse } from "./engine-response";
import type { CompiledStructure } from "../compiler/types";
import type { AgentToolCall, AgentToolResult, ToolConfirmationResult } from "../tool/tool";

export type EngineLifecycleHookName =
  | "onInit"
  | "onShutdown"
  | "onDestroy"
  | "onExecutionStart"
  | "onExecutionEnd"
  | "onExecutionError"
  | "onTickStart"
  | "onTickEnd"
  | "onAfterCompile"
  | "onToolConfirmation"
  | "onClientToolResult";

export type EngineLifecycleSelector = undefined; // Global (all engines)

export type EngineLifecycleHookArgs<T extends EngineLifecycleHookName> = T extends "onInit"
  ? [engine: Engine]
  : T extends "onShutdown"
    ? [engine: Engine, reason?: string]
    : T extends "onDestroy"
      ? [engine: Engine]
      : T extends "onExecutionStart"
        ? [input: EngineInput, agent?: ComponentDefinition, handle?: ExecutionHandle]
        : T extends "onExecutionEnd"
          ? [output: COMInput, handle?: ExecutionHandle]
          : T extends "onExecutionError"
            ? [error: Error, handle?: ExecutionHandle]
            : T extends "onTickStart"
              ? [tick: number, state: TickState, handle?: ExecutionHandle]
              : T extends "onTickEnd"
                ? [
                    tick: number,
                    state: TickState,
                    response: EngineResponse,
                    handle?: ExecutionHandle,
                  ]
                : T extends "onAfterCompile"
                  ? [compiled: CompiledStructure, state: TickState, handle?: ExecutionHandle]
                  : T extends "onToolConfirmation"
                    ? [
                        confirmation: ToolConfirmationResult,
                        call: AgentToolCall,
                        handle?: ExecutionHandle,
                      ]
                    : T extends "onClientToolResult"
                      ? [result: AgentToolResult, call: AgentToolCall, handle?: ExecutionHandle]
                      : never;

/**
 * Engine lifecycle hook - a Procedure that performs side effects.
 * Like component lifecycle hooks, these are Procedures for middleware support.
 * However, they follow a side-effect-only contract (no input/output transformation).
 */
export type EngineLifecycleHook<T extends EngineLifecycleHookName> = Procedure<
  (...args: EngineLifecycleHookArgs<T>) => Promise<void>
>;

/**
 * Engine lifecycle hook registry.
 * Uses BaseHookRegistry to reduce code duplication.
 */
export class EngineLifecycleHookRegistry extends BaseHookRegistry<
  EngineLifecycleHookName,
  EngineLifecycleSelector,
  EngineLifecycleHook<EngineLifecycleHookName>
> {
  protected getAllHookNames(): readonly EngineLifecycleHookName[] {
    return [
      "onInit",
      "onShutdown",
      "onDestroy",
      "onExecutionStart",
      "onExecutionEnd",
      "onExecutionError",
      "onTickStart",
      "onTickEnd",
      "onAfterCompile",
      "onToolConfirmation",
      "onClientToolResult",
    ] as const;
  }

  /**
   * Get all middleware for a lifecycle hook.
   * Currently only supports global hooks (all engines).
   */
  getMiddleware<T extends EngineLifecycleHookName>(hookName: T): EngineLifecycleHook<T>[] {
    return this.registry.getMiddleware(
      hookName,
      () => [], // No selectors for now - only global hooks
    ) as EngineLifecycleHook<T>[];
  }
}
