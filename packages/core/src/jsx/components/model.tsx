import { createElement, type JSX, Fragment } from '../jsx-runtime';
import { type EngineComponent, Component } from '../../component/component';
import { ContextObjectModel } from '../../com/object-model';
import { ModelAdapter, type ModelInstance } from '../../model/model';
import { modelRegistry } from '../../utils/registry';
import type { ComponentBaseProps } from '../jsx-types';
import type { ProviderGenerationOptions } from '../../types';
import type { MessageTransformationConfig } from '../../model/model';

/**
 * Props for Model component.
 */
export interface ModelComponentProps extends ComponentBaseProps {
  /**
   * The model adapter instance or identifier.
   * If a string, will be resolved from the model registry.
   */
  model: ModelInstance | string;

  /**
   * Provider-specific options.
   * Used for model generation/streaming calls and other operations.
   * Each adapter can extend this type using module augmentation.
   */
  providerOptions?: ProviderGenerationOptions;
  
  /**
   * Optional callback when model is mounted.
   */
  onMount?: (com: ContextObjectModel) => Promise<void> | void;
  
  /**
   * Optional callback when model is unmounted.
   */
  onUnmount?: (com: ContextObjectModel) => Promise<void> | void;
}

/**
 * Model component that dynamically sets the model adapter for the current execution.
 * 
 * Model is a configuration component - it sets which model adapter to use.
 * It does NOT contain content (messages, timeline entries, etc.).
 * 
 * When mounted, sets the model on the COM.
 * When unmounted, clears the model.
 * 
 * Model applies to the entire execution scope - all messages/timeline entries
 * will use the model set by the most recent Model component.
 * 
 * If multiple Model components render in the same tick, the last one wins
 * (it becomes the active model for that tick and subsequent ticks).
 * 
 * @example
 * ```tsx
 * <Fragment>
 *   <Model model={myModel} />
 *   <Message role="user" content="Hello" />
 * </Fragment>
 * ```
 * 
 * @example
 * ```tsx
 * <Fragment>
 *   <Model model="gpt-4" />
 *   <Timeline>
 *     <Message role="user" content="Hello" />
 *   </Timeline>
 * </Fragment>
 * ```
 */
export class ModelComponent extends Component<ModelComponentProps> {
  async onMount(com: ContextObjectModel): Promise<void> {
    // Set the model on COM and notify Engine
    com.setModel(this.props.model);
    
    // Call user's onMount if provided
    if (this.props.onMount) {
      await this.props.onMount(com);
    }
  }

  async onUnmount(com: ContextObjectModel): Promise<void> {
    // Clear the model when component unmounts
    com.unsetModel();
    
    // Call user's onUnmount if provided
    if (this.props.onUnmount) {
      await this.props.onUnmount(com);
    }
  }

  render(com: ContextObjectModel): JSX.Element | null {
    // Model is configuration-only - doesn't render anything
    return null;
  }
}

/**
 * Factory function for creating ModelComponent in JSX.
 * 
 * Model is configuration-only - it sets which model adapter to use.
 * Use it as a sibling to content components, not as a container.
 * 
 * @example
 * ```tsx
 * <Fragment>
 *   <Model model={myModel} />
 *   <Message role="user" content="Hello" />
 * </Fragment>
 * ```
 */
export function Model(props: ModelComponentProps): JSX.Element {
  return createElement(ModelComponent, props);
}


// ============================================================================
// ModelOptions Component
// ============================================================================

/**
 * Props for ModelOptions component.
 * Configuration for how content is transformed for model input.
 */
export interface ModelOptionsProps extends ComponentBaseProps {
  /**
   * Unified message transformation configuration.
   * Controls how event and ephemeral messages are transformed for the model.
   * Can override model-level defaults set in adapter capabilities.
   * 
   * @see MessageTransformationConfig
   */
  messageTransformation?: Partial<MessageTransformationConfig>;
  
  /**
   * Model temperature (0-2).
   */
  temperature?: number;
  
  /**
   * Maximum tokens to generate.
   */
  maxTokens?: number;
}

/**
 * ModelOptions component for configuring how content is transformed for model input.
 * 
 * Sets message transformation configuration, role mapping, and other model options that affect
 * how ephemeral content (grounding) and event messages are formatted.
 * 
 * @example
 * ```tsx
 * <ModelOptions
 *   messageTransformation={{
 *     roleMapping: {
 *       event: 'user',
 *       ephemeral: 'user',
 *     },
 *     delimiters: {
 *       event: '[Event]',
 *       ephemeral: '[Context]',
 *       useDelimiters: true,
 *     },
 *   }}
 * />
 * ```
 */
export class ModelOptionsComponent extends Component<ModelOptionsProps> {
  async onTickStart(com: ContextObjectModel): Promise<void> {
    const { messageTransformation, temperature, maxTokens } = this.props;
    
    com.setModelOptions({
      messageTransformation,
      temperature,
      maxTokens,
    });
  }

  render(): JSX.Element | null {
    // Configuration-only - doesn't render anything
    return null;
  }
}

/**
 * ModelOptions component for declarative configuration of content transformation.
 * 
 * @example
 * ```tsx
 * <Fragment>
 *   <Model model={myModel} />
 *   <ModelOptions
 *     messageTransformation={{
 *       delimiters: {
 *         ephemeral: '[Context]',
 *         event: '[Event]',
 *         useDelimiters: true,
 *       }
 *     }}
 *   />
 *   <Timeline>...</Timeline>
 * </Fragment>
 * ```
 */
export function ModelOptions(props: ModelOptionsProps): JSX.Element {
  return createElement(ModelOptionsComponent, props);
}

