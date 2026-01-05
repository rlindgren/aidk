/**
 * DevTools Event Types
 *
 * Re-exported from aidk-shared for backward compatibility.
 * New code should import directly from aidk-shared.
 *
 * @module aidk-devtools/events
 */

import type {
  DTExecutionStartEvent,
  DTExecutionEndEvent,
  DTTickStartEvent,
  DTTickEndEvent,
  DTCompiledEvent,
  DTModelStartEvent,
  DTModelOutputEvent,
  DTContentDeltaEvent,
  DTReasoningDeltaEvent,
  DTToolCallEvent,
  DTToolResultEvent,
  DTToolConfirmationEvent,
  DTStateChangeEvent,
  DTProcedureStartEvent,
  DTProcedureEndEvent,
  DTProcedureErrorEvent,
} from "aidk-shared";

// Re-export constants, emitter, and helpers from aidk-shared
export {
  DEVTOOLS_CHANNEL,
  type DevToolsEvent,
  type DevToolsEventBase,
  type ExecutionContextFields,
  type DevToolsConfig,
  devToolsEmitter,
  type DevToolsSubscriber,
  type DevToolsBatchSubscriber,
  normalizeDevToolsConfig,
} from "aidk-shared";

// Type aliases for backward compatibility (without DT prefix)
export type ExecutionStartEvent = DTExecutionStartEvent;
export type ExecutionEndEvent = DTExecutionEndEvent;
export type TickStartEvent = DTTickStartEvent;
export type TickEndEvent = DTTickEndEvent;
export type CompiledEvent = DTCompiledEvent;
export type ModelStartEvent = DTModelStartEvent;
export type ModelOutputEvent = DTModelOutputEvent;
export type ContentDeltaEvent = DTContentDeltaEvent;
export type ReasoningDeltaEvent = DTReasoningDeltaEvent;
export type ToolCallEvent = DTToolCallEvent;
export type ToolResultEvent = DTToolResultEvent;
export type ToolConfirmationEvent = DTToolConfirmationEvent;
export type StateChangeEvent = DTStateChangeEvent;
export type ProcedureStartEvent = DTProcedureStartEvent;
export type ProcedureEndEvent = DTProcedureEndEvent;
export type ProcedureErrorEvent = DTProcedureErrorEvent;
