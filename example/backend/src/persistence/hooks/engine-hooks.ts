/**
 * Engine Hooks - Persistence for engine.execute and engine.stream
 * 
 * These hooks handle top-level execution tracking. When an agent runs,
 * we create execution and interaction records, track status, and
 * persist messages from the stream.
 */

import type { EngineHookArgs, EngineHookMiddleware } from 'aidk';
import type { Message as EngineMessage } from 'aidk/content';
import type {
  ExecutionRepository,
  MetricsRepository,
  MessageRepository,
  MessageBlockRepository,
  InteractionRepository,
} from '../repositories';
import { generateUUID, getRootNameFromJSX, tryGetExecutionContext } from './utils';

export interface EngineHooksConfig {
  executionRepo: ExecutionRepository;
  metricsRepo: MetricsRepository;
  messageRepo: MessageRepository;
  messageBlockRepo: MessageBlockRepository;
  interactionRepo: InteractionRepository;
}

/**
 * Create engine.execute hook
 */
export function createExecuteHook(config: EngineHooksConfig): EngineHookMiddleware<'execute'> {
  const { executionRepo, metricsRepo, interactionRepo } = config;

  return async (args, _envelope, next) => {
    const [input, agent] = args;
    const execCtx = tryGetExecutionContext(input);
    if (!execCtx) return await next();

    const { ctx, handle, userId, tenantId, threadId } = execCtx;
    const agentId = getRootNameFromJSX(agent);
    const interactionId = generateUUID();
    const executionId = generateUUID();

    // Create interaction record
    await interactionRepo.create({
      id: interactionId,
      type: 'agent',
      origin: 'user_request',
      app_origin: 'example-app',
      agent_id: agentId,
      thread_id: threadId,
      root_execution_id: executionId,
      user_id: userId,
      tenant_id: tenantId,
    });

    // Create execution record
    const execution = await executionRepo.create({
      id: executionId,
      type: 'agent',
      status: 'running',
      root_id: executionId,
      thread_id: threadId,
      user_id: userId,
      tenant_id: tenantId,
      interaction_id: interactionId,
      metadata: {
        agent_id: agentId,
        engine_pid: handle.pid,
      },
    });

    // Create initial metrics record
    await metricsRepo.create({
      id: generateUUID(),
      execution_id: executionId,
      tenant_id: tenantId,
      user_id: userId,
      thread_id: threadId,
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      cost: 0,
      llm_calls: 0,
      tool_calls: 0,
      agent_calls: 0,
      function_calls: 0,
      code_runs: 0,
      executions: 0,
      requests: 0,
    });

    // Store on handle for child hooks to access
    (handle as any).executionEntity = execution;
    (handle as any).interactionEntity = { id: interactionId };
    (handle as any).operationContext = { userId, tenantId, threadId };

    try {
      const result = await next();
      await executionRepo.update(executionId, {
        status: 'completed',
        completed_at: new Date(),
      });
      return result;
    } catch (error: any) {
      await executionRepo.update(executionId, {
        status: 'failed',
        error: JSON.stringify({ message: error.message, stack: error.stack }),
        completed_at: new Date(),
      });
      throw error;
    }
  };
}

/**
 * Create engine.stream hook
 */
export function createStreamHook(config: EngineHooksConfig): EngineHookMiddleware<'stream'> {
  const { executionRepo, metricsRepo, messageRepo, messageBlockRepo, interactionRepo } = config;

  return async (args, _envelope, next) => {
    const [input, agent] = args;
    const execCtx = tryGetExecutionContext(input);
    if (!execCtx) return await next();

    const { ctx, handle, userId, tenantId, threadId } = execCtx;
    const agentId = getRootNameFromJSX(agent);
    const interactionId = generateUUID();
    const executionId = generateUUID();

    // Create interaction record
    await interactionRepo.create({
      id: interactionId,
      type: 'agent',
      origin: 'user_request',
      app_origin: 'example-app',
      agent_id: agentId,
      thread_id: threadId,
      root_execution_id: executionId,
      user_id: userId,
      tenant_id: tenantId,
    });

    // Create execution record
    const execution = await executionRepo.create({
      id: executionId,
      type: 'agent',
      status: 'running',
      root_id: executionId,
      thread_id: threadId,
      user_id: userId,
      tenant_id: tenantId,
      interaction_id: interactionId,
      metadata: {
        agent_id: agentId,
        engine_pid: handle.pid,
      },
    });

    // Create initial metrics record
    await metricsRepo.create({
      id: generateUUID(),
      execution_id: executionId,
      tenant_id: tenantId,
      user_id: userId,
      thread_id: threadId,
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      cost: 0,
      llm_calls: 0,
      tool_calls: 0,
      agent_calls: 0,
      function_calls: 0,
      code_runs: 0,
      executions: 0,
      requests: 0,
    });

    // Store on handle for child hooks to access
    (handle as any).executionEntity = execution;
    (handle as any).interactionEntity = { id: interactionId };
    (handle as any).operationContext = { userId, tenantId, threadId };

    // Helper to persist a single message
    async function persistMessage(message: EngineMessage, source: 'user' | 'agent') {
      const messageId = generateUUID();
      console.log(`💾 Saving: role=${message.role}, blocks=${message.content?.length || 0}`);
      
      await messageRepo.create({
        id: messageId,
        execution_id: executionId,
        interaction_id: interactionId,
        thread_id: threadId,
        role: message.role,
        content: JSON.stringify(message.content),
        source,
        metadata: message.metadata ? JSON.stringify(message.metadata) : undefined,
      });

      for (let i = 0; i < (message.content?.length || 0); i++) {
        const block = message.content[i];
        await messageBlockRepo.create({
          id: generateUUID(),
          message_id: messageId,
          block_index: i,
          block_type: block.type,
          block_data: JSON.stringify(block),
        });
      }
    }

    try {
      const stream = await next();
      let userInputPersisted = false;
      const toolResultsForTick: any[] = [];
      
      return (async function* () {
        for await (const event of stream) {
          // On first tick_end, persist user input messages
          if (event.type === 'tick_end' && event.tick === 1 && !userInputPersisted) {
            userInputPersisted = true;
            
            const userMessages = ((input as any).timeline || []).filter((entry: any) => {
              if (entry.kind !== 'message') return false;
              return entry.message?.role === 'user';
            });
            
            for (const entry of userMessages) {
              await persistMessage(entry.message as EngineMessage, 'user');
            }
          }
          
          // Collect tool results as they stream
          if (event.type === 'tool_result' && event.result) {
            toolResultsForTick.push(event.result);
          }
          
          // Persist model output at every tick_end
          if (event.type === 'tick_end' && event.response?.newTimelineEntries) {
            const newEntries = event.response.newTimelineEntries;
            
            // Filter: only message entries with content, skip system messages and empty messages
            const messagesToPersist = newEntries.filter((entry: any) => {
              if (entry.kind !== 'message') return false;
              const msg = entry.message;
              if (!msg || msg.role === 'system') return false;
              // Skip messages with empty content
              if (!msg.content || msg.content.length === 0) return false;
              return true;
            });
            
            if (messagesToPersist.length > 0) {
              console.log(`💾 Persisting ${messagesToPersist.length} model messages (tick ${event.tick})`);
            }
            
            for (const entry of messagesToPersist) {
              await persistMessage(entry.message as EngineMessage, 'agent');
            }
            
            // Persist tool results collected during this tick
            if (toolResultsForTick.length > 0) {
              console.log(`💾 Persisting ${toolResultsForTick.length} tool results (tick ${event.tick})`);
              
              const toolResultMessage: EngineMessage = {
                role: 'tool',
                content: toolResultsForTick.map(r => ({
                  type: 'tool_result' as const,
                  tool_use_id: r.tool_use_id,
                  id: r.id,
                  name: r.name,
                  content: r.content || [],
                  is_error: !r.success,
                })),
              };
              
              await persistMessage(toolResultMessage, 'agent');
              toolResultsForTick.length = 0;
            }
          }
          
          yield event;
        }
        
        await executionRepo.update(executionId, {
          status: 'completed',
          completed_at: new Date(),
        });
      })();
    } catch (error: any) {
      await executionRepo.update(executionId, {
        status: 'failed',
        error: JSON.stringify({ message: error.message, stack: error.stack }),
        completed_at: new Date(),
      });
      throw error;
    }
  };
}

