import { Router, type Request, type Response } from 'express';
import { getEngine } from '../setup';
import { Context, type ContentBlock } from 'aidk';

const router: Router = Router();

/**
 * SSE endpoint for channel subscriptions.
 * 
 * The Engine's ChannelService is configured with an SSE transport.
 * When clients connect here, we add them to the transport, and the
 * Engine's channel events automatically flow to SSE clients.
 * 
 * Now supports room-based routing:
 * - Connections auto-join `user:{userId}` room
 * - Events can target specific rooms
 */
router.get('/sse', (req: Request, res: Response) => {
  console.log('📡 SSE connection request:', req.query);
  
  const sessionId = req.query.sessionId as string;
  const userId = req.query.userId as string;
  const channelFilter = req.query.channels as string | undefined;
  
  if (!sessionId) {
    console.log('📡 SSE rejected: missing sessionId');
    return res.status(400).json({ error: 'sessionId is required' });
  }

  // Get the SSE transport from engine's channel service
  const engine = getEngine();
  const transport = engine.channels?.getTransport(); // SSETransport has addConnection
  
  if (!transport) {
    console.log('📡 SSE rejected: transport not available');
    return res.status(503).json({ error: 'SSE transport not available' });
  }
  
  console.log(`📡 SSE connecting: connectionId=${sessionId}, userId=${userId || 'anonymous'}, channels=${channelFilter || 'all'}`);
  
  // Parse channel filter
  const channels = channelFilter ? channelFilter.split(',') : undefined;
  
  // Get threadId for thread-scoped rooms
  const threadId = req.query.threadId as string;
  
  // Add this SSE connection to the transport with metadata for auto-join
  // If userId is provided, the transport will auto-join `user:{userId}` room
  // If threadId is provided, the transport will auto-join `thread:{threadId}` room
  // Note: userId/threadId go directly in the object, not nested in metadata
  transport.connect(sessionId, {
    res,
    channels,
    userId,
    threadId,
  });

  // Cleanup on disconnect
  req.on('close', () => {
    transport.disconnect(sessionId);
  });
});

/**
 * POST endpoint for publishing events to channels.
 * 
 * Since SSE is one-way (server→client), we need this endpoint
 * for client→server channel events.
 * 
 * Uses engine.channels.handleEvent() to dispatch to registered channel routers.
 * No if-else chains needed - routers are registered in engine config.
 */
router.post('/events', async (req: Request, res: Response) => {
  // TODO: Standardize on snake_case (user_id) for API contract
  const { sessionId, userId, user_id, channel, type, payload, thread_id, ...rest } = req.body;
  const effectiveUserId = user_id || userId;
  console.log(`📮 /events: channel=${channel}, type=${type}, userId=${userId}, user_id=${user_id}, effectiveUserId=${effectiveUserId}`);
  
  if (!channel || !type) {
    return res.status(400).json({ error: 'channel and type are required' });
  }

  const engine = getEngine();
  const channelService = engine.channels;
  
  if (!channelService) {
    return res.status(503).json({ error: 'Channel service not available' });
  }

  try {
    const eventPayload = payload || rest;
    
    // Get threadId from:
    // 1. Event payload
    // 2. Request body
    // 3. Connection metadata (SSE connection stores threadId from initial connection)
    // 4. Fall back to session ID
    let threadId = eventPayload?.thread_id || thread_id;
    
    if (!threadId && sessionId) {
      // Try to get threadId from SSE connection metadata
      const transport = channelService.getTransport();
      if (transport && 'getConnectionMetadata' in transport) {
        const metadata = (transport as any).getConnectionMetadata(sessionId);
        threadId = metadata?.threadId;
      }
    }
    
    threadId = threadId || '00000000-0000-0000-0000-000000000000';
    
    try {
      // Build context based on channel scope
      // TODO: Could infer scope from router config
      const context: Record<string, unknown> = {
        sourceConnectionId: sessionId,
        broadcast: true,
        userId: effectiveUserId || 'anonymous',
        threadId,
        createEvent: true,
      };
      
      // Handle event and get result
      const result = await channelService.handleEvent(channel, { type, payload: eventPayload }, context);
      
      console.log(`📋 Channel event handled: ${channel}/${type}`);
      return res.json({ success: true, ...result as object });
    } catch (error: any) {
      console.error('Channel event error:', error);
      if (error.message.includes('Unknown channel:')) {
        // For unregistered channels, fall back to generic publish
        const ctx = Context.create({
          user: effectiveUserId ? { id: effectiveUserId } : undefined,
          metadata: {
            sessionId,
            userId: effectiveUserId,
          },
        });

        Context.run(ctx, async () => {
          channelService.publish(Context.get(), channel, {
            type,
            payload: eventPayload,
            metadata: {
              sessionId,
              userId: effectiveUserId,
              timestamp: Date.now(),
            },
          });
        });
        
        return res.json({ success: true });
      }
      console.error('Channel event error:', error);
      return res.status(500).json({ error: error.message });
    }
  } catch (error: any) {
    console.error('Unexpected channel event error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST endpoint for client tool results.
 * 
 * When a client-executed tool requires a response (e.g., forms),
 * the client sends the result back via this endpoint.
 * 
 * The engine's ClientToolCoordinator is waiting for this result
 * to continue execution.
 */
router.post('/tool-results', async (req: Request, res: Response) => {
  const { tool_use_id, content, is_error, error: errorMessage } = req.body;
  
  console.log(`🔧 /tool-results: tool_use_id=${tool_use_id}, is_error=${is_error}`);
  
  if (!tool_use_id) {
    return res.status(400).json({ error: 'tool_use_id is required' });
  }
  
  const engine = getEngine();
  const toolExecutor = engine.getToolExecutor?.();
  
  if (!toolExecutor) {
    return res.status(503).json({ error: 'Tool executor not available' });
  }
  
  const coordinator = toolExecutor.getClientToolCoordinator();
  
  // Normalize content to ContentBlock[]
  let contentBlocks: ContentBlock[];
  if (!content || (Array.isArray(content) && content.length === 0)) {
    contentBlocks = is_error 
      ? [{ type: 'text' as const, text: errorMessage || 'Client tool error' }]
      : [{ type: 'text' as const, text: 'No content provided' }];
  } else if (Array.isArray(content)) {
    contentBlocks = content;
  } else if (typeof content === 'string') {
    contentBlocks = [{ type: 'text' as const, text: content }];
  } else {
    // Assume it's a single content block or data object
    contentBlocks = [{ type: 'json' as const, text: JSON.stringify(content), data: content }];
  }
  
  const resolved = coordinator.resolveResult(tool_use_id, {
    tool_use_id,
    name: 'client_tool', // Client tools don't always have names available
    success: !is_error,
    content: contentBlocks,
    error: is_error ? (errorMessage || 'Client error') : undefined,
  });
  
  if (!resolved) {
    return res.status(404).json({ 
      error: 'No pending tool call found',
      tool_use_id 
    });
  }
  
  return res.json({ success: true, tool_use_id });
});

export default router;