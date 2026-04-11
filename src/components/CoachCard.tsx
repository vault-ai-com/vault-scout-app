import { Link } from "react-router-dom";
import { User, MapPin, Trophy, TrendingUp, CheckCircle2 } from "lucide-react";
import type { ScoutCoach } from "@/types/scout";
import { TIER_LABELS, TIER_COLORS, COACH_CAREER_PHASE_LABELS } from "@/types/scout";

const recColors: Record<string, string> = {
  SIGN: "text-emerald-400",
  MONITOR: "text-amber-400",
  PASS: "text-red-400",
};

interface CoachCardProps {
  coach: ScoutCoach;
}

export function CoachCard({ coach }: CoachCardProps) {
  return (
    <Link to={`/coaches/${coach.id}`}
      className="block rounded-xl p-4 glass-premium gradient-accent-top card-interactive group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl icon-premium flex items-center justify-center flex-shrink-0">
          <User className="w-[18px] h-[18px] text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">
              {coach.name}
            </h3>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[coach.tier] ?? TIER_COLORS.development}`}>
              {TIER_LABELS[coach.tier] ?? coach.tier}
            </span>
            {coach.latest_score != null && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${recColors[coach.latest_recommendation ?? ""] ?? "text-muted-foreground"}`}>
                <CheckCircle2 className="w-3 h-3" />
                {coach.latest_score.toFixed(1)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {coach.coaching_style && (
              <span className="flex items-center gap-1">
                <Trophy className="w-3 h-3" />
                {coach.coaching_style}
              </span>
            )}
            {coach.current_club && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {coach.current_club}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/80">
            {coach.age > 0 && <span>{coach.age} år</span>}
            {coach.nationality && <span>{coach.nationality}</span>}
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {COACH_CAREER_PHASE_LABELS[coach.career_phase] ?? coach.career_phase}
            </span>
            {coach.current_league && <span>{coach.current_league}</span>}
            {coach.formation_preference && (
              <span className="badge-gold text-[10px]">{coach.formation_preference}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
