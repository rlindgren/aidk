/**
 * Input Normalization Types
 * 
 * Platform-independent types for flexible input handling.
 * Used by both backend (aidk-core) and frontend (aidk-client) for
 * normalizing various input formats into standardized structures.
 */

import type { ContentBlock } from './blocks';
import type { Message } from './messages';

// ============================================================================
// Input Types
// ============================================================================

/**
 * Flexible content input - accepts string or ContentBlock
 */
export type ContentInput = ContentBlock | string;

/**
 * Flexible content array input - accepts single or array of ContentInput
 */
export type ContentInputArray = ContentInput | ContentInput[];

/**
 * Flexible message input - accepts various message formats
 * 
 * Can be:
 * - Single string
 * - Array of strings
 * - Single Message
 * - Array of Messages
 * - Single ContentBlock
 * - Array of ContentBlocks
 * - Mixed ContentInputArray
 */
export type MessageInput = ContentInputArray | Message | Message[];

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if value is a ContentBlock
 */
export function isContentBlock(value: unknown): value is ContentBlock {
  return typeof value === 'object' && value !== null && 'type' in value;
}

/**
 * Check if value is a Message
 */
export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && 'role' in value && 'content' in value;
}

// ============================================================================
// Normalization Functions
// ============================================================================

/**
 * Normalize ContentInput to ContentBlock
 */
export function normalizeContentInput(input: ContentInput): ContentBlock {
  return typeof input === 'string' ? { type: 'text', text: input } : input;
}

/**
 * Normalize ContentInputArray to ContentBlock[]
 */
export function normalizeContentArray(input: ContentInputArray): ContentBlock[] {
  return Array.isArray(input) ? input.map(normalizeContentInput) : [normalizeContentInput(input)];
}

/**
 * Normalize MessageInput to Message[]
 * 
 * @param input - Flexible message input
 * @param role - Default role if input is not already a Message (default: 'user')
 */
export function normalizeMessageInput(input: MessageInput, role: Message['role'] = 'user'): Message[] {
  if (Array.isArray(input) && input.length > 0 && isMessage(input[0])) {
    return input as Message[];
  }
  if (isMessage(input)) {
    return [input];
  }
  return [{ role, content: normalizeContentArray(input as ContentInputArray) }];
}

