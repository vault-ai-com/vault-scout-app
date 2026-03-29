import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, Plus, Loader2, StickyNote } from "lucide-react";
import { usePlayerNotes, useCreateNote, useDeleteNote } from "@/hooks/use-scout-notes";

interface NotesPanelProps {
  playerId: string;
}

export function NotesPanel({ playerId }: NotesPanelProps) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");

  const { data: notes = [], isLoading } = usePlayerNotes(playerId);
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

  const handleAdd = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    createNote.mutate(
      { player_id: playerId, content: trimmed, title: title.trim() || undefined },
      {
        onSuccess: () => {
          setContent("");
          setTitle("");
        },
      },
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-xl glass-premium card-accent-left p-6 md:p-8"
    >
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg icon-premium flex items-center justify-center">
          <StickyNote className="w-4 h-4 text-primary" />
        </div>
        <span className="section-tag">Anteckningar</span>
      </div>

      {/* Add note form */}
      <div className="space-y-2.5 mb-5">
        <input
          type="text"
          placeholder="Rubrik (valfritt)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-card/60 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <textarea
          placeholder="Skriv en anteckning..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-card/60 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none transition-all"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!content.trim() || createNote.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground btn-premium disabled:opacity-50 shadow-md shadow-primary/20"
        >
          {createNote.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Lägg till
        </button>
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-primary/50" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 py-2">Inga anteckningar ännu.</p>
      ) : (
        <AnimatePresence initial={false}>
          <ul className="space-y-2.5">
            {notes.map((note) => (
              <motion.li
                key={note.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-card/50 border border-border/30"
              >
                <div className="flex-1 min-w-0">
                  {note.title && (
                    <p className="text-xs font-semibold text-foreground mb-0.5 truncate">{note.title}</p>
                  )}
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{note.content}</p>
                  <p className="text-[10px] text-muted-foreground/40 mt-1.5">
                    {new Date(note.created_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteNote.mutate({ noteId: note.id, playerId })}
                  disabled={deleteNote.isPending}
                  aria-label="Radera anteckning"
                  className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.li>
            ))}
          </ul>
        </AnimatePresence>
      )}
    </motion.div>
  );
}
