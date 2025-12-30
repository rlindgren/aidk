/**
 * Model Hooks - Persistence for model.generate and model.stream
 *
 * These hooks track model executions. When nested inside an engine execution,
 * they link to the parent. When standalone, they create their own execution record.
 */

import type { ModelHookMiddleware } from "aidk";
import type {
  ExecutionRepository,
  MetricsRepository,
  InteractionRepository,
} from "../repositories";
import {
  generateUUID,
  tryGetExecutionContext,
  getParentExecution,
  getInteraction,
  isWithinEngine,
} from "./utils";

export interface ModelHooksConfig {
  executionRepo: ExecutionRepository;
  metricsRepo: MetricsRepository;
  interactionRepo: InteractionRepository;
}

/**
 * Create model.generate hook
 */
export function createModelGenerateHook(config: ModelHooksConfig): ModelHookMiddleware<"generate"> {
  const { executionRepo, metricsRepo, interactionRepo } = config;

  return async ([_input], _envelope, next) => {
    const execCtx = tryGetExecutionContext();
    if (!execCtx) return await next();

    const { ctx, handle, userId, tenantId, threadId } = execCtx;
    const parentExecution = getParentExecution(handle);
    const parentInteraction = getInteraction(handle);
    // Use kernel helper - cleaner than checking parentExecution
    const isStandalone = !isWithinEngine(ctx);

    let modelExecutionId: string;
    let rootId: string;
    let parentId: string | undefined;
    let effectiveThreadId: string;

    if (isStandalone) {
      // Standalone model call - create interaction and execution
      effectiveThreadId = threadId;
      const interactionId = generateUUID();

      await interactionRepo.create({
        id: interactionId,
        type: "agent",
        origin: "user_request",
        app_origin: "example-app",
        agent_id: "model-standalone",
        thread_id: effectiveThreadId,
        root_executionId: generateUUID(),
        user_id: userId,
        tenant_id: tenantId,
      });

      modelExecutionId = generateUUID();
      rootId = modelExecutionId;
      parentId = undefined;
    } else {
      // Nested inside engine - link to parent
      effectiveThreadId = parentExecution.threadId || threadId;
      modelExecutionId = generateUUID();
      rootId = parentExecution.root_id;
      parentId = parentExecution.id;
    }

    await executionRepo.create({
      id: modelExecutionId,
      type: "model",
      status: "running",
      root_id: rootId,
      parent_id: parentId,
      thread_id: effectiveThreadId,
      user_id: userId,
      tenant_id: tenantId,
      interaction_id: parentInteraction?.id,
      metadata: {
        model: ctx.metadata["model_name"] || "unknown",
        provider: ctx.metadata["provider_name"] || "unknown",
        engine_pid: handle.pid,
      },
    });

    await metricsRepo.create({
      id: generateUUID(),
      execution_id: modelExecutionId,
      tenant_id: tenantId,
      user_id: userId,
      thread_id: effectiveThreadId,
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

    try {
      const result = await next();
      await executionRepo.update(modelExecutionId, {
        status: "completed",
        completed_at: new Date(),
      });
      return result;
    } catch (error: any) {
      await executionRepo.update(modelExecutionId, {
        status: "failed",
        error: JSON.stringify({ message: error.message, stack: error.stack }),
        completed_at: new Date(),
      });
      throw error;
    }
  };
}

/**
 * Create model.stream hook
 */
export function createModelStreamHook(config: ModelHooksConfig): ModelHookMiddleware<"stream"> {
  const { executionRepo, metricsRepo } = config;

  return async (_input, _envelope, next) => {
    const execCtx = tryGetExecutionContext();
    if (!execCtx) return await next();

    const { ctx, handle, userId, tenantId, threadId } = execCtx;
    const parentExecution = getParentExecution(handle);
    const parentInteraction = getInteraction(handle);
    // Use kernel helper - cleaner than checking parentExecution
    const isStandalone = !isWithinEngine(ctx);

    let modelExecutionId: string;
    let rootId: string;
    let parentId: string | undefined;
    let effectiveThreadId: string;

    if (isStandalone) {
      effectiveThreadId = threadId;
      modelExecutionId = generateUUID();
      rootId = modelExecutionId;
      parentId = undefined;
    } else {
      effectiveThreadId = parentExecution.threadId || threadId;
      modelExecutionId = generateUUID();
      rootId = parentExecution.root_id;
      parentId = parentExecution.id;
    }

    await executionRepo.create({
      id: modelExecutionId,
      type: "model",
      status: "running",
      root_id: rootId,
      parent_id: parentId,
      thread_id: effectiveThreadId,
      user_id: userId,
      tenant_id: tenantId,
      interaction_id: parentInteraction?.id,
      metadata: {
        model: ctx.metadata["model_name"] || "unknown",
        provider: ctx.metadata["provider_name"] || "unknown",
        engine_pid: handle.pid,
      },
    });

    await metricsRepo.create({
      id: generateUUID(),
      execution_id: modelExecutionId,
      tenant_id: tenantId,
      user_id: userId,
      thread_id: effectiveThreadId,
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

    try {
      const stream = await next();
      return (async function* () {
        for await (const chunk of stream) {
          yield chunk;
        }
        await executionRepo.update(modelExecutionId, {
          status: "completed",
          completed_at: new Date(),
        });
      })();
    } catch (error: any) {
      await executionRepo.update(modelExecutionId, {
        status: "failed",
        error: JSON.stringify({ message: error.message, stack: error.stack }),
        completed_at: new Date(),
      });
      throw error;
    }
  };
}
