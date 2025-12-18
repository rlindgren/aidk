/**
 * Shared utilities for persistence hooks
 */

import { Context, isWithinEngine, isNestedExecution, getExecutionInfo, type KernelContext, type ExecutionHandleImpl } from 'aidk';
import { generateUUID } from 'aidk-express';
export { generateUUID };

// Re-export execution helpers for convenience
export { isWithinEngine, isNestedExecution, getExecutionInfo };

/**
 * Extract agent name from JSX element
 */
export function getRootNameFromJSX(agent: any): string {
  if (!agent) return 'unknown';
  if (typeof agent === 'string') return agent;
  if (typeof agent === 'function' && agent.name) return agent.name;
  if (typeof agent === 'object' && 'type' in agent) {
    if (typeof agent.type === 'function' && agent.type.name) return agent.type.name;
    if (typeof agent.type === 'object' && 'name' in agent.type) return (agent.type as any).name;
  }
  return 'unknown';
}

/**
 * Context and handle extracted from current execution
 */
export interface ExecutionContext {
  ctx: KernelContext;
  handle: ExecutionHandleImpl;
  userId: string;
  tenantId: string;
  threadId: string;
}

/**
 * Try to extract execution context from the current async context.
 * Returns undefined if not in an execution context.
 */
export function tryGetExecutionContext(input?: any): ExecutionContext | undefined {
  const ctx = Context.tryGet() as KernelContext | undefined;
  const handle = ctx?.executionHandle as ExecutionHandleImpl | undefined;
  
  if (!handle || !ctx) {
    return undefined;
  }

  return {
    ctx,
    handle,
    userId: (ctx.metadata['user_id'] as string) || ctx.user?.id || (input as any)?.user_id || 'anonymous',
    tenantId: (ctx.metadata['tenant_id'] as string) || (input as any)?.tenant_id || 'default',
    threadId: (ctx.metadata['thread_id'] as string) || (input as any)?.thread_id || generateUUID(),
  };
}

/**
 * Get parent execution entity from handle (set by engine hooks)
 */
export function getParentExecution(handle: ExecutionHandleImpl): any | undefined {
  return (handle as any).executionEntity;
}

/**
 * Get interaction entity from handle (set by engine hooks)
 */
export function getInteraction(handle: ExecutionHandleImpl): any | undefined {
  return (handle as any).interactionEntity;
}

