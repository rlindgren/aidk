/**
 * In-Memory Store Implementation
 * 
 * Simple Map-based storage for development and testing.
 * Provides repository implementations that store data in memory.
 */

import type {
  ExecutionEntity,
  MetricsEntity,
  MessageEntity,
  MessageBlockEntity,
  InteractionEntity,
  ToolStateEntity,
  ExecutionRepository,
  MetricsRepository,
  MessageRepository,
  MessageBlockRepository,
  InteractionRepository,
  ToolStateRepository,
  PersistenceRepositories,
} from '../types';

// =============================================================================
// Store Interface
// =============================================================================

export interface InMemoryStore {
  executions: Map<string, ExecutionEntity>;
  metrics: Map<string, MetricsEntity>;
  messages: Map<string, MessageEntity>;
  messageBlocks: Map<string, MessageBlockEntity>;
  interactions: Map<string, InteractionEntity>;
  toolState: Map<string, ToolStateEntity>;
}

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create a new in-memory store instance
 */
export function createInMemoryStore(): InMemoryStore {
  return {
    executions: new Map(),
    metrics: new Map(),
    messages: new Map(),
    messageBlocks: new Map(),
    interactions: new Map(),
    toolState: new Map(),
  };
}

/**
 * Clear all data from a store
 */
export function clearStore(store: InMemoryStore): void {
  store.executions.clear();
  store.metrics.clear();
  store.messages.clear();
  store.messageBlocks.clear();
  store.interactions.clear();
  store.toolState.clear();
}

// =============================================================================
// Repository Implementations
// =============================================================================

export class InMemoryExecutionRepository implements ExecutionRepository {
  constructor(private store: InMemoryStore) {}

  async create(data: Omit<ExecutionEntity, 'started_at'> & { started_at?: Date }): Promise<ExecutionEntity> {
    const entity: ExecutionEntity = {
      ...data,
      started_at: data.started_at || new Date(),
      tenant_id: data.tenant_id || 'default',
    };
    this.store.executions.set(entity.id, entity);
    return entity;
  }

  async update(id: string, updates: Partial<ExecutionEntity>): Promise<ExecutionEntity | null> {
    const existing = this.store.executions.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.store.executions.set(id, updated);
    return updated;
  }

  async findById(id: string): Promise<ExecutionEntity | null> {
    return this.store.executions.get(id) || null;
  }

  async findByThreadId(threadId: string, limit = 100): Promise<ExecutionEntity[]> {
    return Array.from(this.store.executions.values())
      .filter(e => e.thread_id === threadId)
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
      .slice(0, limit);
  }

  async findByUserId(userId: string, limit = 100): Promise<ExecutionEntity[]> {
    return Array.from(this.store.executions.values())
      .filter(e => e.user_id === userId)
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
      .slice(0, limit);
  }

  async findByRootId(rootId: string): Promise<ExecutionEntity[]> {
    return Array.from(this.store.executions.values())
      .filter(e => e.root_id === rootId)
      .sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
  }

  async findAll(params?: {
    thread_id?: string;
    user_id?: string;
    tenant_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExecutionEntity[]> {
    let results = Array.from(this.store.executions.values());
    
    if (params?.thread_id) {
      results = results.filter(e => e.thread_id === params.thread_id);
    }
    if (params?.user_id) {
      results = results.filter(e => e.user_id === params.user_id);
    }
    if (params?.tenant_id) {
      results = results.filter(e => e.tenant_id === params.tenant_id);
    }
    
    results.sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
    
    const offset = params?.offset || 0;
    const limit = params?.limit || 100;
    return results.slice(offset, offset + limit);
  }
}

export class InMemoryMetricsRepository implements MetricsRepository {
  constructor(private store: InMemoryStore) {}

  async create(data: MetricsEntity): Promise<MetricsEntity> {
    this.store.metrics.set(data.id, data);
    return data;
  }

  async update(id: string, updates: Partial<MetricsEntity>): Promise<MetricsEntity | null> {
    const existing = this.store.metrics.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.store.metrics.set(id, updated);
    return updated;
  }

  async findByExecutionId(executionId: string): Promise<MetricsEntity | null> {
    return Array.from(this.store.metrics.values())
      .find(m => m.execution_id === executionId) || null;
  }

  async aggregate(params?: {
    thread_id?: string;
    user_id?: string;
    tenant_id?: string;
  }): Promise<Partial<MetricsEntity>> {
    let metrics = Array.from(this.store.metrics.values());
    
    if (params?.thread_id) {
      metrics = metrics.filter(m => m.thread_id === params.thread_id);
    }
    if (params?.user_id) {
      metrics = metrics.filter(m => m.user_id === params.user_id);
    }
    if (params?.tenant_id) {
      metrics = metrics.filter(m => m.tenant_id === params.tenant_id);
    }
    
    return metrics.reduce((acc, m) => ({
      input_tokens: (acc.input_tokens || 0) + m.input_tokens,
      output_tokens: (acc.output_tokens || 0) + m.output_tokens,
      cached_tokens: (acc.cached_tokens || 0) + m.cached_tokens,
      cost: (acc.cost || 0) + m.cost,
      llm_calls: (acc.llm_calls || 0) + m.llm_calls,
      tool_calls: (acc.tool_calls || 0) + m.tool_calls,
      agent_calls: (acc.agent_calls || 0) + m.agent_calls,
      function_calls: (acc.function_calls || 0) + m.function_calls,
      code_runs: (acc.code_runs || 0) + m.code_runs,
      executions: (acc.executions || 0) + m.executions,
      requests: (acc.requests || 0) + m.requests,
    }), {} as Partial<MetricsEntity>);
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  constructor(private store: InMemoryStore) {}

  async create(data: Omit<MessageEntity, 'created_at'> & { created_at?: Date }): Promise<MessageEntity> {
    const entity: MessageEntity = {
      ...data,
      created_at: data.created_at || new Date(),
    };
    this.store.messages.set(entity.id, entity);
    return entity;
  }

  async findByThreadId(threadId: string, limit = 100): Promise<MessageEntity[]> {
    return Array.from(this.store.messages.values())
      .filter(m => m.thread_id === threadId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, limit);
  }

  async findByExecutionId(executionId: string): Promise<MessageEntity[]> {
    return Array.from(this.store.messages.values())
      .filter(m => m.execution_id === executionId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  /**
   * Find messages for a thread, including user-global events.
   * 
   * User-global events (thread_id = nil UUID) are interleaved with thread-specific
   * messages by timestamp, providing the agent with full context of what happened
   * across all the user's conversations.
   */
  async findByThreadIdWithGlobalEvents(threadId: string, userId: string, limit = 100): Promise<MessageEntity[]> {
    const GLOBAL_THREAD_ID = '00000000-0000-0000-0000-000000000000';
    
    return Array.from(this.store.messages.values())
      .filter(m => 
        m.thread_id === threadId || 
        (m.thread_id === GLOBAL_THREAD_ID && m.user_id === userId)
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, limit);
  }
}

export class InMemoryMessageBlockRepository implements MessageBlockRepository {
  constructor(private store: InMemoryStore) {}

  async create(data: Omit<MessageBlockEntity, 'created_at'> & { created_at?: Date }): Promise<MessageBlockEntity> {
    const entity: MessageBlockEntity = {
      ...data,
      created_at: data.created_at || new Date(),
    };
    this.store.messageBlocks.set(entity.id, entity);
    return entity;
  }

  async findByMessageId(messageId: string): Promise<MessageBlockEntity[]> {
    return Array.from(this.store.messageBlocks.values())
      .filter(b => b.message_id === messageId)
      .sort((a, b) => a.block_index - b.block_index);
  }
}

export class InMemoryInteractionRepository implements InteractionRepository {
  constructor(private store: InMemoryStore) {}

  async create(data: Omit<InteractionEntity, 'created_at'> & { created_at?: Date }): Promise<InteractionEntity> {
    const entity: InteractionEntity = {
      ...data,
      created_at: data.created_at || new Date(),
    };
    this.store.interactions.set(entity.id, entity);
    return entity;
  }

  async update(id: string, updates: Partial<InteractionEntity>): Promise<InteractionEntity | null> {
    const existing = this.store.interactions.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.store.interactions.set(id, updated);
    return updated;
  }

  async findById(id: string): Promise<InteractionEntity | null> {
    return this.store.interactions.get(id) || null;
  }

  async findByThreadId(threadId: string): Promise<InteractionEntity[]> {
    return Array.from(this.store.interactions.values())
      .filter(i => i.thread_id === threadId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }
}

export class InMemoryToolStateRepository implements ToolStateRepository {
  constructor(private store: InMemoryStore) {}

  async create(data: Omit<ToolStateEntity, 'created_at' | 'updated_at'> & {
    created_at?: Date;
    updated_at?: Date;
  }): Promise<ToolStateEntity> {
    const now = new Date();
    const entity: ToolStateEntity = {
      ...data,
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    };
    this.store.toolState.set(entity.id, entity);
    return entity;
  }

  async update(id: string, updates: Partial<ToolStateEntity>): Promise<ToolStateEntity | null> {
    const existing = this.store.toolState.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updated_at: new Date() };
    this.store.toolState.set(id, updated);
    return updated;
  }

  async findByToolAndThread(
    toolId: string, 
    threadId: string,
    userId?: string,
    tenantId?: string
  ): Promise<ToolStateEntity | null> {
    return Array.from(this.store.toolState.values())
      .find(t => {
        if (t.tool_id !== toolId || t.thread_id !== threadId) return false;
        if (userId && t.user_id !== userId) return false;
        if (tenantId && t.tenant_id !== tenantId) return false;
        return true;
      }) || null;
  }

  async findByToolAndUser(toolId: string, userId: string): Promise<ToolStateEntity[]> {
    return Array.from(this.store.toolState.values())
      .filter(t => t.tool_id === toolId && t.user_id === userId);
  }

  async upsert(data: Omit<ToolStateEntity, 'id' | 'created_at' | 'updated_at'> & { 
    updated_at?: Date;
  }): Promise<ToolStateEntity> {
    // Find existing by tool_id + thread_id
    const existing = await this.findByToolAndThread(data.tool_id, data.thread_id);
    const now = new Date();
    
    if (existing) {
      // Update
      const updated: ToolStateEntity = {
        ...existing,
        ...data,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: data.updated_at || now,
      };
      this.store.toolState.set(existing.id, updated);
      return updated;
    } else {
      // Create
      const id = `${data.tool_id}-${data.thread_id}-${Date.now()}`;
      const entity: ToolStateEntity = {
        ...data,
        id,
        created_at: now,
        updated_at: data.updated_at || now,
      };
      this.store.toolState.set(id, entity);
      return entity;
    }
  }
}

// =============================================================================
// Repository Factory
// =============================================================================

/**
 * Create all repositories backed by an in-memory store
 */
export function createInMemoryRepositories(store: InMemoryStore): PersistenceRepositories {
  return {
    executionRepo: new InMemoryExecutionRepository(store),
    metricsRepo: new InMemoryMetricsRepository(store),
    messageRepo: new InMemoryMessageRepository(store),
    messageBlockRepo: new InMemoryMessageBlockRepository(store),
    interactionRepo: new InMemoryInteractionRepository(store),
    toolStateRepo: new InMemoryToolStateRepository(store),
  };
}

