/**
 * Message Block Repository
 *
 * Re-exports from shared/server for backwards compatibility.
 */

import { InMemoryMessageBlockRepository, type MessageBlockEntity } from "aidk-express";
import { getStore } from "../database";

// Export implementation and types
export { InMemoryMessageBlockRepository as MessageBlockRepository };
export type { MessageBlockEntity };

// Create singleton instance
let repository: InMemoryMessageBlockRepository | null = null;

export function getMessageBlockRepository(): InMemoryMessageBlockRepository {
  if (!repository) {
    repository = new InMemoryMessageBlockRepository(getStore());
  }
  return repository;
}
