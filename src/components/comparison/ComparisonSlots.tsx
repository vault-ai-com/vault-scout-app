import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Plus, X } from "lucide-react";
import {
  TIER_LABELS,
  TIER_COLORS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_COLORS,
  asRecommendation,
} from "@/types/scout";
import type { ComparisonEntry } from "@/hooks/use-comparison-slots";
import { EASE_OUT_QUART } from "@/lib/motion";

// ---------------------------------------------------------------------------
// ComparisonSlots — 1-3 player slots. Empty slots render a "Lägg till
// spelare" CTA (P12 empty state) linking to /players. Filled slots always
// carry a remove control so any selection can be pared back down.
// ---------------------------------------------------------------------------

/** Overall-score circle tone — same 7/4 thresholds as the legacy comparison view, token-based. */
function scoreToneClasses(score: number): string {
  if (score >= 7) return "text-success border-success/30";
  if (score >= 4) return "text-warning border-warning/30";
  return "text-destructive border-destructive/30";
}

function FilledSlotCard({
  entry,
  index,
  onRemove,
}: {
  entry: ComparisonEntry;
  index: number;
  onRemove: () => void;
}) {
  const player = entry.player;

  if (entry.playerLoading) {
    return (
      <div
        className="card-editorial space-y-3 p-5"
        aria-busy="true"
        data-testid={`comparison-slot-${index}`}
      >
        <div className="h-11 w-11 rounded-full skeleton-shimmer" />
        <div className="h-5 w-32 rounded-sm skeleton-shimmer" />
        <div className="h-4 w-24 rounded-sm skeleton-shimmer" />
      </div>
    );
  }

  if (!player) {
    // Query resolved but returned no player — never a dead end: the slot
    // keeps the same remove control as a filled card, so it can always be
    // cleared instead of getting stuck.
    return (
      <div
        className="card-editorial relative flex min-h-[180px] flex-col items-center justify-center gap-1.5 p-5 text-center"
        data-testid={`comparison-slot-${index}`}
      >
        <button
          type="button"
          onClick={onRemove}
          aria-label="Ta bort platsen"
          data-testid={`comparison-remove-${entry.playerId}`}
          className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <AlertTriangle className="h-5 w-5 text-destructive/60" aria-hidden="true" />
        <p className="text-sm font-semibold text-foreground">Spelaren kunde inte laddas</p>
        <p className="max-w-[200px] text-[11px] text-muted-foreground/70">
          Profilen kunde inte hämtas just nu. Ta bort platsen och försök igen.
        </p>
      </div>
    );
  }

  const score = entry.analysis?.overall_score ?? null;
  const rec = asRecommendation(entry.analysis?.recommendation ?? null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3, ease: EASE_OUT_QUART }}
      className="card-editorial relative p-5"
      data-testid={`comparison-slot-${index}`}
    >
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Ta bort ${player.name} från jämförelsen`}
        data-testid={`comparison-remove-${entry.playerId}`}
        className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        {score != null ? (
          <div
            className={`flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 ${scoreToneClasses(score)}`}
          >
            <span className="font-mono text-sm font-bold tabular-nums">{score.toFixed(1)}</span>
          </div>
        ) : (
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-border/30">
            <span className="text-[10px] text-muted-foreground/50">–</span>
          </div>
        )}
        <div className="min-w-0">
          <span
            className={`mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${TIER_COLORS[player.tier] ?? TIER_COLORS.development}`}
          >
            {TIER_LABELS[player.tier] ?? player.tier}
          </span>
          <h3 className="truncate text-base font-bold text-foreground">
            <Link
              to={`/players/${player.id}`}
              data-testid={`comparison-player-link-${player.id}`}
              className="transition-colors hover:text-accent"
            >
              {player.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {player.position_primary} · {player.current_club}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground/70">
        <span>{player.age} år</span>
        <span aria-hidden="true">·</span>
        <span>{player.nationality}</span>
        {player.market_value != null && (
          <span className="badge-gold text-[10px]">
            €{(player.market_value / 1_000_000).toFixed(1)}M
          </span>
        )}
      </div>

      <div className="mt-3">
        {entry.analysisLoading ? (
          <div className="h-5 w-24 rounded-sm skeleton-shimmer" />
        ) : rec ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold border ${RECOMMENDATION_COLORS[rec]}`}
            >
              {RECOMMENDATION_LABELS[rec]}
            </span>
            {entry.analysis?.confidence != null && (
              <span className="text-[10px] text-muted-foreground/50">
                {Math.round(Math.min(1, Math.max(0, entry.analysis.confidence)) * 100)} % konfidens
              </span>
            )}
          </div>
        ) : (
          <p className="text-[10px] italic text-muted-foreground/40">Ingen analys körd</p>
        )}
      </div>
    </motion.div>
  );
}

function EmptySlotCard({ index }: { index: number }) {
  return (
    <Link
      to="/players"
      data-testid={`comparison-add-slot-${index}`}
      className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border p-5 text-center text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full icon-premium">
        <Plus className="h-4 w-4 text-accent" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold">Lägg till spelare</span>
      <span className="text-[11px] text-muted-foreground/60">Välj en spelare att jämföra</span>
    </Link>
  );
}

export interface ComparisonSlotsProps {
  entries: ComparisonEntry[];
  onRemove: (playerId: string) => void;
}

export function ComparisonSlots({ entries, onRemove }: ComparisonSlotsProps) {
  const slots: Array<ComparisonEntry | null> = [...entries];
  while (slots.length < 3) slots.push(null);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {slots.map((entry, i) =>
        entry ? (
          <FilledSlotCard
            key={entry.playerId}
            entry={entry}
            index={i}
            onRemove={() => onRemove(entry.playerId)}
          />
        ) : (
          <EmptySlotCard key={`empty-${i}`} index={i} />
        ),
      )}
    </div>
  );
}
