/**
 * React hooks for Channel communication
 * 
 * Provides React-friendly channel management with:
 * - Automatic subscription cleanup
 * - Type-safe event handling
 * - Stable channel references (survives StrictMode)
 */

import { useRef, useEffect } from 'react';
import { EngineClient, type ChannelDefinition, type Channel } from 'aidk-client';

// =============================================================================
// Module-level channel cache
// =============================================================================

// Global cache for channels to persist across React remounts
// Keyed by sessionId + channel name
const channelCache = new Map<string, Channel<any, any>>();

// Track channel reference counts to know when to clean up
const channelRefCounts = new Map<string, number>();

/**
 * React hook for typed channel communication
 * 
 * @example
 * ```tsx
 * // Define channel contract
 * const TodoChannel = defineChannel<
 *   { state_changed: { tasks: Task[] } },
 *   { create_task: { title: string }; toggle_complete: { task_id: string } }
 * >('todo-list');
 * 
 * function TodoList() {
 *   const { client } = useEngineClient();
 *   const [tasks, setTasks] = useState<Task[]>([]);
 *   const todo = useChannel(TodoChannel, client);
 *   
 *   useEffect(() => {
 *     return todo.on('state_changed', ({ tasks }) => setTasks(tasks));
 *   }, [todo]);
 *   
 *   const createTask = () => todo.send('create_task', { title: 'New task' });
 * }
 * ```
 */
export function useChannel<
  TIn extends Record<string, unknown>,
  TOut extends Record<string, unknown>
>(
  channelDef: ChannelDefinition<TIn, TOut>,
  client: EngineClient
): Channel<TIn, TOut> {
  // Get stable identifiers
  const sessionId = client.getSessionId();
  const channelName = channelDef.name;
  const cacheKey = `${sessionId}:${channelName}`;
  
  // Use ref to track if we've incremented the ref count
  const registeredRef = useRef(false);
  
  // Get or create channel from cache
  // This runs during render to ensure channel is available immediately
  let channel = channelCache.get(cacheKey) as Channel<TIn, TOut> | undefined;
  
  if (!channel) {
    console.log(`[useChannel] Creating new channel: ${channelName}`);
    channel = channelDef.connect(client);
    channelCache.set(cacheKey, channel);
    channelRefCounts.set(cacheKey, 0);
  }
  
  // Store in ref for stable reference
  const channelRef = useRef<Channel<TIn, TOut>>(channel);
  channelRef.current = channel;
  
  // Manage ref counting in effect (not during render)
  useEffect(() => {
    const count = (channelRefCounts.get(cacheKey) || 0) + 1;
    channelRefCounts.set(cacheKey, count);
    registeredRef.current = true;
    
    return () => {
      const currentCount = channelRefCounts.get(cacheKey) || 0;
      const newCount = currentCount - 1;
      channelRefCounts.set(cacheKey, newCount);
      
      // Don't immediately clean up - allow StrictMode to remount
      if (newCount <= 0) {
        setTimeout(() => {
          const finalCount = channelRefCounts.get(cacheKey) || 0;
          if (finalCount <= 0) {
            const chan = channelCache.get(cacheKey);
            if (chan) {
              console.log(`[useChannel] Cleaning up channel: ${channelName}`);
              chan.disconnect();
              channelCache.delete(cacheKey);
              channelRefCounts.delete(cacheKey);
            }
          }
        }, 100); // Small delay to survive StrictMode
      }
    };
  }, [cacheKey, channelName]);
  
  return channelRef.current;
}

/**
 * Clear all cached channels (useful for testing or logout scenarios)
 */
export function clearChannelCache(): void {
  for (const [_key, channel] of channelCache) {
    channel.disconnect();
  }
  channelCache.clear();
  channelRefCounts.clear();
}

