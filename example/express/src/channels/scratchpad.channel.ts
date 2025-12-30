// ============================================================================
// Channel Context Type
// ============================================================================

import { ChannelRouter, Logger, type ChannelEvent } from "aidk";
import { type ScratchpadNote, ScratchpadService } from "../services";

/**
 * Context passed to channel handlers.
 * Provides runtime data needed by handlers.
 */
export interface ScratchpadChannelContext {
  /** Thread ID for note scoping */
  threadId: string;
  /** Connection ID (for excludeSender) */
  sourceConnectionId?: string;
  /** Whether to broadcast changes (default: true for HTTP, false for engine subscribe) */
  broadcast?: boolean;
}
// ============================================================================
// Channel Definition
// ============================================================================

/**
 * scratchpad channel - handles both inbound (frontend events) and outbound (broadcasts).
 *
 * Inbound: Frontend sends note_added, note_removed, notes_cleared
 * Outbound: Service broadcasts state_changed to thread participants
 *
 * scope: 'thread' → .to(threadId) targets `thread:{threadId}` room.
 */
/**
 * Scratchpad channel - handles note events.
 * Registered contexts are auto-notified when handlers return results.
 *
 * scope: { thread: 'threadId' } means:
 * - Room routing: broadcast to 'thread:{ctx.threadId}'
 * - Context matching: key is 'thread:{ctx.threadId}'
 */
export const scratchpadChannel = new ChannelRouter<ScratchpadChannelContext>("scratchpad", {
  scope: { thread: "threadId" },
})
  .on("add_note", async (event: ChannelEvent, ctx: ScratchpadChannelContext) => {
    return ScratchpadService.addNote(ctx.threadId, event.payload.text, "user", {
      broadcast: ctx.broadcast,
      excludeSender: true,
    });
  })
  .on("remove_note", async (event: ChannelEvent, ctx: ScratchpadChannelContext) => {
    return ScratchpadService.removeNote(ctx.threadId, event.payload.note_id, {
      broadcast: ctx.broadcast,
      excludeSender: true,
    });
  })
  .on("clear_notes", async (_event: ChannelEvent, ctx: ScratchpadChannelContext) => {
    return ScratchpadService.clearNotes(ctx.threadId, {
      broadcast: ctx.broadcast,
      excludeSender: true,
    });
  });
