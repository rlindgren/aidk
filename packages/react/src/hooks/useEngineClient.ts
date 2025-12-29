/**
 * React hook for Engine Client
 * 
 * Provides a React-friendly wrapper around the Engine Client with:
 * - Automatic cleanup on unmount
 * - Stable client reference (survives StrictMode)
 * - Configuration updates
 * 
 * Supports custom transports and channel clients via config:
 * @example
 * ```tsx
 * import { SSETransport } from '../client/core';
 * 
 * const transport = new SSETransport({ ... });
 * const { client } = useEngineClient({
 *   transport,  // Use custom transport
 *   baseUrl: '...',
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EngineClient, createEngineClient, type EngineClientConfig } from 'aidk-client';

export interface UseEngineClientOptions extends EngineClientConfig {
  /** Skip automatic channel connection (for manual control) */
  skipAutoConnect?: boolean;
}

export interface UseEngineClientReturn {
  /** The engine client instance */
  client: EngineClient;
  /** Current session ID */
  sessionId: string;
  /** Whether channels are connected */
  isConnected: boolean;
  /** Update client configuration (e.g., after user login) */
  updateConfig: (updates: Partial<EngineClientConfig>) => void;
}

// =============================================================================
// Module-level client cache to survive React StrictMode remounts
// =============================================================================

interface CachedClient {
  client: EngineClient;
  refCount: number;
  sessionId: string;
}

// Cache by a stable key (we'll use baseUrl + provided sessionId, or generate one)
const clientCache = new Map<string, CachedClient>();

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get a stable cache key for the client.
 * We use baseUrl as the primary key since that typically identifies the backend.
 * If sessionId is explicitly provided, include it to allow multiple sessions.
 */
function getClientCacheKey(options: UseEngineClientOptions): string {
  const base = options.baseUrl || 'default';
  // Only include sessionId in key if explicitly provided (not auto-generated)
  const session = options.sessionId || '';
  return `${base}:${session}`;
}

/**
 * Hook to get an Engine Client instance
 * 
 * @example
 * ```tsx
 * function App() {
 *   const { client, sessionId } = useEngineClient({
 *     baseUrl: 'http://localhost:3001',
 *     userId: user?.id,
 *   });
 *   
 *   // Use client for execution
 *   const handleSubmit = async (message: string) => {
 *     for await (const event of client.stream('task-assistant', { messages: [...] })) {
 *       // Handle events
 *     }
 *   };
 * }
 * ```
 */
export function useEngineClient(options: UseEngineClientOptions = {}): UseEngineClientReturn {
  // TODO: Wire up isConnected to transport state
  const [isConnected] = useState(false);

  // Generate a stable cache key
  const cacheKey = useMemo(() => getClientCacheKey(options), [options]);
  
  // Get or create client from cache
  // This runs during render to ensure client is available immediately
  let cached = clientCache.get(cacheKey);
  
  if (!cached) {
    console.log('[useEngineClient] Creating new client instance');
    const sessionId = options.sessionId || generateUUID();
    const client = createEngineClient({
      baseUrl: options.baseUrl,
      sessionId,
      userId: options.userId,
      tenantId: options.tenantId,
      threadId: options.threadId,
      metadata: options.metadata,
      routes: options.routes,
      transport: options.transport,
      channels: options.channels,
      api: options.api,
      reconnectDelay: options.reconnectDelay,
      maxReconnectDelay: options.maxReconnectDelay,
      maxReconnectAttempts: options.maxReconnectAttempts,
      callbacks: options.callbacks,
    });
    
    cached = { client, refCount: 0, sessionId };
    clientCache.set(cacheKey, cached);
  } else {
    console.log('[useEngineClient] Reusing cached client instance');
  }
  
  const client = cached.client;
  const sessionId = cached.sessionId;
  
  // Increment ref count on mount, decrement on unmount
  useEffect(() => {
    const entry = clientCache.get(cacheKey);
    if (entry) {
      entry.refCount++;
      console.log(`[useEngineClient] Ref count for ${cacheKey}: ${entry.refCount}`);
    }
    
    return () => {
      const entry = clientCache.get(cacheKey);
      if (entry) {
        entry.refCount--;
        console.log(`[useEngineClient] Ref count for ${cacheKey}: ${entry.refCount}`);
        
        // Only dispose when truly no longer needed
        // Use setTimeout to handle StrictMode's rapid mount/unmount
        if (entry.refCount <= 0) {
          setTimeout(() => {
            const currentEntry = clientCache.get(cacheKey);
            if (currentEntry && currentEntry.refCount <= 0) {
              console.log(`[useEngineClient] Disposing client for ${cacheKey}`);
              currentEntry.client.dispose();
              clientCache.delete(cacheKey);
            }
          }, 100); // Small delay to survive StrictMode
        }
      }
    };
  }, [cacheKey]);

  // Update config when identity-related options change
  // Only update values that can change without recreating the client
  const prevOptionsRef = useRef<{
    userId?: string;
    tenantId?: string;
    threadId?: string;
  }>({});
  
  useEffect(() => {
    const prev = prevOptionsRef.current;
    const updates: Partial<EngineClientConfig> = {};
    let hasChanges = false;
    
    // Only include changed values to avoid unnecessary reconnects
    if (options.userId !== prev.userId) {
      updates.userId = options.userId;
      hasChanges = true;
    }
    if (options.tenantId !== prev.tenantId) {
      updates.tenantId = options.tenantId;
      hasChanges = true;
    }
    if (options.threadId !== prev.threadId) {
      updates.threadId = options.threadId;
      hasChanges = true;
    }
    
    if (hasChanges) {
      client.updateConfig(updates);
    }
    
    // Update prev ref
    prevOptionsRef.current = {
      userId: options.userId,
      tenantId: options.tenantId,
      threadId: options.threadId,
    };
  }, [client, options.userId, options.tenantId, options.threadId]);

  // Update config callback
  const updateConfig = useCallback(
    (updates: Partial<EngineClientConfig>) => {
      client.updateConfig(updates);
    },
    [client]
  );

  return {
    client,
    sessionId,
    isConnected,
    updateConfig,
  };
}

