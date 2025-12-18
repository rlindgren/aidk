import type { Middleware } from 'aidk-kernel';
import type { EngineHookMiddleware, EngineHookName } from './engine/engine-hooks';
import type { ModelHookMiddleware, ModelHookName } from './model/model-hooks';
import type { ToolHookMiddleware, ToolHookName } from './tool/tool-hooks';

export interface GlobalEngineConfig {
  globalMiddleware?: Middleware[];
  globalHooks?: {
    engine?: {
      [K in EngineHookName]?: EngineHookMiddleware<K>[];
    };
    model?: {
      [K in ModelHookName]?: ModelHookMiddleware<K>[];
    };
    tool?: {
      [K in ToolHookName]?: ToolHookMiddleware<K>[];
    };
  };
}

const config: GlobalEngineConfig = {
  globalMiddleware: [],
  globalHooks: undefined,
};

/**
 * Configure global defaults for the Engine.
 * This allows setting middleware that applies to ALL operations created via createEngineProcedure,
 * and hooks that apply to ALL engines, models, and tools.
 * 
 * @example
 * ```typescript
 * configureEngine({
 *   globalMiddleware: [myMiddleware],
 *   globalHooks: {
 *     engine: {
 *       execute: [async (args, envelope, next) => {
 *         console.log('Global engine execute hook');
 *         return await next();
 *       }],
 *     },
 *     model: {
 *       generate: [async (args, envelope, next) => {
 *         console.log('Global model generate hook');
 *         return await next();
 *       }],
 *     },
 *     tool: {
 *       run: [async (args, envelope, next) => {
 *         console.log('Global tool run hook');
 *         return await next();
 *       }],
 *     },
 *   },
 * });
 * ```
 */
export function configureEngine(options: GlobalEngineConfig) {
  if (options.globalMiddleware) {
    config.globalMiddleware = options.globalMiddleware;
  }
  if (options.globalHooks) {
    config.globalHooks = options.globalHooks;
  }
}

export function getGlobalMiddleware() {
  return config.globalMiddleware;
}

export function getGlobalHooks() {
  return config.globalHooks;
}


