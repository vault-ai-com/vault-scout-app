import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WatchlistEntrySchema, safeArray } from "@/types/scout";
import type { WatchlistEntry } from "@/types/scout";

export function useWatchlist() {
  return useQuery<WatchlistEntry[]>({
    queryKey: ["scout-watchlist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_watchlist")
        .select("*, scout_players(id, name, position_primary, tier, current_club)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return safeArray(WatchlistEntrySchema, data);
    },
    staleTime: 30_000,
  });
}

/** Returns { isOnWatchlist, watchlistId } — VCE09 P1 fix: need ID for delete */
export function useIsOnWatchlist(playerId: string) {
  return useQuery<{ isOnWatchlist: boolean; watchlistId: string | null }>({
    queryKey: ["scout-watchlist-check", playerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_watchlist")
        .select("id")
        .eq("player_id", playerId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { isOnWatchlist: !!data, watchlistId: data?.id ?? null };
    },
    enabled: !!playerId,
    staleTime: 30_000,
  });
}

export function useToggleWatchlist() {
  const qc = useQueryClient();
  return useMutation<void, Error, { playerId: string; isOnWatchlist: boolean; watchlistId: string | null }>({
    mutationFn: async ({ playerId, isOnWatchlist, watchlistId }) => {
      if (isOnWatchlist && watchlistId) {
        const { error } = await supabase
          .from("scout_watchlist")
          .delete()
          .eq("id", watchlistId);
        if (error) throw new Error(error.message);
      } else if (!isOnWatchlist) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");
        const { error } = await supabase
          .from("scout_watchlist")
          .insert({ player_id: playerId, created_by: session.user.id });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["scout-watchlist"] });
      qc.invalidateQueries({ queryKey: ["scout-watchlist-check", variables.playerId] });
      qc.invalidateQueries({ queryKey: ["scout-dashboard"] });
    },
  });
}
