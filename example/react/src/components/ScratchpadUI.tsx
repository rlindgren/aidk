/**
 * Scratchpad UI Component
 * 
 * A collapsible sticky note panel that appears in the chat window.
 * Thread-scoped: notes are specific to the current conversation.
 */

import { useState } from 'react';
import { ScratchpadNote } from '../hooks/useScratchpad';
import './ScratchpadUI.css';

interface ScratchpadUIProps {
  notes: ScratchpadNote[];
  isLoading: boolean;
  onAddNote: (text: string) => void;
  onRemoveNote: (noteId: string) => void;
  onClear: () => void;
}

export function ScratchpadUI({ 
  notes, 
  isLoading, 
  onAddNote, 
  onRemoveNote, 
  onClear 
}: ScratchpadUIProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [newNote, setNewNote] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNote.trim() && !isLoading) {
      onAddNote(newNote.trim());
      setNewNote('');
    }
  };

  // Always render - header should always be visible
  return (
    <div className={`scratchpad ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div 
        className="scratchpad-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="scratchpad-title">
          <span>Notes</span>
          {notes.length > 0 && (
            <span className="note-count">({notes.length})</span>
          )}
        </div>
        <button 
          className="toggle-btn"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
      </div>

      {isExpanded && (
        <div className="scratchpad-content">
          {notes.length === 0 ? (
            <div className="empty-notes">
              <p>No notes yet</p>
            </div>
          ) : (
            <div className="notes-list">
              {notes.map((note) => (
                <div key={note.id} className={`note-item source-${note.source}`}>
                  <span className="note-source">{note.source === 'model' ? 'AI' : '—'}</span>
                  <span className="note-text">{note.text}</span>
                  <button 
                    className="remove-btn"
                    onClick={() => onRemoveNote(note.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <form className="add-note-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add note..."
              disabled={isLoading}
            />
            <button type="submit" disabled={!newNote.trim() || isLoading}>
              +
            </button>
          </form>

          {notes.length > 0 && (
            <button className="clear-btn" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

