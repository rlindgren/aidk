/**
 * Hook for scratchpad management (thread-scoped notes)
 * Uses the new typed channel API
 */

import { useState, useCallback, useEffect } from "react";
import { useChannel, defineChannel, EngineClient } from "aidk-react";

export interface ScratchpadNote {
  id: string;
  text: string;
  source: "model" | "user";
  createdAt?: string;
}

interface ScratchpadResponse {
  success: boolean;
  notes?: ScratchpadNote[];
  message?: string;
}

const API_URL = import.meta.env.VITE_API_URL || "";

// Define the scratchpad channel contract
const ScratchpadChannel = defineChannel<
  // Incoming events (from server)
  { state_changed: { notes: ScratchpadNote[]; threadId?: string } },
  // Outgoing events (to server)
  {
    add_note: { text: string; threadId: string };
    remove_note: { note_id: string; threadId: string };
    clear_notes: { threadId: string };
  }
>("scratchpad");

/**
 * Hook that syncs with ScratchpadTool via the scratchpad channel.
 * Scratchpad is thread-scoped (tied to current conversation).
 */
export function useScratchpad(client: EngineClient, threadId: string | null = null) {
  const [notes, setNotes] = useState<ScratchpadNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const effectiveThreadId = threadId || "default";

  // Connect to the scratchpad channel
  const channel = useChannel(ScratchpadChannel, client);

  // Subscribe to state changes
  useEffect(() => {
    return channel.on("state_changed", ({ notes, threadId }) => {
      // Only update if it's for our thread
      if (!threadId || threadId === effectiveThreadId) {
        setNotes(notes);
      }
    });
  }, [channel, effectiveThreadId]);

  // Fetch initial notes on mount
  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const params = new URLSearchParams();
        params.set("threadId", effectiveThreadId);

        const response = await fetch(`${API_URL}/api/notes?${params}`);
        if (response.ok) {
          const data = await response.json();
          if (data.notes) {
            setNotes(data.notes);
          }
        }
      } catch (err) {
        console.error("Failed to fetch initial notes:", err);
      }
    };

    fetchNotes();
  }, [effectiveThreadId]);

  const addNote = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      setIsLoading(true);
      try {
        const response = (await channel.send("add_note", {
          text,
          threadId: effectiveThreadId,
        })) as ScratchpadResponse;

        if (response?.notes) {
          setNotes(response.notes);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [channel, effectiveThreadId],
  );

  const removeNote = useCallback(
    async (noteId: string) => {
      // Optimistic update
      setNotes((prev) => prev.filter((n) => n.id !== noteId));

      const response = (await channel.send("remove_note", {
        note_id: noteId,
        threadId: effectiveThreadId,
      })) as ScratchpadResponse;

      if (response?.notes) {
        setNotes(response.notes);
      }
    },
    [channel, effectiveThreadId],
  );

  const clearNotes = useCallback(async () => {
    // Optimistic update
    setNotes([]);

    const response = (await channel.send("clear_notes", {
      threadId: effectiveThreadId,
    })) as ScratchpadResponse;

    if (response?.notes) {
      setNotes(response.notes);
    }
  }, [channel, effectiveThreadId]);

  return {
    notes,
    isLoading,
    addNote,
    removeNote,
    clearNotes,
  };
}
