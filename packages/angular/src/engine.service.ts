/**
 * Angular Service for Engine Client
 * 
 * Provides RxJS-based wrapper around the Engine Client with:
 * - Observable-based streaming
 * - Automatic cleanup on destroy
 * - Zone.js integration for change detection
 */

import { Injectable, type OnDestroy, NgZone, InjectionToken, Inject } from '@angular/core';
import { Observable, Subject, from, defer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  EngineClient,
  createEngineClient,
  type EngineClientConfig,
  type EngineInput,
  type EngineStreamEvent,
  type ExecutionResult,
  type ChannelEvent,
} from 'aidk-client';

/** Injection token for Engine client configuration */
export const ENGINE_CONFIG = new InjectionToken<EngineClientConfig>('ENGINE_CONFIG');

@Injectable()
export class EngineService implements OnDestroy {
  private client: EngineClient;
  private destroy$ = new Subject<void>();
  
  /** Current session ID */
  readonly sessionId: string;
  
  /** Current user ID */
  get userId(): string | undefined {
    return this.client.getUserId();
  }

  constructor(
    private readonly ngZone: NgZone,
    @Inject(ENGINE_CONFIG) private readonly config: EngineClientConfig
  ) {
    // Initialize with empty config - can be updated later
    this.client = createEngineClient(this.config);
    this.sessionId = this.client.getSessionId();
  }

  private runInZone<T>(fn: () => T): T {
    if (this.ngZone) {
      return this.ngZone.run(fn);
    }
    return fn();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.client.dispose();
  }

  /**
   * Update client configuration (e.g., after user login)
   */
  updateConfig(updates: Partial<EngineClientConfig>): void {
    this.client.updateConfig(updates);
  }

  /**
   * Get the underlying client (for advanced use cases)
   */
  getClient(): EngineClient {
    return this.client;
  }

  /**
   * Execute an agent (non-streaming)
   */
  execute(agentId: string, input: EngineInput): Observable<ExecutionResult> {
    return defer(() => from(this.client.execute(agentId, input))).pipe(
      takeUntil(this.destroy$)
    );
  }

  /**
   * Stream agent execution as Observable
   */
  stream(agentId: string, input: EngineInput): Observable<EngineStreamEvent> {
    return new Observable<EngineStreamEvent>((subscriber) => {
      const run = async () => {
        try {
          for await (const event of this.client.stream(agentId, input)) {
            this.runInZone(() => {
              subscriber.next(event);
            });
          }
          this.runInZone(() => {
            subscriber.complete();
          });
        } catch (error) {
          this.runInZone(() => {
            subscriber.error(error);
          });
        }
      };

      run();

      return () => {
        // Cleanup on unsubscribe
      };
    }).pipe(takeUntil(this.destroy$));
  }

  /**
   * Subscribe to channel events
   */
  subscribeToChannel(channels: string | string[]): Observable<ChannelEvent> {
    return new Observable<ChannelEvent>((subscriber) => {
      const unsubscribe = this.client.subscribe(channels, (event) => {
        this.runInZone(() => {
          subscriber.next(event);
        });
      });

      return unsubscribe;
    }).pipe(takeUntil(this.destroy$));
  }

  /**
   * Publish an event to a channel
   * Returns Observable of server response (may include updated state)
   */
  publish<T = unknown>(channel: string, type: string, payload?: unknown): Observable<T> {
    return defer(() => 
      from(this.client.publish<T>(channel, type, payload, { excludeSender: true }))
    ).pipe(takeUntil(this.destroy$));
  }

  /**
   * Get execution history
   */
  getExecutions(params?: {
    thread_id?: string;
    user_id?: string;
    tenant_id?: string;
    limit?: number;
    offset?: number;
  }): Observable<unknown[]> {
    return defer(() => from(this.client.getExecutions(params))).pipe(
      takeUntil(this.destroy$)
    );
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): Observable<unknown> {
    return defer(() => from(this.client.getExecution(executionId))).pipe(
      takeUntil(this.destroy$)
    );
  }
}
