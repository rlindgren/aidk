/**
 * Tests for EngineModule
 *
 * Tests the NestJS module configuration.
 */

import "reflect-metadata";
import { EngineModule } from "../engine.module";
import { ENGINE_TOKEN } from "../tokens";
import { EngineContextInterceptor } from "../interceptors/engine-context.interceptor";
import type { Engine } from "aidk";

// Mock Engine
function createMockEngine(): Engine {
  return {
    execute: jest.fn(),
    stream: jest.fn(),
  } as unknown as Engine;
}

describe("EngineModule", () => {
  describe("forRoot", () => {
    it("should create a dynamic module", () => {
      const mockEngine = createMockEngine();
      const dynamicModule = EngineModule.forRoot({ engine: mockEngine });

      expect(dynamicModule.module).toBe(EngineModule);
    });

    it("should provide engine token", () => {
      const mockEngine = createMockEngine();
      const dynamicModule = EngineModule.forRoot({ engine: mockEngine });

      const engineProvider = dynamicModule.providers?.find(
        (p: any) => p.provide === ENGINE_TOKEN,
      );

      expect(engineProvider).toBeDefined();
      expect((engineProvider as any).useValue).toBe(mockEngine);
    });

    it("should provide EngineContextInterceptor", () => {
      const mockEngine = createMockEngine();
      const dynamicModule = EngineModule.forRoot({ engine: mockEngine });

      expect(dynamicModule.providers).toContain(EngineContextInterceptor);
    });

    it("should export ENGINE_TOKEN", () => {
      const mockEngine = createMockEngine();
      const dynamicModule = EngineModule.forRoot({ engine: mockEngine });

      expect(dynamicModule.exports).toContain(ENGINE_TOKEN);
    });

    it("should export EngineContextInterceptor", () => {
      const mockEngine = createMockEngine();
      const dynamicModule = EngineModule.forRoot({ engine: mockEngine });

      expect(dynamicModule.exports).toContain(EngineContextInterceptor);
    });
  });
});

describe("Tokens", () => {
  it("ENGINE_TOKEN should be a symbol", () => {
    expect(typeof ENGINE_TOKEN).toBe("symbol");
    expect(ENGINE_TOKEN.description).toBe("ENGINE");
  });
});
