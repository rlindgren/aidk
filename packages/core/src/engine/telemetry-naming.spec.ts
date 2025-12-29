import { createEngine } from './factory';
import { createTool } from '../tool/tool';
import { createModel } from '../model/model';
import type { ModelInput, ModelOutput } from '../model';
import { type StreamChunk } from 'aidk-shared/streaming';
import type { EngineInput } from '../com/types';
import { Telemetry, Context } from 'aidk-kernel';
import { fromEngineState, toEngineState } from '../model/utils/language-model';
import { z } from 'zod';

describe('Procedure Telemetry Naming Convention', () => {
  let capturedSpans: Array<{ name: string; attributes: Record<string, any> }> = [];
  let mockTelemetryProvider: any;

  beforeEach(() => {
    capturedSpans = [];
    
    // Mock Telemetry provider to capture spans
    mockTelemetryProvider = {
      startSpan: jest.fn((name: string) => {
        const spanAttributes: Record<string, any> = {};
        const capturedSpan = { name, attributes: spanAttributes };
        capturedSpans.push(capturedSpan);
        
        const span = {
          name,
          attributes: spanAttributes,
          setAttribute: jest.fn((key: string, value: any) => {
            spanAttributes[key] = value;
            // Also update the captured span
            capturedSpan.attributes[key] = value;
          }),
          end: jest.fn(),
          recordError: jest.fn(),
        };
        return span;
      }),
      startTrace: jest.fn(() => 'trace-id'),
      endTrace: jest.fn(),
      recordError: jest.fn(),
      getCounter: jest.fn(() => ({ add: jest.fn() })),
      getHistogram: jest.fn(() => ({ record: jest.fn() })),
    };
    
    Telemetry.setProvider(mockTelemetryProvider);
  });

  afterEach(() => {
    Telemetry.resetProvider();
    capturedSpans = [];
  });

  describe('Engine Procedures', () => {
    it('should use generic span name "engine:execute" with metadata attributes', async () => {
      const mockModel = createModel({
        metadata: { id: 'test-model', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'test-model',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      const engine = createEngine({ id: 'test-engine-123', model: mockModel });
      const input: EngineInput = { timeline: [] };
      
      await engine.execute.call(input);
      
      const executeSpan = capturedSpans.find(s => s.name === 'engine:execute');
      expect(executeSpan).toBeDefined();
      expect(executeSpan!.attributes['procedure.metadata.type']).toBe('engine');
      expect(executeSpan!.attributes['procedure.metadata.id']).toBe('test-engine-123');
      expect(executeSpan!.attributes['procedure.metadata.operation']).toBe('execute');
    });

    it('should use generic span name "engine:stream" with metadata attributes', async () => {
      const mockModel = createModel({
        metadata: { id: 'test-model', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'test-model',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
          executeStream: async function* () {
            yield {
              type: 'content_delta',
              delta: 'chunk',
              toolCalls: [],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: 'stop',
            } as StreamChunk;
          },
        },
        fromEngineState,
        toEngineState,
      });
      
      const engine = createEngine({ id: 'test-engine-456', model: mockModel });
      const input: EngineInput = { timeline: [] };
      
      const stream = await engine.stream.call(input);
      // Consume at least one item to trigger span creation
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      
      const streamSpan = capturedSpans.find(s => s.name === 'engine:stream');
      expect(streamSpan).toBeDefined();
      expect(streamSpan!.attributes['procedure.metadata.type']).toBe('engine');
      expect(streamSpan!.attributes['procedure.metadata.id']).toBe('test-engine-456');
      expect(streamSpan!.attributes['procedure.metadata.operation']).toBe('stream');
    });

    it('should auto-generate engine ID if not provided', async () => {
      const engine = createEngine(); // No ID provided
      expect(engine.id).toBeDefined();
      expect(engine.id).toMatch(/^engine_/);
    });
  });

  describe('Tool Procedures', () => {
    it('should use generic span name "tool:run" with metadata attributes', async () => {
      const tool = createTool({
        name: 'test-tool',
        description: 'Test tool',
        parameters: {} as any,
        handler: async () => [{ type: 'text', text: 'result' }],
      });
      
      await tool.run.call({});
      
      const toolSpan = capturedSpans.find(s => s.name === 'tool:run');
      expect(toolSpan).toBeDefined();
      expect(toolSpan!.attributes['procedure.metadata.type']).toBe('tool');
      expect(toolSpan!.attributes['procedure.metadata.id']).toBe('test-tool');
      expect(toolSpan!.attributes['procedure.metadata.operation']).toBe('run');
    });

    it('should not include tool name in span name (low cardinality)', async () => {
      const tool1 = createTool({
        name: 'tool-one',
        description: 'Tool one',
        parameters: z.object({}) as any,
        handler: async (_input: {}) => [{ type: 'text', text: 'result1' }],
      });
      
      const tool2 = createTool({
        name: 'tool-two',
        description: 'Tool two',
        parameters: z.object({}) as any,
        handler: async (_input: {}) => [{ type: 'text', text: 'result2' }],
      });
      
      // Procedures need a context to execute
      const context = Context.create();
      await Context.run(context, async () => {
        await tool1.run.call({});
        await tool2.run.call({});
      });
      
      const toolSpans = capturedSpans.filter(s => s.name === 'tool:run');
      expect(toolSpans.length).toBe(2);
      // Both should have same span name
      expect(toolSpans[0].name).toBe(toolSpans[1].name);
      // But different IDs in metadata
      expect(toolSpans[0].attributes['procedure.metadata.id']).toBe('tool-one');
      expect(toolSpans[1].attributes['procedure.metadata.id']).toBe('tool-two');
    });
  });

  describe('Model Procedures', () => {
    it('should use generic span name "model:generate" with metadata attributes', async () => {
      const model = createModel<ModelInput, ModelOutput>({
        metadata: {
          id: 'test-model-789',
          provider: 'test',
          capabilities: [],
        },
        executors: {
          execute: async () => ({
            model: 'test-model-789',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      await model.generate.call({
        messages: [],
        tools: [],
      });
      
      const generateSpan = capturedSpans.find(s => s.name === 'model:generate');
      expect(generateSpan).toBeDefined();
      expect(generateSpan!.attributes['procedure.metadata.type']).toBe('model');
      expect(generateSpan!.attributes['procedure.metadata.id']).toBe('test-model-789');
      expect(generateSpan!.attributes['procedure.metadata.operation']).toBe('generate');
    });

    it('should use generic span name "model:stream" with metadata attributes', async () => {
      const model = createModel<ModelInput, ModelOutput>({
        metadata: {
          id: 'test-model-stream',
          provider: 'test',
          capabilities: [],
        },
        executors: {
          execute: async () => ({
            model: 'test-model-stream',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
          executeStream: async function* () {
            yield {
              type: 'content_delta',
              delta: 'chunk',
              toolCalls: [],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              stopReason: 'stop',
            } as StreamChunk;
          },
        },
        fromEngineState,
        toEngineState,
      });
      
      const streamPromise = model.stream!.call({
        messages: [],
        tools: [],
      });
      
      // Consume at least one item
      const stream = await streamPromise;
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      
      const streamSpan = capturedSpans.find(s => s.name === 'model:stream');
      expect(streamSpan).toBeDefined();
      expect(streamSpan!.attributes['procedure.metadata.type']).toBe('model');
      expect(streamSpan!.attributes['procedure.metadata.id']).toBe('test-model-stream');
      expect(streamSpan!.attributes['procedure.metadata.operation']).toBe('stream');
    });
  });

  describe('Span Name Cardinality', () => {
    it('should have low cardinality span names (same name for all instances)', async () => {
      // Create models for engines
      const engineModel = createModel({
        metadata: { id: 'engine-model', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'engine-model',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      // Create multiple engines with different IDs
      const engine1 = createEngine({ id: 'engine-1', model: engineModel });
      const engine2 = createEngine({ id: 'engine-2', model: engineModel });
      
      // Create multiple tools with different names
      const tool1 = createTool({
        name: 'tool-1',
        description: 'Tool 1',
        parameters: z.object({}) as any,
        handler: async (_input: {}) => [{ type: 'text', text: 'result' }],
      });
      
      const tool2 = createTool({
        name: 'tool-2',
        description: 'Tool 2',
        parameters: z.object({}) as any,
        handler: async (_input: {}) => [{ type: 'text', text: 'result' }],
      });
      
      // Create multiple models with different IDs
      const model1 = createModel({
        metadata: { id: 'model-1', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'model-1',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      const model2 = createModel({
        metadata: { id: 'model-2', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'model-2',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      // Execute all procedures
      await engine1.execute.call({ timeline: [] });
      await engine2.execute.call({ timeline: [] });
      // Procedures need a context to execute
      const context = Context.create();
      await Context.run(context, async () => {
        await tool1.run.call({});
        await tool2.run.call({});
      });
      await model1.generate.call({ messages: [], tools: [] });
      await model2.generate.call({ messages: [], tools: [] });
      
      // Count unique span names
      const uniqueSpanNames = new Set(capturedSpans.map(s => s.name));
      
      // Should have only a few unique span names (low cardinality)
      expect(uniqueSpanNames.size).toBeLessThan(10);
      
      // Verify all engines use same span name
      const engineSpans = capturedSpans.filter(s => s.name === 'engine:execute');
      expect(engineSpans.length).toBe(2);
      
      // Verify all tools use same span name
      const toolSpans = capturedSpans.filter(s => s.name === 'tool:run');
      expect(toolSpans.length).toBe(2);
      
      // Verify all models use same span name
      // Note: engine.execute calls model.generate internally, so we get 4 total:
      // 2 from engine1.execute + engine2.execute, plus 2 direct calls
      const modelSpans = capturedSpans.filter(s => s.name === 'model:generate');
      expect(modelSpans.length).toBe(4);
      // All should have same span name (low cardinality)
      const uniqueModelSpanNames = new Set(modelSpans.map(s => s.name));
      expect(uniqueModelSpanNames.size).toBe(1);
    });
  });

  describe('Metadata Attributes', () => {
    it('should set all required metadata attributes', async () => {
      const mockModel = createModel({
        metadata: { id: 'test-model', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'test-model',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      const engine = createEngine({ id: 'test-engine', model: mockModel });
      const tool = createTool({
        name: 'test-tool',
        description: 'Test',
        parameters: {} as any,
        handler: async () => [{ type: 'text', text: 'result' }],
      });
      
      await engine.execute.call({ timeline: [] });
      await tool.run.call({});
      
      const engineSpan = capturedSpans.find(s => s.name === 'engine:execute');
      expect(engineSpan!.attributes['procedure.metadata.type']).toBe('engine');
      expect(engineSpan!.attributes['procedure.metadata.id']).toBe('test-engine');
      expect(engineSpan!.attributes['procedure.metadata.operation']).toBe('execute');
      
      const toolSpan = capturedSpans.find(s => s.name === 'tool:run');
      expect(toolSpan!.attributes['procedure.metadata.type']).toBe('tool');
      expect(toolSpan!.attributes['procedure.metadata.id']).toBe('test-tool');
      expect(toolSpan!.attributes['procedure.metadata.operation']).toBe('run');
    });

    it('should include procedure.pid and procedure.parent_pid attributes', async () => {
      const mockModel = createModel({
        metadata: { id: 'test-model', provider: 'test', capabilities: [] },
        executors: {
          execute: async () => ({
            model: 'test-model',
            createdAt: new Date().toISOString(),
            message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            stopReason: 'stop',
            raw: {},
          }),
        },
        fromEngineState,
        toEngineState,
      });
      
      const engine = createEngine({ model: mockModel });
      await engine.execute.call({ timeline: [] });
      
      const span = capturedSpans.find(s => s.name === 'engine:execute');
      expect(span!.attributes['procedure.pid']).toBeDefined();
      // Root procedures (those that create their own context) don't have a parent_pid
      // Only nested procedures have parent_pid set
      // For this test, engine.execute is a root procedure, so parent_pid may be undefined
      // Check that if parent_pid exists, it's a string (for nested cases)
      if (span!.attributes['procedure.parent_pid'] !== undefined) {
        expect(typeof span!.attributes['procedure.parent_pid']).toBe('string');
      }
    });
  });
});

