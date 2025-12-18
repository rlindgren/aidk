import { Context, type KernelContext } from './context';
import { ExecutionTracker } from './execution-tracker';
import { ProcedureGraph } from './procedure-graph';
import { Telemetry } from './telemetry';

// Mock Telemetry
jest.mock('./telemetry', () => ({
  Telemetry: {
    startSpan: jest.fn(() => ({
      setAttribute: jest.fn(),
      recordError: jest.fn(),
      end: jest.fn(),
    })),
    getHistogram: jest.fn(() => ({
      record: jest.fn(),
    })),
    getCounter: jest.fn(() => ({
      add: jest.fn(),
    })),
  },
}));

describe('ExecutionTracker', () => {
  let ctx: KernelContext;
  
  beforeEach(() => {
    ctx = Context.create();
    jest.clearAllMocks();
    
    // Restore mock implementations after clearing
    (Telemetry.startSpan as jest.Mock).mockImplementation(() => ({
      setAttribute: jest.fn(),
      recordError: jest.fn(),
      end: jest.fn(),
    }));
    (Telemetry.getHistogram as jest.Mock).mockImplementation(() => ({
      record: jest.fn(),
    }));
    (Telemetry.getCounter as jest.Mock).mockImplementation(() => ({
      add: jest.fn(),
    }));
  });
  
  describe('basic tracking', () => {
    it('should track a procedure execution', async () => {
      const result = await ExecutionTracker.track(
        ctx,
        { name: 'test-proc' },
        async (node) => {
          expect(node).toBeDefined();
          expect(node.name).toBe('test-proc');
          expect(node.status).toBe('running');
          return 'result';
        }
      );
      
      expect(result).toBe('result');
      expect(ctx.procedureGraph).toBeDefined();
      expect(ctx.procedureGraph!.getCount()).toBe(1);
    });
    
    it('should initialize ProcedureGraph if not present', async () => {
      expect(ctx.procedureGraph).toBeUndefined();
      
      await ExecutionTracker.track(ctx, { name: 'test' }, async () => 'result');
      
      expect(ctx.procedureGraph).toBeDefined();
    });
    
    it('should track nested procedures', async () => {
      await ExecutionTracker.track(
        ctx,
        { name: 'parent' },
        async (parentNode) => {
          expect(ctx.procedurePid).toBe(parentNode.pid);
          
          await ExecutionTracker.track(
            ctx,
            { name: 'child' },
            async (childNode) => {
              expect(childNode.parentPid).toBe(parentNode.pid);
              expect(ctx.procedurePid).toBe(childNode.pid);
              return 'child-result';
            }
          );
          
          expect(ctx.procedurePid).toBe(parentNode.pid); // Restored
          return 'parent-result';
        }
      );
      
      expect(ctx.procedureGraph!.getCount()).toBe(2);
      const children = ctx.procedureGraph!.getChildren(ctx.procedureGraph!.getAllNodes()[0].pid);
      expect(children.length).toBeGreaterThan(0);
    });
  });
  
  describe('metrics tracking', () => {
    it('should track metrics written to ctx.metrics', async () => {
      await ExecutionTracker.track(
        ctx,
        { name: 'test' },
        async (node) => {
          ctx.metrics!['usage.input_tokens'] = 100;
          ctx.metrics!['usage.output_tokens'] = 50;
          
          expect(node.getMetric('usage.input_tokens')).toBe(100);
          expect(node.getMetric('usage.output_tokens')).toBe(50);
          
          return 'result';
        }
      );
      
      // Metrics should be in the node
      const node = ctx.procedureGraph!.getAllNodes()[0];
      expect(node.getMetric('usage.input_tokens')).toBe(100);
      expect(node.getMetric('usage.output_tokens')).toBe(50);
    });
    
    it('should accumulate metrics when adding multiple times', async () => {
      await ExecutionTracker.track(
        ctx,
        { name: 'test' },
        async (node) => {
          ctx.metrics!['usage.input_tokens'] = 100;
          ctx.metrics!['usage.input_tokens'] = 150; // Overwrite
          
          // Proxy tracks delta, so should be 50 (150 - 100)
          expect(node.getMetric('usage.input_tokens')).toBeGreaterThanOrEqual(50);
          
          return 'result';
        }
      );
    });
    
    it('should propagate metrics to parent on completion', async () => {
      await ExecutionTracker.track(
        ctx,
        { name: 'parent' },
        async (parentNode) => {
          await ExecutionTracker.track(
            ctx,
            { name: 'child' },
            async (childNode) => {
              // Use addMetric helper or direct assignment
              // The proxy tracks deltas, so setting to 100 adds 100
              ctx.metrics!['usage.input_tokens'] = 100;
              return 'child-result';
            }
          );
          
          // After child completes, verify child has metrics
          const childNode = ctx.procedureGraph!.getChildNodes(parentNode.pid)[0];
          expect(childNode).toBeDefined();
          expect(childNode!.getMetric('usage.input_tokens')).toBe(100);
          
          // Parent node should have accumulated child's metrics via propagation
          // Note: Metrics propagate on child completion, so parent should have them
          const parentMetricValue = parentNode.getMetric('usage.input_tokens');
          expect(parentMetricValue).toBe(100);
          
          return 'parent-result';
        }
      );
    });
  });
  
  describe('telemetry integration', () => {
    it('should create telemetry span', async () => {
      await ExecutionTracker.track(
        ctx,
        { name: 'test-proc', metadata: { userId: '123' } },
        async () => 'result'
      );
      
      expect(Telemetry.startSpan).toHaveBeenCalledWith('test-proc');
    });
    
    it('should send metrics to telemetry on completion', async () => {
      await ExecutionTracker.track(
        ctx,
        { name: 'test' },
        async (node) => {
          ctx.metrics!['usage.input_tokens'] = 100;
          return 'result';
        }
      );
      
      expect(Telemetry.getHistogram).toHaveBeenCalledWith('procedure.usage.input_tokens');
    });
  });
  
  describe('error handling', () => {
    it('should track failed procedures', async () => {
      const error = new Error('Test error');
      
      await expect(
        ExecutionTracker.track(
          ctx,
          { name: 'test' },
          async () => {
            throw error;
          }
        )
      ).rejects.toThrow('Test error');
      
      const node = ctx.procedureGraph!.getAllNodes()[0];
      expect(node.status).toBe('failed');
      expect(node.error).toBe(error);
    });
    
    it('should track aborted procedures', async () => {
      ctx.signal = AbortSignal.abort();
      
      await expect(
        ExecutionTracker.track(
          ctx,
          { name: 'test' },
          async () => 'result'
        )
      ).rejects.toThrow('Operation aborted');
      
      const node = ctx.procedureGraph!.getAllNodes()[0];
      expect(node.status).toBe('cancelled');
    });
  });
  
  describe('context restoration', () => {
    it('should restore previous procedurePid after completion', async () => {
      const initialPid = ctx.procedurePid;
      
      await ExecutionTracker.track(
        ctx,
        { name: 'test' },
        async () => {
          expect(ctx.procedurePid).toBeDefined();
          expect(ctx.procedurePid).not.toBe(initialPid);
          return 'result';
        }
      );
      
      expect(ctx.procedurePid).toBe(initialPid);
    });
    
    it('should restore original metrics after completion', async () => {
      ctx.metrics = { existing: 50 };
      const originalMetrics = { ...ctx.metrics };
      
      await ExecutionTracker.track(
        ctx,
        { name: 'test' },
        async () => {
          ctx.metrics!['new'] = 100;
          return 'result';
        }
      );
      
      // Original metrics should be restored
      expect(ctx.metrics).toEqual(originalMetrics);
    });
  });
});

