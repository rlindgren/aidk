import { ChannelRouter, type ChannelEvent } from "aidk";
import { TodoListService, type TodoTask } from "../services";

// ============================================================================
// Channel Context Type
// ============================================================================

/**
 * Context passed to channel handlers.
 * Provides runtime data needed by handlers.
 */
export interface TodoChannelContext {
  /** User ID for task scoping */
  userId: string;
  /** Thread ID for message injection */
  threadId?: string;
  /** Connection ID (for excludeSender) */
  sourceConnectionId?: string;
  /** Whether to broadcast changes (default: true for HTTP, false for engine subscribe) */
  broadcast?: boolean;
  /** Whether to inject action into message history */
  createEvent?: boolean;
}

/**
 * Unified todo list channel - handles both inbound (frontend events) and outbound (broadcasts).
 *
 * Inbound: Frontend sends task_created, task_updated, etc.
 * Outbound: Service broadcasts state_changed to user's devices.
 *
 * scope: 'user' → .to(userId) targets `user:{userId}` room.
 *
 * @example
 * ```typescript
 * // In tool onMount - subscribe with context
 * todoListChannel.subscribe({
 *   userId: this.userId,
 *   onUpdate: (tasks) => com.setState('todo_list_tasks', tasks),
 * });
 *
 * // In HTTP route - handle event with explicit context
 * todoListChannel.handle(event, { userId, onUpdate: () => {} });
 *
 * // Publish state changes
 * todoListChannel.publisher().to(userId).broadcast({ type: 'state_changed', payload: { tasks } });
 * ```
 */
/**
 * Todo list channel - handles task events.
 * Registered contexts are auto-notified when handlers return results.
 *
 * scope: { user: 'userId' } means:
 * - Room routing: broadcast to 'user:{ctx.userId}'
 * - Context matching: key is 'user:{ctx.userId}'
 */
export const todoListChannel = new ChannelRouter<TodoChannelContext>("todo-list", {
  scope: { user: "userId" },
})
  .on("create_task", async (event: ChannelEvent, ctx: TodoChannelContext) => {
    return TodoListService.createTask(ctx.userId, event.payload.title, event.payload.description, {
      ...ctx,
      excludeSender: true,
    });
  })
  .on("update_task", async (event: ChannelEvent, ctx: TodoChannelContext) => {
    // Filter out undefined values to avoid overwriting existing data
    const updates = event.payload.updates || event.payload;
    return TodoListService.updateTask(ctx.userId, event.payload.task_id, updates, {
      ...ctx,
      excludeSender: true,
    });
  })
  .on("toggle_complete", async (event: ChannelEvent, ctx: TodoChannelContext) => {
    return TodoListService.toggleComplete(ctx.userId, event.payload.task_id, {
      ...ctx,
      excludeSender: true,
    });
  })
  .on("delete_task", async (event: ChannelEvent, ctx: TodoChannelContext) => {
    return TodoListService.deleteTask(ctx.userId, event.payload.task_id, {
      ...ctx,
      excludeSender: true,
    });
  });
