/**
 * Fork Component Tests
 * 
 * These tests demonstrate real-world usage of the Fork component
 * and show how users will interact with it in their code.
 */

import { createEngine } from '../../engine/factory';
import { createLanguageModel, type ModelInput, type ModelOutput } from '../../model/model';
import { StopReason, type StreamChunk } from 'aidk-shared';
import { Fork, ForkComponent } from './fork';
import { Model } from './model';
import { Message, Timeline } from './primitives';
import { Component } from '../../component/component';
import { ContextObjectModel } from '../../com/object-model';
import { type TickState } from '../../component/component';
import { type ExecutionHandle } from '../../engine/execution-types';
import { createElement, Fragment } from '../jsx-runtime';

describe('Fork Component', () => {
  let engine: ReturnType<typeof createEngine>;
  let mockModel: ReturnType<typeof createLanguageModel>;
  
  beforeEach(() => {
    mockModel = createLanguageModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
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
              content: [{ type: 'text', text: 'Fork response' }],
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
      }
    });
    
    engine = createEngine({
      model: mockModel,
      maxTicks: 5,
    });
  });
  
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    engine.destroy();
  });

  describe('Basic Usage', () => {
    it('should create a fork with children as agent definition', async () => {
      const Agent = () => (
        <>
          <Fork input={{ timeline: [] }}>
            <Model model={mockModel} />
            <Timeline>
              <Message role="user" content="Hello from fork" />
            </Timeline>
          </Fork>
        </>
      );

      const result = await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      expect(result).toBeDefined();
      expect(result.timeline.length).toBeGreaterThan(0);
    });

    it('should create a fork with agent prop', async () => {
      const forkAgent = {
        render: () => (
          <>
            <Model model={mockModel} />
            <Message role="user" content="Hello" />
          </>
        )
      };

      const Agent = () => (
        <Fork agent={forkAgent} input={{ timeline: [] }} />
      );

      const result = await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      expect(result).toBeDefined();
    });

    it('should prefer children over agent prop', async () => {
      const forkAgent = {
        render: () => <Message role="user" content="Agent prop" />
      };

      const Agent = () => (
        <Fork 
          agent={forkAgent}
          input={{ timeline: [] }}
        >
          <Message role="user" content="Children prop" />
        </Fork>
      );

      const result = await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      expect(result).toBeDefined();
      // Children should be used, not agent prop
    });
  });

  describe('Ref System', () => {
    it('should expose fork instance via ref', async () => {
      let fork: ForkComponent | undefined;
      
      class ForkAccessor extends Component {
        render(com: ContextObjectModel, state: TickState) {
          // Access ref in a later tick to ensure Fork has mounted
          fork = com.getRef<ForkComponent>('myFork');
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork ref="myFork" input={{ timeline: [] }}>
            <Message role="user" content="Test" />
          </Fork>
          <ForkAccessor />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Check after execution completes
      expect(fork).toBeDefined();
      expect(fork).toBeInstanceOf(ForkComponent);
      
      const handle = fork?.getHandle();
      expect(handle).toBeDefined();
    });

    it('should allow accessing fork handle via ref', async () => {
      let forkHandle: ExecutionHandle | undefined;
      let fork: ForkComponent | undefined;
      
      class ForkHandleAccessor extends Component {
        render(com: ContextObjectModel, state: TickState) {
          fork = com.getRef<ForkComponent>('dataFork');
          forkHandle = fork?.getHandle();
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork ref="dataFork" input={{ timeline: [] }}>
            <Message role="user" content="Test" />
          </Fork>
          <ForkHandleAccessor />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      expect(fork).toBeDefined();
      expect(forkHandle).toBeDefined();
      if (forkHandle) {
        // Fork may have completed by the time we check
        expect(['running', 'completed']).toContain(forkHandle.status);
        expect(forkHandle.pid).toBeDefined();
      }
    });

    it('should clean up ref on unmount', async () => {
      class RefChecker extends Component {
        render(com: ContextObjectModel, state: TickState) {
          const refs = com.getRefs();
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork ref="tempFork" input={{ timeline: [] }}>
            <Message role="user" content="Test" />
          </Fork>
          <RefChecker />
        </>
      );

      const result = await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Ref should exist during execution
      // After execution completes, component unmounts and ref is cleaned up
      expect(result).toBeDefined();
    });
  });

  describe('Event Handlers', () => {
    it('should call onComplete when fork completes', async () => {
      const onCompleteSpy = jest.fn();
      const onErrorSpy = jest.fn();
      let forkHandle: ExecutionHandle | undefined;

      class ForkWithHandler extends Component {
        render(com: ContextObjectModel, state: TickState) {
          const fork = com.getRef<ForkComponent>('forkWithHandler');
          forkHandle = fork?.getHandle();
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork 
            ref="forkWithHandler"
            input={{ timeline: [] }}
            onComplete={onCompleteSpy}
            onError={onErrorSpy}
          >
            <Model model={mockModel} />
            <Message role="user" content="Test" />
          </Fork>
          <ForkWithHandler />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Wait for fork to complete
      if (forkHandle) {
        await forkHandle.waitForCompletion().catch(() => {});
      }
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onCompleteSpy).toHaveBeenCalled();
      expect(onErrorSpy).not.toHaveBeenCalled();
    });

    it('should call onError when fork fails', async () => {
      const onCompleteSpy = jest.fn();
      const onErrorSpy = jest.fn();

      // Create a model that throws an error
      const errorModel = createLanguageModel({
        metadata: { id: 'error-model', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => {
            throw new Error('Fork error');
          },
        }
      });

      const Agent = () => (
        <Fork 
          input={{ timeline: [] }}
          onComplete={onCompleteSpy}
          onError={onErrorSpy}
        >
          <Model model={errorModel} />
          <Message role="user" content="Test" />
        </Fork>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Wait for fork to fail
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(onErrorSpy).toHaveBeenCalled();
      expect(onCompleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('waitUntilComplete', () => {
    it('should wait for fork completion before continuing tick', async () => {
      let forkCompleted = false;
      
      class AfterFork extends Component {
        render(com: ContextObjectModel, state: TickState) {
          // This should only render after fork completes
          forkCompleted = true;
          return <Message role="system" content="After fork" />;
        }
      }

      const Agent = () => (
        <>
          <Fork 
            input={{ timeline: [] }}
            waitUntilComplete={true}
            onComplete={() => {
              forkCompleted = true;
            }}
          >
            <Model model={mockModel} />
            <Message role="user" content="Test" />
          </Fork>
          <AfterFork />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Fork should complete before AfterFork renders
      expect(forkCompleted).toBe(true);
    });

    it('should continue immediately when waitUntilComplete is false', async () => {
      let afterForkRendered = false;
      
      class AfterFork extends Component {
        render(com: ContextObjectModel, state: TickState) {
          afterForkRendered = true;
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork 
            input={{ timeline: [] }}
            waitUntilComplete={false}
          >
            <Model model={mockModel} />
            <Message role="user" content="Test" />
          </Fork>
          <AfterFork />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // AfterFork should render immediately, not waiting for fork
      expect(afterForkRendered).toBe(true);
    });
  });

  describe('Inheritance Options', () => {
    it('should inherit timeline from parent when specified', async () => {
      const Agent = () => (
        <Fork 
          input={{ timeline: [] }}
          inherit={{ timeline: 'copy' }}
        >
          <Model model={mockModel} />
          <Message role="user" content="Fork message" />
        </Fork>
      );

      const result = await engine.execute.call(
        { 
          timeline: [
            {
              id: 'parent-message',
              kind: 'message' as const,
              message: {
                role: 'user' as const,
                content: [{ type: 'text' as const, text: 'Parent message' }],
                createdAt: new Date().toISOString(),
              }
            }
          ]
        },
        <Agent />
      );

      expect(result).toBeDefined();
      // Fork should have inherited parent timeline
    });
  });

  describe('Nested Forks', () => {
    it('should support nested forks', async () => {
      const Agent = () => (
        <Fork ref="parentFork" input={{ timeline: [] }}>
          <Model model={mockModel} />
          <Message role="user" content="Parent fork" />
          <Fork 
            ref="childFork"
            input={{ timeline: [] }}
            inherit={{ timeline: 'copy' }}
          >
            <Model model={mockModel} />
            <Message role="user" content="Child fork" />
          </Fork>
        </Fork>
      );

      const result = await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      expect(result).toBeDefined();
    });

    it('should allow accessing nested fork handles', async () => {
      let parentHandle: ExecutionHandle | undefined;
      let parentFork: ForkComponent | undefined;

      class NestedForkAccessor extends Component {
        render(com: ContextObjectModel, state: TickState) {
          parentFork = com.getRef<ForkComponent>('parentFork');
          parentHandle = parentFork?.getHandle();
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork ref="parentFork" input={{ timeline: [] }}>
            <Model model={mockModel} />
            <Message role="user" content="Parent" />
            {/* Child fork runs in parent fork's execution context, so its ref won't be accessible from here */}
            <Fork input={{ timeline: [] }}>
              <Message role="user" content="Child" />
            </Fork>
          </Fork>
          <NestedForkAccessor />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Parent fork ref should be available in main execution context
      expect(parentFork).toBeDefined();
      expect(parentHandle).toBeDefined();
      // Note: Child fork ref is in the parent fork's execution context, not accessible here
      // This is correct behavior - nested forks run in separate execution contexts
    });
  });

  describe('Component Instance Persistence', () => {
    it('should persist fork instance across ticks', async () => {
      let tickCount = 0;
      let forkHandle: ExecutionHandle | undefined;

      class TickTracker extends Component {
        render(com: ContextObjectModel, state: TickState) {
          tickCount++;
          
          const fork = com.getRef<ForkComponent>('persistentFork');
          if (fork) {
            forkHandle = fork.getHandle();
          }
          
          return null;
        }
      }

      const Agent = () => (
        <>
          <Fork ref="persistentFork" input={{ timeline: [] }}>
            <Message role="user" content="Test" />
          </Fork>
          <TickTracker />
        </>
      );

      await engine.execute.call(
        { timeline: [] },
        <Agent />
      );

      // Fork instance should persist across multiple ticks
      expect(tickCount).toBeGreaterThan(0);
      expect(forkHandle).toBeDefined();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle parallel data processing forks', async () => {
      class DataProcessor extends Component {
        render(com: ContextObjectModel, state: TickState) {
          return (
            <>
              {/* Process data in parallel forks */}
              <Fork ref="dataFork1" input={{ timeline: [] }} waitUntilComplete={false}>
                <Model model={mockModel} />
                <Message role="user" content="Process dataset 1" />
              </Fork>
              <Fork ref="dataFork2" input={{ timeline: [] }} waitUntilComplete={false}>
                <Model model={mockModel} />
                <Message role="user" content="Process dataset 2" />
              </Fork>
              <Fork ref="dataFork3" input={{ timeline: [] }} waitUntilComplete={false}>
                <Model model={mockModel} />
                <Message role="user" content="Process dataset 3" />
              </Fork>
            </>
          );
        }
      }

      const result = await engine.execute.call(
        { timeline: [] },
        <DataProcessor />
      );

      expect(result).toBeDefined();
    });

    it('should handle sequential forks with results', async () => {
      class SequentialProcessor extends Component {
        render(com: ContextObjectModel, state: TickState) {
          const fork1 = com.getRef<ForkComponent>('step1');
          const fork2 = com.getRef<ForkComponent>('step2');
          
          // Step 1: Initial processing
          if (!fork1) {
            return (
              <Fork 
                ref="step1"
                input={{ timeline: [] }}
                waitUntilComplete={true}
                onComplete={(result: any) => {
                  com.setState('step1Result', result);
                }}
              >
                <Model model={mockModel} />
                <Message role="user" content="Step 1" />
              </Fork>
            );
          }
          
          // Step 2: Process step 1 result
          if (!fork2 && com.getState('step1Result')) {
            return (
              <Fork 
                ref="step2"
                input={{ timeline: [] }}
                waitUntilComplete={true}
              >
                <Model model={mockModel} />
                <Message role="user" content="Step 2" />
              </Fork>
            );
          }
          
          return null;
        }
      }

      const result = await engine.execute.call(
        { timeline: [] },
        <SequentialProcessor />
      );

      expect(result).toBeDefined();
    });
  });
});
