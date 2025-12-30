/**
 * # AIDK NestJS
 *
 * NestJS integration for AIDK agents. Provides modules, controllers,
 * guards, and interceptors for seamless engine integration.
 *
 * ## Features
 *
 * - **EngineModule** - Configure engine as a NestJS module
 * - **ChannelModule** - Real-time channel communication
 * - **Guards & Interceptors** - Context extraction and validation
 * - **Decorators** - Inject engine context into handlers
 *
 * ## Quick Start
 *
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
 * // controller.ts
 * import { EngineController, Stream } from 'aidk-nestjs';
 *
 * @Controller('api/run')
 * export class RunController {
 *   @Post('stream')
 *   @Stream()
 *   async stream(@Body() input: EngineInput) {
 *     return input;
 *   }
 * }
 * ```
 *
 * @module aidk-nestjs
 */

// Module
export { EngineModule } from "./engine.module";
export type { EngineModuleOptions } from "./engine.module";

// Controller decorators
export { Stream, Execute, StreamAgent, ExecuteAgent } from "./decorators/agent";

// Guards
export { EngineContextGuard } from "./guards/engine-context.guard";

// Interceptors
export { EngineContextInterceptor } from "./interceptors/engine-context.interceptor";

// SSE Transport
export { SSETransport } from "./transports/sse";
export type { SSETransportConfig } from "./transports/sse";

// Re-export from server
export * from "aidk-server";
