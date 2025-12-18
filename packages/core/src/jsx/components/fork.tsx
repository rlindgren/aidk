/**
 * Fork component - creates a forked execution with inherited state
 * 
 * Fork creates a child execution that inherits state from the parent.
 * Can take children as the agent definition, or use the `agent` prop.
 * 
 * @example
 * ```tsx
 * <Fork ref="myFork" input={forkInput} waitUntilComplete={true}>
 *   <Model model={myModel} />
 *   <Timeline>
 *     <Message role="user" content="Process this" />
 *   </Timeline>
 * </Fork>
 * ```
 * 
 * @example
 * ```tsx
 * <Fork 
 *   ref="dataFork"
 *   agent={myAgent}
 *   input={forkInput}
 *   waitUntilComplete={false}
 *   onComplete={(result) => {
 *     com.setState('forkResult', result);
 *   }}
 * />
 * ```
 */

import { createElement, type JSX, Fragment } from '../jsx-runtime';
import { Component, type ComponentDefinition } from '../../component/component';
import { ContextObjectModel } from '../../com/object-model';
import { type TickState } from '../../component/component';
import { type EngineInput } from '../../com/types';
import { type ExecutionHandle, type ForkInheritanceOptions } from '../../engine/execution-types';
import { type EngineConfig } from '../../engine/engine';
import { registerWaitHandle } from './fork-spawn-helpers';
import { type ComponentBaseProps } from '../jsx-types';

/**
 * Props for Fork component
 */
export interface ForkProps extends ComponentBaseProps {
  
  /**
   * Agent definition (optional if children are provided)
   * Children take precedence over agent prop
   */
  agent?: ComponentDefinition;
  
  /**
   * Children JSX that define what to execute in the fork
   * These become the agent definition for the forked execution
   */
  children?: JSX.Element | JSX.Element[];
  
  /**
   * Input for the fork execution
   * Defaults to empty timeline if not provided
   */
  input?: EngineInput;
  
  /**
   * Whether to wait for fork completion before continuing tick
   * Default: false (fire and continue)
   */
  waitUntilComplete?: boolean;
  
  /**
   * Callback when fork completes successfully
   */
  onComplete?: (result: any) => void | Promise<void>;
  
  /**
   * Callback when fork errors
   */
  onError?: (error: Error) => void | Promise<void>;
  
  /**
   * Inheritance options for fork
   */
  inherit?: ForkInheritanceOptions;
  
  /**
   * Parent PID (defaults to current execution PID)
   */
  parentPid?: string;
  
  /**
   * Engine configuration for child engine
   */
  engineConfig?: Partial<EngineConfig>;
}

/**
 * Fork component implementation
 */
export class ForkComponent extends Component<ForkProps> {
  private forkHandle?: ExecutionHandle;
  private forkStarted = false;
  
  async onUnmount(com: ContextObjectModel): Promise<void> {
    // Cancel fork if still running
    if (this.forkHandle?.status === 'running') {
      this.forkHandle.cancel('Fork component unmounted');
    }
    
    // Call parent onUnmount for ref cleanup
    super.onUnmount(com);
  }
  
  render(com: ContextObjectModel, state: TickState): JSX.Element | null {
    if (!com.process) {
      throw new Error('Fork component requires process operations. Ensure Engine provides process interface to COM');
    }
    
    // Determine agent definition (children take precedence)
    const agentDefinition = this.getAgentDefinition();
    if (!agentDefinition) {
      return null; // No agent or children provided
    }
    
    // Start fork on first render (instance persists across ticks)
    if (!this.forkStarted) {
      try {
        this.forkHandle = com.process.fork(
          this.props.input || { timeline: [] },
          agentDefinition,
          {
            parentPid: this.props.parentPid,
            inherit: this.props.inherit,
            engineConfig: this.props.engineConfig,
          }
        );
        
        // Set up handlers
        this.forkHandle.waitForCompletion()
          .then((result) => {
            this.props.onComplete?.(result);
          })
          .catch((error) => {
            if (this.props.onError) {
              this.props.onError(error instanceof Error ? error : new Error(String(error)));
            }
          });
        
        // Register handle for waiting if needed
        registerWaitHandle(com, this.forkHandle, this.props.waitUntilComplete || false);
        
        this.forkStarted = true;
      } catch (error) {
        // Call error handler if provided
        if (this.props.onError) {
          this.props.onError(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    }
    
    // Fork doesn't render any content
    return null;
  }
  
  /**
   * Get the ExecutionHandle for this fork
   * Useful for accessing fork status, result, etc.
   */
  getHandle(): ExecutionHandle | undefined {
    return this.forkHandle;
  }
  
  /**
   * Determine agent definition from props
   * Children take precedence over agent prop
   */
  private getAgentDefinition(): ComponentDefinition | undefined {
    // Children take precedence
    if (this.props.children) {
      const children = Array.isArray(this.props.children) 
        ? this.props.children 
        : [this.props.children];
      return createElement(Fragment, {}, ...children);
    }
    
    // Fall back to agent prop
    return this.props.agent;
  }
}

/**
 * Factory function for creating ForkComponent in JSX
 * 
 * @example
 * ```tsx
 * <Fork ref="myFork" input={forkInput} waitUntilComplete={true}>
 *   <Model model={myModel} />
 *   <Timeline>
 *     <Message role="user" content="Process this" />
 *   </Timeline>
 * </Fork>
 * ```
 */
export function Fork(props: ForkProps): JSX.Element {
  return createElement(ForkComponent, props);
}

