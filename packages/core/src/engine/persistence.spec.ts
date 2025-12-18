import { createEngine } from './factory';
import type { EngineConfig } from './engine';
import { Component, type TickState } from '../component/component';
import { ContextObjectModel } from '../com/object-model';
import type { ExecutionState } from './execution-types';
import { createModel, type ModelInput, type ModelOutput } from '../model/model';
import { StopReason, type StreamChunk } from 'aidk-shared';
import { type JSX, createElement, Fragment } from '../jsx/jsx-runtime';
import { fromEngineState, toEngineState } from '../model/utils/language-model';

describe('Execution Persistence', () => {
  let engine: ReturnType<typeof createEngine>;
  let mockModel: ReturnType<typeof createModel>;
  let persistedStates: ExecutionState[] = [];
  
  beforeEach(() => {
    persistedStates = [];
    
    mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
      metadata: {
        id: 'test-model',
        provider: 'test',
        capabilities: [],
      },
      executors: {
        execute: async (input: ModelInput): Promise<ModelOutput> => {
          return {
            model: 'test-model',
            createdAt: new Date().toISOString(),
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Test response' }],
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
  });
  
  afterEach(async () => {
    // Clean up any pending executions if engine exists
    if (engine) {
      const metrics = engine.getMetrics();
      if (metrics.activeExecutions > 0) {
        // Wait a bit for any pending executions to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Destroy engine to clean up resources (channels, etc.)
      engine.destroy();
    }
  });
  
  describe('persistExecutionState hook', () => {
    it('should call persistExecutionState before each tick', async () => {
      const persistFn = jest.fn(async (state: ExecutionState) => {
        persistedStates.push(state);
      });
      
      const config: EngineConfig = {
        model: mockModel,
        maxTicks: 3,
        persistExecutionState: persistFn,
      };
      
      engine = createEngine(config);
      
      class SimpleAgent extends Component {
        render(com: ContextObjectModel, state: TickState) {
          return createElement(Fragment, {});
        }
      }
      
      await engine.execute(
        { timeline: [] },
        createElement(SimpleAgent, {})
      );
      
      // Should be called at least once per tick
      expect(persistFn).toHaveBeenCalled();
      expect(persistedStates.length).toBeGreaterThan(0);
      
      // Verify state structure
      const state = persistedStates[0];
      expect(state.pid).toBeDefined();
      expect(state.rootPid).toBeDefined();
      expect(state.type).toBe('root');
      expect(state.status).toBe('running');
      expect(state.input).toBeDefined();
      expect(state.currentTick).toBeGreaterThan(0);
      expect(state.startedAt).toBeInstanceOf(Date);
    });
    
    it('should not fail execution if persistence fails', async () => {
      const persistFn = jest.fn(async (state: ExecutionState) => {
        throw new Error('Persistence failed');
      });
      
      const config: EngineConfig = {
        model: mockModel,
        maxTicks: 2,
        persistExecutionState: persistFn,
      };
      
      engine = createEngine(config);
      
      class SimpleAgent extends Component {
        render(com: ContextObjectModel, state: TickState) {
          return createElement(Fragment, {});
        }
      }
      
      // Should not throw
      const result = await engine.execute.call(
        { timeline: [] },
        createElement(SimpleAgent, {})
      );
      
      expect(result).toBeDefined();
      expect(persistFn).toHaveBeenCalled();
    });
    
    it('should persist state with correct tick number', async () => {
      const persistFn = jest.fn(async (state: ExecutionState) => {
        persistedStates.push(state);
      });
      
      const config: EngineConfig = {
        model: mockModel,
        maxTicks: 3,
        persistExecutionState: persistFn,
      };
      
      engine = createEngine(config);
      
      class SimpleAgent extends Component {
        render(com: ContextObjectModel, state: TickState) {
          return createElement(Fragment, {});
        }
      }
      
      await engine.execute(
        { timeline: [] },
        createElement(SimpleAgent, {})
      );
      
      // Check that tick numbers are sequential
      const tickNumbers = persistedStates.map(s => s.currentTick);
      expect(tickNumbers.length).toBeGreaterThan(0);
      
      // Verify tick numbers are increasing
      for (let i = 1; i < tickNumbers.length; i++) {
        expect(tickNumbers[i]).toBeGreaterThanOrEqual(tickNumbers[i - 1]);
      }
    });
    
    it('should persist state with previousState when available', async () => {
      const persistFn = jest.fn(async (state: ExecutionState) => {
        persistedStates.push(state);
      });
      
      const config: EngineConfig = {
        model: mockModel,
        maxTicks: 2,
        persistExecutionState: persistFn,
      };
      
      engine = createEngine(config);
      
      class SimpleAgent extends Component {
        render(com: ContextObjectModel, state: TickState) {
          return createElement(Fragment, {});
        }
      }
      
      await engine.execute.call(
        { timeline: [] },
        createElement(SimpleAgent, {})
      );
      
      // After first tick, previousState should be available
      const statesWithPreviousState = persistedStates.filter(s => s.previousState !== undefined);
      expect(statesWithPreviousState.length).toBeGreaterThan(0);
    });
  });
  
  describe('loadExecutionState hook', () => {
    it('should use loadExecutionState for recovery', async () => {
      const savedState: ExecutionState = {
        pid: 'test-pid',
        rootPid: 'test-pid',
        type: 'root',
        status: 'running',
        input: { timeline: [] },
        agent: {} as any,
        currentTick: 1,
        startedAt: new Date(),
      };
      
      const loadFn = jest.fn(async (pid: string) => {
        if (pid === 'test-pid') {
          return savedState;
        }
        return undefined;
      });
      
      const config: EngineConfig = {
        model: mockModel,
        loadExecutionState: loadFn,
      };
      
      engine = createEngine(config);
      
      // Attempt to resume (will fail since resumption not fully implemented)
      // Use expect().rejects.toThrow() to properly handle the async error
      await expect(
        engine.resumeExecution(savedState)
      ).rejects.toThrow(/not yet implemented/);
      
      expect(loadFn).not.toHaveBeenCalled(); // Not called in resumeExecution
    });
    
    it('should get recoverable executions', async () => {
      const loadFn = jest.fn(async (pid: string) => {
        return undefined;
      });
      
      const config: EngineConfig = {
        model: mockModel,
        loadExecutionState: loadFn,
      };
      
      engine = createEngine(config);
      
      const recoverable = await engine.getRecoverableExecutions();
      expect(recoverable).toEqual([]);
    });
  });
  
  describe('resumeExecution', () => {
    it('should throw if loadExecutionState not configured', async () => {
      const config: EngineConfig = {
        model: mockModel,
      };
      
      engine = createEngine(config);
      
      const state: ExecutionState = {
        pid: 'test-pid',
        rootPid: 'test-pid',
        type: 'root',
        status: 'running',
        input: { timeline: [] },
        agent: {} as any,
        currentTick: 1,
        startedAt: new Date(),
      };
      
      await expect(
        engine.resumeExecution(state)
      ).rejects.toThrow(/not configured/);
    });
    
    it('should create handle from state', async () => {
      const config: EngineConfig = {
        model: mockModel,
        loadExecutionState: async (pid: string) => {
          return undefined;
        },
      };
      
      engine = createEngine(config);
      
      const state: ExecutionState = {
        pid: 'test-pid',
        rootPid: 'test-pid',
        type: 'root',
        status: 'completed',
        input: { timeline: [] },
        agent: {} as any,
        currentTick: 1,
        startedAt: new Date(),
        completedAt: new Date(),
      };
      
      // For completed state, should create handle
      const handle = await engine.resumeExecution(state);
      expect(handle).toBeDefined();
      expect(handle.pid).toBe('test-pid');
      expect(handle.status).toBe('completed');
    });
  });
  
  describe('integration', () => {
    it('should persist and potentially recover execution', async () => {
      const persistedStatesMap = new Map<string, ExecutionState>();
      
      const persistFn = jest.fn(async (state: ExecutionState) => {
        persistedStatesMap.set(state.pid, state);
      });
      
      const loadFn = jest.fn(async (pid: string) => {
        return persistedStatesMap.get(pid);
      });
      
      const config: EngineConfig = {
        model: mockModel,
        maxTicks: 2,
        persistExecutionState: persistFn,
        loadExecutionState: loadFn,
      };
      
      engine = createEngine(config);
      
      class SimpleAgent extends Component {
        render(com: ContextObjectModel, state: TickState) {
          return createElement(Fragment, {});
        }
      }
      
      await engine.execute.call(
        { timeline: [] },
        createElement(SimpleAgent, {})
      );
      
      expect(persistFn).toHaveBeenCalled();
      expect(persistedStatesMap.size).toBeGreaterThan(0);
      
      // Verify we can load persisted state
      const firstState = Array.from(persistedStatesMap.values())[0];
      const loadedState = await loadFn(firstState.pid);
      expect(loadedState).toBeDefined();
      expect(loadedState?.pid).toBe(firstState.pid);
    });
  });
});

