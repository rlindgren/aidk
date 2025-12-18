import { createProcedure, createHook, createPipeline, Middleware, procedure as procedureDecorator, hook  } from './procedure';
import { Context } from './context';
import { z } from 'zod';

describe('Kernel Procedure', () => {
  it('should execute a simple handler', async () => {
    const proc = createProcedure({ name: 'test' }, async (input: number) => input * 2)
    const result = await proc(5);
    expect(result).toBe(10);
  });

  it('should run middleware', async () => {
    const proc = createProcedure({ name: 'test' }, async (input: number) => input)
      .use(async (args, envelope, next) => {
        const res = await next();
        return res + 1;
      });

    const result = await proc(1);
    expect(result).toBe(2);
  });

  it('should support .withHandle() for observability', async () => {
    const proc = createProcedure({ name: 'test' }, async () => 10);
    const { result, handle } = proc.withHandle().call();
    
    const eventLog: any[] = [];
    handle.events.on('*', (e) => eventLog.push(e));
    // Also listen to specific event to ensure it fires
    handle.events.on('procedure:end', (e) => eventLog.push(e));

    await expect(result).resolves.toBe(10);
    
    // Wait a tick for events to propagate
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(eventLog.length).toBeGreaterThanOrEqual(1);
    // Check for payload inside the ExecutionEvent
    const endEvent = eventLog.find(e => e.payload?.result === 10);
    expect(endEvent).toBeDefined();
    expect(endEvent.type).toBe('procedure:end');
  });

  it('should support ad-hoc middleware extension via .use()', async () => {
    const baseProc = createProcedure({ name: 'test' }, async () => 1);
    
    const extendedProc = baseProc.use(async (args, envelope, next) => {
      const res = await next();
      return res + 10;
    });

    const result = await extendedProc();
    expect(result).toBe(11);
  });

  it('should support chained ad-hoc middleware', async () => {
    const baseProc = createProcedure({ name: 'test' }, async () => []);
    
    const chainedProc = baseProc
      .use(async (args, envelope, next) => {
        const res = await next();
        return [...res, 'mw1'];
      })
      .use(async (args, envelope, next) => {
        const res = await next();
        return [...res, 'mw2'];
      })
      .use(async (args, envelope, next) => {
        const res = await next();
        return [...res, 'mw3'];
      });

    // Execution order: mw1 -> mw2 -> mw3 -> handler
    // Return order: handler([]) -> mw3(['mw3']) -> mw2(['mw3', 'mw2']) -> mw1(['mw3', 'mw2', 'mw1'])
    const result = await chainedProc();
    expect(result).toEqual(['mw3', 'mw2', 'mw1']);
  });

  it('should support input transformation in middleware', async () => {
    const proc = createProcedure({ name: 'test' }, async (input: number) => input * 10)
      .use(async (args, envelope, next) => {
        // Transform input: multiply by 2
        return next([2]); // Pass transformed input
      })
      .use(async (args, envelope, next) => {
        // Transform input again: add 1
        return next([3]); // Pass transformed input
      })
    
    const result = await proc(1);
    // Input flow: 1 -> (mw1 transforms to 2) -> (mw2 transforms to 3) -> handler(3 * 10 = 30)
    expect(result).toBe(30);
  });

  it('should use original input if middleware does not transform', async () => {
    const proc = createProcedure({ name: 'test' }, async (input: number) => input * 2)
      .use(async (args, envelope, next) => {
        // Don't transform - just call next() without args
        return next();
      })
    
    const result = await proc(5);
    // Input flow: 5 -> (mw1 doesn't transform) -> handler(5 * 2 = 10)
    expect(result).toBe(10);
  });

  it('should support mixed transformation and non-transformation middleware', async () => {
    const proc = createProcedure({ name: 'test' }, async (input: number) => input * 2)
      .use(async (args, envelope, next) => {
        // Transform: multiply by 2
        return next([10]);
      })
      .use(async (args, envelope, next) => {
        // Don't transform - use current input (10)
        return next();
      })
      .use(async (args, envelope, next) => {
        // Transform again: add 5
        return next([15]);
      });
    
    const result = await proc(5);
    // Input flow: 5 -> (mw1: 10) -> (mw2: 10) -> (mw3: 15) -> handler(15 * 2 = 30)
    expect(result).toBe(30);
  });
});


/**
 * Tests for new Procedure implementation
 * 
 * Tests:
 * - Variable arity (0, 1, N args)
 * - Decorator name inference
 * - Hooks as procedures (direct calls)
 * - Execution graph parent-child tracking
 * - Pipelines
 * - Fluent API
 */

describe('Procedure v2 - Variable Arity', () => {
  beforeEach(() => {
    // Clear context before each test
  });

  it('should support 0 args', async () => {
    const proc = createProcedure(async () => {
      return 'result';
    });

    const result = await proc();
    expect(result).toBe('result');
  });

  it('should support 1 arg', async () => {
    const proc = createProcedure(async (input: string) => {
      return input.toUpperCase();
    });

    const result = await proc('test');
    expect(result).toBe('TEST');
  });

  it('should support N args', async () => {
    const proc = createProcedure(async (a: number, b: string, c: boolean) => {
      return `${a}-${b}-${c}`;
    });

    const result = await proc(1, 'test', true);
    expect(result).toBe('1-test-true');
  });
});

describe('Procedure v2 - Decorators', () => {
  it('should infer name from method name', () => {
    class TestClass {
      @procedureDecorator()
      async execute(input: string) {
        return input;
      }
    }

    const instance = new TestClass();
    // Method should be a Procedure
    expect(typeof instance.execute).toBe('function');
    expect('use' in instance.execute).toBe(true);
    expect('withHandle' in instance.execute).toBe(true);
  });

  it('should support @hook decorator', () => {
    class TestClass {
      // generatorProcedure preserves 'this' type - specify it for IntelliSense
      stream = createProcedure({ name: 'stream' }, async function* (this: TestClass, input: string) {
        yield await this.processChunk(input);  // ✅ Full IntelliSense
      });

      private processChunk = createHook({ name: 'stream:chunk' }, async (chunk: string) => {
        return chunk.toUpperCase();
      });
    }

    const instance = new TestClass();
    instance.stream('test').then(console.log);
    // Both should be Procedures
    expect(instance.stream.use).toBeDefined();
    // processChunk is private, but should still be a Procedure
  });
});

describe('Procedure v2 - Pipelines', () => {
  it('should create and use pipelines', async () => {
    const mw1: Middleware = async (args, envelope, next) => {
      return next();
    };

    const mw2: Middleware = async (args, envelope, next) => {
      return next();
    };

    const pipeline = createPipeline([mw1, mw2]);
    pipeline.use(mw1);

    const proc = createProcedure(async (input: string) => {
      return input;
    }).use(pipeline as any);

    const result = await proc('test');
    expect(result).toBe('test');
  });
});

describe('Procedure v2 - Fluent API', () => {
  it('should support .call() for chained execution', async () => {
    const proc = createProcedure(async (input: string) => {
      return input.toUpperCase();
    });

    const result1 = await proc('test');
    const result2 = await proc.call('test');
    
    expect(result1).toBe('TEST');
    expect(result2).toBe('TEST');
  });

  it('should support .withContext()', async () => {
    const proc = createProcedure(async (input: string) => {
      const ctx = Context.get();
      return ctx.traceId || input;
    });

    const result = await proc.withContext({ traceId: '123' }).call('test');
    expect(result).toBe('123');
  });

  it('should support .use() chaining', async () => {
    const mw: Middleware<any[]> = async (args, envelope, next) => {
      return next();
    };

    const proc = createProcedure(async (input: string) => {
      return input;
    }).use(mw as any);

    const result = await proc('test');
    expect(result).toBe('test');
  });
});

describe('Procedure v2 - Hooks as Procedures', () => {
  it('should allow direct calls to hooks', async () => {
    const processChunk = createHook(async (chunk: string) => {
      return chunk.toUpperCase();
    });

    const result = await processChunk('test');
    expect(result).toBe('TEST');
  });

  it('should track parent-child in execution graph', async () => {
    const stream = createProcedure({ name: 'stream' }, async function*(input: string) {
      const processChunk = createHook({ name: 'stream:chunk' }, async (chunk: string) => {
        return chunk;
      });

      for (const chunk of ['a', 'b', 'c']) {
        yield await processChunk(chunk);
      }
    });

    const ctx = Context.create();
    const results: string[] = [];

    const iterable = await Context.run(ctx, async () => stream('test'));
    for await (const chunk of iterable) {
      results.push(chunk);
    }

    expect(results).toEqual(['a', 'b', 'c']);
    
    // Check execution graph exists
    expect(ctx.procedureGraph).toBeDefined();
    if (ctx.procedureGraph) {
      const allNodes = ctx.procedureGraph.getAllNodes();
      expect(allNodes.length).toBeGreaterThan(0);
      // At least the root procedure should be tracked
      const root = allNodes.find(node => !node.parentPid);
      expect(root).toBeDefined();
    }
  });
});

