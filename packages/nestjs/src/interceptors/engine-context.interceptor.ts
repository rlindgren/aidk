import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Inject,
} from "@nestjs/common";
import { Observable } from "rxjs";
import type { Engine } from "aidk";
import { ENGINE_TOKEN } from "../tokens";
import { Context } from "aidk";
import { defaultContextExtractor, attachContext, type RequestContext } from "aidk-server";

/**
 * Interceptor that sets up execution context for engine operations.
 * Extracts user/tenant/thread IDs from request and sets them in async-local storage.
 *
 * The context is available during:
 * 1. Controller method execution (synchronous)
 * 2. Engine.stream()/execute() calls (they capture and propagate context internally)
 *
 * Context is also attached to the request object via `attachContext()` from aidk-server,
 * making it accessible in guards, decorators, and other middleware via `getContext(request)`.
 *
 * Note: If you need context in custom RxJS operators or async callbacks outside
 * the Engine, use Context.run() explicitly.
 */
@Injectable()
export class EngineContextInterceptor implements NestInterceptor {
  constructor(@Inject(ENGINE_TOKEN) private engine: Engine) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const body = request.body || {};
    const headers = request.headers || {};

    // Extract context using server package's extractor
    const requestContext: RequestContext = defaultContextExtractor(body, {
      "x-thread-id": headers["x-thread-id"] || headers["thread-id"],
      "x-session-id": headers["x-session-id"] || headers["session-id"],
      "x-user-id": headers["x-user-id"] || headers["user-id"],
      "x-tenant-id": headers["x-tenant-id"] || headers["tenant-id"],
    });

    // Attach to request for access in guards/decorators
    attachContext(request, requestContext);

    // Create kernel context with request metadata
    const kernelContext = Context.create({
      metadata: {
        threadId: requestContext.threadId,
        userId: requestContext.userId,
        tenantId: requestContext.tenantId,
        sessionId: requestContext.sessionId,
        ...requestContext.metadata,
      },
    });

    return new Observable((subscriber) => {
      // Run the entire handler execution within the kernel context
      // This ensures Context.get() works during controller method execution
      Context.run(kernelContext, async () => {
        try {
          // next.handle() returns the Observable from the controller
          // We subscribe within Context.run so the initial call has context
          const source$ = next.handle();

          // Subscribe and forward emissions
          // Note: Async emissions (from databases, HTTP, etc.) may run outside
          // this Context.run scope. The Engine handles this internally by
          // capturing context at call time. For custom async code, use
          // Context.run() explicitly.
          const subscription = source$.subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });

          // Return cleanup function
          return () => subscription.unsubscribe();
        } catch (err) {
          subscriber.error(err);
        }
      });
    });
  }
}
