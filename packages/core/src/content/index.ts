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

// Re-export streaming utilities but not the event types (which conflict with engine-events.ts)
// The new StreamEvent/EngineEvent types are in aidk-shared/streaming for clients
// The engine uses its own EngineStreamEvent in ./engine/engine-events.ts
export {
  StopReason,
  StreamChunkType,
  isStreamEvent,
  isEngineEvent,
  isDeltaEvent,
  isFinalEvent,
} from "aidk-shared/streaming";
export type { StreamChunk } from "aidk-shared/streaming";
