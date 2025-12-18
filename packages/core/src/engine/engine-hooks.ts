import type { Middleware } from 'aidk-kernel';
import type { EngineInput, COMInput } from '../com/types';
import type { EngineStreamEvent } from './engine-events';
import type { ComponentDefinition } from '../component/component';
import type { JSX } from '../jsx/jsx-runtime';
import type { EngineContext } from '../types';
import { BaseHookRegistry } from '../hooks/base-hook-registry';
import { getGlobalHooks } from '../config';

/**
 * Engine operation names.
 */
export type EngineHookName = 'execute' | 'stream';

/**
 * Engine selector for hook registration.
 * For now, we only support global hooks (all engines).
 * Future: Could support engine-specific hooks by engine name or type.
 */
export type EngineSelector = undefined; // Global (all engines)

/**
 * Hook middleware type for engine operations.
 */
export type EngineHookMiddleware<T extends EngineHookName> = Middleware<EngineHookArgs<T>>;

/**
 * Arguments for each engine hook.
 */
export type EngineHookArgs<T extends EngineHookName> = T extends 'execute'
  ? [input: EngineInput, agent?: JSX.Element | ComponentDefinition | ComponentDefinition[], options?: Partial<EngineContext>]
  : T extends 'stream'
  ? [input: EngineInput, agent?: JSX.Element | ComponentDefinition | ComponentDefinition[], options?: Partial<EngineContext>]
  : never;

/**
 * Return type for each engine hook.
 */
export type EngineHookReturn<T extends EngineHookName> = T extends 'execute'
  ? Promise<COMInput>
  : T extends 'stream'
  ? AsyncIterable<EngineStreamEvent>
  : never;

/**
 * Engine-specific hook registry.
 * Uses BaseHookRegistry to reduce code duplication.
 */
export class EngineHookRegistry extends BaseHookRegistry<
  EngineHookName,
  EngineSelector,
  EngineHookMiddleware<EngineHookName>
> {
  protected getAllHookNames(): readonly EngineHookName[] {
    return [
      'execute',
      'stream',
    ] as const;
  }

  /**
   * Get all middleware for an engine hook.
   * Merges global hooks (from configureEngine) with instance-specific hooks.
   * Global hooks are applied first, then instance hooks.
   */
  getMiddleware<T extends EngineHookName>(
    hookName: T
  ): EngineHookMiddleware<T>[] {
    const instanceHooks = this.registry.getMiddleware(
      hookName,
      () => [] // No selectors for now - only global hooks
    );
    
    // Merge global hooks (if any) - apply global hooks first, then instance hooks
    const globalHooks = getGlobalHooks()?.engine?.[hookName];
    if (globalHooks && globalHooks.length > 0) {
      return [...globalHooks, ...instanceHooks] as EngineHookMiddleware<T>[];
    }
    
    return instanceHooks;
  }
}

