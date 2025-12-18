import { applyRegistryMiddleware, type Procedure, wrapProcedure } from 'aidk-kernel';
import { telemetryMiddleware, errorMiddleware } from './middleware/defaults';
import { getGlobalMiddleware } from './config';

export const createEngineProcedure = wrapProcedure([
  telemetryMiddleware,
  errorMiddleware,
  ...(getGlobalMiddleware() || [])
]);

// Re-export the helper for convenience
export { applyRegistryMiddleware };

export function isProcedure(value: any): value is Procedure<any> {
  return (
    typeof value === 'function' &&
    'use' in value && typeof value.use === 'function' &&
    'withContext' in value && typeof value.withContext === 'function'
  );
}