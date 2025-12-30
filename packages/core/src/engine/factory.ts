/**
 * Factory function for creating Engine v2 instances
 *
 * Returns an Engine instance with Procedure-based execute() and stream() methods.
 * These methods support full type safety with .use(), .withHandle(), .withContext(), etc.
 */

import { Engine, type EngineConfig } from "./engine";

/**
 * Create an Engine v2 instance with Procedure-based methods
 *
 * @param config Engine configuration
 * @returns Engine instance with Procedure-based execute() and stream()
 *
 * @example
 * ```typescript
 * const engine = createEngine({ model: myModel });
 *
 * // Use as Procedure
 * await engine.execute(input, agent);
 *
 * // Use Procedure features
 * engine.execute.use(myMiddleware);
 * const { handle, result } = await engine.execute.withHandle().call(input, agent);
 * await engine.execute.withContext({ traceId: '123' }).call(input, agent);
 * ```
 */
export function createEngine(config: EngineConfig = {}): Engine {
  return new Engine(config);
}
