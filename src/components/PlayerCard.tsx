import { Link } from "react-router-dom";
import { User, MapPin, Trophy, TrendingUp } from "lucide-react";
import type { ScoutPlayer } from "@/types/scout";
import { TIER_LABELS, TIER_COLORS } from "@/types/scout";

interface PlayerCardProps {
  player: ScoutPlayer;
}

export function PlayerCard({ player }: PlayerCardProps) {
  return (
    <Link to={`/players/${player.id}`}
      className="block rounded-2xl p-4 bg-card border border-border hover:border-primary/30 card-interactive group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="w-4.5 h-4.5 text-primary" />
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
              {player.career_phase}
            </span>
            {player.current_league && <span>{player.current_league}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
