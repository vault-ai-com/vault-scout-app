import { Link } from "react-router-dom";
import { User, MapPin, Trophy, TrendingUp } from "lucide-react";
import type { ScoutPlayer } from "@/types/scout";
import { TIER_LABELS } from "@/types/scout";

interface PlayerCardProps {
  player: ScoutPlayer;
}

const tierColors: Record<string, string> = {
  elite: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  established: "bg-primary/10 text-primary border-primary/20",
  emerging: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  prospect: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export function PlayerCard({ player }: PlayerCardProps) {
  return (
    <Link to={`/players/${player.id}`}
      className="block rounded-2xl p-4 bg-card border border-border hover:border-primary/30 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="w-4.5 h-4.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {player.name}
            </h3>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${tierColors[player.tier] ?? tierColors.prospect}`}>
              {TIER_LABELS[player.tier] ?? player.tier}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Trophy className="w-3 h-3" />
              {player.position}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {player.club}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/80">
            <span>{player.age} år</span>
            <span>{player.nationality}</span>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {player.career_phase}
            </span>
            {player.league && <span>{player.league}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
