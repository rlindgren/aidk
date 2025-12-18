/**
 * ServerClient - Direct engine access for server-side use
 * 
 * Provides the same interface pattern as frontend clients but calls
 * the engine directly without HTTP. Exposes underlying Procedures.
 * 
 * @example
 * ```typescript
 * import { createServerClient } from 'aidk';
 * 
 * // With existing engine (uses engine's configured root)
 * const client = createServerClient({ engine });
 * const result = await client.execute('Hello');
 * 
 * // With specific agent/component
 * const result = await client.execute('Hello', { agent: MyAgentComponent });
 * 
 * // Direct procedure access
 * const result = await client.procedures.execute(input, agent);
 * const { handle } = await client.procedures.execute.withHandle().call(input);
 * ```
 */

import { Engine, type EngineConfig } from '../engine/engine';
import type { EngineInput, COMInput } from '../com/types';
import type { EngineStreamEvent } from '../engine/engine-events';
import type { ComponentDefinition } from '../component/component';
import { type MessageInput, normalizeMessageInput, messagesToTimeline } from './types';
import { type JSX } from '../jsx/jsx-runtime';

// =============================================================================
// Types
// =============================================================================

export interface ServerClientConfig {
  /** Existing engine instance */
  engine?: Engine;
  /** Config to create new engine (if engine not provided) */
  engineConfig?: EngineConfig;
}

export interface ExecuteOptions {
  /** Agent/component to use (overrides engine's default root) */
  agent?: ComponentDefinition | JSX.Element;
  /** Thread ID for conversation continuity */
  threadId?: string;
  /** Additional engine input fields */
  input?: Partial<EngineInput>;
}

// =============================================================================
// ServerClient
// =============================================================================

export class ServerClient {
  private _engine: Engine;
  private _ownsEngine: boolean;

  constructor(config: ServerClientConfig) {
    if (config.engine) {
      this._engine = config.engine;
      this._ownsEngine = false;
    } else if (config.engineConfig) {
      this._engine = new Engine(config.engineConfig);
      this._ownsEngine = true;
    } else {
      throw new Error('ServerClient requires either engine or engineConfig');
    }
  }

  // ===========================================================================
  // High-Level API
  // ===========================================================================

  /**
   * Execute and return result (non-streaming)
   */
  async execute(input: MessageInput, options: ExecuteOptions = {}): Promise<COMInput> {
    const engineInput = this.buildEngineInput(input, options);
    return this._engine.execute(engineInput, options.agent);
  }

  /**
   * Stream execution events
   */
  async *stream(input: MessageInput, options: ExecuteOptions = {}): AsyncGenerator<EngineStreamEvent> {
    const engineInput = this.buildEngineInput(input, options);
    yield* await this._engine.stream(engineInput, options.agent);
  }

  // ===========================================================================
  // Direct Procedure Access
  // ===========================================================================

  /**
   * Access underlying engine procedures directly.
   * 
   * Use for advanced features like middleware, handles, custom context:
   * ```typescript
   * client.procedures.execute.use(myMiddleware);
   * const { handle } = await client.procedures.execute.withHandle().call(input);
   * await client.procedures.stream.withContext({ traceId: '123' }).call(input);
   * ```
   */
  get procedures() {
    return {
      execute: this._engine.execute,
      stream: this._engine.stream,
    };
  }

  /** Direct access to the underlying engine instance */
  get engine(): Engine {
    return this._engine;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Shutdown the client */
  async shutdown(): Promise<void> {
    if (this._ownsEngine) {
      this._engine.removeAllListeners();
    }
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private buildEngineInput(input: MessageInput, options: ExecuteOptions): EngineInput {
    const messages = normalizeMessageInput(input, 'user');
    const timeline = messagesToTimeline(messages);
    
    return {
      timeline,
      metadata: {
        threadId: options.threadId,
        ...options.input?.metadata,
      },
      ...options.input,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createServerClient(config: ServerClientConfig): ServerClient {
  return new ServerClient(config);
}

