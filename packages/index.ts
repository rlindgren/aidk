/**
 * Engine Example Shared Modules
 * 
 * This package provides reusable building blocks for Engine frontend and backend applications.
 * 
 * ## Packages
 * 
 * - `./client` - Framework-agnostic Engine client (works everywhere)
 * - `./react` - React hooks wrapping the client
 * - `./angular` - Angular services wrapping the client
 * - `./express` - Express middleware and routes (TODO)
 * - `./nestjs` - NestJS modules and services (TODO)
 * - `./server` - Server-side utilities (TODO)
 * 
 * @example
 * ```typescript
 * // Framework-agnostic
 * import { EngineClient, createEngineClient } from '@example/packages/client';
 * 
 * // React
 * import { useEngineClient, useExecution } from '@example/packages/react';
 * 
 * // Angular
 * import { EngineModule, EngineService, ExecutionService } from '@example/packages/angular';
 * 
 * // Express (TODO)
 * import { createChannelRoutes, SSETransport } from '@example/packages/express';
 * ```
 */

// Re-export client for direct access
export * from './client';

