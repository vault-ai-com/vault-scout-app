import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScoutNoteSchema, safeArray } from "@/types/scout";
import type { ScoutNote } from "@/types/scout";

export function usePlayerNotes(playerId: string) {
  return useQuery<ScoutNote[]>({
    queryKey: ["scout-notes", playerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_notes")
        .select("*")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return safeArray(ScoutNoteSchema, data);
    },
    enabled: !!playerId,
    staleTime: 30_000,
  });
}

interface CreateNoteArgs {
  player_id: string;
  content: string;
  title?: string;
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation<ScoutNote, Error, CreateNoteArgs>({
    mutationFn: async ({ player_id, content, title }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("scout_notes")
        .insert({ player_id, content, title: title ?? null, created_by: session.user.id })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const parsed = ScoutNoteSchema.safeParse(data);
      if (!parsed.success) throw new Error("Invalid note response");
      return parsed.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["scout-notes", variables.player_id] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation<void, Error, { noteId: string; playerId: string }>({
    mutationFn: async ({ noteId }) => {
      const { error } = await supabase
        .from("scout_notes")
        .delete()
        .eq("id", noteId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["scout-notes", variables.playerId] });
    },
  });
}
