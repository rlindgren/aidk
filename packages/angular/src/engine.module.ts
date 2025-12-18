/**
 * Angular providers for Engine Integration
 * 
 * Services use plain @Injectable() (not providedIn: 'root') because they're
 * imported from external TypeScript source files. Explicit providers are
 * required for proper DI resolution.
 * 
 * Supports custom transports and channel clients via config:
 * @example
 * ```typescript
 * import { SSETransport } from '@packages/client/core';
 * 
 * const transport = new SSETransport({ ... });
 * provideEngine({
 *   transport,  // Use custom transport
 *   baseUrl: '...',
 * });
 * ```
 */

import { NgModule, type ModuleWithProviders, NgZone, Optional, Inject } from '@angular/core';
import { EngineService, ENGINE_CONFIG } from './engine.service';
import { ExecutionService } from './execution.service';
import { ChannelsService } from './channels.service';
import type { EngineClientConfig } from 'aidk-client';

/**
 * Create providers for all Engine services
 */
function createEngineProviders(config: EngineClientConfig) {
  return [
    { provide: ENGINE_CONFIG, useValue: config },
    {
      provide: EngineService,
      useFactory: (ngZone: NgZone, config: EngineClientConfig) => {
        console.log('Creating EngineService with config:', config);
        const service = new EngineService(ngZone, config);
        return service;
      },
      deps: [NgZone, [new Inject(ENGINE_CONFIG), new Optional()]],
    },
    ExecutionService,
    ChannelsService,
  ];
}

@NgModule({})
export class EngineModule {
  /**
   * Configure the Engine module with client options.
   * 
   * @example
   * ```typescript
   * @NgModule({
   *   imports: [
   *     EngineModule.forRoot({ baseUrl: 'http://localhost:3000' }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(config: EngineClientConfig): ModuleWithProviders<EngineModule> {
    return {
      ngModule: EngineModule,
      providers: createEngineProviders(config),
    };
  }
}

/**
 * Standalone provider function for Engine services.
 * Use this with bootstrapApplication.
 * 
 * @example
 * ```typescript
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideEngine({ baseUrl: 'http://localhost:3000' }),
 *   ],
 * });
 * ```
 */
export function provideEngine(config: EngineClientConfig) {
  return createEngineProviders(config);
}
