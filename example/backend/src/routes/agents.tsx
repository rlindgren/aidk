/**
 * Agent Routes
 * 
 * Execute and stream agent workflows via HTTP.
 * Uses middleware for context extraction and transport coordination.
 */

import { Router } from 'express';
import { getEngine } from '../setup';
import { TaskAssistantAgent } from '../agents/task-assistant';
import {
  withEngine,
  withTransport,
  getSSETransport,
  setupStreamingResponse,
  writeSSEEvent,
  writeSSEEventSafe,
  type EngineRequest,
} from 'aidk-express';
import { Logger } from 'aidk';

const logger = Logger.for('AgentRoutes');

const router: Router = Router();

// =============================================================================
// Agent Registry
// =============================================================================

const agents: Record<string, any> = {
  'task-assistant': TaskAssistantAgent,
};

// =============================================================================
// Middleware Setup
// =============================================================================

// Apply execution context middleware to all routes
const engineMiddleware = [
  withEngine({ engine: getEngine() }),
  withTransport({ transport: getSSETransport() })
];

// =============================================================================
// Routes
// =============================================================================

/**
 * Execute an agent (non-streaming)
 */
router.post('/:agentId/execute', ...engineMiddleware, async (req, res) => {
  try {
    const engineReq = req as unknown as EngineRequest; // TODO: Fix this
    const Agent = agents[req.params.agentId];
    
    if (!Agent) {
      return res.status(404).json({ error: `Agent ${req.params.agentId} not found` });
    }

    const { engine, input, execution_id, thread_id, session_id, withContext } = engineReq.engineContext;
    
    const result = await engine.execute.withContext(withContext).run(input, <Agent />);

    res.json({ 
      execution_id, 
      result,
      thread_id,
      session_id,
    });
  } catch (error: any) {
    console.error('Agent execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Stream an agent execution
 */
router.post('/:agentId/stream', ...engineMiddleware, async (req, res) => {
  console.log('\n=== STREAM REQUEST RECEIVED ===');
  console.log('Agent ID:', req.params.agentId);
  
  try {
    const engineReq = req as unknown as EngineRequest;
    const Agent = agents[req.params.agentId];
    
    if (!Agent) {
      console.log('❌ Agent not found:', req.params.agentId);
      return res.status(404).json({ error: `Agent ${req.params.agentId} not found` });
    }
    console.log('✅ Agent found:', req.params.agentId);

    // Set up streaming response
    setupStreamingResponse(res);

    const { engine, input, execution_id, thread_id, session_id, withContext } = engineReq.engineContext;
    
    console.log('Execution ID:', execution_id);
    console.log('Thread ID:', thread_id);
    console.log('Session ID:', session_id);

    console.log('🚀 Starting engine.stream...');
    
    const stream = await engine.stream.withContext(withContext).run(input, <Agent />);
    
    console.log('✅ Stream created, starting iteration...');

    // Send execution info first
    writeSSEEvent(res, { 
      type: 'execution_start', 
      execution_id, 
      thread_id, 
      session_id,
      timestamp: new Date().toISOString(),
    });

    let eventCount = 0;
    for await (const event of stream) {
      eventCount++;
      
      if (event.type === 'error' && event.error instanceof Error) {
        logger.error({ err: event.error }, '❌ Stream yielded error:');
        console.error('❌ Stream yielded error:', event.error.message);
      }
      
      writeSSEEventSafe(res, event);
    }


    // Send execution info first
    writeSSEEvent(res, { 
      type: 'execution_end', 
      execution_id, 
      thread_id, 
      session_id,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Stream complete. Total events: ${eventCount}`);
    res.end();
  } catch (error: any) {
    console.error('❌ Agent stream error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

export default router;
