/**
 * Re-export from new modular hooks structure.
 * 
 * @deprecated Import from './hooks' directory instead:
 * ```typescript
 * import { setupPersistenceHooks } from './persistence/hooks';
 * ```
 */
export { 
  setupPersistenceHooks, 
  getGlobalToolStateRepository,
  type PersistenceHooksConfig,
} from './hooks/index';

// Re-export individual hook creators for customization
export { createExecuteHook, createStreamHook } from './hooks/engine-hooks';
export { createModelGenerateHook, createModelStreamHook } from './hooks/model-hooks';
export { createToolRunHook } from './hooks/tool-hooks';

// Re-export utilities
export { 
  generateUUID, 
  getRootNameFromJSX, 
  tryGetExecutionContext,
  getParentExecution,
  getInteraction,
  type ExecutionContext,
} from './hooks/utils';
