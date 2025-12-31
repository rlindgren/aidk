import type { Mock } from "vitest";
import { Context, type KernelContext } from "./context";
import { ExecutionTracker } from "./execution-tracker";
import { Telemetry } from "./telemetry";

// Mock Telemetry
vi.mock("./telemetry", () => ({
  Telemetry: {
    startSpan: vi.fn(() => ({
      setAttribute: vi.fn(),
      recordError: vi.fn(),
      end: vi.fn(),
    })),
    getHistogram: vi.fn(() => ({
      record: vi.fn(),
    })),
    getCounter: vi.fn(() => ({
      add: vi.fn(),
    })),
  },
}));

describe("ExecutionTracker", () => {
  let ctx: KernelContext;

  beforeEach(() => {
    ctx = Context.create();
    vi.clearAllMocks();

    // Restore mock implementations after clearing
    (Telemetry.startSpan as Mock).mockImplementation(() => ({
      setAttribute: vi.fn(),
      recordError: vi.fn(),
      end: vi.fn(),
    }));
    (Telemetry.getHistogram as Mock).mockImplementation(() => ({
      record: vi.fn(),
    }));
    (Telemetry.getCounter as Mock).mockImplementation(() => ({
      add: vi.fn(),
    }));
  });

  // Helper to run tests within a context
  const runInContext = <T>(fn: () => Promise<T>): Promise<T> => {
    return Context.run(ctx, fn);
  };

  describe("basic tracking", () => {
    it("should track a procedure execution", async () => {
      const result = await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test-proc" }, async (node) => {
          expect(node).toBeDefined();
          expect(node.name).toBe("test-proc");
          expect(node.status).toBe("running");
          return "result";
        });
      });

      expect(result).toBe("result");
      expect(ctx.procedureGraph).toBeDefined();
      expect(ctx.procedureGraph!.getCount()).toBe(1);
    });

    it("should initialize ProcedureGraph if not present", async () => {
      expect(ctx.procedureGraph).toBeUndefined();

      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test" }, async () => "result");
      });

      expect(ctx.procedureGraph).toBeDefined();
    });

    it("should track nested procedures", async () => {
      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "parent" }, async (parentNode) => {
          // Inside forked context, use Context.get() to get current context
          const parentCtx = Context.get();
          expect(parentCtx.procedurePid).toBe(parentNode.pid);

          await ExecutionTracker.track(parentCtx, { name: "child" }, async (childNode) => {
            const childCtx = Context.get();
            expect(childNode.parentPid).toBe(parentNode.pid);
            expect(childCtx.procedurePid).toBe(childNode.pid);
            return "child-result";
          });

          // After child completes, parent context is still active
          expect(Context.get().procedurePid).toBe(parentNode.pid);
          return "parent-result";
        });
      });

      expect(ctx.procedureGraph!.getCount()).toBe(2);
      const children = ctx.procedureGraph!.getChildren(ctx.procedureGraph!.getAllNodes()[0].pid);
      expect(children.length).toBeGreaterThan(0);
    });
  });

  describe("metrics tracking", () => {
    it("should track metrics written to ctx.metrics", async () => {
      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test" }, async (node) => {
          // Use Context.get() to access the forked context's metrics proxy
          const forkedCtx = Context.get();
          forkedCtx.metrics!["usage.inputTokens"] = 100;
          forkedCtx.metrics!["usage.outputTokens"] = 50;

          expect(node.getMetric("usage.inputTokens")).toBe(100);
          expect(node.getMetric("usage.outputTokens")).toBe(50);

          return "result";
        });
      });

      // Metrics should be in the node
      const node = ctx.procedureGraph!.getAllNodes()[0];
      expect(node.getMetric("usage.inputTokens")).toBe(100);
      expect(node.getMetric("usage.outputTokens")).toBe(50);
    });

    it("should accumulate metrics when adding multiple times", async () => {
      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test" }, async (node) => {
          // Use Context.get() to access the forked context's metrics proxy
          const forkedCtx = Context.get();
          forkedCtx.metrics!["usage.inputTokens"] = 100;
          forkedCtx.metrics!["usage.inputTokens"] = 150; // Overwrite

          // Proxy tracks delta: first set adds 100, second set adds 50 (150-100) = 150 total
          expect(node.getMetric("usage.inputTokens")).toBe(150);

          return "result";
        });
      });
    });

    it("should propagate metrics to parent on completion", async () => {
      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "parent" }, async (parentNode) => {
          const parentCtx = Context.get();

          // Parent adds its own metrics
          parentCtx.metrics!["usage.inputTokens"] = 50;

          await ExecutionTracker.track(parentCtx, { name: "child" }, async (_childNode) => {
            // Use Context.get() to access the child's forked context
            const childCtx = Context.get();
            childCtx.metrics!["usage.inputTokens"] = 100;
            return "child-result";
          });

          // After child completes, verify child has metrics
          const childNode = parentCtx.procedureGraph!.getChildNodes(parentNode.pid)[0];
          expect(childNode).toBeDefined();
          expect(childNode!.getMetric("usage.inputTokens")).toBe(100);

          // Parent should have its own metrics PLUS child's metrics propagated
          // Parent: 50 + Child propagated: 100 = 150
          expect(parentNode.getMetric("usage.inputTokens")).toBe(150);

          return "parent-result";
        });
      });
    });
  });

  describe("telemetry integration", () => {
    it("should create telemetry span", async () => {
      await runInContext(async () => {
        return ExecutionTracker.track(
          ctx,
          { name: "test-proc", metadata: { userId: "123" } },
          async () => "result",
        );
      });

      expect(Telemetry.startSpan).toHaveBeenCalledWith("test-proc");
    });

    it("should send metrics to telemetry on completion", async () => {
      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test" }, async (_node) => {
          // Use Context.get() to access the forked context's metrics proxy
          const forkedCtx = Context.get();
          forkedCtx.metrics!["usage.inputTokens"] = 100;
          return "result";
        });
      });

      expect(Telemetry.getHistogram).toHaveBeenCalledWith("procedure.usage.inputTokens");
    });
  });

  describe("error handling", () => {
    it("should track failed procedures", async () => {
      const error = new Error("Test error");

      await expect(
        runInContext(async () => {
          return ExecutionTracker.track(ctx, { name: "test" }, async () => {
            throw error;
          });
        }),
      ).rejects.toThrow("Test error");

      const node = ctx.procedureGraph!.getAllNodes()[0];
      expect(node.status).toBe("failed");
      expect(node.error).toBe(error);
    });

    it("should track aborted procedures", async () => {
      ctx.signal = AbortSignal.abort();

      await expect(
        runInContext(async () => {
          return ExecutionTracker.track(ctx, { name: "test" }, async () => "result");
        }),
      ).rejects.toThrow("Operation aborted");

      const node = ctx.procedureGraph!.getAllNodes()[0];
      expect(node.status).toBe("cancelled");
    });
  });

  describe("context isolation", () => {
    it("should have forked context with procedurePid inside callback", async () => {
      const initialPid = ctx.procedurePid;

      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test" }, async () => {
          // Inside forked context, procedurePid is set
          const forkedCtx = Context.get();
          expect(forkedCtx.procedurePid).toBeDefined();
          expect(forkedCtx.procedurePid).not.toBe(initialPid);
          return "result";
        });
      });

      // Original context is unchanged (isolation, not restoration)
      expect(ctx.procedurePid).toBe(initialPid);
    });

    it("should isolate metrics to forked context", async () => {
      ctx.metrics = { existing: 50 };
      const originalMetrics = { ...ctx.metrics };

      await runInContext(async () => {
        return ExecutionTracker.track(ctx, { name: "test" }, async () => {
          // Forked context has its own metrics proxy
          const forkedCtx = Context.get();
          forkedCtx.metrics!["new"] = 100;
          return "result";
        });
      });

      // Original metrics are unchanged (isolation, not restoration)
      expect(ctx.metrics).toEqual(originalMetrics);
    });
  });
});
