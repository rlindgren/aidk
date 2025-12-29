/**
 * Message Repository
 * 
 * Re-exports from shared/server for backwards compatibility.
 */

import { InMemoryMessageRepository } from 'aidk-express';
import { getStore } from '../database';

// Export implementation and types
export { InMemoryMessageRepository as MessageRepository };
export type { MessageEntity } from 'aidk-express';

// Create singleton instance
let repository: InMemoryMessageRepository | null = null;

export function getMessageRepository(): InMemoryMessageRepository {
  if (!repository) {
    repository = new InMemoryMessageRepository(getStore());
  }
  return repository;
}
