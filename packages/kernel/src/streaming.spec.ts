import { createProcedure } from './procedure';
import { Context } from './context';

describe('Kernel Streaming', () => {
  it('should stream data via AsyncGenerator', async () => {
    const proc = createProcedure({ name: 'test' }, async function* () {
      yield 1;
      yield 2;
    });

    const iterator = (await proc()) as AsyncIterable<number>;
    const chunks = [];
    for await (const chunk of iterator) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([1, 2]);
  });

  it('should preserve context across yields', async () => {
    const proc = createProcedure({ name: 'test' }, async function* () {
      const ctx = Context.get();
      yield ctx.traceId;
      yield ctx.traceId;
    });

    const iterator = (await proc()) as AsyncIterable<string>;
    const chunks = [];
    for await (const chunk of iterator) {
      chunks.push(chunk);
    }
    expect(chunks[0]).toBeDefined();
    expect(chunks[0]).toBe(chunks[1]);
  });

  it('should emit stream:chunk events on the handle', async () => {
    const proc = createProcedure({ name: 'test' }, async function* () {
      yield 'A';
      yield 'B';
    });

    const { handle } = proc.withHandle().call();
    const chunks: any[] = [];
    
    // Update expectation: payload is now wrapped in ExecutionEvent
    handle.events.on('stream:chunk', (event) => chunks.push(event.payload.value));

    const iterator = (await handle.result) as AsyncIterable<string>;
    for await (const _ of iterator) {
      // consume
    }

    expect(chunks).toEqual(['A', 'B']);
  });
});
