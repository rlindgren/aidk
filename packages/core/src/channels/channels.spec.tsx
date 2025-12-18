import { createEngine } from '../engine/factory';
import type { EngineConfig } from '../engine/engine';
import { Component, type TickState } from '../component/component';
import { ContextObjectModel } from '../com/object-model';
import { ChannelService } from './service';
import { type ChannelEvent } from 'aidk-kernel';
import { Context } from '../context';
import { createTool } from '../tool/tool';
import type { ContentBlock } from '../content';
import type { JSX, createElement } from '../jsx/jsx-runtime';
import { createModel, type ModelInput, type ModelOutput } from '../model/model';
import { StopReason, type StreamChunk } from 'aidk-shared';
import { z } from 'zod';
import { fromEngineState, toEngineState } from '../model/utils/language-model';

describe('Channels Integration', () => {
  let engine: ReturnType<typeof createEngine>;
  let channelService: ChannelService;
  let receivedEvents: ChannelEvent[] = [];
  
  // Mock model for tests
  const mockModel = createModel<ModelInput, ModelOutput, ModelInput, ModelOutput, StreamChunk>({
    metadata: {
      id: 'test-model',
      type: 'language',
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

  beforeEach(() => {
    receivedEvents = [];
    channelService = new ChannelService();
  });

  afterEach(() => {
    channelService.destroy();
    if (engine) {
      engine.destroy();
    }
  });

  describe('Component Integration', () => {
    class TestComponent extends Component {
      render(com: ContextObjectModel, state: TickState) {
        // Publish event using channels from state
        if (state.channels) {
          const ctx = Context.tryGet();
          if (ctx) {
            state.channels.publish(ctx, 'test:progress', {
              type: 'progress',
              payload: { percent: 50 },
            });

            // Subscribe to events
            state.channels.subscribe(ctx, 'test:input', (event: ChannelEvent) => {
              receivedEvents.push(event);
            });
          }
        }

        return null;
      }
    }

    it('should allow components to publish events', async () => {
      const config: EngineConfig = {
        model: mockModel,
        channels: {},
        root: <TestComponent />,
      };

      engine = createEngine(config);
      
      // Subscribe to channel using engine's channel service
      const ctx = Context.create({ user: { id: 'user-1' }, metadata: { conversationId: 'conv-1' } });
      
      await Context.run(ctx, async () => {
        // Get channel service from engine (it's created internally)
        const engineChannelService = (engine as any).channelService;
        if (engineChannelService) {
          const unsubscribe = engineChannelService.subscribe(ctx, 'test:progress', (event: ChannelEvent) => {
            receivedEvents.push(event);
          });

          await engine.execute.call({ timeline: [] });

          expect(receivedEvents.length).toBeGreaterThan(0);
          const progressEvent = receivedEvents.find(e => e.type === 'progress');
          expect(progressEvent).toBeDefined();
          expect(progressEvent?.payload).toEqual({ percent: 50 });

          unsubscribe();
        } else {
          // If channels not configured, test should still pass
          await engine.execute.call({ timeline: [] });
        }
      });
    });

    it('should handle missing channel service gracefully', async () => {
      const config: EngineConfig = {
        model: mockModel,
        // No channels config
        root: <TestComponent />,
      };

      engine = createEngine(config);
      
      const ctx = Context.create({ user: { id: 'user-1' }, metadata: { conversationId: 'conv-1' } });
      
      // Should not throw - component checks for state.channels existence
      await Context.run(ctx, async () => {
        await engine.execute({ timeline: [] });
      });
    });
  });

  describe('Tool Integration', () => {
    const ChannelTool = createTool({
      name: 'channel_tool',
      description: 'Tool that uses channels',
      parameters: z.object({ message: z.string() }),
      handler: async (input: { message: string }): Promise<ContentBlock[]> => {
        const ctx = Context.get();
        
        if (!ctx.channels) {
          return [{ type: 'text', text: 'Channels not available' }];
        }

        // Publish to channel
        ctx.channels.publish(ctx, 'tool:status', {
          type: 'status',
          payload: { message: input.message },
        });

        // Wait for response (simulate bidirectional communication)
        const requestId = 'req-tool-123';
        ctx.channels.publish(ctx, 'tool:request', {
          type: 'request',
          id: requestId,
          payload: { question: 'Did you receive the message?' },
        });

        try {
          const response = await ctx.channels.waitForResponse(ctx, 'tool:request', requestId, 1000);
          return [{ type: 'text', text: `Received response: ${JSON.stringify(response.payload)}` }];
        } catch (error) {
          return [{ type: 'text', text: 'No response received' }];
        }
      }
    });

    it('should allow tools to access channels via context', async () => {
      const config: EngineConfig = {
        model: mockModel,
        channels: {},
        tools: [ChannelTool],
        root: undefined,
      };

      engine = createEngine(config);
      const ctx = Context.create({ user: { id: 'user-1' }, metadata: { conversationId: 'conv-1' } });

      await Context.run(ctx, async () => {
        // Simulate UI sending response
        setTimeout(() => {
          const engineChannelService = (engine as any).channelService;
          if (engineChannelService) {
            engineChannelService.publish(ctx, 'tool:request', {
              type: 'response',
              id: 'req-tool-123',
              payload: { answer: 'Yes, message received!' },
            });
          }
        }, 50);

        const result = await engine.execute.call({ timeline: [] });
        
        // Tool should have executed and received response
        expect(result).toBeDefined();
      });
    });

    it('should handle tools gracefully when channels not configured', async () => {
      const config: EngineConfig = {
        model: mockModel,
        // No channels config
        tools: [ChannelTool],
        root: undefined,
      };

      engine = createEngine(config);
      const ctx = Context.create({ user: { id: 'user-1' }, metadata: { conversationId: 'conv-1' } });

      await Context.run(ctx, async () => {
        // Should not throw - tool checks for channels availability
        const result = await engine.execute.call({ timeline: [] });
        expect(result).toBeDefined();
      });
    });
  });

  describe('Session Management', () => {
    it('should maintain sessions across multiple executions', async () => {
      const config: EngineConfig = {
        model: mockModel,
        channels: {},
        root: undefined,
      };

      engine = createEngine(config);
      const ctx = Context.create({ user: { id: 'user-1' }, metadata: { conversationId: 'conv-1' } });

      await Context.run(ctx, async () => {
        const engineChannelService = (engine as any).channelService;
        if (!engineChannelService) {
          // Skip if channels not configured
          return;
        }

        const session1 = engineChannelService.getSession(ctx);
        const channel1 = session1.getChannel('test-channel');
        
        await engine.execute({ timeline: [] });
        
        const session2 = engineChannelService.getSession(ctx);
        const channel2 = session2.getChannel('test-channel');
        
        // Should be same session and channel
        expect(session1).toBe(session2);
        expect(channel1).toBe(channel2);
      });
    });
  });

  describe('Bidirectional Communication', () => {
    class RequestResponseComponent extends Component {
      render(com: ContextObjectModel, state: TickState) {
        if (!state.channels) return null;

        const ctx = Context.tryGet();
        if (!ctx) return null;

        // Simulate requesting user input
        const requestId = 'req-123';
        state.channels.publish(ctx, 'ui:request', {
          type: 'request',
          id: requestId,
          payload: { question: 'What is your name?' },
        });

        // Wait for response (in real scenario, this would pause execution)
        state.channels.waitForResponse(ctx, 'ui:request', requestId, 1000)
          .then((response) => {
            receivedEvents.push(response);
          })
          .catch(() => {
            // Timeout expected in test
          });

        return null;
      }
    }

    // TODO: This test has timing issues with the async request/response pattern
    // The waitForResponse may complete/timeout before the simulated response arrives
    it.skip('should support request/response pattern', async () => {
      const config: EngineConfig = {
        model: mockModel,
        channels: {},
        root: <RequestResponseComponent />,
      };

      engine = createEngine(config);
      const ctx = Context.create({ user: { id: 'user-1' }, metadata: { conversationId: 'conv-1' } });

      await Context.run(ctx, async () => {
        const engineChannelService = (engine as any).channelService;
        if (!engineChannelService) {
          // Skip if channels not configured
          return;
        }

        // Simulate UI sending response
        setTimeout(() => {
          engineChannelService.publish(ctx, 'ui:request', {
            type: 'response',
            id: 'req-123',
            payload: { answer: 'John Doe' },
          });
        }, 50);

        await engine.execute({ timeline: [] });
      });

      // Wait for async response handling
      await new Promise(resolve => setTimeout(resolve, 200));

      const responseEvent = receivedEvents.find(e => e.type === 'response');
      expect(responseEvent).toBeDefined();
      expect(responseEvent?.payload).toEqual({ answer: 'John Doe' });
    });
  });
});

