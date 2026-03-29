import { useScoutSearch } from "@/hooks/use-scout-search";
import type { ScoutPlayer } from "@/types/scout";

export function useComparablePlayers(player: ScoutPlayer | null) {
  const result = useScoutSearch(
    {
      position: player?.position_primary,
      tier: player?.tier,
      limit: 6,
    },
    !!player,
  );

  const filtered = (result.data?.players ?? []).filter(
    (p) => p.id !== player?.id,
  ).slice(0, 3);

  return {
    players: filtered,
    isLoading: result.isLoading,
    error: result.error,
  };
}
