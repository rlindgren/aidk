/**
 * Persistence Hooks
 * 
 * This module provides hooks for persisting engine execution data:
 * - Execution records (tracking agent, model, tool runs)
 * - Message history (conversation persistence)
 * - Metrics (token counts, costs, call counts)
 * 
 * Usage:
 * ```typescript
 * import { setupPersistenceHooks } from './persistence/hooks';
 * 
 * setupPersistenceHooks({
 *   executionRepo,
 *   metricsRepo,
 *   messageRepo,
 *   messageBlockRepo,
 *   interactionRepo,
 *   toolStateRepo,
 * });
 * ```
 */

import { configureEngine } from 'aidk';
import type {
  ExecutionRepository,
  MetricsRepository,
  MessageRepository,
  MessageBlockRepository,
  InteractionRepository,
  ToolStateRepository,
} from '../repositories';
import { createExecuteHook, createStreamHook } from './engine-hooks';
import { createModelGenerateHook, createModelStreamHook } from './model-hooks';
import { createToolRunHook } from './tool-hooks';

// Re-export utilities for custom hook implementations
export * from './utils';

// Global tool state repository (accessible to ToolComponents)
let globalToolStateRepository: ToolStateRepository | null = null;

export interface PersistenceHooksConfig {
  executionRepo: ExecutionRepository;
  metricsRepo: MetricsRepository;
  messageRepo: MessageRepository;
  messageBlockRepo: MessageBlockRepository;
  interactionRepo: InteractionRepository;
  toolStateRepo: ToolStateRepository;
}

/**
 * Setup all persistence hooks.
 * 
 * This configures global hooks for engine, model, and tool operations
 * to automatically persist execution data.
 */
export function setupPersistenceHooks(config: PersistenceHooksConfig) {
  const {
    executionRepo,
    metricsRepo,
    messageRepo,
    messageBlockRepo,
    interactionRepo,
    toolStateRepo,
  } = config;

  // Make tool state repo globally accessible to ToolComponents
  globalToolStateRepository = toolStateRepo;

  // configureEngine replaces (not appends), so calling multiple times is idempotent
  configureEngine({
    globalHooks: {
      engine: {
        execute: [createExecuteHook({ executionRepo, metricsRepo, messageRepo, messageBlockRepo, interactionRepo })],
        stream: [createStreamHook({ executionRepo, metricsRepo, messageRepo, messageBlockRepo, interactionRepo })],
      },
      model: {
        generate: [createModelGenerateHook({ executionRepo, metricsRepo, interactionRepo })],
        stream: [createModelStreamHook({ executionRepo, metricsRepo, interactionRepo })],
      },
      tool: {
        run: [createToolRunHook({ executionRepo, metricsRepo })],
      },
    },
  });
}

/**
 * Get the global tool state repository.
 * Accessible to ToolComponents for persisting tool-specific state.
 */
export function getGlobalToolStateRepository(): ToolStateRepository | null {
  return globalToolStateRepository;
}

