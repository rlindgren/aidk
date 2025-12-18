import type { AgentToolCall, AgentToolResult } from '../tool/tool';
import type { COMInput } from '../com/types';
import type { EngineResponse } from './engine-response';

/**
 * Engine Stream Events (Model-Agnostic)
 */
export type EngineStreamEvent =
  | { type: 'execution_start'; execution_id: string; thread_id: string; session_id?: string; timestamp: string }
  | { type: 'agent_start'; agent_name: string; timestamp: string }
  | { type: 'tick_start'; tick: number; timestamp: string }
  | { type: 'model_chunk'; chunk: unknown; tick: number } // Opaque chunk from model
  | { type: 'tool_call'; call: AgentToolCall; tick: number }
  | { type: 'tool_result'; result: AgentToolResult; tick: number }
  | { type: 'tick_end'; tick: number; response: EngineResponse; timestamp: string }
  | { type: 'agent_end'; output: COMInput; timestamp: string }
  | { type: 'execution_end'; execution_id: string; thread_id: string; session_id?: string; timestamp: string }
  | { type: 'error'; error: Error; timestamp: string };

// Re-export for backward compatibility (deprecated)
export type AgentStreamEvent = EngineStreamEvent;

