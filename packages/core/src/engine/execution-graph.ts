import {
  type ExecutionHandle,
  type ExecutionStatus,
  type ExecutionType,
  type ExecutionMetrics,
  type ExecutionTreeNode,
  ExecutionStatuses,
  ExecutionTypes,
} from './execution-types';

/**
 * Execution context stored in the graph
 */
interface ExecutionContext {
  pid: string;
  parentPid?: string;
  rootPid: string;
  type: ExecutionType;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  handle: ExecutionHandle;
  error?: {
    message: string;
    stack?: string;
    phase?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Execution graph for tracking parent-child relationships
 */
export class ExecutionGraph {
  private executions = new Map<string, ExecutionContext>();
  private executionsForStatus = new Map<ExecutionStatus, Set<string>>();
  private executionsByType = new Map<ExecutionType, Set<string>>();
  private childrenMap = new Map<string, Set<string>>(); // parentPid -> Set<childPid>
  
  /**
   * Register a new execution
   */
  register(handle: ExecutionHandle, parentPid?: string): void {
    const context: ExecutionContext = {
      pid: handle.pid,
      parentPid,
      rootPid: handle.rootPid,
      type: handle.type,
      status: handle.status,
      startedAt: handle.startedAt,
      completedAt: handle.completedAt,
      handle,
    };
    
    this.setExecution(handle, context);
    
    // Track parent-child relationship
    if (parentPid) {
      if (!this.childrenMap.has(parentPid)) {
        this.childrenMap.set(parentPid, new Set());
      }
      this.childrenMap.get(parentPid)!.add(handle.pid);
    }
  }

  private setExecution(handle: ExecutionHandle, context: ExecutionContext): void {
    this.executions.set(handle.pid, context);

    for (const status of ExecutionStatuses) {
      this.executionsForStatus.get(status)?.delete(handle.pid)
    }

    this.executionsByType.get(handle.type)?.delete(handle.pid);

    const statusSet = this.executionsForStatus.get(handle.status) || new Set();
    statusSet.add(handle.pid);
    this.executionsForStatus.set(handle.status, statusSet);

    const typeSet = this.executionsByType.get(handle.type) || new Set();
    typeSet.add(handle.pid);
    this.executionsByType.set(handle.type, typeSet);
  }
  
  /**
   * Update execution status
   */
  updateStatus(pid: string, status: ExecutionStatus, error?: Error, phase?: string): void {
    const context = this.executions.get(pid);
    if (!context) {
      return;
    }
    
    context.status = status;
    context.completedAt = status === 'completed' || status === 'failed' || status === 'cancelled'
      ? new Date()
      : undefined;
    
    if (error) {
      context.error = {
        message: error.message,
        stack: error.stack,
        phase,
      };

    }

    this.setExecution(context.handle, context);
  }
  
  /**
   * Get execution context by PID
   */
  get(pid: string): ExecutionContext | undefined {
    return this.executions.get(pid);
  }
  
  /**
   * Get execution handle by PID
   */
  getHandle(pid: string): ExecutionHandle | undefined {
    return this.executions.get(pid)?.handle;
  }
  
  /**
   * Get all child executions for a parent
   */
  getChildren(parentPid: string): ExecutionHandle[] {
    const childPids = this.childrenMap.get(parentPid);
    if (!childPids) {
      return [];
    }
    
    return Array.from(childPids)
      .map(pid => this.getHandle(pid))
      .filter((handle): handle is ExecutionHandle => handle !== undefined);
  }
  
  /**
   * Get outstanding forks/spawns for a parent (not yet completed)
   */
  getOutstandingForks(parentPid: string): ExecutionHandle[] {
    return this.getChildren(parentPid).filter(
      handle => handle.status === 'running'
    );
  }
  
  /**
   * Get orphaned forks/spawns (parent completed but child still running)
   */
  getOrphanedForks(): ExecutionHandle[] {
    const orphaned: ExecutionHandle[] = [];
    
    for (const [_pid, context] of this.executions.entries()) {
      // Skip root executions
      if (context.type === 'root') {
        continue;
      }
      
      // Check if parent exists and is completed
      if (context.parentPid) {
        const parent = this.executions.get(context.parentPid);
        if (parent && 
            (parent.status === 'completed' || parent.status === 'failed' || parent.status === 'cancelled') &&
            context.status === 'running') {
          orphaned.push(context.handle);
        }
      }
    }
    
    return orphaned;
  }
  
  /**
   * Get execution tree starting from a root PID
   */
  getExecutionTree(rootPid: string): ExecutionTreeNode | undefined {
    const root = this.executions.get(rootPid);
    if (!root) {
      return undefined;
    }
    
    return this.buildTreeNode(rootPid);
  }
  
  /**
   * Build a tree node recursively
   */
  private buildTreeNode(pid: string): ExecutionTreeNode {
    const context = this.executions.get(pid);
    if (!context) {
      throw new Error(`Execution ${pid} not found`);
    }
    
    const children = this.getChildren(pid).map(child => this.buildTreeNode(child.pid));
    
    return {
      pid: context.pid,
      parentPid: context.parentPid,
      rootPid: context.rootPid,
      type: context.type,
      status: context.status,
      startedAt: context.startedAt,
      completedAt: context.completedAt,
      children,
      metrics: this.getMetricsForContext(context),
    };
  }
  
  /**
   * Get metrics for an execution context
   */
  private getMetricsForContext(context: ExecutionContext): ExecutionMetrics {
    const duration = context.completedAt
      ? context.completedAt.getTime() - context.startedAt.getTime()
      : Date.now() - context.startedAt.getTime();
    
    return {
      pid: context.pid,
      parentPid: context.parentPid,
      rootPid: context.rootPid,
      type: context.type,
      status: context.status,
      startedAt: context.startedAt,
      completedAt: context.completedAt,
      duration,
      tickCount: 0, // TODO: Track tick count
      error: context.error ? {
        message: context.error.message,
        phase: context.error.phase,
      } : undefined,
    };
  }
  
  /**
   * Get all active (running) executions
   */
  getActiveExecutions(): ExecutionHandle[] {
    return this.getExecutionsByStatus('running');
  }

  /**
   * Get all executions
   */
  getAllExecutions(): ExecutionHandle[] {
    return Array.from(this.executions.values()).map(ctx => ctx.handle);
  }
  
  /**
   * Get executions by status
   */
  getExecutionsByStatus(status: ExecutionStatus): ExecutionHandle[] {
    return Array.from(this.executionsForStatus.get(status) || [])
      .map(pid => this.getHandle(pid))
      .filter((handle): handle is ExecutionHandle => handle !== undefined);
  }
  
  /**
   * Get executions by type
   */
  getExecutionsByType(type: ExecutionType): ExecutionHandle[] {
    return Array.from(this.executionsByType.get(type) || [])
      .map(pid => this.getHandle(pid))
      .filter((handle): handle is ExecutionHandle => handle !== undefined);
  }
  
  /**
   * Remove execution from graph (cleanup)
   */
  remove(pid: string): void {
    const context = this.executions.get(pid);
    if (!context) {
      return;
    }
    
    // Remove from parent's children
    if (context.parentPid) {
      const children = this.childrenMap.get(context.parentPid);
      if (children) {
        children.delete(pid);
        if (children.size === 0) {
          this.childrenMap.delete(context.parentPid);
        }
      }
    }
    
    // Remove children references
    this.childrenMap.delete(pid);
    
    // Remove execution
    this.executions.delete(pid);

    for (const status of ExecutionStatuses) {
      this.executionsForStatus.get(status)?.delete(pid);
    }
    for (const type of ExecutionTypes) {
      this.executionsByType.get(type)?.delete(pid);
    }
  }
  
  /**
   * Clear all executions
   */
  clear(): void {
    this.executions.clear();
    this.executionsForStatus.clear();
    this.executionsByType.clear();
    this.childrenMap.clear();
  }
  
  /**
   * Get count of executions
   */
  getCount(): number {
    return this.executions.size;
  }
  
  /**
   * Get count of active executions
   */
  getActiveCount(): number {
    return this.executionsForStatus.get('running')?.size || 0;
  }
}

