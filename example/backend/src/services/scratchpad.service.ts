import { getToolStateRepository } from '../persistence/repositories/tool-state';
import { generateUUID } from 'aidk-express';
import { getEngine } from '../setup';
import { GLOBAL_THREAD_ID } from '../routes/scratchpad';

// ============================================================================
// Types
// ============================================================================

export interface ScratchpadNote {
  id: string;
  text: string;
  source: 'model' | 'user';
  createdAt: Date;
}

export interface ScratchpadActionResult {
  success: boolean;
  notes: ScratchpadNote[];
  message: string;
  action: string;
}

export interface ScratchpadActionOptions {
  /** Broadcast state change to connected clients (default: true) */
  broadcast?: boolean;
  /** Exclude sender from broadcast (broadcast pattern) */
  excludeSender?: boolean;
  /** Source connection ID (for excludeSender) */
  sourceConnectionId?: string;
}
// Repository getter
const toolStateRepo = () => getToolStateRepository();

// ============================================================================
// ScratchpadService - Business logic for scratchpad management
// ============================================================================

export class ScratchpadService {

  static get channel() {
    return getEngine().channels?.getRouter('scratchpad');
  }

  /**
   * Load notes from persistence (thread-scoped)
   */
  static async getNotes(threadId: string): Promise<ScratchpadNote[]> {
    const state = await toolStateRepo().findByToolAndThread('scratchpad', threadId);
    if (!state?.state_data) return [];
    
    const notes = JSON.parse(state.state_data);
    return notes.map((n: any) => ({
      ...n,
      createdAt: typeof n.createdAt === 'string' ? new Date(n.createdAt) : n.createdAt
    }));
  }

  /**
   * Save notes to persistence (thread-scoped)
   */
  private static async saveNotes(threadId: string, notes: ScratchpadNote[]): Promise<void> {
    await toolStateRepo().upsert({
      tool_id: 'scratchpad',
      thread_id: threadId,
      user_id: 'shared',
      tenant_id: GLOBAL_THREAD_ID,
      state_data: JSON.stringify(notes),
      updated_at: new Date(),
    });
  }

  /**
   * Broadcast state change to thread participants via SSE rooms.
   * Uses the scratchpadChannel router for clean room-based routing.
   * 
   * Note: sourceConnectionId is automatically pulled from Context.sessionId
   * when excludeSender is true, so no need to pass it explicitly.
   */
  static broadcast(
    threadId: string,
    notes: ScratchpadNote[], 
    options: { excludeSender?: boolean }
  ): void {
    const event = { type: 'state_changed', payload: { notes, threadId: threadId } };
    const target = ScratchpadService.channel?.publisher().to(threadId);

    if (!target) {
      return;
    }
    
    if (options.excludeSender) {
      target.broadcast(event)
        .catch((err: unknown) => console.error('Failed to broadcast scratchpad update:', err));
    } else {
      target.send(event)
        .catch((err: unknown) => console.error('Failed to send scratchpad update:', err));
    }
  }

  /**
   * Add a note
   */
  static async addNote(
    threadId: string,
    text: string,
    source: 'model' | 'user' = 'model',
    options: ScratchpadActionOptions = {}
  ): Promise<ScratchpadActionResult> {
    if (!text?.trim()) {
      return { success: false, notes: [], message: 'Error: text is required', action: 'add' };
    }

    const notes = await ScratchpadService.getNotes(threadId);
    const newNote: ScratchpadNote = {
      id: generateUUID(),
      text: text.trim(),
      source,
      createdAt: new Date(),
    };
    
    notes.push(newNote);
    await ScratchpadService.saveNotes(threadId, notes);
    
    if (options.broadcast !== false) {
      ScratchpadService.broadcast(threadId, notes, { 
        excludeSender: options.excludeSender,
      });
    }
    
    return {
      success: true,
      notes,
      message: `Added note: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
      action: 'add',
    };
  }

  /**
   * Remove a note by ID
   */
  static async removeNote(
    threadId: string,
    noteId: string,
    options: ScratchpadActionOptions = {}
  ): Promise<ScratchpadActionResult> {
    if (!noteId) {
      return { success: false, notes: [], message: 'Error: note_id is required', action: 'remove' };
    }

    const notes = await ScratchpadService.getNotes(threadId);
    const index = notes.findIndex(n => n.id === noteId);
    
    if (index < 0) {
      return { success: false, notes, message: `Note not found: ${noteId}`, action: 'remove' };
    }
    
    const removedNote = notes[index];
    notes.splice(index, 1);
    await ScratchpadService.saveNotes(threadId, notes);
    
    if (options.broadcast !== false) {
      ScratchpadService.broadcast(threadId, notes, { 
        excludeSender: options.excludeSender,
      });
    }
    
    return {
      success: true,
      notes,
      message: `Removed note: "${removedNote.text.substring(0, 30)}..."`,
      action: 'remove',
    };
  }

  /**
   * Clear all notes
   */
  static async clearNotes(
    threadId: string,
    options: ScratchpadActionOptions = {}
  ): Promise<ScratchpadActionResult> {
    const oldNotes = await ScratchpadService.getNotes(threadId);
    const count = oldNotes.length;
    
    await ScratchpadService.saveNotes(threadId, []);
    
    if (options.broadcast !== false) {
      ScratchpadService.broadcast(threadId, [], { 
        excludeSender: options.excludeSender,
      });
    }
    
    return {
      success: true,
      notes: [],
      message: `Cleared ${count} note(s)`,
      action: 'clear',
    };
  }

  /**
   * List all notes
   */
  static async listNotes(threadId: string): Promise<ScratchpadActionResult> {
    const notes = await ScratchpadService.getNotes(threadId);
    return {
      success: true,
      notes,
      message: notes.length > 0 ? `Found ${notes.length} note(s)` : 'No notes yet',
      action: 'list',
    };
  }

}

