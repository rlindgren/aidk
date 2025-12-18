/**
 * Messages
 * 
 * Message types for model input/output.
 * 
 * Message roles:
 * - user: User input messages
 * - assistant: Model-generated responses
 * - system: System/behavioral instructions
 * - tool: Tool/function call results
 * - event: Application events (user actions, system events, state changes)
 * 
 * Note: Ephemeral content is NOT a Message role - it's handled
 * separately via the ephemeral system and is not persisted.
 */

import type { MessageRoles } from './block-types';
import type { ContentBlock, EventAllowedBlock } from './blocks';

// ============================================================================
// Message Types
// ============================================================================

export interface Message {
  readonly id?: string;
  readonly role: MessageRoles;
  readonly content: ContentBlock[];
  readonly metadata?: Record<string, any>;
  readonly created_at?: string | Date;
  readonly updated_at?: string | Date;
}

export interface UserMessage extends Message {
  readonly role: 'user';
}

export interface AssistantMessage extends Message {
  readonly role: 'assistant';
}

export interface SystemMessage extends Message {
  readonly role: 'system';
}

export interface ToolMessage extends Message {
  readonly role: 'tool';
  readonly tool_call_id?: string;
}

export interface EventMessage extends Message {
  readonly role: 'event';
  readonly content: EventAllowedBlock[];
  readonly event_type?: string; // Optional categorization: 'user_action', 'system', 'state_change', etc.
}

// ============================================================================
// Message Helpers
// ============================================================================

export function createUserMessage(
  content: ContentBlock[] | string,
  metadata?: Record<string, any>
): UserMessage {
  return {
    role: 'user',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    metadata,
  };
}

export function createAssistantMessage(
  content: ContentBlock[] | string,
  metadata?: Record<string, any>
): AssistantMessage {
  return {
    role: 'assistant',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    metadata,
  };
}

export function createSystemMessage(
  content: ContentBlock[] | string,
  metadata?: Record<string, any>
): SystemMessage {
  return {
    role: 'system',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    metadata,
  };
}

export function isUserMessage(message: Message): message is UserMessage {
  return message.role === 'user';
}

export function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === 'assistant';
}

export function isSystemMessage(message: Message): message is SystemMessage {
  return message.role === 'system';
}

export function isToolMessage(message: Message): message is ToolMessage {
  return message.role === 'tool';
}

export function isEventMessage(message: Message): message is EventMessage {
  return message.role === 'event';
}

export function createToolMessage(
  content: ContentBlock[] | string,
  toolCallId?: string,
  metadata?: Record<string, any>
): ToolMessage {
  return {
    role: 'tool',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    tool_call_id: toolCallId,
    metadata,
  };
}

export function createEventMessage(
  content: EventAllowedBlock[] | string,
  eventType?: string,
  metadata?: Record<string, any>
): EventMessage {
  return {
    role: 'event',
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    event_type: eventType,
    metadata,
  };
}

