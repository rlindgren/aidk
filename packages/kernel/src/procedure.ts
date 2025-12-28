/**
 * New Procedure Implementation - Variable Arity, Decorators, Pipelines
 *
 * Design Principles:
 * - Everything is a Procedure
 * - Variable arity support (0, 1, N args)
 * - Decorator = Function (same type)
 * - Hooks are Procedures (@hook decorator)
 * - Pipelines for middleware bundles
 * - Direct calls (no registration)
 * - Automatic tracking (execution graph, telemetry)
 */

import { z } from "zod";
import { EventEmitter } from "node:events";
import { Context, type KernelContext, isKernelContext } from "./context";
import { ExecutionTracker } from "./execution-tracker";
import { randomUUID } from "node:crypto";
import { ProcedureGraph } from "./procedure-graph";
import { ProcedureNode } from "./procedure-graph";
import { AbortError, ValidationError } from "aidk-shared";

// ============================================================================
// Types
// ============================================================================

export type Middleware<TArgs extends any[] = any[]> = (
  args: TArgs,
  envelope: ProcedureEnvelope<TArgs>,
  next: (transformedArgs?: TArgs) => Promise<any>,
) => Promise<any>;

export interface ProcedureEnvelope<TArgs extends any[]> {
  sourceType: "procedure" | "hook";
  sourceId?: string;
  operationName: string;
  args: TArgs;
  context: KernelContext;
}

export interface ExecutionHandle<TOutput> {
  result: Promise<TOutput>;
  events: EventEmitter;
  traceId: string;
  cancel?(): void;
  getStatus?(): "running" | "completed" | "failed" | "cancelled";
}

export type HandleFactory<
  THandle extends ExecutionHandle<any> = ExecutionHandle<any>,
  TContext extends KernelContext = KernelContext,
> = (
  events: EventEmitter,
  traceId: string,
  result: Promise<any>,
  context: TContext,
) => THandle;

export interface ProcedureOptions {
  name?: string;
  middleware?: (Middleware<any[]> | MiddlewarePipeline)[];
  handleFactory?: HandleFactory;
  schema?: z.ZodType<any>;
  parentProcedure?: string; // For hooks
  sourceType?: "procedure" | "hook"; // Internal use
  sourceId?: string; // Internal use
  metadata?: Record<string, any>; // For telemetry span attributes (e.g., { type: 'tool', id: 'myTool', operation: 'run' })
  /** Timeout in milliseconds. If exceeded, throws AbortError.timeout() */
  timeout?: number;
}

/**
 * Static middleware configuration for a class.
 * Maps procedure names to middleware arrays or pipelines.
 */
export interface StaticMiddleware {
  [procedureName: string]: (Middleware<any[]> | MiddlewarePipeline)[];
}

export interface Procedure<THandler extends (...args: any[]) => any> {
  // Direct call - always returns Promise<TOutput>
  // For streams, TOutput = AsyncIterable<ChunkType>, so await returns AsyncIterable
  (...args: ExtractArgs<THandler>): Promise<ExtractReturn<THandler>>;

  // Chained execution
  // @deprecated Use .run() instead.
  call(...args: ExtractArgs<THandler>): Promise<ExtractReturn<THandler>>;

  // Direct call - always returns Promise<TOutput>
  // For streams, TOutput = AsyncIterable<ChunkType>, so await returns AsyncIterable
  run(...args: ExtractArgs<THandler>): Promise<ExtractReturn<THandler>>;

  // Configuration methods (return Procedure for chaining)
  use(
    ...middleware: (Middleware<ExtractArgs<THandler>> | MiddlewarePipeline)[]
  ): Procedure<THandler>;
  withHandle(): ProcedureWithHandle<THandler>;
  withContext(ctx: Partial<KernelContext>): Procedure<THandler>;
  withMiddleware(
    mw: Middleware<ExtractArgs<THandler>> | MiddlewarePipeline,
  ): Procedure<THandler>;
  /** Create a procedure variant with a timeout. Throws AbortError.timeout() if exceeded. */
  withTimeout(ms: number): Procedure<THandler>;

  // Composition methods
  /**
   * Pipe the output of this procedure to another procedure.
   * Creates a new procedure that runs this procedure, then passes its result to the next.
   *
   * @example
   * ```typescript
   * const parse = createProcedure(async (input: string) => JSON.parse(input));
   * const validate = createProcedure(async (data: object) => schema.parse(data));
   * const transform = createProcedure(async (valid: Valid) => transform(valid));
   *
   * const pipeline = parse.pipe(validate).pipe(transform);
   * const result = await pipeline('{"name": "test"}');
   * ```
   */
  pipe<TNext extends (arg: ExtractReturn<THandler>) => any>(
    next: Procedure<TNext>,
  ): Procedure<
    (...args: ExtractArgs<THandler>) => Promise<ExtractReturn<TNext>>
  >;
}

export type ProcedureWithHandle<THandler extends (...args: any[]) => any> = {
  (...args: ExtractArgs<THandler>): {
    handle: ExecutionHandle<ExtractReturn<THandler>>;
    result: Promise<ExtractReturn<THandler>>;
  };
  call(...args: ExtractArgs<THandler>): {
    handle: ExecutionHandle<ExtractReturn<THandler>>;
    result: Promise<ExtractReturn<THandler>>;
  };
  run(...args: ExtractArgs<THandler>): {
    handle: ExecutionHandle<ExtractReturn<THandler>>;
    result: Promise<ExtractReturn<THandler>>;
  };
  use(
    ...middleware: (Middleware<ExtractArgs<THandler>> | MiddlewarePipeline)[]
  ): ProcedureWithHandle<THandler>;
  withContext(ctx: Partial<KernelContext>): ProcedureWithHandle<THandler>;
  withMiddleware(
    mw: Middleware<ExtractArgs<THandler>> | MiddlewarePipeline,
  ): ProcedureWithHandle<THandler>;
  withTimeout(ms: number): ProcedureWithHandle<THandler>;
};

/**
 * Helper type to extract argument types from a function signature.
 * Handles functions with `this` parameters and generator functions.
 *
 * @example
 * ```typescript
 * type Args1 = ExtractArgs<(input: string) => void>; // [string]
 * type Args2 = ExtractArgs<(this: Test, input: string) => void>; // [string]
 * type Args3 = ExtractArgs<() => Generator<string>>; // []
 * ```
 */
export type ExtractArgs<T> = T extends {
  (this: infer This, ...args: infer Args): any;
}
  ? Args
  : T extends {
        (...args: infer Args): any;
      }
    ? Args
    : T extends {
          (
            this: infer This,
            ...args: infer Args
          ): Generator<infer Y, infer R, infer N>;
        }
      ? Args
      : T extends {
            (...args: infer Args): Generator<infer Y, infer R, infer N>;
          }
        ? Args
        : T extends {
              (
                this: infer This,
                ...args: infer Args
              ): AsyncGenerator<infer Y, infer R, infer N>;
            }
          ? Args
          : T extends {
                (
                  ...args: infer Args
                ): AsyncGenerator<infer Y, infer R, infer N>;
              }
            ? Args
            : never;

/**
 * Helper type to extract return type from a function signature.
 * Handles both Promise and direct returns, and unwraps Promise.
 * Preserves AsyncIterable as-is.
 */
export type ExtractReturn<T> = T extends (...args: any[]) => infer Return
  ? Return extends Promise<infer U>
    ? U
    : Return extends AsyncIterable<any>
      ? Return
      : Return
  : never;

/**
 * Helper type to transform a method signature to Procedure type.
 * Extracts args and return type, then creates Procedure<TArgs, TOutput>.
 *
 * Use this type to get proper IntelliSense for decorated methods:
 *
 * @example
 * ```typescript
 * class Model {
 *   @procedure()
 *   async execute(input: string): Promise<string> { ... }
 * }
 *
 * // For IntelliSense, you can use:
 * type ModelWithProcedures = {
 *   execute: AsProcedure<Model['execute']>;
 * };
 *
 * // Or cast at usage:
 * const model = new Model();
 * const execute = model.execute as AsProcedure<typeof model.execute>;
 * ```
 */
export type AsProcedure<T extends (...args: any[]) => any> = Procedure<T>;

/**
 * Helper type to transform all methods in a class to Procedures.
 *
 * **Primary Use Case**: Use with decorators when you need IntelliSense.
 *
 * ```typescript
 * class Model {
 *   @procedure()
 *   async execute(input: string): Promise<string> { ... }
 * }
 *
 * // Most of the time - runtime works perfectly, no types needed
 * const model = new Model();
 * await model.execute('test');  // ✅ Works
 *
 * // When you need IntelliSense - cast once
 * const typedModel = model as WithProcedures<Model>;
 * typedModel.execute.use(...);        // ✅ Full IntelliSense
 * typedModel.execute.withHandle();    // ✅ Full IntelliSense
 * ```
 *
 * **Alternative**: Use property initializers for full types everywhere:
 * ```typescript
 * class Model {
 *   execute = createProcedure(async (input: string) => input);
 *   // ✅ Full types always, but more verbose
 * }
 * ```
 */
export type WithProcedures<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? AsProcedure<T[K]>
    : T[K];
};

// ============================================================================
// Pipeline (Middleware Bundles)
// ============================================================================

export interface MiddlewarePipeline {
  use(...middleware: Middleware<any[]>[]): MiddlewarePipeline;
  getMiddleware(): Middleware<any[]>[];
}

export function createPipeline(
  middleware: Middleware<any[]>[] = [],
): MiddlewarePipeline {
  const middlewares: Middleware<any[]>[] = [...middleware];

  return {
    use(...mw: Middleware<any[]>[]) {
      middlewares.push(...mw);
      return this;
    },
    getMiddleware() {
      return middlewares;
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function isAsyncIterable(obj: any): obj is AsyncIterable<any> {
  return obj && typeof obj[Symbol.asyncIterator] === "function";
}

function inferNameFromMethod(target: any, propertyKey: string): string {
  return propertyKey;
}

function flattenMiddleware<TArgs extends any[]>(
  middleware: (Middleware<TArgs> | MiddlewarePipeline)[],
): Middleware<TArgs>[] {
  const flattened: Middleware<TArgs>[] = [];
  for (const mw of middleware) {
    if ("getMiddleware" in mw && typeof mw.getMiddleware === "function") {
      flattened.push(...(mw.getMiddleware() as unknown as Middleware<TArgs>[]));
    } else {
      flattened.push(mw as unknown as Middleware<TArgs>);
    }
  }
  return flattened;
}

// ============================================================================
// Procedure Class
// ============================================================================

/**
 * Procedure class - instances are callable functions with methods.
 * TOutput is inferred from the handler's return type.
 *
 * @example
 * ```typescript
 * const proc = new ProcedureImpl(
 *   { name: 'execute' },
 *   async (input: string) => input.toUpperCase()  // TOutput inferred as string
 * );
 *
 * await proc('test');  // ✅ Callable
 * proc.use(...);       // ✅ Has methods
 * ```
 */
/**
 * Internal middleware type for procedure execution.
 */
type InternalMiddleware<TArgs extends any[], TReturn> = (
  args: TArgs,
  ctx: KernelContext,
  next: (transformedArgs?: TArgs) => Promise<TReturn>,
) => Promise<TReturn>;

class ProcedureImpl<
  TArgs extends any[] = any[],
  THandler extends (...args: TArgs) => any = (...args: TArgs) => any,
> {
  private internalMiddlewares: InternalMiddleware<
    TArgs,
    ExtractReturn<THandler>
  >[] = [];
  private middlewares: Middleware<TArgs>[] = [];
  private schema?: z.ZodType<any>;
  private procedureName?: string;
  private sourceType: "procedure" | "hook" = "procedure";
  private sourceId?: string;
  private handleFactory?: HandleFactory;
  private metadata?: Record<string, any>; // For telemetry span attributes
  private handler?: THandler;
  private timeout?: number; // Timeout in milliseconds

  constructor(options: ProcedureOptions = {}, handler?: THandler) {
    this.procedureName = options.name;
    this.schema = options.schema;
    this.sourceType = options.sourceType || "procedure";
    this.sourceId = options.sourceId;
    this.handleFactory = options.handleFactory;
    this.metadata = options.metadata; // Store metadata for telemetry
    this.timeout = options.timeout; // Store timeout

    if (options.middleware) {
      this.middlewares = flattenMiddleware(
        options.middleware as unknown as (
          | Middleware<TArgs>
          | MiddlewarePipeline
        )[],
      );
    }

    // Adapt Procedure middleware to internal middleware format
    for (const mw of this.middlewares) {
      const adaptedMw: InternalMiddleware<
        TArgs,
        ExtractReturn<THandler>
      > = async (args, ctx, nextFn) => {
        const envelope: ProcedureEnvelope<TArgs> = {
          sourceType: this.sourceType,
          sourceId: this.sourceId,
          operationName: this.procedureName || "anonymous",
          args,
          context: ctx,
        };
        return mw(args, envelope, async (transformedArgs?: TArgs) => {
          return nextFn(transformedArgs);
        });
      };
      this.internalMiddlewares.push(adaptedMw);
    }

    // Set handler if provided
    if (handler) {
      this.handler = handler;
    }
  }

  /**
   * Set the handler function. Returns a new Procedure with the handler set.
   */
  setHandler<TNewHandler extends (...args: TArgs) => any>(
    fn: TNewHandler,
  ): Procedure<TNewHandler> {
    return createProcedureFromImpl<TArgs, TNewHandler>(
      {
        name: this.procedureName,
        schema: this.schema,
        middleware: this.middlewares as unknown as (
          | Middleware<any[]>
          | MiddlewarePipeline
        )[],
        handleFactory: this.handleFactory,
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        metadata: this.metadata, // Preserve metadata when setting new handler
      },
      fn,
    );
  }

  /**
   * Internal execution method - runs middleware pipeline and handler.
   */
  private async runMiddlewarePipeline(
    args: TArgs,
    context: KernelContext,
  ): Promise<ExtractReturn<THandler>> {
    if (!this.handler) {
      throw new Error(
        "Procedure handler not set. Call constructor with handler or use .setHandler() method.",
      );
    }

    // Wrap execution with ExecutionTracker
    return ExecutionTracker.track(
      context,
      {
        name:
          this.procedureName || `procedure:${this.handler.name || "anonymous"}`,
        parentPid: context.procedurePid,
        metadata: this.metadata, // Pass metadata to ExecutionTracker for span attributes
      },
      async (node: ProcedureNode) => {
        // Check Abort Signal before starting
        if (context?.signal?.aborted) {
          throw new AbortError();
        }

        // Run Middleware Pipeline
        let index = 0;
        let currentInput: TArgs = args;

        const runMiddleware = async (
          transformedInput?: TArgs,
        ): Promise<ExtractReturn<THandler>> => {
          // Check Abort Signal before each middleware/handler
          if (context?.signal?.aborted) {
            throw new AbortError();
          }

          // Update current input if middleware provided transformed input
          if (transformedInput !== undefined) {
            currentInput = transformedInput;
          }

          if (index < this.internalMiddlewares.length) {
            const middleware = this.internalMiddlewares[index++];
            const result = await middleware(
              currentInput,
              context,
              runMiddleware,
            );
            // Check Abort Signal after middleware execution (middleware might have aborted)
            if (context?.signal?.aborted) {
              throw new AbortError();
            }
            return result;
          } else {
            // Check Abort Signal before handler
            if (context?.signal?.aborted) {
              throw new AbortError();
            }

            // Call handler with current input (which may have been transformed)
            const result = this.handler!(...currentInput);
            // Handler can return anything - Promise.resolve handles Promise, value, or AsyncIterable
            return result as ExtractReturn<THandler>;
          }
        };

        return runMiddleware();
      },
    );
  }

  /**
   * Internal execution method.
   */
  async execute(
    args: TArgs,
    options?: Partial<KernelContext>,
    opEvents?: EventEmitter,
  ): Promise<ExtractReturn<THandler>> {
    if (!this.handler) {
      throw ValidationError.required(
        "handler",
        "Procedure handler not set. Call constructor with handler or use .setHandler() method.",
      );
    }

    // Validate input if schema provided
    let validatedArgs = args;
    if (this.schema && args.length > 0) {
      const validated = await this.schema.parseAsync(args[0]);
      validatedArgs = [validated, ...args.slice(1)] as TArgs;
    }

    // Resolve context: either create new root or derive child from current
    let context: KernelContext;
    const currentContext = Context.tryGet();

    if (!currentContext) {
      // No existing context - create a new root context
      context = Context.create(options);
    } else if (options || opEvents) {
      // Existing context with overrides - create a child context
      // This ensures we don't mutate the parent's context object
      context = Context.child({
        ...options,
        events: opEvents ?? options?.events ?? currentContext.events,
        channels: options?.channels ?? currentContext.channels,
      });
    } else {
      // Existing context, no overrides - reuse as-is
      context = currentContext;
    }

    // Create handle if handleFactory is provided and handle doesn't exist
    if (this.handleFactory && !context.executionHandle) {
      const events = opEvents || context.events || new EventEmitter();
      const traceId = context.traceId || randomUUID();
      const resultPromise = Promise.resolve() as Promise<any>;
      const handle = this.handleFactory(
        events,
        traceId,
        resultPromise,
        context,
      );
      context.executionHandle = handle as any as EventEmitter;
    }

    const currentStore = Context.tryGet();
    const isRoot = context !== currentStore;

    const executeInternal = async (): Promise<ExtractReturn<THandler>> => {
      let result: ExtractReturn<THandler>;
      if (isRoot) {
        result = await Context.run(context!, async () =>
          this.runMiddlewarePipeline(validatedArgs, context!),
        );
      } else {
        result = await this.runMiddlewarePipeline(validatedArgs, context!);
      }

      // If handler returned AsyncIterable, wrap it
      if (isAsyncIterable(result)) {
        const capturedContext = context!;
        const capturedIsRoot = isRoot;

        const wrappedIterable = (async function* () {
          const iterator = result[Symbol.asyncIterator]();
          try {
            let next;
            while (true) {
              // Always check capturedContext.signal first (it has the original signal reference)
              // Also check current context signal in case it was updated
              const currentCtx = capturedIsRoot
                ? Context.tryGet() || capturedContext
                : capturedContext;
              const signalToCheck =
                capturedContext?.signal || currentCtx?.signal;
              if (signalToCheck?.aborted) {
                throw new AbortError();
              }

              if (capturedIsRoot) {
                next = await Context.run(capturedContext, async () =>
                  iterator.next(),
                );
              } else {
                next = await iterator.next();
              }

              // Check abort again after iterator.next() - generator might have aborted during execution
              // Always prefer capturedContext.signal (original execution context)
              const postCheckCtx = capturedIsRoot
                ? Context.tryGet() || capturedContext
                : capturedContext;
              const postSignalToCheck =
                capturedContext?.signal || postCheckCtx?.signal;
              if (postSignalToCheck?.aborted) {
                throw new AbortError();
              }

              if (next.done) break;

              const chunkPayload = { value: next.value };
              if (capturedIsRoot) {
                await Context.run(capturedContext, async () => {
                  Context.emit("stream:chunk", chunkPayload);
                });
              } else {
                const emitCtx = Context.tryGet() || capturedContext;
                if (emitCtx === capturedContext) {
                  Context.emit("stream:chunk", chunkPayload);
                } else {
                  await Context.run(capturedContext, async () => {
                    Context.emit("stream:chunk", chunkPayload);
                  });
                }
              }

              yield next.value;
            }
          } catch (err) {
            if (capturedIsRoot) {
              await Context.run(capturedContext, async () => {
                Context.emit("procedure:error", { error: err });
              });
            } else {
              Context.emit("procedure:error", { error: err });
            }
            throw err;
          } finally {
            if (iterator.return) {
              if (capturedIsRoot) {
                await Context.run(capturedContext, async () =>
                  iterator.return!(),
                );
              } else {
                await iterator.return!();
              }
            }
            if (capturedIsRoot) {
              await Context.run(capturedContext, async () => {
                Context.emit("procedure:end", {});
              });
            } else {
              Context.emit("procedure:end", {});
            }
          }
        })();

        return wrappedIterable as ExtractReturn<THandler>;
      }

      return result as ExtractReturn<THandler>;
    };

    // Apply timeout if configured
    if (this.timeout && this.timeout > 0) {
      return this.withTimeoutRace(executeInternal(), this.timeout);
    }

    return executeInternal();
  }

  /**
   * Race execution against a timeout.
   */
  private async withTimeoutRace<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(AbortError.timeout(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Call the procedure with explicit args (no context extraction).
   *
   * @deprecated Use .run() instead.
   */
  call(...args: TArgs): Promise<ExtractReturn<THandler>> {
    return this.execute(args);
  }

  /**
   * Run the procedure with explicit args (no context extraction).
   */
  run(...args: TArgs): Promise<ExtractReturn<THandler>> {
    return this.execute(args);
  }

  /**
   * Add middleware to the procedure. Returns a new Procedure.
   */
  use(
    ...middleware: (Middleware<TArgs> | MiddlewarePipeline)[]
  ): Procedure<THandler> {
    const flattened = flattenMiddleware(
      middleware as unknown as (Middleware<TArgs> | MiddlewarePipeline)[],
    );
    return createProcedureFromImpl<TArgs, THandler>(
      {
        name: this.procedureName,
        schema: this.schema,
        middleware: [...this.middlewares, ...flattened] as unknown as (
          | Middleware<any[]>
          | MiddlewarePipeline
        )[],
        handleFactory: this.handleFactory,
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        metadata: this.metadata, // Preserve metadata when adding middleware
      },
      this.handler!,
    );
  }

  /**
   * Create a procedure variant that returns a handle. Returns a new ProcedureWithHandle.
   */
  withHandle(): ProcedureWithHandle<THandler> {
    const proc = this;
    const handleProcedure = ((...args: ExtractArgs<THandler>) => {
      const validatedArgsPromise =
        proc.schema && args.length > 0
          ? proc.schema
              .parseAsync(args[0])
              .then((validated) => [validated, ...args.slice(1)] as TArgs)
          : Promise.resolve(args);

      const events = new EventEmitter();
      const traceId = Context.tryGet()?.traceId || randomUUID();

      let context = Context.tryGet();
      if (!context) {
        context = Context.create({ traceId });
      } else {
        context = {
          ...context,
          traceId,
        };
      }

      const handle = proc.handleFactory
        ? proc.handleFactory(
            events,
            traceId,
            Promise.resolve() as Promise<any>,
            context,
          )
        : ({
            events,
            traceId,
            result: Promise.resolve(),
          } as ExecutionHandle<ExtractReturn<THandler>>);

      context.executionHandle = handle as any as EventEmitter;

      const resultPromise = validatedArgsPromise.then(
        async (validatedArgs): Promise<ExtractReturn<THandler>> => {
          const hookResult = await (context !== Context.tryGet()
            ? Context.run(context, async () =>
                proc.execute(validatedArgs, undefined, events),
              )
            : proc.execute(validatedArgs, undefined, events));
          return hookResult;
        },
      );

      // Always update handle.result to point to the actual result promise
      // This ensures handleFactory-created handles have their result set
      if (handle && typeof handle === "object") {
        (handle as any).result = resultPromise;
      }

      return { handle, result: resultPromise };
    }) as ProcedureWithHandle<THandler>;

    handleProcedure.call = handleProcedure;
    handleProcedure.run = handleProcedure;
    handleProcedure.use = proc.use.bind(proc) as any;
    handleProcedure.withContext = proc.withContext.bind(proc) as any;
    handleProcedure.withMiddleware = proc.withMiddleware.bind(proc) as any;
    handleProcedure.withTimeout = proc.withTimeout.bind(proc) as any;

    return handleProcedure;
  }

  /**
   * Create a procedure variant with merged context. Returns a new Procedure.
   *
   * IMPORTANT: This does NOT copy middleware to the new procedure. The middleware
   * runs when proc.execute() is called in the wrapped handler. Copying middleware
   * would cause double execution since execute() runs its own middleware chain.
   */
  withContext(ctx: Partial<KernelContext>): Procedure<THandler> {
    const proc = this;
    // Create a wrapper that merges context BEFORE execution
    const wrappedHandler = (async (...args: TArgs) => {
      // Get current context and merge
      // Note: Signal should come from ExecutionHandle, not Context inheritance
      // Context signal is only for external aborts (e.g., user-provided), not execution lifecycle
      const currentCtx = Context.tryGet() || Context.create();
      const mergedCtx = { ...currentCtx, ...ctx };

      // Run with merged context - this ensures middleware sees the merged context
      return Context.run(mergedCtx, async () => {
        // Call the original procedure's execute method with merged context as options
        // This ensures the merged context is used throughout execution
        return proc.execute(args, ctx);
      });
    }) as THandler;

    // Don't copy middleware here! The original proc.execute() will run its middleware.
    // Copying middleware would cause double execution.
    return createProcedureFromImpl<TArgs, THandler>(
      {
        name: this.procedureName,
        schema: this.schema,
        middleware: [], // Empty - middleware runs in proc.execute()
        handleFactory: this.handleFactory,
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        metadata: this.metadata, // Preserve metadata for telemetry
      },
      wrappedHandler,
    );
  }

  /**
   * Add a single middleware. Returns a new Procedure.
   */
  withMiddleware(
    mw: Middleware<TArgs> | MiddlewarePipeline,
  ): Procedure<THandler> {
    return this.use(mw);
  }

  /**
   * Create a procedure variant with a timeout. Returns a new Procedure.
   * Throws AbortError.timeout() if the timeout is exceeded.
   *
   * @param ms - Timeout in milliseconds
   */
  withTimeout(ms: number): Procedure<THandler> {
    return createProcedureFromImpl<TArgs, THandler>(
      {
        name: this.procedureName,
        schema: this.schema,
        middleware: this.middlewares as unknown as (
          | Middleware<any[]>
          | MiddlewarePipeline
        )[],
        handleFactory: this.handleFactory,
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        metadata: this.metadata,
        timeout: ms,
      },
      this.handler!,
    );
  }

  /**
   * Pipe the output of this procedure to another procedure.
   * Creates a new procedure that runs this procedure, then passes its result to the next.
   */
  pipe<TNext extends (arg: ExtractReturn<THandler>) => any>(
    next: Procedure<TNext>,
  ): Procedure<(...args: TArgs) => Promise<ExtractReturn<TNext>>> {
    const self = this;
    const pipedHandler = async (
      ...args: TArgs
    ): Promise<ExtractReturn<TNext>> => {
      const firstResult = await self.execute(args);
      const secondResult = await (next as any)(firstResult);
      return secondResult;
    };

    return createProcedureFromImpl<TArgs, typeof pipedHandler>(
      {
        name: this.procedureName
          ? `${this.procedureName}.pipe`
          : "piped-procedure",
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        metadata: this.metadata,
        timeout: this.timeout,
      },
      pipedHandler,
    ) as any;
  }
}

/**
 * Helper to create a callable Procedure from ProcedureImpl.
 */
function createProcedureFromImpl<
  TArgs extends any[],
  THandler extends (...args: TArgs) => any,
>(options: ProcedureOptions, handler?: THandler): Procedure<THandler> {
  const impl = new ProcedureImpl<TArgs, THandler>(options, handler);

  // Create a callable function with methods attached
  const proc = ((...args: any[]) => {
    // Support context as last arg (backward compat)
    let actualArgs: TArgs;
    let contextOptions: Partial<KernelContext> | undefined;

    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      // Check if last arg is a KernelContext
      // Must check isKernelContext() first, then check for KernelContext-specific properties
      // Don't just check for 'traceId' - ExecutionHandle also has traceId!
      // KernelContext has: requestId, traceId, metadata, metrics, events (required), signal, executionHandle, etc.
      // A more specific check: KernelContext must have 'events' (EventEmitter) and 'metadata' properties
      // TODO: consider requiring the context() function be used to pass context as last argument
      if (
        isKernelContext(lastArg) ||
        (typeof lastArg === "object" &&
          lastArg !== null &&
          !Array.isArray(lastArg) &&
          "traceId" in lastArg &&
          "events" in lastArg &&
          "metadata" in lastArg &&
          "metrics" in lastArg)
      ) {
        actualArgs = args.slice(0, -1) as TArgs;
        contextOptions = lastArg as Partial<KernelContext>;
      } else {
        actualArgs = args as TArgs;
      }
    } else {
      actualArgs = args as TArgs;
    }

    return impl.execute(actualArgs, contextOptions);
  }) as Procedure<THandler>;

  // Attach methods
  // Type assertions needed because ProcedureImpl uses TArgs internally,
  // but Procedure interface uses ExtractArgs<THandler> - they're equivalent but TS can't prove it
  proc.call = impl.call.bind(impl);
  proc.run = impl.run.bind(impl);
  proc.use = impl.use.bind(impl) as Procedure<THandler>["use"];
  proc.withHandle = impl.withHandle.bind(impl);
  proc.withContext = impl.withContext.bind(impl);
  proc.withMiddleware = impl.withMiddleware.bind(
    impl,
  ) as Procedure<THandler>["withMiddleware"];
  proc.withTimeout = impl.withTimeout.bind(impl);
  proc.pipe = impl.pipe.bind(impl) as Procedure<THandler>["pipe"];

  return proc;
}

// ============================================================================
// Public API - Functions
// ============================================================================

/**
 * Helper to create a generator procedure that captures 'this' context.
 */
type Handler<TArgs extends any[]> =
  | ((...args: TArgs) => any)
  | ((this: any, ...args: TArgs) => any);

export function generatorProcedure<
  TThis extends any,
  TArgs extends any[],
  THandler extends Handler<TArgs>,
>(
  optionsOrFn?: ProcedureOptions | THandler,
  fn?: THandler,
): Procedure<THandler> {
  let options: ProcedureOptions = {};

  if (typeof optionsOrFn === "function") {
    fn = optionsOrFn;
  } else if (optionsOrFn) {
    options = optionsOrFn;
  }

  return createProcedure(function (this: TThis, ...args: TArgs) {
    if (!fn) {
      throw ValidationError.required(
        "handler",
        "Handler function required when options are provided",
      );
    }
    return fn.apply(this, args);
  } as THandler) as Procedure<THandler>;
}

/**
 * Create a Procedure from a function (for use in class property initializers).
 *
 * @example
 * ```typescript
 * class Model {
 *   execute = createProcedure(async (input: string) => input);
 *   // Type inferred: Procedure<[string], string>
 * }
 * ```
 */
export function createProcedure<THandler extends (...args: any[]) => any>(
  handler: THandler,
): Procedure<THandler>;
export function createProcedure<THandler extends (...args: any[]) => any>(
  options: ProcedureOptions,
  handler: THandler,
): Procedure<THandler>;
export function createProcedure<THandler extends (...args: any[]) => any>(
  optionsOrFn?: ProcedureOptions | THandler,
  fn?: THandler,
): Procedure<THandler> {
  let options: ProcedureOptions = {};
  let handler: THandler | undefined;

  if (typeof optionsOrFn === "function") {
    handler = optionsOrFn;
    options = { sourceType: "procedure" };
  } else if (optionsOrFn) {
    options = { ...optionsOrFn, sourceType: "procedure" };
    if (!fn) {
      throw ValidationError.required(
        "handler",
        "Handler function required when options are provided",
      );
    }
    handler = fn;
  } else if (fn) {
    handler = fn;
    options = { sourceType: "procedure" };
  }

  if (!handler) {
    throw ValidationError.required("handler");
  }

  return createProcedureFromImpl<ExtractArgs<THandler>, THandler>(
    options,
    handler,
  ) as any;
}

/**
 * Pipe multiple procedures together, passing the output of each to the next.
 *
 * @example
 * ```typescript
 * const parse = createProcedure(async (json: string) => JSON.parse(json));
 * const validate = createProcedure(async (data: unknown) => schema.parse(data));
 * const transform = createProcedure(async (valid: Valid) => transform(valid));
 *
 * // Create a pipeline that parses, validates, then transforms
 * const pipeline = pipe(parse, validate, transform);
 * const result = await pipeline('{"name": "test"}');
 * ```
 */
export function pipe<T1 extends (...args: any[]) => any>(
  p1: Procedure<T1>,
): Procedure<T1>;
export function pipe<
  T1 extends (...args: any[]) => any,
  T2 extends (arg: ExtractReturn<T1>) => any,
>(
  p1: Procedure<T1>,
  p2: Procedure<T2>,
): Procedure<(...args: ExtractArgs<T1>) => Promise<ExtractReturn<T2>>>;
export function pipe<
  T1 extends (...args: any[]) => any,
  T2 extends (arg: ExtractReturn<T1>) => any,
  T3 extends (arg: ExtractReturn<T2>) => any,
>(
  p1: Procedure<T1>,
  p2: Procedure<T2>,
  p3: Procedure<T3>,
): Procedure<(...args: ExtractArgs<T1>) => Promise<ExtractReturn<T3>>>;
export function pipe<
  T1 extends (...args: any[]) => any,
  T2 extends (arg: ExtractReturn<T1>) => any,
  T3 extends (arg: ExtractReturn<T2>) => any,
  T4 extends (arg: ExtractReturn<T3>) => any,
>(
  p1: Procedure<T1>,
  p2: Procedure<T2>,
  p3: Procedure<T3>,
  p4: Procedure<T4>,
): Procedure<(...args: ExtractArgs<T1>) => Promise<ExtractReturn<T4>>>;
export function pipe<
  T1 extends (...args: any[]) => any,
  T2 extends (arg: ExtractReturn<T1>) => any,
  T3 extends (arg: ExtractReturn<T2>) => any,
  T4 extends (arg: ExtractReturn<T3>) => any,
  T5 extends (arg: ExtractReturn<T4>) => any,
>(
  p1: Procedure<T1>,
  p2: Procedure<T2>,
  p3: Procedure<T3>,
  p4: Procedure<T4>,
  p5: Procedure<T5>,
): Procedure<(...args: ExtractArgs<T1>) => Promise<ExtractReturn<T5>>>;
export function pipe(...procedures: Procedure<any>[]): Procedure<any> {
  if (procedures.length === 0) {
    throw new ValidationError(
      "pipe requires at least one procedure",
      "procedures",
    );
  }
  if (procedures.length === 1) {
    return procedures[0];
  }

  // Chain all procedures together using the instance pipe method
  let result = procedures[0];
  for (let i = 1; i < procedures.length; i++) {
    result = result.pipe(procedures[i]);
  }
  return result;
}

/**
 * Create a Hook Procedure from a function.
 *
 * @example
 * ```typescript
 * const processChunk = createHook(async (chunk: string) => chunk.toUpperCase());
 * // Type inferred: Procedure<[string], string>
 * ```
 */
export function createHook<THandler extends (...args: any[]) => any>(
  handler: THandler,
): Procedure<THandler>;
export function createHook<THandler extends (...args: any[]) => any>(
  options: ProcedureOptions,
  handler: THandler,
): Procedure<THandler>;
export function createHook<THandler extends (...args: any[]) => any>(
  optionsOrFn?: ProcedureOptions | THandler,
  fn?: THandler,
): Procedure<THandler> {
  let options: ProcedureOptions = {};
  let handler: THandler | undefined;

  if (typeof optionsOrFn === "function") {
    handler = optionsOrFn;
    options = { sourceType: "hook" };
  } else if (optionsOrFn) {
    options = { ...optionsOrFn, sourceType: "hook" };
    if (!fn) {
      throw ValidationError.required(
        "handler",
        "Handler function required when options are provided",
      );
    }
    handler = fn;
  } else if (fn) {
    handler = fn;
    options = { sourceType: "hook" };
  }

  if (!handler) {
    throw ValidationError.required("handler");
  }

  return createProcedure(options, handler);
}

// ============================================================================
// Static Middleware Discovery
// ============================================================================

function getStaticMiddleware(
  constructor: any,
  procedureName: string,
): (Middleware<any[]> | MiddlewarePipeline)[] {
  if (
    constructor &&
    constructor.middleware &&
    typeof constructor.middleware === "object"
  ) {
    const staticMw = constructor.middleware as StaticMiddleware;
    return staticMw[procedureName] || [];
  }
  return [];
}

// ============================================================================
// Decorators
// ============================================================================

/**
 * @procedure decorator - Transforms method into Procedure
 */
export function procedureDecorator(options?: ProcedureOptions) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> | void {
    if (!descriptor.value) {
      throw new Error(`@procedure() can only be applied to methods`);
    }

    const originalMethod = descriptor.value;
    const inferredName =
      options?.name || inferNameFromMethod(target, propertyKey);
    const className = target.constructor.name;
    const constructor = target.constructor;

    const staticMiddleware = getStaticMiddleware(constructor, inferredName);
    const allMiddleware = [...staticMiddleware, ...(options?.middleware || [])];

    const finalOptions: ProcedureOptions = {
      ...options,
      name: inferredName,
      middleware: allMiddleware.length > 0 ? allMiddleware : undefined,
      sourceType: "procedure" as const,
      sourceId: className,
    };

    const proc = createProcedure(finalOptions, originalMethod as any);
    descriptor.value = proc as unknown as T;
    return descriptor as any;
  };
}

/**
 * @hook decorator - Transforms method into Procedure (hook)
 */
export function hookDecorator(options?: ProcedureOptions) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> | void {
    if (!descriptor.value) {
      throw new Error(`@hook() can only be applied to methods`);
    }

    const originalMethod = descriptor.value;
    const inferredName =
      options?.name || inferNameFromMethod(target, propertyKey);
    const className = target.constructor.name;
    const constructor = target.constructor;

    const staticMiddleware = getStaticMiddleware(constructor, inferredName);
    const allMiddleware = [...staticMiddleware, ...(options?.middleware || [])];

    const finalOptions: ProcedureOptions = {
      ...options,
      name: inferredName,
      middleware: allMiddleware.length > 0 ? allMiddleware : undefined,
      sourceType: "hook" as const,
      sourceId: className,
    };

    const proc = createHook(finalOptions, originalMethod as any);
    descriptor.value = proc as unknown as T;
    return descriptor;
  };
}

// ============================================================================
// ProcedureBase - Base class for auto-wrapping methods as Procedures
// ============================================================================

export abstract class ProcedureBase {
  static middleware?: StaticMiddleware;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type-safe helper to apply middleware to a Procedure while preserving types.
 *
 * This helper ensures that middleware types are correctly matched to the Procedure's
 * argument types, avoiding the need for type assertions.
 *
 * @example
 * ```typescript
 * const proc = createProcedure({ name: 'test' }, async (input: string) => input);
 * const middleware: Middleware<[string]>[] = [...];
 * const procWithMw = applyMiddleware(proc, middleware);
 * // procWithMw is still Procedure<[string], string> - types preserved!
 * ```
 */
export function applyMiddleware<TArgs extends any[], TOutput>(
  procedure: Procedure<(...args: TArgs) => TOutput>,
  ...middleware: (Middleware<TArgs> | MiddlewarePipeline)[]
): Procedure<(...args: TArgs) => TOutput> {
  return procedure.use(...middleware);
}

/**
 * Type-safe helper to apply middleware from a registry/hook system.
 *
 * This is useful when middleware comes from hook registries where types might
 * be unions or `Middleware<any[]>`. The helper ensures type safety by requiring
 * the middleware to match the Procedure's argument types.
 *
 * @example
 * ```typescript
 * const proc = createProcedure({ name: 'test' }, async (input: string) => input);
 * const registryMiddleware = registry.getMiddleware('test'); // Middleware<any[]>[]
 * const procWithMw = applyRegistryMiddleware(proc, registryMiddleware);
 * // Types are preserved and validated
 * ```
 */
export function applyRegistryMiddleware<
  THandler extends (...args: any[]) => any,
>(
  procedure: Procedure<THandler>,
  ...middleware: (Middleware<any[]> | MiddlewarePipeline)[]
): Procedure<THandler> {
  // Type assertion is safe here because we're applying middleware that should
  // be compatible with the Procedure's args. The runtime will validate.
  // We accept Procedure<any, any> to handle cases where createEngineProcedure
  // returns a generic Procedure type that needs to be narrowed.
  return (procedure as Procedure<THandler>).use(
    ...(middleware as (
      | Middleware<ExtractArgs<THandler>>
      | MiddlewarePipeline
    )[]),
  );
}

export function wrapProcedure(middleware: Middleware<any[]>[]) {
  function wrapProcedureImpl<THandler extends (...args: any[]) => any>(
    handler: THandler,
  ): Procedure<THandler>;
  function wrapProcedureImpl<THandler extends (...args: any[]) => any>(
    config: ProcedureOptions,
    handler: THandler,
  ): Procedure<THandler>;
  function wrapProcedureImpl<THandler extends (...args: any[]) => any>(
    optionsOrFn?: ProcedureOptions | THandler,
    fn?: THandler,
  ): Procedure<THandler> {
    let config: ProcedureOptions;
    let handler: THandler;

    if (typeof optionsOrFn === "function") {
      // Handler-only overload: createEngineProcedure(handler)
      handler = optionsOrFn;
      config = {
        name: handler.name || "anonymous",
      };
    } else if (optionsOrFn) {
      // Config + handler overload: createEngineProcedure(config, handler)
      config = { ...optionsOrFn };
      if (!fn) {
        throw ValidationError.required(
          "handler",
          "Handler function required when options are provided",
        );
      }
      handler = fn;
    } else if (fn) {
      // Edge case: just handler as second param
      handler = fn;
      config = {
        name: handler.name || "anonymous",
      };
    } else {
      throw ValidationError.required("handler");
    }

    // Merge middleware: engine defaults + global + config middleware
    config.middleware = [...middleware, ...(config.middleware || [])];

    return createProcedure<THandler>(config, handler);
  }

  return wrapProcedureImpl;
}

export function wrapHook(middleware: Middleware<any[]>[]) {
  function wrapHookImpl<THandler extends (...args: any[]) => any>(
    handler: THandler,
  ): Procedure<THandler>;
  function wrapHookImpl<THandler extends (...args: any[]) => any>(
    config: ProcedureOptions,
    handler: THandler,
  ): Procedure<THandler>;
  function wrapHookImpl<THandler extends (...args: any[]) => any>(
    optionsOrFn?: ProcedureOptions | THandler,
    fn?: THandler,
  ): Procedure<THandler> {
    let config: ProcedureOptions;
    let handler: THandler;

    if (typeof optionsOrFn === "function") {
      // Handler-only overload: createEngineHook(handler)
      handler = optionsOrFn;
      config = {
        name: handler.name || "anonymous",
      };
    } else if (optionsOrFn) {
      // Config + handler overload: createEngineHook(config, handler)
      config = { ...optionsOrFn };
      if (!fn) {
        throw ValidationError.required(
          "handler",
          "Handler function required when options are provided",
        );
      }
      handler = fn;
    } else if (fn) {
      // Edge case: just handler as second param
      handler = fn;
      config = {
        name: handler.name || "anonymous",
      };
    } else {
      throw ValidationError.required("handler");
    }

    // Merge middleware: engine defaults + global + config middleware
    config.middleware = [...middleware, ...(config.middleware || [])];

    return createHook<THandler>(config, handler);
  }

  return wrapHookImpl;
}

// ============================================================================
// Exports
// ============================================================================

export { procedureDecorator as procedure };
export { hookDecorator as hook };
