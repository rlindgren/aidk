/**
 * Helper functions for creating Fork and Spawn executions
 * 
 * These helpers encapsulate the logic for creating forks/spawns correctly,
 * preventing users from making mistakes when implementing custom components.
 */

import { Engine, type EngineConfig } from '../../engine/engine';
import { ContextObjectModel } from '../../com/object-model';
import { type TickState, type ComponentDefinition } from '../../component/component';
import { type EngineInput } from '../../com/types';
import { type ExecutionHandle,type ForkInheritanceOptions } from '../../engine/execution-types';
import { type JSX } from '../jsx-runtime';
import { createElement, Fragment } from '../jsx-runtime';
import { Context } from 'aidk-kernel';

/**
 * Options for creating a fork handle
 */
export interface CreateForkOptions {
  /**
   * Agent definition - either a ComponentDefinition or JSX children
   */
  agent?: ComponentDefinition | JSX.Element | JSX.Element[];
  
  /**
   * Input for the fork execution
   */
  input?: EngineInput;
  
  /**
   * Parent PID (defaults to current execution PID from context)
   */
  parentPid?: string;
  
  /**
   * Inheritance options
   */
  inherit?: ForkInheritanceOptions;
  
  /**
   * Engine configuration for child engine
   */
  engineConfig?: Partial<EngineConfig>;
  
  /**
   * Completion handler
   */
  onComplete?: (result: any) => void | Promise<void>;
  
  /**
   * Error handler
   */
  onError?: (error: Error) => void | Promise<void>;
}

/**
 * Options for creating a spawn handle
 */
export interface CreateSpawnOptions {
  /**
   * Agent definition - either a ComponentDefinition or JSX children
   */
  agent?: ComponentDefinition | JSX.Element | JSX.Element[];
  
  /**
   * Input for the spawn execution
   */
  input?: EngineInput;
  
  /**
   * Engine configuration for child engine
   */
  engineConfig?: Partial<EngineConfig>;
  
  /**
   * Completion handler
   */
  onComplete?: (result: any) => void | Promise<void>;
  
  /**
   * Error handler
   */
  onError?: (error: Error) => void | Promise<void>;
}

/**
 * Create a fork execution handle
 * 
 * Helper function that encapsulates fork creation logic.
 * Use this in custom components to create forks correctly.
 * 
 * @param engine Engine instance (from com.engine)
 * @param com ContextObjectModel (for accessing current execution context)
 * @param state TickState (for accessing execution handle)
 * @param options Fork options
 * @returns ExecutionHandle for the fork
 * 
 * @example
 * ```typescript
 * class MyComponent extends Component {
 *   render(com: ContextObjectModel, state: TickState) {
 *     const forkHandle = createForkHandle(
 *       com.engine as Engine,
 *       com,
 *       state,
 *       {
 *         agent: createElement(MyAgent, {}),
 *         input: { timeline: [] },
 *         onComplete: (result) => {
 *           com.setState('forkResult', result);
 *         }
 *       }
 *     );
 *     
 *     return null;
 *   }
 * }
 * ```
 */
export function createForkHandle(
  engine: Engine,
  com: ContextObjectModel,
  state: TickState,
  options: CreateForkOptions
): ExecutionHandle {
  // Normalize agent definition
  const agentDefinition = normalizeAgentDefinition(options.agent);
  if (!agentDefinition) {
    throw new Error('Cannot fork: agent or children must be provided');
  }
  
  // Get parent PID from current execution if not provided
  // Try to get from context first, then from state if available
  const ctx = Context.tryGet();
  const currentHandle = (ctx as any)?.executionHandle as ExecutionHandle | undefined;
  const parentPid = options.parentPid || currentHandle?.pid;
  
  if (!parentPid) {
    throw new Error('Cannot fork: no parent execution found. Provide parentPid or call from within an execution context.');
  }
  
  // Create fork handle
  const handle = engine.fork(
    agentDefinition,
    options.input || { timeline: [] },
    {
      parentPid,
      inherit: options.inherit,
      engineConfig: options.engineConfig,
    }
  );
  
  // Set up handlers
  handle.waitForCompletion()
    .then((result) => {
      options.onComplete?.(result);
    })
    .catch((error) => {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  
  return handle;
}

/**
 * Create a spawn execution handle
 * 
 * Helper function that encapsulates spawn creation logic.
 * Use this in custom components to create spawns correctly.
 * 
 * @param engine Engine instance (from com.engine)
 * @param com ContextObjectModel (for context)
 * @param state TickState (for context)
 * @param options Spawn options
 * @returns ExecutionHandle for the spawn
 * 
 * @example
 * ```typescript
 * class MyComponent extends Component {
 *   render(com: ContextObjectModel, state: TickState) {
 *     const spawnHandle = createSpawnHandle(
 *       com.engine as Engine,
 *       com,
 *       state,
 *       {
 *         agent: createElement(IndependentAgent, {}),
 *         input: { timeline: [] },
 *         onComplete: (result) => {
 *           console.log('Spawn completed:', result);
 *         }
 *       }
 *     );
 *     
 *     return null;
 *   }
 * }
 * ```
 */
export function createSpawnHandle(
  engine: Engine,
  com: ContextObjectModel,
  state: TickState,
  options: CreateSpawnOptions
): ExecutionHandle {
  // Normalize agent definition
  const agentDefinition = normalizeAgentDefinition(options.agent);
  if (!agentDefinition) {
    throw new Error('Cannot spawn: agent or children must be provided');
  }
  
  // Create spawn handle
  const handle = engine.spawn(
    agentDefinition,
    options.input || { timeline: [] },
    {
      engineConfig: options.engineConfig,
    }
  );
  
  // Set up handlers
  handle.waitForCompletion()
    .then((result) => {
      options.onComplete?.(result);
    })
    .catch((error) => {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  
  return handle;
}

/**
 * Register a fork/spawn handle for waiting
 * 
 * If waitUntilComplete is true, this registers the handle in COM state
 * so the Engine can wait for it before continuing the tick.
 * 
 * @param com ContextObjectModel
 * @param handle ExecutionHandle to register
 * @param waitUntilComplete Whether to wait for completion
 */
export function registerWaitHandle(
  com: ContextObjectModel,
  handle: ExecutionHandle,
  waitUntilComplete: boolean
): void {
  if (!waitUntilComplete) {
    return;
  }
  
  // Get active wait handles
  const waitHandles = com.getState<Set<ExecutionHandle>>('__wait_handles__') || new Set();
  waitHandles.add(handle);
  com.setState('__wait_handles__', waitHandles);
  
  // Clean up when handle completes
  handle.waitForCompletion()
    .finally(() => {
      const handles = com.getState<Set<ExecutionHandle>>('__wait_handles__');
      if (handles) {
        handles.delete(handle);
        if (handles.size === 0) {
          com.setState('__wait_handles__', undefined);
        } else {
          com.setState('__wait_handles__', handles);
        }
      }
    });
}

/**
 * Get active wait handles from COM
 * 
 * Used by Engine to check if any forks/spawns are waiting.
 * 
 * @param com ContextObjectModel
 * @returns Set of ExecutionHandles that are waiting
 */
export function getWaitHandles(com: ContextObjectModel): Set<ExecutionHandle> {
  return com.getState<Set<ExecutionHandle>>('__wait_handles__') || new Set();
}

/**
 * Normalize agent definition
 * 
 * Converts JSX children or ComponentDefinition to a single ComponentDefinition.
 * 
 * @param agent Agent definition (ComponentDefinition or JSX children)
 * @returns Normalized ComponentDefinition
 */
function normalizeAgentDefinition(
  agent?: ComponentDefinition | JSX.Element | JSX.Element[]
): ComponentDefinition | undefined {
  if (!agent) {
    return undefined;
  }
  
  // If it's already a ComponentDefinition, return as-is
  if (typeof agent === 'function' || (typeof agent === 'object' && 'render' in agent)) {
    return agent as ComponentDefinition;
  }
  
  // If it's JSX.Element(s), wrap in Fragment
  if (Array.isArray(agent)) {
    return createElement(Fragment, {}, ...agent);
  }
  
  // Single JSX.Element
  return agent as JSX.Element;
}

