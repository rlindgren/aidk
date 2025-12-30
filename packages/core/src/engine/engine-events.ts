import type { AgentToolCall, AgentToolResult, ToolConfirmationResult } from "../tool/tool";
import type { COMInput } from "../com/types";
import type { EngineResponse } from "./engine-response";

/**
 * Engine Stream Events (Model-Agnostic)
 */
export type EngineStreamEvent =
  | {
      type: "execution_start";
      executionId: string;
      threadId: string;
      sessionId?: string;
      timestamp: string;
    }
  | { type: "agent_start"; agent_name: string; timestamp: string }
  | { type: "tick_start"; tick: number; timestamp: string }
  | { type: "model_chunk"; chunk: unknown; tick: number } // Opaque chunk from model
  | { type: "tool_call"; call: AgentToolCall; tick: number }
  | { type: "tool_result"; result: AgentToolResult; tick: number }
  | {
      type: "tool_confirmation_required";
      call: AgentToolCall;
      message: string;
      tick: number;
    }
  | {
      type: "tool_confirmation_result";
      confirmation: ToolConfirmationResult;
      tick: number;
    }
  | {
      type: "tick_end";
      tick: number;
      response: EngineResponse;
      timestamp: string;
    }
  | { type: "agent_end"; output: COMInput; timestamp: string }
  | {
      type: "execution_end";
      executionId: string;
      threadId: string;
      sessionId?: string;
      timestamp: string;
    }
  | { type: "error"; error: Error; timestamp: string };

/** @deprecated Use EngineStreamEvent instead */
export type AgentStreamEvent = EngineStreamEvent;
