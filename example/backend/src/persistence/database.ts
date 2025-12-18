/**
 * In-memory storage for the example application.
 * 
 * Re-exports from shared/server and provides a singleton store.
 */

import { createInMemoryStore, type InMemoryStore } from 'aidk-express';

// Re-export types for backwards compatibility
export type {
  InMemoryStore,
  ExecutionEntity,
  MetricsEntity,
  MessageEntity,
  MessageBlockEntity,
  InteractionEntity,
  ToolStateEntity,
} from 'aidk-express';

export { generateUUID } from 'aidk-express';

// Singleton store
let store: InMemoryStore | null = null;

export function getStore(): InMemoryStore {
  if (!store) {
    store = createInMemoryStore();
    console.log('In-memory store initialized');
  }
  return store;
}

export function clearStore(): void {
  if (store) {
    store.executions.clear();
    store.metrics.clear();
    store.messages.clear();
    store.messageBlocks.clear();
    store.interactions.clear();
    store.toolState.clear();
  }
}
