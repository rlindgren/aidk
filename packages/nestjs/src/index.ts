/**
 * NestJS Integration for AIDK
 * 
 * Provides NestJS modules, controllers, guards, and interceptors for engine integration.
 * 
 * @example
 * ```typescript
 * // app.module.ts
 * import { EngineModule } from 'aidk-nestjs';
 * 
 * @Module({
 *   imports: [
 *     EngineModule.forRoot({
 *       engine: createEngine(),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * 
 * // agent.controller.ts
 * import { EngineController, StreamAgent } from 'aidk-nestjs';
 * 
 * @Controller('api/agent')
 * export class AgentController {
 *   @Post('stream')
 *   @StreamAgent()
 *   async stream(@Body() input: EngineInput) {
 *     return input;
 *   }
 * }
 * ```
 */

// Module
export { EngineModule } from './engine.module';
export type { EngineModuleOptions } from './engine.module';

// Controller decorators
export { StreamAgent, ExecuteAgent } from './decorators/agent';

// Guards
export { EngineContextGuard } from './guards/engine-context.guard';

// Interceptors
export { EngineContextInterceptor } from './interceptors/engine-context.interceptor';

// SSE Transport
export { SSETransport } from './transports/sse';
export type { SSETransportConfig } from './transports/sse';

// Re-export from server
export * from 'aidk-server';

