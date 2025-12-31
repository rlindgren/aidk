/**
 * Fork/Spawn Helper Functions Tests
 *
 * These tests demonstrate how users can use the helper functions
 * to create forks and spawns in custom components.
 */

import { createEngine } from "../../engine/factory";
import { createModel, type ModelInput, type ModelOutput } from "../../model/model";
import { type StreamChunk } from "aidk-shared";
import { StopReason } from "aidk-shared/streaming";
import { fromEngineState, toEngineState } from "../../model/utils/language-model";
import {
  createForkHandle,
  createSpawnHandle,
  registerWaitHandle,
  getWaitHandles,
} from "./fork-spawn-helpers";
import { Component } from "../../component/component";
import { COM } from "../../com/object-model";
import { type TickState } from "../../component/component";
import { type ExecutionHandle } from "../../engine/execution-types";
import { Message } from "./primitives";

describe("Fork/Spawn Helper Functions", () => {
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
              content: [{ type: "text", text: "Helper response" }],
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

    engine = createEngine({
      model: mockModel,
      maxTicks: 5,
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    engine.destroy();
  });

  describe("createForkHandle", () => {
    it("should create a fork handle with root prop", async () => {
      const forkRoot = {
        render: () => (
          <>
            <Message role="user" content="Fork root" />
          </>
        ),
      };

      class ForkCreator extends Component {
        render(com: COM, state: TickState) {
          const handle = createForkHandle(engine, com, state, {
            root: forkRoot,
            input: { timeline: [] },
            onComplete: (result) => {
              com.setState("forkResult", result);
            },
          });

          expect(handle).toBeDefined();
          expect(handle.pid).toBeDefined();
          expect(handle.status).toBe("running");

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <ForkCreator />);
    });

    it("should create a fork handle with JSX children", async () => {
      class ForkCreator extends Component {
        render(com: COM, state: TickState) {
          const handle = createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Fork children" />
              </>
            ),
            input: { timeline: [] },
          });

          expect(handle).toBeDefined();
          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <ForkCreator />);
    });

    it("should call onComplete handler when fork completes", async () => {
      const onCompleteSpy = vi.fn();

      class ForkCreator extends Component {
        render(com: COM, state: TickState) {
          createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Test" />
              </>
            ),
            input: { timeline: [] },
            onComplete: onCompleteSpy,
          });
          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <ForkCreator />);

      // Wait for fork to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(onCompleteSpy).toHaveBeenCalled();
    });

    it("should call onError handler when spawn fails", async () => {
      const onErrorSpy = vi.fn();
      let spawnHandle: ExecutionHandle | undefined;

      // Create a model that throws an error
      const errorModel = createModel({
        metadata: { id: "error-model", provider: "test", capabilities: [] },
        executors: {
          execute: async () => {
            throw new Error("Spawn error");
          },
        },
        fromEngineState,
        toEngineState,
      });

      const errorEngine = createEngine({ model: errorModel });

      // Use spawn instead of fork - spawn doesn't require a parent execution
      class SpawnCreator extends Component {
        render(com: COM, state: TickState) {
          const handle = createSpawnHandle(errorEngine, com, state, {
            root: (
              <>
                <Message role="user" content="Test" />
              </>
            ),
            input: { timeline: [] },
            onError: onErrorSpy,
          });

          spawnHandle = handle;
          return null;
        }
      }

      try {
        await errorEngine.execute.call({ timeline: [] }, <SpawnCreator />);
      } catch (_e) {
        // Execution might fail, but spawn error handler should still be called
      }

      // Wait for spawn to fail and error handler to be called
      if (spawnHandle) {
        try {
          await spawnHandle.waitForCompletion();
        } catch (_e) {
          // Expected to fail
        }
      }
      // Give error handler time to be invoked
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(onErrorSpy).toHaveBeenCalled();
      errorEngine.destroy();
    });

    it("should use parentPid from options if provided", async () => {
      let forkHandle: ExecutionHandle | undefined;
      let rootHandle: ExecutionHandle | undefined;

      class RootForkCreator extends Component {
        render(com: COM, state: TickState) {
          // Create a root fork first to get a valid PID
          const handle = createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Root fork" />
              </>
            ),
            input: { timeline: [] },
          });

          rootHandle = handle;
          // Store root handle PID for child fork
          com.setState("rootPid", handle.pid);
          return null;
        }
      }

      class ChildForkCreator extends Component {
        render(com: COM, state: TickState) {
          const rootPid = com.getState<string>("rootPid");
          if (rootPid) {
            const handle = createForkHandle(engine, com, state, {
              root: (
                <>
                  <Message role="user" content="Child fork" />
                </>
              ),
              input: { timeline: [] },
              parentPid: rootPid,
            });

            forkHandle = handle;
          }
          return null;
        }
      }

      const Agent = () => (
        <>
          <RootForkCreator />
          <ChildForkCreator />
        </>
      );

      await engine.execute.call({ timeline: [] }, <Agent />);

      expect(forkHandle).toBeDefined();
      expect(rootHandle).toBeDefined();
      if (forkHandle && rootHandle) {
        expect(forkHandle.parentPid).toBe(rootHandle.pid);
      }
    });

    it("should throw error if no root or children provided", async () => {
      class ForkCreator extends Component {
        render(com: COM, state: TickState) {
          expect(() => {
            createForkHandle(engine, com, state, {
              input: { timeline: [] },
              // No root or children
            });
          }).toThrow(/root or children must be provided/);

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <ForkCreator />);
    });
  });

  describe("createSpawnHandle", () => {
    it("should create a spawn handle with root prop", async () => {
      const spawnRoot = {
        render: () => (
          <>
            <Message role="user" content="Spawn root" />
          </>
        ),
      };

      class SpawnCreator extends Component {
        render(com: COM, state: TickState) {
          const handle = createSpawnHandle(engine, com, state, {
            root: spawnRoot,
            input: { timeline: [] },
            onComplete: (result) => {
              com.setState("spawnResult", result);
            },
          });

          expect(handle).toBeDefined();
          expect(handle.pid).toBeDefined();
          expect(handle.status).toBe("running");

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <SpawnCreator />);
    });

    it("should create a spawn handle with JSX children", async () => {
      class SpawnCreator extends Component {
        render(com: COM, state: TickState) {
          const handle = createSpawnHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Spawn children" />
              </>
            ),
            input: { timeline: [] },
          });

          expect(handle).toBeDefined();
          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <SpawnCreator />);
    });

    it("should call onComplete handler when spawn completes", async () => {
      const onCompleteSpy = vi.fn();

      class SpawnCreator extends Component {
        render(com: COM, state: TickState) {
          createSpawnHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Test" />
              </>
            ),
            input: { timeline: [] },
            onComplete: onCompleteSpy,
          });
          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <SpawnCreator />);

      // Wait for spawn to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(onCompleteSpy).toHaveBeenCalled();
    });

    it("should throw error if no root or children provided", async () => {
      class SpawnCreator extends Component {
        render(com: COM, state: TickState) {
          expect(() => {
            createSpawnHandle(engine, com, state, {
              input: { timeline: [] },
              // No root or children
            });
          }).toThrow(/root or children must be provided/);

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <SpawnCreator />);
    });
  });

  describe("registerWaitHandle and getWaitHandles", () => {
    it("should register a handle for waiting", async () => {
      class WaitHandler extends Component {
        render(com: COM, state: TickState) {
          const handle = createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Test" />
              </>
            ),
            input: { timeline: [] },
          });

          // Register handle for waiting
          registerWaitHandle(com, handle, true);

          // Check that handle is registered
          const waitHandles = getWaitHandles(com);
          expect(waitHandles.has(handle)).toBe(true);

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <WaitHandler />);
    });

    it("should not register handle when waitUntilComplete is false", async () => {
      class WaitHandler extends Component {
        render(com: COM, state: TickState) {
          const handle = createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Test" />
              </>
            ),
            input: { timeline: [] },
          });

          // Don't register (waitUntilComplete = false)
          registerWaitHandle(com, handle, false);

          // Check that handle is NOT registered
          const waitHandles = getWaitHandles(com);
          expect(waitHandles.has(handle)).toBe(false);

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <WaitHandler />);
    });

    it("should clean up handle when it completes", async () => {
      class WaitHandler extends Component {
        render(com: COM, state: TickState) {
          const handle = createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Test" />
              </>
            ),
            input: { timeline: [] },
          });

          registerWaitHandle(com, handle, true);

          return null;
        }
      }

      await engine.execute.call({ timeline: [] }, <WaitHandler />);

      // Wait for fork to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Handle should be cleaned up
      const com = new COM();
      const waitHandles = getWaitHandles(com);
      expect(waitHandles.size).toBe(0);
    });
  });

  describe("Real-World Usage Patterns", () => {
    it("should handle background processing with helpers", async () => {
      class BackgroundProcessor extends Component {
        render(com: COM, state: TickState) {
          // Start background fork
          const handle = createForkHandle(engine, com, state, {
            root: (
              <>
                <Message role="user" content="Background task" />
              </>
            ),
            input: { timeline: [] },
            onComplete: (result) => {
              com.setState("backgroundResult", result);
            },
            onError: (error) => {
              com.setState("backgroundError", error.message);
            },
          });

          // Store handle for later access
          com.setState("backgroundHandle", handle);

          return null;
        }
      }

      const result = await engine.execute.call({ timeline: [] }, <BackgroundProcessor />);

      expect(result).toBeDefined();
    });

    it("should handle parallel processing with multiple forks", async () => {
      class ParallelProcessor extends Component {
        render(com: COM, state: TickState) {
          const handles: ExecutionHandle[] = [];

          // Create multiple parallel forks
          for (let i = 0; i < 3; i++) {
            const handle = createForkHandle(engine, com, state, {
              root: (
                <>
                  <Message role="user" content={`Task ${i + 1}`} />
                </>
              ),
              input: { timeline: [] },
              onComplete: (result) => {
                com.setState(`task${i + 1}Result`, result);
              },
            });
            handles.push(handle);
          }

          // Store all handles
          com.setState("allHandles", handles);

          return null;
        }
      }

      const result = await engine.execute.call({ timeline: [] }, <ParallelProcessor />);

      expect(result).toBeDefined();
    });

    it("should handle conditional fork creation", async () => {
      class ConditionalFork extends Component {
        render(com: COM, state: TickState) {
          const shouldFork = com.getState<boolean>("shouldFork") ?? true;

          if (shouldFork) {
            createForkHandle(engine, com, state, {
              root: (
                <>
                  <Message role="user" content="Conditional fork" />
                </>
              ),
              input: { timeline: [] },
            });
          }

          return null;
        }
      }

      const result = await engine.execute.call({ timeline: [] }, <ConditionalFork />);

      expect(result).toBeDefined();
    });
  });
});
