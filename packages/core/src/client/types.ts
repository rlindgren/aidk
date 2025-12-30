/**
 * Server Client Types - Flexible input types
 *
 * Re-exports input normalization types from aidk-shared for convenience.
 */
import type { Message, TimelineEntry } from "aidk-shared";
export type { MessageInput, ContentInput, ContentInputArray } from "aidk-shared";
export {
  normalizeMessageInput,
  normalizeContentInput,
  normalizeContentArray,
  isMessage,
  isContentBlock,
} from "aidk-shared";

/**
 * Convert messages to timeline format.
 * Server-client specific helper.
 *
 * Returns TimelineEntry[] which is compatible with COMTimelineEntry[]
 * (COMTimelineEntry extends TimelineEntry).
 */
export function messagesToTimeline(messages: Message[]): TimelineEntry[] {
  return messages.map((m) => ({
    kind: "message" as const,
    message: m,
  }));
}
