/**
 * Shared Server Types
 * 
 * Framework-agnostic entity interfaces and repository patterns
 * for engine persistence and state management.
 */

import type { MessageRoles } from "aidk";

// =============================================================================
// Entity Interfaces
// =============================================================================

export interface ExecutionEntity {
  id: string;
  type: 'agent' | 'model' | 'tool';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  root_id?: string;
  parent_id?: string;
  thread_id?: string;
  user_id?: string;
  tenant_id: string;
  interaction_id?: string;
  started_at: Date;
  completed_at?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface MetricsEntity {
  id: string;
  execution_id: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost: number;
  llm_calls: number;
  tool_calls: number;
  agent_calls: number;
  function_calls: number;
  code_runs: number;
  executions: number;
  requests: number;
  tenant_id: string;
  user_id?: string;
  thread_id?: string;
}

export interface MessageEntity {
  id: string;
  execution_id: string;
  interaction_id?: string;
  thread_id: string;
  user_id?: string;  // For user-global events (thread_id = nil UUID)
  role: MessageRoles;
  content: string; // JSON string
  source?: string;
  created_at: Date;
  metadata?: string;
}

export interface MessageBlockEntity {
  id: string;
  message_id: string;
  block_index: number;
  block_type: string;
  block_data: string; // JSON string
  created_at: Date;
}

export interface InteractionEntity {
  id: string;
  type: string;
  origin: string;
  app_origin: string;
  agent_id?: string;
  thread_id: string;
  root_execution_id?: string;
  user_id?: string;
  tenant_id: string;
  status?: string;
  created_at: Date;
}

export interface ToolStateEntity {
  id: string;
  tool_id: string;
  thread_id: string;
  user_id: string;
  tenant_id: string;
  state_data: string; // JSON string
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// Repository Interfaces
// =============================================================================

export interface ExecutionRepository {
  create(data: Omit<ExecutionEntity, 'started_at'> & { started_at?: Date }): Promise<ExecutionEntity>;
  update(id: string, updates: Partial<ExecutionEntity>): Promise<ExecutionEntity | null>;
  findById(id: string): Promise<ExecutionEntity | null>;
  findByThreadId(threadId: string, limit?: number): Promise<ExecutionEntity[]>;
  findByUserId(userId: string, limit?: number): Promise<ExecutionEntity[]>;
  findByRootId(rootId: string): Promise<ExecutionEntity[]>;
  findAll(params?: {
    thread_id?: string;
    user_id?: string;
    tenant_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExecutionEntity[]>;
}

export interface MetricsRepository {
  create(data: MetricsEntity): Promise<MetricsEntity>;
  update(id: string, updates: Partial<MetricsEntity>): Promise<MetricsEntity | null>;
  findByExecutionId(executionId: string): Promise<MetricsEntity | null>;
  aggregate(params?: {
    thread_id?: string;
    user_id?: string;
    tenant_id?: string;
  }): Promise<Partial<MetricsEntity>>;
}

/**
 * Nil UUID used for user-global events (not tied to any specific thread).
 * @see libs/engine/example/backend/src/services/todo-list.service.ts
 */
export const GLOBAL_THREAD_ID = '00000000-0000-0000-0000-000000000000';

export interface MessageRepository {
  create(data: Omit<MessageEntity, 'created_at'> & { created_at?: Date }): Promise<MessageEntity>;
  findByThreadId(threadId: string, limit?: number): Promise<MessageEntity[]>;
  findByExecutionId(executionId: string): Promise<MessageEntity[]>;
  /**
   * Find messages for a thread, including user-global events.
   * Returns thread-specific messages + any events with thread_id = GLOBAL_THREAD_ID for this user.
   * Results are ordered by created_at for proper interleaving.
   */
  findByThreadIdWithGlobalEvents(threadId: string, userId: string, limit?: number): Promise<MessageEntity[]>;
}

export interface MessageBlockRepository {
  create(data: Omit<MessageBlockEntity, 'created_at'> & { created_at?: Date }): Promise<MessageBlockEntity>;
  findByMessageId(messageId: string): Promise<MessageBlockEntity[]>;
}

export interface InteractionRepository {
  create(data: Omit<InteractionEntity, 'created_at'> & { created_at?: Date }): Promise<InteractionEntity>;
  update(id: string, updates: Partial<InteractionEntity>): Promise<InteractionEntity | null>;
  findById(id: string): Promise<InteractionEntity | null>;
  findByThreadId(threadId: string): Promise<InteractionEntity[]>;
}

export interface ToolStateRepository {
  create(data: Omit<ToolStateEntity, 'created_at' | 'updated_at'> & { 
    created_at?: Date; 
    updated_at?: Date; 
  }): Promise<ToolStateEntity>;
  update(id: string, updates: Partial<ToolStateEntity>): Promise<ToolStateEntity | null>;
  findByToolAndThread(
    toolId: string, 
    threadId: string, 
    userId?: string, 
    tenantId?: string
  ): Promise<ToolStateEntity | null>;
  findByToolAndUser(toolId: string, userId: string): Promise<ToolStateEntity[]>;
  /** Create or update tool state by tool_id + thread_id */
  upsert(data: Omit<ToolStateEntity, 'id' | 'created_at' | 'updated_at'> & { 
    updated_at?: Date;
  }): Promise<ToolStateEntity>;
}

// =============================================================================
// Persistence Hooks Config
// =============================================================================

export interface PersistenceRepositories {
  executionRepo: ExecutionRepository;
  metricsRepo: MetricsRepository;
  messageRepo: MessageRepository;
  messageBlockRepo: MessageBlockRepository;
  interactionRepo: InteractionRepository;
  toolStateRepo: ToolStateRepository;
}

