/**
 * Spawn component - creates an independent spawn execution
 *
 * Spawn creates a completely independent execution with its own engine instance.
 * Can take children as the root definition, or use the `root` prop.
 *
 * @example
 * ```tsx
 * <Spawn ref="mySpawn" input={spawnInput} waitUntilComplete={true}>
 *   <Model model={myModel} />
 *   <Timeline>
 *     <Message role="user" content="Run independently" />
 *   </Timeline>
 * </Spawn>
 * ```
 *
 * @example
 * ```tsx
 * <Spawn
 *   ref="backgroundTask"
 *   root={myRoot}
 *   input={spawnInput}
 *   waitUntilComplete={false}
 *   onComplete={(result) => {
 *     com.setState('spawnResult', result);
 *   }}
 * />
 * ```
 */

import { createElement, type JSX, Fragment } from "../jsx-runtime";
import { Component, type ComponentDefinition } from "../../component/component";
import { COM } from "../../com/object-model";
import type { TickState } from "../../component/component";
import type { EngineInput } from "../../com/types";
import type { ExecutionHandle } from "../../engine/execution-types";
import type { EngineConfig } from "../../engine/engine";
import { registerWaitHandle } from "./fork-spawn-helpers";
import type { ComponentBaseProps } from "../jsx-types";

/**
 * Props for Spawn component
 */
export interface SpawnProps extends ComponentBaseProps {
  /**
   * Root component definition (optional if children are provided)
   * Children take precedence over root prop
   */
  root?: ComponentDefinition;

  /**
   * Children JSX that define what to execute in the spawn
   * These become the root definition for the spawned execution
   */
  children?: JSX.Element | JSX.Element[];

  /**
   * Input for the spawn execution
   * Defaults to empty timeline if not provided
   */
  input?: EngineInput;

  /**
   * Whether to wait for spawn completion before continuing tick
   * Default: false (fire and continue)
   */
  waitUntilComplete?: boolean;

  /**
   * Callback when spawn completes successfully
   */
  onComplete?: (result: any) => void | Promise<void>;

  /**
   * Callback when spawn errors
   */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Engine configuration for child engine
   */
  engineConfig?: Partial<EngineConfig>;

  /**
   * Whether to inherit model from parent execution
   * Default: true (model is inherited)
   * Set to false for truly independent spawns
   */
  inheritModel?: boolean;
}

/**
 * Spawn component implementation
 */
export class SpawnComponent extends Component<SpawnProps> {
  private spawnHandle?: ExecutionHandle;
  private spawnStarted = false;

  async onUnmount(com: COM): Promise<void> {
    // Cancel spawn if still running
    if (this.spawnHandle?.status === "running") {
      this.spawnHandle.cancel("Spawn component unmounted");
    }

    // Call parent onUnmount for ref cleanup
    super.onUnmount(com);
  }

  render(com: COM, _state: TickState): JSX.Element | null {
    if (!com.process) {
      throw new Error(
        "Spawn component requires process operations. Ensure Engine provides process interface to COM",
      );
    }

    // Determine root definition (children take precedence)
    const rootDefinition = this.getRootDefinition();
    if (!rootDefinition) {
      return null; // No root or children provided
    }

    // Start spawn on first render (instance persists across ticks)
    if (!this.spawnStarted) {
      try {
        // Inherit model from parent unless explicitly disabled
        const shouldInheritModel = this.props.inheritModel !== false;
        const parentModel = shouldInheritModel ? com.getModel() : undefined;

        // Build engine config with inherited model
        const engineConfig = {
          ...this.props.engineConfig,
          // Parent model is used as fallback if no model in engineConfig
          ...(parentModel && !this.props.engineConfig?.model ? { model: parentModel } : {}),
        };

        this.spawnHandle = com.process.spawn(this.props.input || { timeline: [] }, rootDefinition, {
          engineConfig,
        });

        // Set up handlers
        this.spawnHandle
          .waitForCompletion()
          .then((result) => {
            this.props.onComplete?.(result);
          })
          .catch((error) => {
            if (this.props.onError) {
              this.props.onError(error instanceof Error ? error : new Error(String(error)));
            }
          });

        // Register handle for waiting if needed
        registerWaitHandle(com, this.spawnHandle, this.props.waitUntilComplete || false);

        this.spawnStarted = true;
      } catch (error) {
        // Call error handler if provided
        if (this.props.onError) {
          this.props.onError(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    }

    // Spawn doesn't render any content
    return null;
  }

  /**
   * Get the ExecutionHandle for this spawn
   * Useful for accessing spawn status, result, etc.
   */
  getHandle(): ExecutionHandle | undefined {
    return this.spawnHandle;
  }

  /**
   * Determine root definition from props
   * Children take precedence over root prop
   */
  private getRootDefinition(): ComponentDefinition | undefined {
    // Children take precedence
    if (this.props.children) {
      const children = Array.isArray(this.props.children)
        ? this.props.children
        : [this.props.children];
      return createElement(Fragment, {}, ...children);
    }

    // Fall back to root prop
    return this.props.root;
  }
}

/**
 * Factory function for creating SpawnComponent in JSX
 *
 * @example
 * ```tsx
 * <Spawn ref="mySpawn" input={spawnInput} waitUntilComplete={true}>
 *   <Model model={myModel} />
 *   <Timeline>
 *     <Message role="user" content="Run independently" />
 *   </Timeline>
 * </Spawn>
 * ```
 */
export function Spawn(props: SpawnProps): JSX.Element {
  return createElement(SpawnComponent, props);
}
