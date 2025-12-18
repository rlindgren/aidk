# EngineModule

The `EngineModule` is a NestJS module that provides engine integration for your application.

## Installation

```bash
pnpm add aidk-nestjs aidk @nestjs/common @nestjs/core rxjs
```

## Basic Usage

```typescript
import { Module } from '@nestjs/common';
import { EngineModule } from 'aidk-nestjs';
import { createEngine } from 'aidk';

@Module({
  imports: [
    EngineModule.forRoot({
      engine: createEngine(),
    }),
  ],
})
export class AppModule {}
```

## API

### `EngineModule.forRoot(options)`

Configures the engine module with the provided options.

**Parameters:**

- `options.engine` - An `Engine` instance created with `createEngine()`

**Returns:**

A `DynamicModule` that can be imported into your NestJS module.

## Global Module

`EngineModule` is marked as `@Global()`, meaning once imported, the engine instance is available throughout your application via dependency injection.

## Accessing the Engine

The engine is provided via the `ENGINE_TOKEN` injection token:

```typescript
import { Inject } from '@nestjs/common';
import { ENGINE_TOKEN } from 'aidk-nestjs';
import type { Engine } from 'aidk';

@Injectable()
export class MyService {
  constructor(@Inject(ENGINE_TOKEN) private engine: Engine) {}
  
  async execute() {
    // Use engine here
  }
}
```

## Example

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { EngineModule } from 'aidk-nestjs';
import { createEngine } from 'aidk';
import { AgentController } from './agent.controller';

@Module({
  imports: [
    EngineModule.forRoot({
      engine: createEngine(),
    }),
  ],
  controllers: [AgentController],
})
export class AppModule {}
```

