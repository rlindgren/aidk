/**
 * Tests for NestJS Decorators
 *
 * Tests the StreamAgent and ExecuteAgent decorators.
 */

import "reflect-metadata";
import { StreamAgent, ExecuteAgent } from "../decorators/agent";
import { AGENT_TOKEN } from "../tokens";

describe("NestJS Decorators", () => {
  describe("StreamAgent", () => {
    it("should set metadata with type stream", () => {
      class TestController {
        @StreamAgent()
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(
        AGENT_TOKEN,
        TestController.prototype.testMethod,
      );
      expect(metadata).toEqual({ type: "stream", agent: undefined });
    });

    it("should accept an agent JSX element", () => {
      const mockAgent = { type: "MockAgent", props: {} };

      class TestController {
        @StreamAgent(mockAgent as any)
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(
        AGENT_TOKEN,
        TestController.prototype.testMethod,
      );
      expect(metadata).toEqual({ type: "stream", agent: mockAgent });
    });
  });

  describe("ExecuteAgent", () => {
    it("should set metadata with type execute", () => {
      class TestController {
        @ExecuteAgent()
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(
        AGENT_TOKEN,
        TestController.prototype.testMethod,
      );
      expect(metadata).toEqual({ type: "execute", agent: undefined });
    });

    it("should accept an agent JSX element", () => {
      const mockAgent = { type: "MockAgent", props: { tools: [] } };

      class TestController {
        @ExecuteAgent(mockAgent as any)
        testMethod() {}
      }

      const metadata = Reflect.getMetadata(
        AGENT_TOKEN,
        TestController.prototype.testMethod,
      );
      expect(metadata).toEqual({ type: "execute", agent: mockAgent });
    });
  });

  describe("AGENT_TOKEN", () => {
    it("should be a unique symbol", () => {
      expect(typeof AGENT_TOKEN).toBe("symbol");
      expect(AGENT_TOKEN.description).toBe("AGENT");
    });
  });
});
