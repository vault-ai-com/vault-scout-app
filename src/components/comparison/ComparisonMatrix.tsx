import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { StatGrid, type StatGridDimension } from "@/components/StatGrid";
import { EmptyState } from "@/components/EmptyState";
import { DIMENSION_GROUPS, DIMENSION_LABELS } from "@/types/scout";
import { EASE_OUT_QUART } from "@/lib/motion";
import type { ComparisonEntry } from "@/hooks/use-comparison-slots";

// ---------------------------------------------------------------------------
// ComparisonMatrix — StatGrid-style dimension groups, but with one score
// column per player instead of one. The best non-null score in each
// dimension row gets a success ring + "Bäst" tag; the rest get a small
// delta chip ("−0.7"). Missing data is never crowned. With exactly one
// player, this delegates straight to StatGrid — plain bars, no comparison
// chrome (there's nothing to compare against).
// ---------------------------------------------------------------------------

function fmtScore(n: number): string {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function barColorClass(score: number): string {
  if (score >= 8) return "bg-success";
  if (score >= 6) return "bg-accent";
  if (score >= 4) return "bg-warning";
  return "bg-destructive";
}

/** Error copy — distinct from "no analysis run yet" so a failed fetch never reads as empty. */
function missingDataMessage(erroredCount: number, totalCount: number): string {
  if (erroredCount === totalCount) {
    return `Analysdata kunde inte hämtas för ${totalCount === 1 ? "spelaren" : "spelarna"}. Ladda om sidan för att försöka igen.`;
  }
  return `Analysdata kunde inte hämtas för ${erroredCount} av ${totalCount} spelare — visas som saknad data nedan.`;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-sm border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row layout — one fixed-width label column + N equal player columns. Used
// both for the one-off player-name header and for every dimension row, so
// everything lines up without a real <table>.
// ---------------------------------------------------------------------------

function RowLayout({ label, cells }: { label: ReactNode; cells: ReactNode[] }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[150px] flex-none">{label}</div>
      <div
        className="grid flex-1 gap-2.5"
        style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      >
        {cells.map((cell, i) => (
          <div key={i} className="min-w-0">
            {cell}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreCell({
  score,
  isBest,
  delta,
}: {
  score: number | null;
  isBest: boolean;
  delta: number | null;
}) {
  if (score == null) {
    return (
      <div className="flex h-8 items-center justify-center rounded-md border border-dashed border-border">
        <span className="text-[11px] text-muted-foreground/50">—</span>
      </div>
    );
  }

  const clamped = Math.min(10, Math.max(0, score));

  return (
    <div className={`rounded-md px-2 py-1.5 transition-colors ${isBest ? "bg-success/10 ring-1 ring-success/50" : ""}`}>
      <div className="flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/50">
          <motion.div
            className={`h-full rounded-full ${barColorClass(clamped)}`}
            style={{ width: `${clamped * 10}%` }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: EASE_OUT_QUART }}
          />
        </div>
        <span
          className={`flex-none font-mono text-[12px] font-bold tabular-nums ${isBest ? "text-success" : "stat-gold"}`}
        >
          {fmtScore(clamped)}
        </span>
      </div>
      {isBest ? (
        <span className="mt-0.5 block text-[10px] font-semibold text-success">Bäst</span>
      ) : delta != null && delta > 0 ? (
        <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground/60">
          −{fmtScore(delta)}
        </span>
      ) : null}
    </div>
  );
}

export interface ComparisonMatrixProps {
  entries: ComparisonEntry[];
  playerNames: string[];
}

export function ComparisonMatrix({ entries, playerNames }: ComparisonMatrixProps) {
  const anyLoading = entries.some((e) => e.analysisLoading);
  const erroredEntries = entries.filter((e) => e.analysisError != null);
  const allEmpty = entries.length === 0 || entries.every((e) => !e.analysisLoading && e.analysis == null);

  if (anyLoading) {
    return (
      <div className="card-editorial space-y-2.5 p-6" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-6 rounded-sm skeleton-shimmer" />
        ))}
      </div>
    );
  }

  if (allEmpty) {
    // A failed fetch never reads as "ingen analys körd" — errored entries get
    // their own banner, separate from the genuinely-never-analyzed empty state.
    return (
      <div className="space-y-3">
        {erroredEntries.length > 0 && (
          <ErrorBanner message={missingDataMessage(erroredEntries.length, entries.length)} />
        )}
        {erroredEntries.length < entries.length && (
          <EmptyState>
            Ingen analys har körts ännu. Kör en AI-analys på spelarprofilsidan för att se dimensionspoäng här.
          </EmptyState>
        )}
      </div>
    );
  }

  // Single player — plain bars, no comparison chrome. Reuse StatGrid verbatim.
  if (entries.length === 1) {
    const dims: StatGridDimension[] = entries[0].scores.map((s) => ({
      id: s.dimension_id,
      name: s.dimension_name,
      score: s.score,
      confidence: s.confidence,
      evidence: s.evidence,
    }));
    return <StatGrid dimensions={dims} />;
  }

  const minWidth = Math.max(480, 170 + entries.length * 150);

  return (
    <div className="overflow-x-auto">
      <div className="space-y-4" style={{ minWidth }}>
        {erroredEntries.length > 0 && (
          <ErrorBanner message={missingDataMessage(erroredEntries.length, entries.length)} />
        )}

        {/* Column header — player names, aligned with the rows below */}
        <div className="card-editorial px-5 py-3">
          <RowLayout
            label={
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                Dimension
              </span>
            }
            cells={entries.map((e, i) => (
              <span
                key={e.playerId}
                className="block truncate text-[12px] font-bold text-foreground"
                title={playerNames[i] || undefined}
              >
                {playerNames[i] || `Spelare ${i + 1}`}
              </span>
            ))}
          />
        </div>

        {DIMENSION_GROUPS.map((group, gi) => (
          <motion.section
            key={group.id}
            aria-label={`${group.label} — viktning ${group.weightPct} %`}
            className="card-editorial p-5"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: gi * 0.05, ease: EASE_OUT_QUART }}
          >
            <div className="mb-3.5 border-b border-border/60 pb-2.5">
              <h3 className="text-[13.5px] font-bold text-foreground">{group.label}</h3>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                Viktning {group.weightPct} % · {group.dims.length} dimensioner
              </span>
            </div>

            <div className="divide-y divide-border/40">
              {group.dims.map((dimId) => {
                const dimScores = entries.map((e) => e.scores.find((s) => s.dimension_id === dimId)?.score ?? null);
                const nonNull = dimScores.filter((s): s is number => s != null);
                const max = nonNull.length > 0 ? Math.max(...nonNull) : null;

                return (
                  <div key={dimId} className="py-2.5">
                    <RowLayout
                      label={
                        <span
                          className="block truncate text-[12.5px] text-muted-foreground"
                          title={DIMENSION_LABELS[dimId] ?? dimId}
                        >
                          <span className="mr-1.5 font-mono text-[10px] text-accent/60">{dimId}</span>
                          {DIMENSION_LABELS[dimId] ?? dimId}
                        </span>
                      }
                      cells={dimScores.map((score, i) => {
                        const isBest =
                          max != null && score != null && nonNull.length > 1 && Math.abs(score - max) < 1e-9;
                        const delta = max != null && score != null ? max - score : null;
                        return (
                          <ScoreCell key={entries[i].playerId} score={score} isBest={isBest} delta={delta} />
                        );
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </motion.section>
        ))}
      </div>
    </div>
  );
}
