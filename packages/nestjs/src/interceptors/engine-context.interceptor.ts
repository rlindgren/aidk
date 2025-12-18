import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Engine } from 'aidk';
import { ENGINE_TOKEN } from '../tokens';
import { Context } from 'aidk';

/**
 * Interceptor that sets up execution context for engine operations.
 * Extracts user/tenant/thread IDs from request and sets them in async-local storage.
 * 
 * Note: This interceptor sets up the context, but async operations within handlers
 * should use Context.run() to ensure context propagation.
 */
@Injectable()
export class EngineContextInterceptor implements NestInterceptor {
  constructor(@Inject(ENGINE_TOKEN) private engine: Engine) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const body = request.body || {};
    const headers = request.headers || {};

    // Extract context from request
    const threadId = body.thread_id || headers['x-thread-id'] || headers['thread-id'];
    const userId = body.user_id || headers['x-user-id'] || headers['user-id'];
    const tenantId = body.tenant_id || headers['x-tenant-id'] || headers['tenant-id'];
    const sessionId = body.session_id || headers['x-session-id'] || headers['session-id'];

    // Create context
    const kernelContext = Context.create({
      metadata: {
        thread_id: threadId,
        user_id: userId,
        tenant_id: tenantId,
        session_id: sessionId,
      },
    });

    // Wrap the Observable chain to run within the context
    return new Observable((subscriber) => {
      Context.run(kernelContext, async () => {
        try {
          const source$ = next.handle();
          source$.subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
        } catch (err) {
          subscriber.error(err);
        }
      });
    });
  }
}

