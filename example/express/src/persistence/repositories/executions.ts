/**
 * Execution Repository
 *
 * Re-exports from shared/server for backwards compatibility.
 */

import { InMemoryExecutionRepository } from "aidk-express";
import { getStore } from "../database";

// Export implementation and types
export { InMemoryExecutionRepository as ExecutionRepository };
export type { ExecutionEntity } from "aidk-express";

// Create singleton instance
let repository: InMemoryExecutionRepository | null = null;

export function getExecutionRepository(): InMemoryExecutionRepository {
  if (!repository) {
    repository = new InMemoryExecutionRepository(getStore());
  }
  return repository;
}
