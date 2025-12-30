/**
 * Tests for NestJS Decorators
 *
 * Tests the Stream and Execute decorators.
 */

import "reflect-metadata";
import { Stream, Execute, StreamAgent, ExecuteAgent } from "../decorators/agent";
import { ROOT_TOKEN, AGENT_TOKEN } from "../tokens";

describe("NestJS Decorators", () => {
  describe("Stream", () => {
    it("should set metadata with type stream", () => {
      class TestController {
        @Stream()
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(ROOT_TOKEN, TestController.prototype.testMethod);
      expect(metadata).toEqual({ type: "stream", root: undefined });
    });

    it("should accept a root JSX element", () => {
      const mockRoot = { type: "MockRoot", props: {} };

      class TestController {
        @Stream(mockRoot as any)
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(ROOT_TOKEN, TestController.prototype.testMethod);
      expect(metadata).toEqual({ type: "stream", root: mockRoot });
    });
  });

  describe("Execute", () => {
    it("should set metadata with type execute", () => {
      class TestController {
        @Execute()
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(ROOT_TOKEN, TestController.prototype.testMethod);
      expect(metadata).toEqual({ type: "execute", root: undefined });
    });

    it("should accept a root JSX element", () => {
      const mockRoot = { type: "MockRoot", props: { tools: [] } };

      class TestController {
        @Execute(mockRoot as any)
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(ROOT_TOKEN, TestController.prototype.testMethod);
      expect(metadata).toEqual({ type: "execute", root: mockRoot });
    });
  });

  describe("Deprecated aliases", () => {
    it("StreamAgent should be an alias for Stream", () => {
      expect(StreamAgent).toBe(Stream);
    });

    it("ExecuteAgent should be an alias for Execute", () => {
      expect(ExecuteAgent).toBe(Execute);
    });

    it("AGENT_TOKEN should be an alias for ROOT_TOKEN", () => {
      expect(AGENT_TOKEN).toBe(ROOT_TOKEN);
    });
  });

  describe("ROOT_TOKEN", () => {
    it("should be a unique symbol", () => {
      expect(typeof ROOT_TOKEN).toBe("symbol");
      expect(ROOT_TOKEN.description).toBe("ROOT");
    });
  });
});
