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
import { ProcedureNode } from "./procedure-graph";
import { AbortError, ValidationError } from "aidk-shared";

// ============================================================================
// Types
// ============================================================================

/**
 * Middleware function that can intercept and transform procedure execution.
 *
 * Middleware can:
 * - Transform input arguments before passing to the next middleware/handler
 * - Modify the result after `next()` returns
 * - Short-circuit execution by not calling `next()`
 * - Handle or transform errors
 *
 * @typeParam TArgs - The argument types of the procedure
 *
 * @example
 * ```typescript
 * const loggingMiddleware: Middleware<[string]> = async (args, envelope, next) => {
 *   console.log(`${envelope.operationName} called with:`, args);
 *   const start = Date.now();
 *   try {
 *     const result = await next();
 *     console.log(`Completed in ${Date.now() - start}ms`);
 *     return result;
 *   } catch (error) {
 *     console.error(`Failed:`, error);
 *     throw error;
 *   }
 * };
 * ```
 *
 * @example Transform arguments
 * ```typescript
 * const upperMiddleware: Middleware<[string]> = async (args, envelope, next) => {
 *   return next([args[0].toUpperCase()]);
 * };
 * ```
 *
 * @see {@link ProcedureEnvelope} - The envelope containing execution metadata
 * @see {@link createPipeline} - Bundle multiple middleware for reuse
 */
export type Middleware<TArgs extends any[] = any[]> = (
  args: TArgs,
  envelope: ProcedureEnvelope<TArgs>,
  next: (transformedArgs?: TArgs) => Promise<any>,
) => Promise<any>;

/**
 * Metadata envelope passed to middleware containing execution context.
 *
 * @typeParam TArgs - The argument types of the procedure
 *
 * @example
 * ```typescript
 * const middleware: Middleware<[string]> = async (args, envelope, next) => {
 *   if (envelope.sourceType === 'hook') {
 *     console.log(`Hook ${envelope.operationName} from ${envelope.sourceId}`);
 *   }
 *   return next();
 * };
 * ```
 */
export interface ProcedureEnvelope<TArgs extends any[]> {
  /** Whether this is a regular procedure or a hook */
  sourceType: "procedure" | "hook";
  /** Identifier of the source (e.g., class name for decorated methods) */
  sourceId?: string;
  /** Name of the operation being executed */
  operationName: string;
  /** The arguments passed to the procedure */
  args: TArgs;
  /** The current kernel context */
  context: KernelContext;
}

/**
 * Handle for monitoring and controlling a running procedure execution.
 *
 * Obtained by calling `.withHandle()` on a procedure. Useful for:
 * - Subscribing to execution events (progress, errors, completion)
 * - Correlating execution via trace ID
 * - Cancelling long-running operations
 *
 * @typeParam TOutput - The return type of the procedure
 *
 * @example
 * ```typescript
 * const { handle, result } = myProc.withHandle()('input');
 *
 * // Subscribe to events
 * handle.events.on('stream:chunk', (e) => console.log('Progress:', e));
 *
 * // Check status
 * console.log('Status:', handle.getStatus?.());
 *
 * // Wait for completion
 * const output = await result;
 * ```
 *
 * @see {@link HandleFactory} - Custom handle factory function type
 */
export interface ExecutionHandle<TOutput> {
  /** Promise that resolves with the procedure result */
  result: Promise<TOutput>;
  /** EventEmitter for subscribing to execution events */
  events: EventEmitter;
  /** Trace ID for distributed tracing correlation */
  traceId: string;
  /** Cancel the execution (if supported) */
  cancel?(): void;
  /** Get current execution status */
  getStatus?(): "running" | "completed" | "failed" | "cancelled";
}

/**
 * Factory function for creating custom execution handles.
 *
 * Use this to provide custom handle implementations with additional
 * functionality like cancellation, status tracking, or specialized events.
 *
 * @typeParam THandle - The custom handle type (must extend ExecutionHandle)
 * @typeParam TContext - The context type (must extend KernelContext)
 *
 * @example
 * ```typescript
 * const customHandleFactory: HandleFactory = (events, traceId, result, context) => ({
 *   events,
 *   traceId,
 *   result,
 *   status: 'running' as const,
 *   cancel() {
 *     // Custom cancellation logic
 *   },
 *   getStatus() {
 *     return this.status;
 *   }
 * });
 *
 * const proc = createProcedure(
 *   { handleFactory: customHandleFactory },
 *   async (input) => input
 * );
 * ```
 *
 * @see {@link ExecutionHandle} - The base handle interface
 */
export type HandleFactory<
  THandle extends ExecutionHandle<any> = ExecutionHandle<any>,
  TContext extends KernelContext = KernelContext,
> = (events: EventEmitter, traceId: string, result: Promise<any>, context: TContext) => THandle;

/**
 * Configuration options for creating a procedure.
 *
 * @example
 * ```typescript
 * const proc = createProcedure({
 *   name: 'myProcedure',
 *   schema: z.object({ input: z.string() }),
 *   middleware: [loggingMiddleware],
 *   timeout: 5000,
 * }, async ({ input }) => input.toUpperCase());
 * ```
 *
 * @see {@link createProcedure} - Create a procedure with these options
 */
export interface ProcedureOptions {
  /** Name of the procedure (used in telemetry and logging) */
  name?: string;
  /** Middleware pipeline to apply to this procedure */
  middleware?: (Middleware<any[]> | MiddlewarePipeline)[];
  /** Custom factory for creating execution handles */
  handleFactory?: HandleFactory;
  /** Zod schema for input validation */
  schema?: z.ZodType<any>;
  /** Parent procedure name (for hooks) */
  parentProcedure?: string;
  /** @internal Whether this is a procedure or hook */
  sourceType?: "procedure" | "hook";
  /** @internal Source identifier (e.g., class name) */
  sourceId?: string;
  /** Metadata for telemetry span attributes (e.g., { type: 'tool', id: 'myTool' }) */
  metadata?: Record<string, any>;
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

/**
 * A callable function wrapper with middleware, validation, and execution control.
 *
 * Procedures are the core execution primitive in AIDK. They wrap any async function
 * and provide:
 * - **Middleware pipeline** - Transform args, intercept results, handle errors
 * - **Schema validation** - Zod-based input validation
 * - **Execution handles** - Events and cancellation for long-running operations
 * - **Automatic tracking** - Every call is tracked in the procedure graph
 * - **Composition** - Chain procedures with `.pipe()`
 *
 * @typeParam THandler - The function type being wrapped
 *
 * @example Direct call
 * ```typescript
 * const greet = createProcedure(async (name: string) => `Hello, ${name}!`);
 * const result = await greet('World'); // 'Hello, World!'
 * ```
 *
 * @example With middleware
 * ```typescript
 * const proc = createProcedure(async (x: number) => x * 2)
 *   .use(loggingMiddleware)
 *   .use(timingMiddleware);
 * ```
 *
 * @example With execution handle
 * ```typescript
 * const { handle, result } = proc.withHandle()(input);
 * handle.events.on('stream:chunk', console.log);
 * const output = await result;
 * ```
 *
 * @see {@link createProcedure} - Create a new procedure
 * @see {@link Middleware} - Middleware function type
 * @see {@link ExecutionHandle} - Handle for execution control
 */
export interface Procedure<THandler extends (...args: any[]) => any> {
  /**
   * Call the procedure directly.
   * For streams, returns `Promise<AsyncIterable<ChunkType>>`.
   */
  (...args: ExtractArgs<THandler>): Promise<ExtractReturn<THandler>>;

  /**
   * Call the procedure (alias for direct call).
   * @deprecated Use `.run()` or direct call instead.
   */
  call(...args: ExtractArgs<THandler>): Promise<ExtractReturn<THandler>>;

  /**
   * Run the procedure with explicit arguments.
   * Equivalent to direct call.
   */
  run(...args: ExtractArgs<THandler>): Promise<ExtractReturn<THandler>>;

  /**
   * Add middleware to the procedure. Returns a new Procedure (immutable).
   * @param middleware - Middleware functions or pipelines to add
   */
  use(
    ...middleware: (Middleware<ExtractArgs<THandler>> | MiddlewarePipeline)[]
  ): Procedure<THandler>;

  /**
   * Get a procedure variant that returns an execution handle.
   * Useful for subscribing to events and tracking long-running operations.
   */
  withHandle(): ProcedureWithHandle<THandler>;

  /**
   * Create a procedure variant with merged context. Returns a new Procedure.
   * @param ctx - Partial context to merge with the current context
   */
  withContext(ctx: Partial<KernelContext>): Procedure<THandler>;

  /**
   * Add a single middleware. Returns a new Procedure.
   * Convenience method equivalent to `.use(mw)`.
   */
  withMiddleware(mw: Middleware<ExtractArgs<THandler>> | MiddlewarePipeline): Procedure<THandler>;

  /**
   * Create a procedure variant with a timeout. Returns a new Procedure.
   * Throws `AbortError.timeout()` if the timeout is exceeded.
   * @param ms - Timeout in milliseconds
   */
  withTimeout(ms: number): Procedure<THandler>;

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
  ): Procedure<(...args: ExtractArgs<THandler>) => Promise<ExtractReturn<TNext>>>;
}

/**
 * A procedure variant that returns an execution handle along with the result.
 *
 * Obtained by calling `.withHandle()` on a Procedure. Useful for:
 * - Subscribing to execution events (progress, errors, completion)
 * - Correlating execution via trace ID
 * - Cancelling long-running operations
 *
 * @typeParam THandler - The function type being wrapped
 *
 * @example
 * ```typescript
 * const proc = createProcedure(async function* (count: number) {
 *   for (let i = 0; i < count; i++) {
 *     yield { progress: i / count };
 *   }
 * });
 *
 * const { handle, result } = proc.withHandle()(10);
 * handle.events.on('stream:chunk', (e) => console.log('Progress:', e.payload));
 * const final = await result;
 * ```
 *
 * @see {@link Procedure.withHandle} - Create a ProcedureWithHandle
 * @see {@link ExecutionHandle} - The handle interface
 */
export type ProcedureWithHandle<THandler extends (...args: any[]) => any> = {
  /** Call the procedure, returning both handle and result promise */
  (...args: ExtractArgs<THandler>): {
    handle: ExecutionHandle<ExtractReturn<THandler>>;
    result: Promise<ExtractReturn<THandler>>;
  };
  /** @deprecated Use direct call or `.run()` instead */
  call(...args: ExtractArgs<THandler>): {
    handle: ExecutionHandle<ExtractReturn<THandler>>;
    result: Promise<ExtractReturn<THandler>>;
  };
  /** Run the procedure, returning both handle and result promise */
  run(...args: ExtractArgs<THandler>): {
    handle: ExecutionHandle<ExtractReturn<THandler>>;
    result: Promise<ExtractReturn<THandler>>;
  };
  /** Add middleware. Returns a new ProcedureWithHandle. */
  use(
    ...middleware: (Middleware<ExtractArgs<THandler>> | MiddlewarePipeline)[]
  ): ProcedureWithHandle<THandler>;
  /** Create variant with merged context. Returns a new ProcedureWithHandle. */
  withContext(ctx: Partial<KernelContext>): ProcedureWithHandle<THandler>;
  /** Add single middleware. Returns a new ProcedureWithHandle. */
  withMiddleware(
    mw: Middleware<ExtractArgs<THandler>> | MiddlewarePipeline,
  ): ProcedureWithHandle<THandler>;
  /** Create variant with timeout. Returns a new ProcedureWithHandle. */
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
  (this: infer _This, ...args: infer Args): any;
}
  ? Args
  : T extends {
        (...args: infer Args): any;
      }
    ? Args
    : T extends {
          (this: infer _This, ...args: infer Args): Generator<infer _Y, infer _R, infer _N>;
        }
      ? Args
      : T extends {
            (...args: infer Args): Generator<infer _Y, infer _R, infer _N>;
          }
        ? Args
        : T extends {
              (
                this: infer _This,
                ...args: infer Args
              ): AsyncGenerator<infer _Y, infer _R, infer _N>;
            }
          ? Args
          : T extends {
                (...args: infer Args): AsyncGenerator<infer _Y, infer _R, infer _N>;
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
  [K in keyof T]: T[K] extends (...args: any[]) => any ? AsProcedure<T[K]> : T[K];
};

// ============================================================================
// Pipeline (Middleware Bundles)
// ============================================================================

/**
 * A reusable bundle of middleware that can be applied to procedures.
 *
 * Pipelines allow you to define common middleware combinations once
 * and reuse them across multiple procedures.
 *
 * @example
 * ```typescript
 * const commonPipeline = createPipeline()
 *   .use(loggingMiddleware)
 *   .use(timingMiddleware)
 *   .use(errorHandlingMiddleware);
 *
 * const proc1 = createProcedure(handler1).use(commonPipeline);
 * const proc2 = createProcedure(handler2).use(commonPipeline);
 * ```
 *
 * @see {@link createPipeline} - Create a new middleware pipeline
 * @see {@link Middleware} - Individual middleware function type
 */
export interface MiddlewarePipeline {
  /** Add middleware to this pipeline. Returns the pipeline for chaining. */
  use(...middleware: Middleware<any[]>[]): MiddlewarePipeline;
  /** Get all middleware in this pipeline. */
  getMiddleware(): Middleware<any[]>[];
}

/**
 * Create a reusable middleware pipeline.
 *
 * Pipelines bundle multiple middleware together for reuse across procedures.
 * They can be passed to `procedure.use()` just like individual middleware.
 *
 * @param middleware - Initial middleware to include in the pipeline
 * @returns A new MiddlewarePipeline
 *
 * @example
 * ```typescript
 * // Create a pipeline with initial middleware
 * const authPipeline = createPipeline([authMiddleware, rateLimitMiddleware]);
 *
 * // Or build it up with .use()
 * const logPipeline = createPipeline()
 *   .use(requestLogging)
 *   .use(responseLogging);
 *
 * // Apply to procedures
 * const proc = createProcedure(handler)
 *   .use(authPipeline)
 *   .use(logPipeline);
 * ```
 *
 * @see {@link MiddlewarePipeline} - The pipeline interface
 */
export function createPipeline(middleware: Middleware<any[]>[] = []): MiddlewarePipeline {
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
  private internalMiddlewares: InternalMiddleware<TArgs, ExtractReturn<THandler>>[] = [];
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
        options.middleware as unknown as (Middleware<TArgs> | MiddlewarePipeline)[],
      );
    }

    // Adapt Procedure middleware to internal middleware format
    for (const mw of this.middlewares) {
      const adaptedMw: InternalMiddleware<TArgs, ExtractReturn<THandler>> = async (
        args,
        ctx,
        nextFn,
      ) => {
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
  setHandler<TNewHandler extends (...args: TArgs) => any>(fn: TNewHandler): Procedure<TNewHandler> {
    return createProcedureFromImpl<TArgs, TNewHandler>(
      {
        name: this.procedureName,
        schema: this.schema,
        middleware: this.middlewares as unknown as (Middleware<any[]> | MiddlewarePipeline)[],
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
        name: this.procedureName || `procedure:${this.handler.name || "anonymous"}`,
        parentPid: context.procedurePid,
        metadata: this.metadata, // Pass metadata to ExecutionTracker for span attributes
      },
      async (_node: ProcedureNode) => {
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
            const result = await middleware(currentInput, context, runMiddleware);
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
      const handle = this.handleFactory(events, traceId, resultPromise, context);
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
              const signalToCheck = capturedContext?.signal || currentCtx?.signal;
              if (signalToCheck?.aborted) {
                throw new AbortError();
              }

              if (capturedIsRoot) {
                next = await Context.run(capturedContext, async () => iterator.next());
              } else {
                next = await iterator.next();
              }

              // Check abort again after iterator.next() - generator might have aborted during execution
              // Always prefer capturedContext.signal (original execution context)
              const postCheckCtx = capturedIsRoot
                ? Context.tryGet() || capturedContext
                : capturedContext;
              const postSignalToCheck = capturedContext?.signal || postCheckCtx?.signal;
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
                await Context.run(capturedContext, async () => iterator.return!());
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
  private async withTimeoutRace<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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
  use(...middleware: (Middleware<TArgs> | MiddlewarePipeline)[]): Procedure<THandler> {
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
        ? proc.handleFactory(events, traceId, Promise.resolve() as Promise<any>, context)
        : ({
            events,
            traceId,
            result: Promise.resolve(),
          } as ExecutionHandle<ExtractReturn<THandler>>);

      context.executionHandle = handle as any as EventEmitter;

      const resultPromise = validatedArgsPromise.then(
        async (validatedArgs): Promise<ExtractReturn<THandler>> => {
          const hookResult = await (context !== Context.tryGet()
            ? Context.run(context, async () => proc.execute(validatedArgs, undefined, events))
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
  withMiddleware(mw: Middleware<TArgs> | MiddlewarePipeline): Procedure<THandler> {
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
        middleware: this.middlewares as unknown as (Middleware<any[]> | MiddlewarePipeline)[],
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
    const pipedHandler = async (...args: TArgs): Promise<ExtractReturn<TNext>> => {
      const firstResult = await self.execute(args);
      const secondResult = await (next as any)(firstResult);
      return secondResult;
    };

    return createProcedureFromImpl<TArgs, typeof pipedHandler>(
      {
        name: this.procedureName ? `${this.procedureName}.pipe` : "piped-procedure",
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
function createProcedureFromImpl<TArgs extends any[], THandler extends (...args: TArgs) => any>(
  options: ProcedureOptions,
  handler?: THandler,
): Procedure<THandler> {
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
  proc.withMiddleware = impl.withMiddleware.bind(impl) as Procedure<THandler>["withMiddleware"];
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

export function generatorProcedure<TThis, TArgs extends any[], THandler extends Handler<TArgs>>(
  optionsOrFn?: ProcedureOptions | THandler,
  fn?: THandler,
): Procedure<THandler> {
  if (typeof optionsOrFn === "function") {
    fn = optionsOrFn;
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

  return createProcedureFromImpl<ExtractArgs<THandler>, THandler>(options, handler) as any;
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
export function pipe<T1 extends (...args: any[]) => any>(p1: Procedure<T1>): Procedure<T1>;
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
    throw new ValidationError("pipe requires at least one procedure", "procedures");
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
  if (constructor && constructor.middleware && typeof constructor.middleware === "object") {
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
    const inferredName = options?.name || inferNameFromMethod(target, propertyKey);
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
    const inferredName = options?.name || inferNameFromMethod(target, propertyKey);
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
export function applyRegistryMiddleware<THandler extends (...args: any[]) => any>(
  procedure: Procedure<THandler>,
  ...middleware: (Middleware<any[]> | MiddlewarePipeline)[]
): Procedure<THandler> {
  // Type assertion is safe here because we're applying middleware that should
  // be compatible with the Procedure's args. The runtime will validate.
  // We accept Procedure<any, any> to handle cases where createEngineProcedure
  // returns a generic Procedure type that needs to be narrowed.
  return (procedure as Procedure<THandler>).use(
    ...(middleware as (Middleware<ExtractArgs<THandler>> | MiddlewarePipeline)[]),
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
