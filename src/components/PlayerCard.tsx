import { Link } from "react-router-dom";
import { User, MapPin, Trophy, TrendingUp, Star } from "lucide-react";
import { useIsOnWatchlist, useToggleWatchlist } from "@/hooks/use-scout-watchlist";
import type { ScoutPlayer } from "@/types/scout";
import { TIER_LABELS, TIER_COLORS } from "@/types/scout";

const phaseLabels: Record<string, string> = {
  emergence: "Genombrott",
  development: "Utveckling",
  peak: "Topp",
  prime: "Prime",
  decline: "Avtagande",
  veteran: "Veteran",
};

interface PlayerCardProps {
  player: ScoutPlayer;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const { data: watchlistData } = useIsOnWatchlist(player.id);
  const isOnWatchlist = watchlistData?.isOnWatchlist ?? false;
  const watchlistId = watchlistData?.watchlistId ?? null;
  const toggleWatchlist = useToggleWatchlist();

  return (
    <div className="relative">
    <Link to={`/players/${player.id}`}
      className="block rounded-xl p-4 glass-premium gradient-accent-top card-interactive group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl icon-premium flex items-center justify-center flex-shrink-0">
          <User className="w-[18px] h-[18px] text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {player.name}
            </h3>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[player.tier] ?? TIER_COLORS.development}`}>
              {TIER_LABELS[player.tier] ?? player.tier}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Trophy className="w-3 h-3" />
              {player.position_primary}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {player.current_club}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/80">
            <span>{player.age} år</span>
            <span>{player.nationality}</span>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {phaseLabels[player.career_phase] ?? player.career_phase}
            </span>
            {player.current_league && <span>{player.current_league}</span>}
            {player.market_value != null && (
              <span className="badge-gold text-[10px]">
                €{(player.market_value / 1_000_000).toFixed(1)}M
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
    <button
      type="button"
      onClick={() => toggleWatchlist.mutate({ playerId: player.id, isOnWatchlist, watchlistId })}
      disabled={toggleWatchlist.isPending}
      aria-label={isOnWatchlist ? "Ta bort från bevakningslista" : "Lägg till i bevakningslista"}
      className="absolute top-2 right-2 p-1.5 rounded-lg text-muted-foreground/40 hover:text-amber-400 transition-colors disabled:opacity-30 z-10"
    >
      <Star className={`w-3.5 h-3.5 ${isOnWatchlist ? "fill-amber-400 text-amber-400" : ""}`} />
    </button>
    </div>
  );
}
