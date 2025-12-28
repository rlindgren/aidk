/**
 * ClientChannel - Client-side channel abstraction
 * 
 * Mirrors the server-side ChannelRouter pattern.
 * Provides typed, ergonomic access to bidirectional channel communication.
 * 
 * @example
 * ```typescript
 * // Define channel contract
 * const TodoChannel = defineChannel<
 *   { state_changed: { tasks: Task[] } },  // incoming
 *   { create_task: { title: string } }      // outgoing
 * >('todo-list');
 * 
 * // Use in vanilla JS
 * const todo = TodoChannel.connect(client);
 * todo.on('state_changed', ({ tasks }) => updateUI(tasks));
 * await todo.send('create_task', { title: 'Buy milk' });
 * todo.disconnect();
 * 
 * // Use in React
 * const todo = useChannel(TodoChannel);
 * useEffect(() => todo.on('state_changed', ({ tasks }) => setTasks(tasks)), []);
 * ```
 */

import type { EngineClient } from './engine-client';
import type { ChannelEvent } from './core';

// Re-export for convenience
export type { ChannelEvent };

/**
 * Channel definition - the contract for a channel
 */
export interface ChannelDefinition<
  TIncoming extends Record<string, unknown> = Record<string, unknown>,
  TOutgoing extends Record<string, unknown> = Record<string, unknown>
> {
  /** Channel name */
  name: string;
  /** Create a connected channel instance */
  connect(client: EngineClient): Channel<TIncoming, TOutgoing>;
  /** Incoming event types (for type inference) */
  _incoming?: TIncoming;
  /** Outgoing event types (for type inference) */
  _outgoing?: TOutgoing;
}

/**
 * Connected channel instance
 */
export interface Channel<
  TIncoming extends Record<string, unknown> = Record<string, unknown>,
  TOutgoing extends Record<string, unknown> = Record<string, unknown>
> {
  /** Channel name */
  readonly name: string;
  
  /** Whether the channel is connected */
  readonly connected: boolean;
  
  /**
   * Subscribe to an incoming event type
   * @returns Unsubscribe function
   */
  on<K extends keyof TIncoming>(
    eventType: K,
    handler: (payload: TIncoming[K], event: ChannelEvent) => void
  ): () => void;
  
  /**
   * Subscribe to all incoming events
   * @returns Unsubscribe function
   */
  onAny(handler: (event: ChannelEvent) => void): () => void;
  
  /**
   * Send an outgoing event
   */
  send<K extends keyof TOutgoing>(
    eventType: K,
    payload: TOutgoing[K]
  ): Promise<unknown>;
  
  /**
   * Disconnect from the channel
   */
  disconnect(): void;
}

/**
 * Internal channel implementation
 */
class ChannelImpl<
  TIncoming extends Record<string, unknown>,
  TOutgoing extends Record<string, unknown>
> implements Channel<TIncoming, TOutgoing> {
  private client: EngineClient;
  private handlers = new Map<string, Set<(payload: unknown, event: ChannelEvent) => void>>();
  private anyHandlers = new Set<(event: ChannelEvent) => void>();
  private unsubscribe?: () => void;
  private _connected = false;
  
  constructor(
    public readonly name: string,
    client: EngineClient
  ) {
    this.client = client;
    // Don't auto-connect - wait for first handler registration
    // This prevents the race condition where events arrive before handlers are set up
  }
  
  get connected(): boolean {
    return this._connected;
  }
  
  private ensureConnected(): void {
    if (this._connected) return;
    
    this.unsubscribe = this.client.subscribe(this.name, (event) => {
      // Debug logging
      if (this.name === 'todo-list') {
        console.debug(`[Channel:${this.name}] Received event:`, event.type, 'handlers:', this.handlers.get(event.type)?.size || 0);
      }
      
      // Call type-specific handlers
      const typeHandlers = this.handlers.get(event.type);
      if (typeHandlers) {
        typeHandlers.forEach(h => h(event.payload, event));
      }
      
      // Call any handlers
      this.anyHandlers.forEach(h => h(event));
    });
    
    this._connected = true;
  }
  
  on<K extends keyof TIncoming>(
    eventType: K,
    handler: (payload: TIncoming[K], event: ChannelEvent) => void
  ): () => void {
    const key = eventType as string;

    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler as any);
    
    // Connect lazily - only when we have handlers
    this.ensureConnected();
    
    return () => {
      this.handlers.get(key)?.delete(handler as any);
    };
  }
  
  onAny(handler: (event: ChannelEvent) => void): () => void {
    this.anyHandlers.add(handler);
    
    // Connect lazily - only when we have handlers
    this.ensureConnected();
    
    return () => {
      this.anyHandlers.delete(handler);
    };
  }
  
  async send<K extends keyof TOutgoing>(
    eventType: K,
    payload: TOutgoing[K]
  ): Promise<unknown> {
    return this.client.publish(this.name, eventType as string, payload, { excludeSender: true });
  }
  
  disconnect(): void {
    if (!this._connected) return;
    
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.handlers.clear();
    this.anyHandlers.clear();
    this._connected = false;
  }
}

/**
 * Define a channel contract
 * 
 * @param name - Channel name (used for both subscribe and publish)
 * @returns Channel definition that can be connected to a client
 * 
 * @example
 * ```typescript
 * // Define with full types
 * const TodoChannel = defineChannel<
 *   { state_changed: { tasks: Task[] }; task_created: { task: Task } },
 *   { create_task: { title: string }; toggle_complete: { task_id: string } }
 * >('todo-list');
 * 
 * // Or define incrementally
 * const TodoChannel = defineChannel('todo-list')
 *   .incoming<{ state_changed: { tasks: Task[] } }>()
 *   .outgoing<{ create_task: { title: string } }>();
 * ```
 */
export function defineChannel<
  TIncoming extends Record<string, unknown> = Record<string, unknown>,
  TOutgoing extends Record<string, unknown> = Record<string, unknown>
>(name: string): ChannelDefinition<TIncoming, TOutgoing> {
  console.debug(`[defineChannel] Creating channel definition: ${name}`);
  return {
    name,
    connect(client: EngineClient): Channel<TIncoming, TOutgoing> {
      console.debug(`[defineChannel.connect] Connecting channel: ${name}`);
      return new ChannelImpl<TIncoming, TOutgoing>(name, client);
    },
  };
}

/**
 * Type helper for defining payload types
 * @example
 * ```typescript
 * const TodoChannel = defineChannel<
 *   { state_changed: type<{ tasks: Task[] }> }
 * >('todo-list');
 * ```
 */
export type type<T> = T;

