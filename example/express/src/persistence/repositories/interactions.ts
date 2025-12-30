/**
 * Interaction Repository
 *
 * Re-exports from shared/server for backwards compatibility.
 */

import { InMemoryInteractionRepository, type InteractionEntity } from "aidk-express";
import { getStore } from "../database";

// Export implementation and types
export { InMemoryInteractionRepository as InteractionRepository };
export type { InteractionEntity };

// Create singleton instance
let repository: InMemoryInteractionRepository | null = null;

export function getInteractionRepository(): InMemoryInteractionRepository {
  if (!repository) {
    repository = new InMemoryInteractionRepository(getStore());
  }
  return repository;
}
