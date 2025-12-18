import { type DynamicModule, Module, Global } from '@nestjs/common';
import type { Engine } from 'aidk';
import { EngineContextInterceptor } from './interceptors/engine-context.interceptor';
import { ENGINE_TOKEN } from './tokens';

export interface EngineModuleOptions {
  engine: Engine;
}

@Global()
@Module({})
export class EngineModule {
  static forRoot(options: EngineModuleOptions): DynamicModule {
    return {
      module: EngineModule,
      providers: [
        {
          provide: ENGINE_TOKEN,
          useValue: options.engine,
        },
        EngineContextInterceptor,
      ],
      exports: [ENGINE_TOKEN, EngineContextInterceptor],
    };
  }
}

