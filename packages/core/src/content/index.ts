/**
 * Content types, blocks, and message utilities.
 *
 * @module aidk/content
 */

// Re-export content types, but exclude ones we extend locally
// Note: Message, ContentBlock, etc. are also exported from types.ts re-exports
export {
  normalizeMessageInput,
  normalizeContentInput,
  normalizeContentArray,
  isMessage,
  isContentBlock,
} from "aidk-shared";
export * from "aidk-shared/blocks";
export * from "aidk-shared/block-types";
export * from "aidk-shared/input";
export * from "aidk-shared/messages";

// Re-export all streaming types and utilities
// StreamEvent types are the new typed events for model output streaming
// EngineEvent types are orchestration events (execution, ticks, tool results)
export * from "aidk-shared/streaming";
