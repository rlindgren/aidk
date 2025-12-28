/**
 * Tests for tool confirmation flow (requiresConfirmation)
 */

import { z } from "zod";
import { createTool, ToolExecutionType } from "../../tool/tool";
import { ToolExecutor } from "../tool-executor";
import { ToolConfirmationCoordinator } from "../tool-confirmation-coordinator";
import { ContextObjectModel } from "../../com/object-model";
import type { AgentToolCall } from "aidk-shared";

describe("Tool Confirmation", () => {
  describe("ToolConfirmationCoordinator", () => {
    let coordinator: ToolConfirmationCoordinator;

    beforeEach(() => {
      coordinator = new ToolConfirmationCoordinator();
    });

    it("should wait for confirmation and resolve when confirmed", async () => {
      const toolUseId = "test-tool-1";
      const toolName = "test_tool";

      // Start waiting for confirmation
      const confirmationPromise = coordinator.waitForConfirmation(
        toolUseId,
        toolName,
      );

      // Simulate async confirmation (like from client)
      setTimeout(() => {
        coordinator.resolveConfirmation(toolUseId, true, false);
      }, 10);

      const result = await confirmationPromise;

      expect(result.toolUseId).toBe(toolUseId);
      expect(result.confirmed).toBe(true);
      expect(result.always).toBe(false);
    });

    it("should wait for confirmation and resolve when denied", async () => {
      const toolUseId = "test-tool-2";
      const toolName = "test_tool";

      const confirmationPromise = coordinator.waitForConfirmation(
        toolUseId,
        toolName,
      );

      setTimeout(() => {
        coordinator.resolveConfirmation(toolUseId, false, false);
      }, 10);

      const result = await confirmationPromise;

      expect(result.confirmed).toBe(false);
      expect(result.always).toBe(false);
    });

    it("should handle 'always' flag for persistent preferences", async () => {
      const toolUseId = "test-tool-3";
      const toolName = "test_tool";

      const confirmationPromise = coordinator.waitForConfirmation(
        toolUseId,
        toolName,
      );

      setTimeout(() => {
        coordinator.resolveConfirmation(toolUseId, true, true);
      }, 10);

      const result = await confirmationPromise;

      expect(result.confirmed).toBe(true);
      expect(result.always).toBe(true);
    });

    it("should return null when resolving non-existent confirmation", () => {
      const result = coordinator.resolveConfirmation(
        "non-existent",
        true,
        false,
      );
      expect(result).toBeNull();
    });

    it("should track pending confirmations correctly", async () => {
      const toolUseId = "test-tool-4";

      expect(coordinator.hasPendingConfirmation(toolUseId)).toBe(false);
      expect(coordinator.getPendingCount()).toBe(0);

      const promise = coordinator.waitForConfirmation(toolUseId, "test");

      expect(coordinator.hasPendingConfirmation(toolUseId)).toBe(true);
      expect(coordinator.getPendingCount()).toBe(1);

      coordinator.resolveConfirmation(toolUseId, true, false);
      await promise;

      expect(coordinator.hasPendingConfirmation(toolUseId)).toBe(false);
      expect(coordinator.getPendingCount()).toBe(0);
    });

    it("should handle multiple concurrent confirmations", async () => {
      const promise1 = coordinator.waitForConfirmation("tool-1", "tool_a");
      const promise2 = coordinator.waitForConfirmation("tool-2", "tool_b");
      const promise3 = coordinator.waitForConfirmation("tool-3", "tool_c");

      expect(coordinator.getPendingCount()).toBe(3);

      // Resolve in different order
      coordinator.resolveConfirmation("tool-2", true, false);
      coordinator.resolveConfirmation("tool-1", false, true);
      coordinator.resolveConfirmation("tool-3", true, true);

      const [result1, result2, result3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      expect(result1.confirmed).toBe(false);
      expect(result1.always).toBe(true);
      expect(result2.confirmed).toBe(true);
      expect(result2.always).toBe(false);
      expect(result3.confirmed).toBe(true);
      expect(result3.always).toBe(true);

      expect(coordinator.getPendingCount()).toBe(0);
    });

    it("should cancel a pending confirmation", async () => {
      const toolUseId = "test-tool-cancel";
      const promise = coordinator.waitForConfirmation(toolUseId, "test");

      expect(coordinator.hasPendingConfirmation(toolUseId)).toBe(true);

      coordinator.cancelConfirmation(toolUseId);

      await expect(promise).rejects.toThrow(/cancelled/);
      expect(coordinator.hasPendingConfirmation(toolUseId)).toBe(false);
    });

    it("should cancel all pending confirmations", async () => {
      const promise1 = coordinator.waitForConfirmation("tool-1", "a");
      const promise2 = coordinator.waitForConfirmation("tool-2", "b");

      expect(coordinator.getPendingCount()).toBe(2);

      coordinator.cancelAll();

      await expect(promise1).rejects.toThrow(/cancelled/);
      await expect(promise2).rejects.toThrow(/cancelled/);
      expect(coordinator.getPendingCount()).toBe(0);
    });
  });

  describe("ToolExecutor confirmation checking", () => {
    let executor: ToolExecutor;
    let com: ContextObjectModel;

    beforeEach(() => {
      executor = new ToolExecutor();
      com = new ContextObjectModel({ timeline: [] });
    });

    it("should return required=false when tool has no requiresConfirmation", async () => {
      const tool = createTool({
        name: "no_confirm_tool",
        description: "A tool without confirmation",
        parameters: z.object({ value: z.string() }),
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "no_confirm_tool",
        input: { value: "test" },
      };

      const result = await executor.checkConfirmationRequired(call, com, []);

      expect(result).not.toBeNull();
      expect(result!.required).toBe(false);
    });

    it("should return required=true when requiresConfirmation is true", async () => {
      const tool = createTool({
        name: "confirm_tool",
        description: "A tool requiring confirmation",
        parameters: z.object({ value: z.string() }),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "confirm_tool",
        input: { value: "test" },
      };

      const result = await executor.checkConfirmationRequired(call, com, []);

      expect(result).not.toBeNull();
      expect(result!.required).toBe(true);
    });

    it("should use default confirmation message", async () => {
      const tool = createTool({
        name: "confirm_tool",
        description: "A tool requiring confirmation",
        parameters: z.object({ value: z.string() }),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "confirm_tool",
        input: { value: "test" },
      };

      const result = await executor.checkConfirmationRequired(call, com, []);

      expect(result!.message).toBe("Allow confirm_tool to execute?");
    });

    it("should use custom string confirmation message", async () => {
      const tool = createTool({
        name: "confirm_tool",
        description: "A tool requiring confirmation",
        parameters: z.object({ value: z.string() }),
        requiresConfirmation: true,
        confirmationMessage: "Are you sure you want to proceed?",
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "confirm_tool",
        input: { value: "test" },
      };

      const result = await executor.checkConfirmationRequired(call, com, []);

      expect(result!.message).toBe("Are you sure you want to proceed?");
    });

    it("should use function-based confirmation message with input", async () => {
      const tool = createTool({
        name: "delete_file",
        description: "Delete a file",
        parameters: z.object({ path: z.string() }),
        requiresConfirmation: true,
        confirmationMessage: (input) => `Delete file "${input.path}"?`,
        handler: () => [{ type: "text", text: "deleted" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "delete_file",
        input: { path: "/tmp/important.txt" },
      };

      const result = await executor.checkConfirmationRequired(call, com, []);

      expect(result!.message).toBe('Delete file "/tmp/important.txt"?');
    });

    it("should evaluate requiresConfirmation function", async () => {
      let callCount = 0;
      const tool = createTool({
        name: "conditional_confirm",
        description: "Conditionally requires confirmation",
        parameters: z.object({ dangerous: z.boolean() }),
        requiresConfirmation: (input) => {
          callCount++;
          return input.dangerous;
        },
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      // Safe operation - no confirmation
      const safeCall: AgentToolCall = {
        id: "call-1",
        name: "conditional_confirm",
        input: { dangerous: false },
      };
      const safeResult = await executor.checkConfirmationRequired(
        safeCall,
        com,
        [],
      );
      expect(safeResult!.required).toBe(false);

      // Dangerous operation - requires confirmation
      const dangerousCall: AgentToolCall = {
        id: "call-2",
        name: "conditional_confirm",
        input: { dangerous: true },
      };
      const dangerousResult = await executor.checkConfirmationRequired(
        dangerousCall,
        com,
        [],
      );
      expect(dangerousResult!.required).toBe(true);

      expect(callCount).toBe(2);
    });

    it("should evaluate async requiresConfirmation function", async () => {
      const tool = createTool({
        name: "async_confirm",
        description: "Async confirmation check",
        parameters: z.object({ userId: z.string() }),
        requiresConfirmation: async (input) => {
          // Simulate async check (e.g., database lookup)
          await new Promise((resolve) => setTimeout(resolve, 5));
          return input.userId !== "admin";
        },
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      // Admin - no confirmation
      const adminCall: AgentToolCall = {
        id: "call-1",
        name: "async_confirm",
        input: { userId: "admin" },
      };
      const adminResult = await executor.checkConfirmationRequired(
        adminCall,
        com,
        [],
      );
      expect(adminResult!.required).toBe(false);

      // Regular user - requires confirmation
      const userCall: AgentToolCall = {
        id: "call-2",
        name: "async_confirm",
        input: { userId: "user123" },
      };
      const userResult = await executor.checkConfirmationRequired(
        userCall,
        com,
        [],
      );
      expect(userResult!.required).toBe(true);
    });

    it("should return null for unknown tool", async () => {
      const call: AgentToolCall = {
        id: "call-1",
        name: "unknown_tool",
        input: {},
      };

      const result = await executor.checkConfirmationRequired(call, com, []);

      expect(result).toBeNull();
    });

    it("should find tool in configTools fallback", async () => {
      const tool = createTool({
        name: "config_tool",
        description: "Tool from config",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "done" }],
      });

      const call: AgentToolCall = {
        id: "call-1",
        name: "config_tool",
        input: {},
      };

      // Tool not in COM, but in configTools
      const result = await executor.checkConfirmationRequired(call, com, [
        tool,
      ]);

      expect(result).not.toBeNull();
      expect(result!.required).toBe(true);
    });
  });

  describe("ToolExecutor denial result", () => {
    let executor: ToolExecutor;

    beforeEach(() => {
      executor = new ToolExecutor();
    });

    it("should create proper denial result", () => {
      const call: AgentToolCall = {
        id: "call-123",
        name: "dangerous_tool",
        input: { action: "delete" },
      };

      const result = executor.createDenialResult(call);

      expect(result.toolUseId).toBe("call-123");
      expect(result.name).toBe("dangerous_tool");
      expect(result.success).toBe(false);
      expect(result.error).toBe("User denied tool execution");
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect((result.content[0] as any).text).toBe(
        "Tool execution was denied by user.",
      );
    });
  });

  describe("ToolExecutor with confirmation flow", () => {
    let executor: ToolExecutor;
    let com: ContextObjectModel;

    beforeEach(() => {
      executor = new ToolExecutor();
      com = new ContextObjectModel({ timeline: [] });
    });

    it("should execute tool when confirmation received", async () => {
      let executed = false;
      const tool = createTool({
        name: "confirm_execute",
        description: "Tool that executes after confirmation",
        parameters: z.object({ value: z.string() }),
        requiresConfirmation: true,
        handler: (input) => {
          executed = true;
          return [{ type: "text", text: `Executed with ${input.value}` }];
        },
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "confirm_execute",
        input: { value: "test" },
      };

      // Check confirmation required
      const check = await executor.checkConfirmationRequired(call, com, []);
      expect(check!.required).toBe(true);

      // Simulate confirmation
      const coordinator = executor.getConfirmationCoordinator();
      const confirmPromise = executor.waitForConfirmation(call);

      // Resolve confirmation async
      setTimeout(() => {
        coordinator.resolveConfirmation(call.id, true, false);
      }, 10);

      const confirmation = await confirmPromise;
      expect(confirmation.confirmed).toBe(true);

      // Execute after confirmation
      const result = await executor.executeSingleTool(call, com, []);

      expect(executed).toBe(true);
      expect(result.success).toBe(true);
      expect((result.content[0] as any).text).toBe("Executed with test");
    });

    it("should not execute tool when confirmation denied", async () => {
      let executed = false;
      const tool = createTool({
        name: "confirm_deny",
        description: "Tool that should not execute when denied",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => {
          executed = true;
          return [{ type: "text", text: "Should not see this" }];
        },
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "confirm_deny",
        input: {},
      };

      // Check confirmation required
      const check = await executor.checkConfirmationRequired(call, com, []);
      expect(check!.required).toBe(true);

      // Simulate denial
      const coordinator = executor.getConfirmationCoordinator();
      const confirmPromise = executor.waitForConfirmation(call);

      setTimeout(() => {
        coordinator.resolveConfirmation(call.id, false, false);
      }, 10);

      const confirmation = await confirmPromise;
      expect(confirmation.confirmed).toBe(false);

      // Create denial result instead of executing
      const result = executor.createDenialResult(call);

      expect(executed).toBe(false);
      expect(result.success).toBe(false);
    });
  });

  describe("Tool confirmation with different tool types", () => {
    let executor: ToolExecutor;
    let com: ContextObjectModel;

    beforeEach(() => {
      executor = new ToolExecutor();
      com = new ContextObjectModel({ timeline: [] });
    });

    it("should work with SERVER tools", async () => {
      const tool = createTool({
        name: "server_confirm",
        description: "Server tool with confirmation",
        parameters: z.object({}),
        type: ToolExecutionType.SERVER,
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "server result" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "server_confirm",
        input: {},
      };

      const check = await executor.checkConfirmationRequired(call, com, []);
      expect(check!.required).toBe(true);
    });

    it("should work with CLIENT tools", async () => {
      const tool = createTool({
        name: "client_confirm",
        description: "Client tool with confirmation",
        parameters: z.object({}),
        type: ToolExecutionType.CLIENT,
        requiresConfirmation: true,
        // No handler for client tools
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "client_confirm",
        input: {},
      };

      const check = await executor.checkConfirmationRequired(call, com, []);
      expect(check!.required).toBe(true);
    });

    it("should work with MCP tools", async () => {
      const tool = createTool({
        name: "mcp_confirm",
        description: "MCP tool with confirmation",
        parameters: z.object({}),
        type: ToolExecutionType.MCP,
        requiresConfirmation: true,
        mcpConfig: { serverName: "test-server" },
        handler: () => [{ type: "text", text: "mcp result" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "mcp_confirm",
        input: {},
      };

      const check = await executor.checkConfirmationRequired(call, com, []);
      expect(check!.required).toBe(true);
    });
  });

  describe("processToolWithConfirmation", () => {
    let executor: ToolExecutor;
    let com: ContextObjectModel;

    beforeEach(() => {
      executor = new ToolExecutor();
      com = new ContextObjectModel({ timeline: [] });
    });

    it("should process tool without confirmation directly", async () => {
      const tool = createTool({
        name: "no_confirm",
        description: "Tool without confirmation",
        parameters: z.object({}),
        handler: () => [{ type: "text", text: "done" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "no_confirm",
        input: {},
      };

      const { result, confirmCheck, confirmation } =
        await executor.processToolWithConfirmation(call, com, []);

      expect(confirmCheck?.required).toBe(false);
      expect(confirmation).toBeNull();
      expect(result.success).toBe(true);
      expect((result.content[0] as any).text).toBe("done");
    });

    it("should process tool with confirmation and execute on confirm", async () => {
      const tool = createTool({
        name: "confirm_tool",
        description: "Tool with confirmation",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "executed" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "confirm_tool",
        input: {},
      };

      const events: string[] = [];

      // Simulate confirmation async
      const coordinator = executor.getConfirmationCoordinator();
      setTimeout(() => {
        coordinator.resolveConfirmation(call.id, true, false);
      }, 10);

      const { result, confirmCheck, confirmation } =
        await executor.processToolWithConfirmation(call, com, [], {
          onConfirmationRequired: async () => {
            events.push("confirmation_required");
          },
          onConfirmationResult: async () => {
            events.push("confirmation_result");
          },
        });

      expect(confirmCheck?.required).toBe(true);
      expect(confirmation?.confirmed).toBe(true);
      expect(result.success).toBe(true);
      expect((result.content[0] as any).text).toBe("executed");
      expect(events).toEqual(["confirmation_required", "confirmation_result"]);
    });

    it("should process tool with confirmation and deny", async () => {
      const tool = createTool({
        name: "deny_tool",
        description: "Tool to be denied",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "should not see" }],
      });

      com.addTool(tool);

      const call: AgentToolCall = {
        id: "call-1",
        name: "deny_tool",
        input: {},
      };

      // Simulate denial async
      const coordinator = executor.getConfirmationCoordinator();
      setTimeout(() => {
        coordinator.resolveConfirmation(call.id, false, false);
      }, 10);

      const { result, confirmCheck, confirmation } =
        await executor.processToolWithConfirmation(call, com, []);

      expect(confirmCheck?.required).toBe(true);
      expect(confirmation?.confirmed).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error).toBe("User denied tool execution");
    });
  });

  describe("Parallel tool execution with confirmations", () => {
    let executor: ToolExecutor;
    let com: ContextObjectModel;

    beforeEach(() => {
      executor = new ToolExecutor();
      com = new ContextObjectModel({ timeline: [] });
    });

    it("should process multiple tools in parallel with mixed confirmation states", async () => {
      // Tool 1: No confirmation needed
      const tool1 = createTool({
        name: "fast_tool",
        description: "Fast tool without confirmation",
        parameters: z.object({}),
        handler: () => [{ type: "text", text: "fast" }],
      });

      // Tool 2: Requires confirmation (will be confirmed)
      const tool2 = createTool({
        name: "confirm_tool",
        description: "Tool requiring confirmation",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "confirmed" }],
      });

      // Tool 3: Requires confirmation (will be denied)
      const tool3 = createTool({
        name: "deny_tool",
        description: "Tool to be denied",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "should not see" }],
      });

      com.addTool(tool1);
      com.addTool(tool2);
      com.addTool(tool3);

      const calls: AgentToolCall[] = [
        { id: "call-1", name: "fast_tool", input: {} },
        { id: "call-2", name: "confirm_tool", input: {} },
        { id: "call-3", name: "deny_tool", input: {} },
      ];

      const coordinator = executor.getConfirmationCoordinator();
      const executionOrder: string[] = [];

      // Process all tools in parallel
      const resultsPromise = Promise.all(
        calls.map(async (call) => {
          const { result } = await executor.processToolWithConfirmation(
            call,
            com,
            [],
            {
              onConfirmationRequired: async (c) => {
                executionOrder.push(`confirm_required:${c.name}`);
              },
              onConfirmationResult: async (conf, c) => {
                executionOrder.push(
                  `confirm_result:${c.name}:${conf.confirmed}`,
                );
              },
            },
          );
          executionOrder.push(`result:${call.name}`);
          return result;
        }),
      );

      // Resolve confirmations with delays to simulate real-world timing
      // Tool 2 gets confirmed first (faster response)
      setTimeout(() => {
        coordinator.resolveConfirmation("call-2", true, false);
      }, 20);

      // Tool 3 gets denied later
      setTimeout(() => {
        coordinator.resolveConfirmation("call-3", false, false);
      }, 40);

      const results = await resultsPromise;

      // Verify results
      expect(results).toHaveLength(3);

      // Tool 1 should succeed (no confirmation)
      expect(results[0].name).toBe("fast_tool");
      expect(results[0].success).toBe(true);

      // Tool 2 should succeed (confirmed)
      expect(results[1].name).toBe("confirm_tool");
      expect(results[1].success).toBe(true);

      // Tool 3 should fail (denied)
      expect(results[2].name).toBe("deny_tool");
      expect(results[2].success).toBe(false);

      // Verify confirmation events occurred for tools that need confirmation
      expect(executionOrder).toContain("confirm_required:confirm_tool");
      expect(executionOrder).toContain("confirm_required:deny_tool");
      expect(executionOrder).toContain("confirm_result:confirm_tool:true");
      expect(executionOrder).toContain("confirm_result:deny_tool:false");

      // Verify all tools completed
      expect(executionOrder).toContain("result:fast_tool");
      expect(executionOrder).toContain("result:confirm_tool");
      expect(executionOrder).toContain("result:deny_tool");

      // The key insight: fast_tool completes first because it doesn't wait for confirmation
      // We can verify this by checking that result:fast_tool appears before
      // confirm_result events (which happen after the setTimeout delays)
      const fastToolResultIndex = executionOrder.indexOf("result:fast_tool");
      const confirmToolResultIndex = executionOrder.indexOf(
        "confirm_result:confirm_tool:true",
      );
      expect(fastToolResultIndex).toBeLessThan(confirmToolResultIndex);
    });

    it("should handle tools that complete in any order based on confirmation timing", async () => {
      const tool1 = createTool({
        name: "slow_confirm",
        description: "Gets confirmed slowly",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "slow confirmed" }],
      });

      const tool2 = createTool({
        name: "fast_confirm",
        description: "Gets confirmed quickly",
        parameters: z.object({}),
        requiresConfirmation: true,
        handler: () => [{ type: "text", text: "fast confirmed" }],
      });

      com.addTool(tool1);
      com.addTool(tool2);

      const calls: AgentToolCall[] = [
        { id: "call-1", name: "slow_confirm", input: {} },
        { id: "call-2", name: "fast_confirm", input: {} },
      ];

      const completionOrder: string[] = [];
      const coordinator = executor.getConfirmationCoordinator();

      const resultsPromise = Promise.all(
        calls.map(async (call) => {
          const { result } = await executor.processToolWithConfirmation(
            call,
            com,
            [],
          );
          completionOrder.push(call.name);
          return result;
        }),
      );

      // Tool 2 gets confirmed first, even though it was second in the array
      setTimeout(() => {
        coordinator.resolveConfirmation("call-2", true, false);
      }, 10);

      // Tool 1 gets confirmed later
      setTimeout(() => {
        coordinator.resolveConfirmation("call-1", true, false);
      }, 30);

      await resultsPromise;

      // Tool 2 should complete first due to earlier confirmation
      expect(completionOrder[0]).toBe("fast_confirm");
      expect(completionOrder[1]).toBe("slow_confirm");
    });
  });
});
