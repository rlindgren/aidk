/**
 * Tool Hooks - Persistence for tool.run
 *
 * These hooks track tool executions. When nested inside an engine execution,
 * they link to the parent. When standalone, they create their own execution record.
 */

import type { ToolHookMiddleware } from "aidk";
import type { ExecutionRepository, MetricsRepository } from "../repositories";
import {
  generateUUID,
  tryGetExecutionContext,
  getParentExecution,
  getInteraction,
  isNestedExecution,
} from "./utils";

export interface ToolHooksConfig {
  executionRepo: ExecutionRepository;
  metricsRepo: MetricsRepository;
}

/**
 * Create tool.run hook
 */
export function createToolRunHook(config: ToolHooksConfig): ToolHookMiddleware<"run"> {
  const { executionRepo, metricsRepo } = config;

  return async ([_input], _envelope, next) => {
    const execCtx = tryGetExecutionContext();
    if (!execCtx) return await next();

    const { ctx, handle, userId, tenantId, threadId } = execCtx;
    const parentExecution = getParentExecution(handle);
    const parentInteraction = getInteraction(handle);
    // Use kernel helper - checks if ANY parent (engine OR model) exists
    const isStandalone = !isNestedExecution(ctx);

    let toolExecutionId: string;
    let rootId: string;
    let parentId: string | undefined;
    let effectiveThreadId: string;

    if (isStandalone) {
      effectiveThreadId = threadId;
      toolExecutionId = generateUUID();
      rootId = toolExecutionId;
      parentId = undefined;
    } else {
      effectiveThreadId = parentExecution.threadId || threadId;
      toolExecutionId = generateUUID();
      rootId = parentExecution.root_id;
      parentId = parentExecution.id;
    }

    await executionRepo.create({
      id: toolExecutionId,
      type: "tool",
      status: "running",
      root_id: rootId,
      parent_id: parentId,
      thread_id: effectiveThreadId,
      user_id: userId,
      tenant_id: tenantId,
      interaction_id: parentInteraction?.id,
      metadata: {
        tool_id: ctx.metadata["tool_id"] || "unknown",
        tool_type: ctx.metadata["tool_type"] || "unknown",
        engine_pid: handle.pid,
      },
    });

    await metricsRepo.create({
      id: generateUUID(),
      execution_id: toolExecutionId,
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

    (handle as any).toolExecutionEntity = { id: toolExecutionId };

    try {
      const result = await next();
      await executionRepo.update(toolExecutionId, {
        status: "completed",
        completed_at: new Date(),
      });
      return result;
    } catch (error: any) {
      await executionRepo.update(toolExecutionId, {
        status: "failed",
        error: JSON.stringify({ message: error.message, stack: error.stack }),
        completed_at: new Date(),
      });
      throw error;
    }
  };
}
