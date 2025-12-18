import { randomUUID } from 'crypto';
import { EventEmitter } from 'node:events';
import type { EngineInput, COMInput } from '../com/types';
import type { JSX } from '../jsx/jsx-runtime';
import type { ComponentDefinition } from '../component/component';

/**
 * Signal types for execution and engine signals
 */
export type SignalType = 
  | 'abort'           // Immediate abort (like SIGKILL)
  | 'interrupt'       // Graceful interrupt (like SIGTERM)
  | 'pause'           // Pause execution
  | 'resume'          // Resume execution
  | 'shutdown'        // Graceful shutdown (like SIGTERM for process) - ENGINE LEVEL ONLY
  | string;           // Custom signals

/**
 * Signal event structure
 */
export interface SignalEvent {
  type: SignalType;
  source: 'engine' | 'execution' | 'parent' | 'external';
  pid?: string;              // Execution PID (if execution-specific)
  parentPid?: string;        // Parent PID (if child execution)
  reason?: string;           // Reason for signal
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Execution status
 */
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'pending';
export const ExecutionStatuses: ExecutionStatus[] = ['running', 'completed', 'failed', 'cancelled', 'pending'];

/**
 * Execution type
 */
export type ExecutionType = 'root' | 'spawn' | 'fork';
export const ExecutionTypes: ExecutionType[] = ['root', 'spawn', 'fork'];

/**
 * Fork inheritance options
 */
export interface ForkInheritanceOptions {
  /**
   * How to inherit timeline entries
   * - 'copy': Deep copy timeline entries
   * - 'reference': Share reference (modifications affect parent)
   */
  timeline?: 'copy' | 'reference';
  
  /**
   * How to inherit sections
   * - 'copy': Deep copy sections
   * - 'reference': Share reference (modifications affect parent)
   */
  sections?: 'copy' | 'reference';
  
  /**
   * Share tools (always shared, not copied)
   */
  tools?: 'share';
  
  /**
   * Inherit channels service
   */
  channels?: boolean;
  
  /**
   * Inherit traceId (for distributed tracing)
   */
  traceId?: boolean;
  
  /**
   * Inherit context properties (metadata, user, traceId, etc.)
   * These are Kernel-level context properties that can be shared across executions.
   */
  context?: boolean;
  
  /**
   * Inherit hooks (component, model, tool, engine hooks)
   * Default: true (hooks are inherited from parent engine)
   */
  hooks?: boolean;
}

/**
 * Execution state for persistence and recovery
 */
export interface ExecutionState {
  pid: string;
  parentPid?: string;
  rootPid: string;
  type: ExecutionType;
  status: ExecutionStatus;
  input: EngineInput;
  agent: ComponentDefinition; // Serialized component definition
  currentTick: number;
  previousState?: COMInput;
  startedAt: Date;
  completedAt?: Date;
  error?: {
    message: string;
    stack?: string;
    phase?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Execution handle for managing an execution lifecycle
 * Extends EventEmitter for signal handling
 */
export interface ExecutionHandle extends EventEmitter {
  /**
   * Process ID (unique identifier for this execution)
   */
  pid: string;
  
  /**
   * Parent process ID (if this is a fork/spawn)
   */
  parentPid?: string;
  
  /**
   * Root process ID (top-level execution)
   */
  rootPid: string;
  
  /**
   * Execution status
   */
  status: ExecutionStatus;
  
  /**
   * Execution type
   */
  type: ExecutionType;
  
  /**
   * When execution started
   */
  startedAt: Date;
  
  /**
   * When execution completed (if completed)
   */
  completedAt?: Date;
  
  /**
   * Wait for execution to complete
   */
  waitForCompletion(options?: { timeout?: number }): Promise<COMInput>;
  
  /**
   * Cancel the execution (triggers abort signal)
   */
  cancel(reason?: string): void;
  
  /**
   * Get execution result (if completed)
   */
  getResult(): COMInput | undefined;
  
  /**
   * Stream execution events
   */
  stream(): AsyncIterable<any>;
  
  /**
   * Get execution metrics
   */
  getMetrics(): ExecutionMetrics;
  
  /**
   * Get execution duration in milliseconds
   */
  getDuration(): number;
  
  /**
   * Get the cancel signal (if cancel controller is set)
   */
  getCancelSignal(): AbortSignal | undefined;
  
  /**
   * Get procedure graph for this execution (if procedures were executed)
   * Returns undefined if no procedures were executed in this execution's context
   */
  getProcedureGraph(): import('aidk-kernel').ProcedureGraph | undefined;
  
  /**
   * Get aggregated metrics from all procedures in this execution
   * Includes both execution-level metrics and procedure-level metrics
   */
  getProcedureMetrics(): Record<string, number>;
  
  /**
   * Emit signal for this execution (and its children)
   */
  emitSignal(signal: SignalType, reason?: string, metadata?: Record<string, any>): void;
  
  /**
   * Register graceful shutdown hook for this execution
   */
  onShutdown(handler: () => Promise<void> | void): () => void;
}

/**
 * Execution metrics
 */
export interface ExecutionMetrics {
  pid: string;
  parentPid?: string;
  rootPid: string;
  type: ExecutionType;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  duration: number;
  tickCount: number;
  error?: {
    message: string;
    phase?: string;
  };
}

/**
 * Execution tree node
 */
export interface ExecutionTreeNode {
  pid: string;
  parentPid?: string;
  rootPid: string;
  type: ExecutionType;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  children: ExecutionTreeNode[];
  metrics: ExecutionMetrics;
}

/**
 * Engine metrics
 */
export interface EngineMetrics {
  /**
   * Number of active executions
   */
  activeExecutions: number;
  
  /**
   * Total number of executions (including completed)
   */
  totalExecutions: number;
  
  /**
   * Executions by status
   */
  executionsByStatus: Record<ExecutionStatus, number>;
  
  /**
   * Executions by type
   */
  executionsByType: Record<ExecutionType, number>;
  
  /**
   * Average execution duration (ms)
   */
  averageExecutionTime: number;
  
  /**
   * Memory usage
   */
  memoryUsage: NodeJS.MemoryUsage;
  
  /**
   * Timestamp of metrics collection
   */
  timestamp: Date;
}

/**
 * Generate a unique process ID
 */
export function generatePid(prefix: string = 'exec'): string {
  try {
    return `${prefix}_${randomUUID()}`;
  } catch {
    // Fallback if crypto.randomUUID is not available
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }
}

