/**
 * Base props that all components can accept.
 * These are handled universally by EngineComponent and the compiler.
 */
export interface ComponentBaseProps {
  /**
   * Reference name for accessing this component instance.
   * Use com.getRef<ComponentType>('myRef') to access the instance.
   * 
   * @example
   * ```tsx
   * <Fork ref="myFork" input={forkInput} />
   * const fork = com.getRef<ForkComponent>('myFork');
   * ```
   */
  ref?: string;
  
  /**
   * Key for React-like reconciliation (optional).
   * Used by compiler to track component instances across renders.
   */
  key?: string | number;
}

