/**
 * Metrics Repository
 * 
 * Re-exports from shared/server for backwards compatibility.
 */

import { InMemoryMetricsRepository, type MetricsEntity } from 'aidk-express';
import { getStore } from '../database';

// Export implementation and types
export { InMemoryMetricsRepository as MetricsRepository };
export type { MetricsEntity };

// Create singleton instance
let repository: InMemoryMetricsRepository | null = null;

export function getMetricsRepository(): InMemoryMetricsRepository {
  if (!repository) {
    repository = new InMemoryMetricsRepository(getStore());
  }
  return repository;
}
