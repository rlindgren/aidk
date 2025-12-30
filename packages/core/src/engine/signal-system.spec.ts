import { createEngine } from "./factory";
import { type EngineConfig } from "./engine";
import { Component, type TickState } from "../component/component";
import { COM } from "../com/object-model";
import { createModel, type ModelInput, type ModelOutput } from "../model/model";
import { StopReason, type StreamChunk } from "aidk-shared";
import { type SignalEvent } from "./execution-types";
import { fromEngineState, toEngineState } from "../model/utils/language-model";
import { createElement, Fragment } from "../jsx/jsx-runtime";

describe("Signal System", () => {
  let engine: ReturnType<typeof createEngine>;
  let mockModel: ReturnType<typeof createModel>;

  beforeEach(() => {
    mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
      metadata: {
        id: "test-model",
        provider: "test",
        capabilities: [],
      },
      executors: {
        execute: async (_input: ModelInput): Promise<ModelOutput> => {
          return {
            model: "test-model",
            createdAt: new Date().toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Test response" }],
            },
            stopReason: StopReason.STOP_SEQUENCE,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
            raw: {} as any,
          };
        },
      },
      fromEngineState,
      toEngineState,
    });

    const config: EngineConfig = {
      model: mockModel,
      maxTicks: 5,
    };

    engine = createEngine(config);
  });

  afterEach(async () => {
    // Clean up any pending executions
    const metrics = engine.getMetrics();
    if (metrics.activeExecutions > 0) {
      const activeHandles = engine["executionGraph"].getActiveExecutions();
      for (const handle of activeHandles) {
        // Set up error handler before cancelling to prevent unhandled rejections
        const completionPromise = handle.waitForCompletion({ timeout: 100 }).catch(() => {
          // Expected rejection - prevents uncaught exception
        });
        handle.cancel();
        await completionPromise;
      }
    }
    engine.destroy();
  });

  describe("ExecutionHandle Signal Emission", () => {
    it("should emit abort signal when cancel() is called", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const abortPromise = new Promise<SignalEvent>((resolve) => {
        // Use once to avoid multiple calls
        handle.once("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      handle.cancel();

      const event = await abortPromise;
      expect(event.type).toBe("abort");
      expect(event.source).toBe("execution");
      expect(event.pid).toBe(handle.pid);
      expect(event.reason).toBe("Execution cancelled");

      // Wait for cancellation to complete
      try {
        await handle.waitForCompletion({ timeout: 100 });
      } catch (_e) {
        // Expected
      }
    });

    it("should emit abort signal with custom reason", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const abortPromise = new Promise<SignalEvent>((resolve) => {
        handle.on("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      handle.cancel("Custom abort reason");

      const event = await abortPromise;
      expect(event.reason).toBe("Custom abort reason");

      // Wait for cancellation to complete
      try {
        await handle.waitForCompletion({ timeout: 100 });
      } catch (_e) {
        // Expected
      }
    });

    it("should propagate abort signal to child forks", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentHandle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const forkHandle = engine.fork(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
        },
      );

      const forkAbortPromise = new Promise<SignalEvent>((resolve) => {
        forkHandle.on("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      parentHandle.cancel();

      const forkEvent = await forkAbortPromise;
      expect(forkEvent.type).toBe("abort");
      expect(forkEvent.pid).toBe(forkHandle.pid);
      expect(forkEvent.metadata?.["propagatedFrom"]).toBe(parentHandle.pid);

      // Wait for cancellations to complete
      try {
        await Promise.all([
          parentHandle.waitForCompletion({ timeout: 100 }),
          forkHandle.waitForCompletion({ timeout: 100 }),
        ]);
      } catch (_e) {
        // Expected
      }
    });

    it("should not propagate abort signal to spawns", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentHandle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const spawnHandle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      let spawnAbortReceived = false;

      spawnHandle.on("abort", () => {
        spawnAbortReceived = true;
      });

      parentHandle.cancel();

      // Wait a bit - spawn should NOT receive abort
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(spawnAbortReceived).toBe(false);

      // Clean up
      try {
        await Promise.all([
          parentHandle.waitForCompletion({ timeout: 100 }),
          spawnHandle.waitForCompletion({ timeout: 100 }),
        ]);
      } catch (_e) {
        // Expected for parent
      }
    });
  });

  describe("Signal Propagation During Execution", () => {
    it("should abort execution when abort signal is received", async () => {
      class LongRunningAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle = engine.spawn(createElement(LongRunningAgent, {}), { timeline: [] });

      // Cancel immediately
      handle.cancel();

      try {
        await handle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected execution to be aborted");
      } catch (error: any) {
        if (error.message === "Expected execution to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/cancelled|aborted/i);
        expect(handle.status).toBe("cancelled");
      }
    });

    it("should abort fork when parent is cancelled", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      // Agent that waits a bit to ensure fork is still running when parent completes
      class DelayedAgent extends Component {
        render(_com: COM, _state: TickState) {
          // Return empty fragment - execution will complete quickly
          return createElement(Fragment, {});
        }
      }

      const parentHandle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      // Set up abort signal listener BEFORE creating fork to catch the signal
      const _forkAbortPromise = new Promise<SignalEvent>((_resolve) => {
        // We'll attach this listener after fork is created
      });

      // Create fork - it should complete quickly, but we'll cancel parent immediately
      const forkHandle = engine.fork(
        createElement(DelayedAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
        },
      );

      // Set up listener for fork abort signal
      const forkAbortReceived = new Promise<SignalEvent>((resolve) => {
        forkHandle.once("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      // Cancel parent immediately - this should trigger fork abort
      parentHandle.cancel();

      // Wait for parent cancellation
      try {
        await parentHandle.waitForCompletion({ timeout: 1000 });
      } catch (_e) {
        // Expected - parent was cancelled
      }

      // Verify fork received abort signal
      const abortEvent = await forkAbortReceived;
      expect(abortEvent.type).toBe("abort");
      expect(abortEvent.pid).toBe(forkHandle.pid);
      expect(abortEvent.metadata?.["propagatedFrom"]).toBe(parentHandle.pid);

      // Wait for fork to process abort signal and update status
      try {
        await forkHandle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected fork to be aborted");
      } catch (error: any) {
        if (error.message === "Expected fork to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/cancelled|aborted/i);
      }

      // Verify fork status is cancelled after abort is processed
      expect(forkHandle.status).toBe("cancelled");
    });

    it("should abort fork when parent fails", async () => {
      class FailingAgent extends Component {
        render(_com: COM, _state: TickState) {
          throw new Error("Parent execution failed");
        }
      }

      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentHandle = engine.spawn(createElement(FailingAgent, {}), { timeline: [] });

      const forkHandle = engine.fork(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
        },
      );

      // Set up listener for fork abort signal BEFORE parent fails
      const forkAbortReceived = new Promise<SignalEvent>((resolve) => {
        forkHandle.once("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      // Wait for parent to fail
      try {
        await parentHandle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected parent to fail");
      } catch (_error) {
        // Expected - parent failed
      }

      // Verify fork received abort signal
      const abortEvent = await forkAbortReceived;
      expect(abortEvent.type).toBe("abort");
      expect(abortEvent.pid).toBe(forkHandle.pid);
      expect(abortEvent.reason).toMatch(/Parent execution failed|failed/i);

      // Wait for fork to process abort signal and update status
      try {
        await forkHandle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected fork to be aborted");
      } catch (error: any) {
        if (error.message === "Expected fork to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/cancelled|aborted/i);
      }

      // Verify fork status is cancelled after abort is processed
      expect(forkHandle.status).toBe("cancelled");
    });
  });

  describe("Engine Shutdown Hooks", () => {
    it("should call shutdown hooks when shutdown() is called", async () => {
      const shutdownHook1 = jest.fn(async (_engine: any, _reason?: string) => {});
      const shutdownHook2 = jest.fn(async (_engine: any, _reason?: string) => {});

      engine.onShutdown(shutdownHook1);
      engine.onShutdown(shutdownHook2);

      await engine.shutdown();

      expect(shutdownHook1).toHaveBeenCalledTimes(1);
      expect(shutdownHook1).toHaveBeenCalledWith(engine, undefined);
      expect(shutdownHook2).toHaveBeenCalledTimes(1);
      expect(shutdownHook2).toHaveBeenCalledWith(engine, undefined);
    });

    it("should cancel all running executions on shutdown", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle1 = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const handle2 = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      await engine.shutdown();

      expect(handle1.status).toBe("cancelled");
      expect(handle2.status).toBe("cancelled");
    });

    it("should return unsubscribe function from onShutdown", async () => {
      const shutdownHook = jest.fn(async (_engine: any, _reason?: string) => {});

      const unsubscribe = engine.onShutdown(shutdownHook);

      unsubscribe();

      await engine.shutdown();

      expect(shutdownHook).not.toHaveBeenCalled();
    });
  });

  describe("Signal Listeners in iterateTicks", () => {
    it("should abort execution when Context signal is aborted", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const abortController = new AbortController();
      const handle = engine.spawn(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          signal: abortController.signal,
        },
      );

      // Abort via Context signal immediately
      abortController.abort();

      try {
        await handle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected execution to be aborted");
      } catch (error: any) {
        if (error.message === "Expected execution to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/aborted|cancelled/i);
        expect(handle.status).toBe("cancelled");
      }
    });

    it("should abort execution when handle signal is emitted", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      // Emit abort signal directly immediately
      handle.emitSignal("abort", "Test abort");

      try {
        await handle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected execution to be aborted");
      } catch (error: any) {
        if (error.message === "Expected execution to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/aborted|cancelled/i);
        expect(handle.status).toBe("cancelled");
      }
    });
  });

  describe("Signal Inheritance for Forks", () => {
    it("should inherit parent abort signal in fork", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentAbortController = new AbortController();
      const parentHandle = engine.spawn(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          signal: parentAbortController.signal,
        },
      );

      const forkHandle = engine.fork(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
        },
      );

      // Abort parent signal immediately - fork should also abort
      parentAbortController.abort();

      try {
        await forkHandle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected fork to be aborted");
      } catch (error: any) {
        if (error.message === "Expected fork to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/aborted|cancelled/i);
        expect(forkHandle.status).toBe("cancelled");
      }
    });

    it("should merge fork signal with parent signal", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentAbortController = new AbortController();
      const forkAbortController = new AbortController();

      const parentHandle = engine.spawn(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          signal: parentAbortController.signal,
        },
      );

      const forkHandle = engine.fork(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
          signal: forkAbortController.signal,
        },
      );

      // Abort fork signal immediately - fork should abort
      forkAbortController.abort();

      try {
        await forkHandle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected fork to be aborted");
      } catch (error: any) {
        if (error.message === "Expected fork to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/aborted|cancelled/i);
        expect(forkHandle.status).toBe("cancelled");
      }

      // Wait a bit for parent to potentially complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Parent should still be running (or completed normally, but not cancelled)
      expect(parentHandle.status).not.toBe("cancelled");
    });
  });

  describe("Signal Event Structure", () => {
    it("should include correct metadata in signal events when fork cancels itself", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentHandle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const forkHandle = engine.fork(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
        },
      );

      const abortPromise = new Promise<SignalEvent>((resolve) => {
        forkHandle.once("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      forkHandle.cancel("Test reason");

      const event = await abortPromise;
      expect(event.type).toBe("abort");
      expect(event.source).toBe("execution");
      expect(event.pid).toBe(forkHandle.pid);
      expect(event.parentPid).toBe(parentHandle.pid);
      expect(event.reason).toBe("Test reason");
      expect(typeof event.timestamp).toBe("number");
      expect(event.timestamp).toBeGreaterThan(0);

      // Wait for cancellation to complete
      try {
        await forkHandle.waitForCompletion({ timeout: 100 });
      } catch (_e) {
        // Expected
      }
    });

    it("should include propagatedFrom metadata when parent cancels fork", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const parentHandle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      const forkHandle = engine.fork(
        createElement(SimpleAgent, {}),
        { timeline: [] },
        {
          parentPid: parentHandle.pid,
          inherit: {},
        },
      );

      // Set up listener BEFORE parent cancels
      const abortPromise = new Promise<SignalEvent>((resolve) => {
        forkHandle.once("abort", (event: SignalEvent) => {
          resolve(event);
        });
      });

      // Cancel parent - this should propagate to fork
      parentHandle.cancel("Parent cancelled");

      const event = await abortPromise;
      expect(event.type).toBe("abort");
      expect(event.source).toBe("execution");
      expect(event.pid).toBe(forkHandle.pid);
      expect(event.parentPid).toBe(parentHandle.pid);
      expect(event.metadata?.["propagatedFrom"]).toBe(parentHandle.pid);
      expect(typeof event.timestamp).toBe("number");
      expect(event.timestamp).toBeGreaterThan(0);

      // Wait for fork to process abort signal and update status
      try {
        await forkHandle.waitForCompletion({ timeout: 1000 });
        throw new Error("Expected fork to be aborted");
      } catch (error: any) {
        if (error.message === "Expected fork to be aborted") {
          throw error;
        }
        expect(error.message).toMatch(/cancelled|aborted/i);
      }

      // Verify fork status after abort is processed
      expect(forkHandle.status).toBe("cancelled");

      // Wait for parent cancellation
      try {
        await parentHandle.waitForCompletion({ timeout: 1000 });
      } catch (_e) {
        // Expected - parent was cancelled
      }
    });
  });

  describe("Multiple Signal Listeners", () => {
    it("should call all listeners when signal is emitted", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      let callCount = 0;
      const listener1 = () => {
        callCount++;
      };
      const listener2 = () => {
        callCount++;
      };
      const listener3 = () => {
        callCount++;
      };

      // Register all listeners BEFORE emitting signal
      handle.on("abort", listener1);
      handle.on("abort", listener2);
      handle.on("abort", listener3);

      // Use once for promise resolver to avoid double-counting
      const abortPromise = new Promise<void>((resolve) => {
        handle.once("abort", () => {
          resolve();
        });
      });

      handle.cancel();

      await abortPromise;

      // Assert after promise resolves, not inside listener
      expect(callCount).toBe(3);

      // Wait for cancellation to complete
      try {
        await handle.waitForCompletion({ timeout: 100 });
      } catch (_e) {
        // Expected
      }
    });

    it("should allow removing listeners", async () => {
      class SimpleAgent extends Component {
        render(_com: COM, _state: TickState) {
          return createElement(Fragment, {});
        }
      }

      const handle = engine.spawn(createElement(SimpleAgent, {}), { timeline: [] });

      let callCount = 0;
      const listener1 = () => {
        callCount++;
      };
      const listener2 = () => {
        callCount++;
      };

      // Register listeners
      handle.on("abort", listener1);
      handle.on("abort", listener2);

      // Remove listener1
      handle.off("abort", listener1);

      // Use once for promise resolver
      const abortPromise = new Promise<void>((resolve) => {
        handle.once("abort", () => {
          resolve();
        });
      });

      handle.cancel();

      await abortPromise;

      // Assert after promise resolves, not inside listener
      expect(callCount).toBe(1); // Only listener2 should be called

      // Wait for cancellation to complete
      try {
        await handle.waitForCompletion({ timeout: 100 });
      } catch (_e) {
        // Expected
      }
    });
  });
});
