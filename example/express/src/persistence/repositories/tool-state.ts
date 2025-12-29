/**
 * Tool State Repository
 * 
 * Re-exports from shared/server for backwards compatibility.
 */

import { InMemoryToolStateRepository, type ToolStateEntity } from 'aidk-express';
import { getStore } from '../database';

// Export implementation and types
export { InMemoryToolStateRepository as ToolStateRepository };
export type { ToolStateEntity };

// Create singleton instance
let repository: InMemoryToolStateRepository | null = null;

export function getToolStateRepository(): InMemoryToolStateRepository {
  if (!repository) {
    repository = new InMemoryToolStateRepository(getStore());
  }
  return repository;
}
