import { getToolStateRepository } from '../persistence/repositories/tool-state';
import { getMessageRepository } from '../persistence/repositories/messages';
import { generateUUID } from 'aidk-express';
import { getEngine } from '../setup';
import { type UserActionBlock, createEventMessage } from 'aidk';


// ============================================================================
// Constants
// ============================================================================

/**
 * Nil UUID (RFC 4122) used for user-global events.
 * 
 * Event messages with this thread_id are user-scoped, not thread-scoped.
 * They represent actions that happened "outside" any specific conversation
 * (e.g., UI-initiated task completion, external system events).
 * 
 * When loading conversation history, query:
 *   WHERE user_id = ? AND (thread_id = ? OR thread_id = GLOBAL_THREAD_ID)
 * 
 * This ensures all threads for a user see global events, properly ordered
 * by timestamp alongside thread-specific messages.
 * 
 * Why not nullable thread_id?
 * - Works with UUID-typed columns (no schema change needed)
 * - Avoids NULL handling complexity in ORMs
 * - Clear semantic: nil UUID = "belongs to user, not to any specific thread"
 */
export const GLOBAL_THREAD_ID = '00000000-0000-0000-0000-000000000000';


// ============================================================================
// Types
// ============================================================================

export interface TodoTask {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  created_at: Date;
  user_id?: string;
}

export interface TodoActionResult {
  success: boolean;
  tasks: TodoTask[];
  message: string;
  action: string;
}

export interface TodoActionOptions {
  /** 
   * Inject a user-global event message for this action.
   * Events are user-scoped (not thread-scoped) and visible to all conversations.
   * @see GLOBAL_THREAD_ID
   */
  createEvent?: boolean;
  /** Thread ID (for context, not used for event scoping since events are user-global) */
  threadId?: string;
  /** Broadcast state change to connected clients (default: true) */
  broadcast?: boolean;
  /** Exclude sender from broadcast (broadcast pattern) */
  excludeSender?: boolean;
  /** Source connection ID (for excludeSender) */
  sourceConnectionId?: string;
}

// Repository getters
const toolStateRepo = () => getToolStateRepository();
const messageRepo = () => getMessageRepository();

// ============================================================================
// TodoListService - Business logic for todo list management
// ============================================================================

export class TodoListService {

  static get channel() {
    return getEngine().channels?.getRouter('todo-list');
  }
  
  /**
   * Load tasks from persistence (scoped by user_id)
   */
  static async getTasks(userId: string): Promise<TodoTask[]> {
    const state = await toolStateRepo().findByToolAndThread('todo_list', userId);
    if (!state?.state_data) return [];
    
    const tasks = JSON.parse(state.state_data) as TodoTask[];
    return tasks.map(t => ({
      ...t,
      created_at: typeof t.created_at === 'string' ? new Date(t.created_at) : t.created_at
    }));
  }

  /**
   * Save tasks to persistence (scoped by user_id)
   */
  private static async saveTasks(userId: string, tasks: TodoTask[]): Promise<void> {
    await toolStateRepo().upsert({
      tool_id: 'todo_list',
      thread_id: userId,
      user_id: userId,
      tenant_id: 'default',
      state_data: JSON.stringify(tasks),
      updated_at: new Date(),
    });
  }

  /**
   * Broadcast state change to user's devices via SSE rooms.
   * Uses the todoListChannel router for clean room-based routing.
   * 
   * Note: sourceConnectionId is automatically pulled from Context.sessionId
   * when excludeSender is true, so no need to pass it explicitly.
   */
  static broadcast(
    tasks: TodoTask[], 
    options: { userId?: string; excludeSender?: boolean }
  ): void {
    if (!options.userId) {
      console.warn('TodoListService.broadcast: userId required for room-based routing');
      return;
    }
    
    console.log(`📢 TodoListService.broadcast: userId=${options.userId}, excludeSender=${options.excludeSender}, tasks=${tasks.length}`);
    
    const event = { type: 'state_changed', payload: { tasks } };
    const target = TodoListService.channel?.publisher().to(options.userId);

    if (!target) {
      return;
    }
    
    if (options.excludeSender) {
      target.broadcast(event)
        .then(() => console.log('📢 Broadcast sent (excludeSender)'))
        .catch((err: unknown) => console.error('Failed to broadcast todo list update:', err));
    } else {
      target.send(event)
        .then(() => console.log('📢 Send sent'))
        .catch((err: unknown) => console.error('Failed to send todo list update:', err));
    }
  }

  /**
   * Inject a user-global event message for UI-initiated actions.
   * 
   * These events are user-scoped (not thread-scoped) because they represent
   * actions that happen "outside" any specific conversation. Using GLOBAL_THREAD_ID
   * (nil UUID) allows all threads for this user to see the event.
   * 
   * The agent in any conversation will see these events when loading history,
   * properly ordered by timestamp alongside thread-specific messages.
   * 
   * @see GLOBAL_THREAD_ID for the nil UUID pattern explanation
   */
  private static async injectActionMessage(
    userId: string,
    action: string,
    details: string
  ): Promise<void> {
    const block: UserActionBlock = {
      type: 'user_action',
      action,
      actor: 'user',
      target: 'todo_list',
      details: {
        description: details,
        timestamp: new Date().toISOString(),
        user_id: userId,
      },
      // Human-readable text for model consumption
      text: `User ${action} on todo list: ${details}`,
    };

    const eventMessage = createEventMessage(
      [block],
      'user_action',
      { ui_action: true, action_type: action, user_id: userId }
    );

    await messageRepo().create({
      id: generateUUID(),
      execution_id: 'ui-action',  // Sentinel: UI action, not part of an execution
      interaction_id: 'ui-action',
      thread_id: GLOBAL_THREAD_ID,  // Nil UUID = user-global, visible to all threads
      user_id: userId,
      role: eventMessage.role,
      content: JSON.stringify(eventMessage.content),
      source: 'user',
      metadata: eventMessage.metadata ? JSON.stringify(eventMessage.metadata) : undefined,
    });
  }

  /**
   * Create a new task
   */
  static async createTask(
    userId: string,
    title: string,
    description?: string,
    options: TodoActionOptions = {}
  ): Promise<TodoActionResult> {
    if (!title) {
      return { success: false, tasks: [], message: 'Error: title is required', action: 'create' };
    }

    const tasks = await TodoListService.getTasks(userId);
    const newTask: TodoTask = {
      id: generateUUID(),
      title,
      description,
      completed: false,
      created_at: new Date(),
      user_id: userId,
    };
    
    tasks.push(newTask);
    await TodoListService.saveTasks(userId, tasks);
    
    if (options.broadcast !== false) {
      TodoListService.broadcast(tasks, { 
        userId, 
        excludeSender: options.excludeSender,
      });
    }
    
    if (options.createEvent) {
      await TodoListService.injectActionMessage(
        userId,
        'Created task',
        `"${title}"${description ? ` - ${description}` : ''}`
      );
    }
    
    return {
      success: true,
      tasks,
      message: `Created task: ${title} (ID: ${newTask.id})`,
      action: 'create',
    };
  }

  /**
   * Update an existing task
   */
  static async updateTask(
    userId: string,
    taskId: string,
    updates: { title?: string; description?: string; completed?: boolean },
    options: TodoActionOptions = {}
  ): Promise<TodoActionResult> {
    if (!taskId) {
      return { success: false, tasks: [], message: 'Error: task_id is required', action: 'update' };
    }

    const tasks = await TodoListService.getTasks(userId);
    const index = tasks.findIndex(t => t.id === taskId);
    
    if (index < 0) {
      return { success: false, tasks, message: `Task not found: ${taskId}`, action: 'update' };
    }
    
    const oldTask = tasks[index];
    const newTask = { ...oldTask };
    if (updates.title !== undefined) newTask.title = updates.title;
    if (updates.description !== undefined) newTask.description = updates.description;
    if (updates.completed !== undefined) newTask.completed = updates.completed;
    tasks[index] = { ...newTask };
    await TodoListService.saveTasks(userId, tasks);
    
    if (options.broadcast !== false) {
      TodoListService.broadcast(tasks, { 
        userId, 
        excludeSender: options.excludeSender,
      });
    }
    
    if (options.createEvent) {
      const changes: string[] = [];
      if (updates.title !== undefined) changes.push(`title to "${updates.title}"`);
      if (updates.description !== undefined) changes.push(`description to "${updates.description}"`);
      if (updates.completed !== undefined) changes.push(updates.completed ? 'marked complete' : 'marked incomplete');
      
      await TodoListService.injectActionMessage(
        userId,
        'Updated task',
        `"${oldTask.title}" - ${changes.join(', ')}`
      );
    }
    
    return {
      success: true,
      tasks,
      message: `Updated task: ${tasks[index].title}`,
      action: 'update',
    };
  }

  /**
   * Toggle task completion status
   */
  static async toggleComplete(
    userId: string,
    taskId: string,
    options: TodoActionOptions = {}
  ): Promise<TodoActionResult> {
    const tasks = await TodoListService.getTasks(userId);
    const index = tasks.findIndex(t => t.id === taskId);
    
    if (index < 0) {
      return { success: false, tasks, message: `Task not found: ${taskId}`, action: 'toggle' };
    }
    
    const newCompleted = !tasks[index].completed;
    tasks[index] = { ...tasks[index], completed: newCompleted };
    await TodoListService.saveTasks(userId, tasks);
    
    if (options.broadcast !== false) {
      TodoListService.broadcast(tasks, { 
        userId, 
        excludeSender: options.excludeSender,
      });
    }
    
    if (options.createEvent) {
      await TodoListService.injectActionMessage(
        userId,
        newCompleted ? 'Completed task' : 'Reopened task',
        `"${tasks[index].title}"`
      );
    }
    
    return {
      success: true,
      tasks,
      message: `${newCompleted ? 'Completed' : 'Reopened'} task: ${tasks[index].title}`,
      action: 'toggle',
    };
  }

  /**
   * Delete a task
   */
  static async deleteTask(
    userId: string,
    taskId: string,
    options: TodoActionOptions = {}
  ): Promise<TodoActionResult> {
    if (!taskId) {
      return { success: false, tasks: [], message: 'Error: task_id is required', action: 'delete' };
    }

    const tasks = await TodoListService.getTasks(userId);
    const index = tasks.findIndex(t => t.id === taskId);
    
    if (index < 0) {
      return { success: false, tasks, message: `Task not found: ${taskId}`, action: 'delete' };
    }
    
    const deletedTask = tasks[index];
    tasks.splice(index, 1);
    await TodoListService.saveTasks(userId, tasks);
    
    if (options.broadcast !== false) {
      TodoListService.broadcast(tasks, { 
        userId, 
        excludeSender: options.excludeSender,
      });
    }
    
    if (options.createEvent) {
      await TodoListService.injectActionMessage(userId, 'Deleted task', `"${deletedTask.title}"`);
    }
    
    return {
      success: true,
      tasks,
      message: `Deleted task: ${deletedTask.title}`,
      action: 'delete',
    };
  }

  /**
   * List all tasks
   */
  static async listTasks(userId: string): Promise<TodoActionResult> {
    const tasks = await TodoListService.getTasks(userId);
    return {
      success: true,
      tasks,
      message: tasks.length > 0 ? `Found ${tasks.length} task(s)` : 'No tasks found',
      action: 'list',
    };
  }

}

