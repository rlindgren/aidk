/**
 * ID generation utilities for streaming events
 * 
 * Format: <prefix>_<counter>
 * - Messages: msg_1, msg_2, msg_3
 * - Content blocks: blk_1, blk_2, blk_3
 * - Tool calls: tool_1, tool_2, tool_3
 * - Tool results: result_1, result_2, result_3
 */
import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically secure random ID with prefix
 */
function generateRandomId(prefix: string): string {
  const randomHex = randomBytes(8).toString('hex');
  return `${prefix}_${randomHex}`;
}

let messageCounter = 0;
let contentCounter = 0;
let toolCallCounter = 0;
let toolResultCounter = 0;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return generateRandomId('msg');
}

/**
 * Generate a unique content block ID
 */
export function generateContentId(): string {
  return generateRandomId('blk');
}

/**
 * Generate a unique tool call ID
 */
export function generateToolCallId(): string {
  return generateRandomId('tool');
}

/**
 * Generate a unique tool result ID
 */
export function generateToolResultId(): string {
  return generateRandomId('result');
}


