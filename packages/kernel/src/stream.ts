import { Context } from './context';

/**
 * Helper to check if an object is an async iterable.
 */
export function isAsyncIterable(obj: any): obj is AsyncIterable<any> {
  return obj && typeof obj[Symbol.asyncIterator] === 'function';
}

/**
 * Maps items in an async stream.
 */
export async function* mapStream<T, R>(
  stream: AsyncIterable<T>,
  mapper: (item: T) => R | Promise<R>
): AsyncIterable<R> {
  // Ensure we iterate inside the current context
  const ctx = Context.tryGet();
  const iterator = stream[Symbol.asyncIterator]();

  try {
    while (true) {
      const next = ctx
        ? await Context.run(ctx, () => iterator.next())
        : await iterator.next();

      if (next.done) break;

      const mapped = ctx
        ? await Context.run(ctx, async () => mapper(next.value))
        : await mapper(next.value);
        
      yield mapped;
    }
  } finally {
    if (iterator.return) {
      if (ctx) await Context.run(ctx, () => iterator.return!());
      else await iterator.return();
    }
  }
}

/**
 * Taps into a stream to perform side effects without modifying the stream.
 */
export async function* tapStream<T>(
  stream: AsyncIterable<T>,
  tapper: (item: T) => void | Promise<void>
): AsyncIterable<T> {
  yield* mapStream(stream, async (item) => {
    await tapper(item);
    return item;
  });
}

export interface StreamTag<T> {
  source: string;
  value: T;
}

/**
 * Merges multiple streams into a single stream, yielding items as they arrive.
 * Handles context propagation and backpressure.
 * Supports merging an Array of streams OR a Record of tagged streams.
 */
export async function* mergeStreams<T>(
  input: AsyncIterable<T>[] | Record<string, AsyncIterable<T>>
): AsyncIterable<T | StreamTag<T>> {
  const ctx = Context.tryGet();
  
  let streams: AsyncIterable<T>[];
  let tags: string[] | null = null;

  if (Array.isArray(input)) {
    streams = input;
  } else {
    tags = Object.keys(input);
    streams = Object.values(input);
  }
  
  // Wrap iterators to run in context
  const iterators = streams.map(s => {
    const iter = s[Symbol.asyncIterator]();
    return {
      next: () => ctx ? Context.run(ctx, () => iter.next()) : iter.next(),
      return: () => ctx && iter.return ? Context.run(ctx, () => iter.return!()) : iter.return?.(),
      instance: iter
    };
  });

  try {
    // Map of active promises to their iterator index
    const nextPromises = new Map<number, Promise<IteratorResult<T>>>();

    // Initialize all iterators
    for (let i = 0; i < iterators.length; i++) {
      nextPromises.set(i, iterators[i].next());
    }

    while (nextPromises.size > 0) {
      // Create a race between all active promises
      const racePromises = Array.from(nextPromises.entries()).map(async ([index, promise]) => {
        try {
          const result = await promise;
          return { index, result };
        } catch (error) {
          return { index, error };
        }
      });

      const { index, result, error } = await Promise.race(racePromises);

      if (error) {
        throw error;
      }

      if (result!.done) {
        nextPromises.delete(index);
      } else {
        // If tagged, wrap in tag object. Else yield raw.
        if (tags) {
          yield { source: tags[index], value: result!.value };
        } else {
          yield result!.value;
        }
        
        // Refill
        nextPromises.set(index, iterators[index].next());
      }
    }
  } finally {
    // Ensure all iterators are closed
    await Promise.all(
      iterators.map(iter => iter.return())
    );
  }
}
