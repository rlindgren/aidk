import { SetMetadata } from '@nestjs/common';
import type { JSX } from 'aidk/jsx-runtime';
import { AGENT_TOKEN } from '../tokens';

/**
 * Decorator to mark a route handler for agent streaming.
 * The handler should return EngineInput, and the agent JSX will be provided via metadata.
 */
export function StreamAgent(agent?: JSX.Element) {
  return SetMetadata(AGENT_TOKEN, { type: 'stream', agent });
}

/**
 * Decorator to mark a route handler for agent execution.
 * The handler should return EngineInput, and the agent JSX will be provided via metadata.
 */
export function ExecuteAgent(agent?: JSX.Element) {
  return SetMetadata(AGENT_TOKEN, { type: 'execute', agent });
}

