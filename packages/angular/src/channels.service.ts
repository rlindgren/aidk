/**
 * Angular Service for Channel Subscriptions
 * 
 * Provides RxJS-based channel subscription management with:
 * - Observable-based event streams
 * - Automatic cleanup
 * - Type-safe event handling
 */

import { Injectable, type OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil, share } from 'rxjs/operators';
import { EngineService } from './engine.service';
import type { ChannelEvent } from 'aidk-client';

@Injectable()
export class ChannelsService implements OnDestroy {
  private destroy$ = new Subject<void>();
  private channelStreams = new Map<string, Observable<ChannelEvent>>();

  constructor(private engineService: EngineService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.channelStreams.clear();
  }

  /**
   * Subscribe to channel events.
   * Returns a shared Observable that multicasts to all subscribers.
   */
  subscribe(channels: string | string[]): Observable<ChannelEvent> {
    const key = Array.isArray(channels) ? channels.sort().join(',') : channels;
    
    // Return cached stream if exists
    if (this.channelStreams.has(key)) {
      return this.channelStreams.get(key)!;
    }

    // Create new shared stream
    const stream$ = this.engineService.subscribeToChannel(channels).pipe(
      share(),
      takeUntil(this.destroy$)
    );

    this.channelStreams.set(key, stream$);
    return stream$;
  }

  /**
   * Publish an event to a channel
   * Returns Observable of server response (may include updated state)
   */
  publish<T = unknown>(channel: string, type: string, payload?: unknown): Observable<T> {
    return this.engineService.publish<T>(channel, type, payload);
  }

  /**
   * Subscribe to a specific event type on a channel
   */
  on<T = unknown>(channel: string, eventType: string): Observable<T> {
    return new Observable<T>((subscriber) => {
      const subscription = this.subscribe(channel).subscribe((event) => {
        if (event.type === eventType) {
          subscriber.next(event.payload as T);
        }
      });

      return () => subscription.unsubscribe();
    }).pipe(takeUntil(this.destroy$));
  }
}
