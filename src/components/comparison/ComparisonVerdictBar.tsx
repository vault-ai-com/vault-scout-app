import { motion } from "framer-motion";
import { EASE_OUT_QUART } from "@/lib/motion";
import type { ComparisonEntry } from "@/hooks/use-comparison-slots";

// ---------------------------------------------------------------------------
// ComparisonVerdictBar — one overall-score mini-bar per player, with a gold
// "Bäst helhetsbetyg" badge on the winner. Ties get the badge on every tied
// player; players without a score are shown honestly ("—") and are never
// eligible to win. Guards internally: renders nothing with fewer than 2
// scored players (the parent page also gates the surrounding section).
// ---------------------------------------------------------------------------

export interface ComparisonVerdictBarProps {
  entries: ComparisonEntry[];
}

export function ComparisonVerdictBar({ entries }: ComparisonVerdictBarProps) {
  const scores = entries.map((e) => e.analysis?.overall_score ?? null);
  const nonNull = scores.filter((s): s is number => s != null);

  if (nonNull.length < 2) return null;

  const max = Math.max(...nonNull);

  return (
    <div className="card-editorial p-5 md:p-6" data-testid="comparison-verdict-bar">
      <div className="space-y-3.5">
        {entries.map((entry, i) => {
          const score = scores[i];
          const clamped = score == null ? null : Math.min(10, Math.max(0, score));
          const isWinner = clamped != null && Math.abs(clamped - max) < 1e-9;
          const name = entry.player?.name ?? `Spelare ${i + 1}`;

          return (
            <div key={entry.playerId} className="flex items-center gap-3">
              <span
                className="w-28 flex-none truncate text-[12.5px] font-semibold text-foreground md:w-36"
                title={name}
              >
                {name}
              </span>
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/50">
                {clamped != null && (
                  <motion.div
                    className={`h-full rounded-full ${isWinner ? "bg-success" : "bg-accent"}`}
                    style={{ width: `${clamped * 10}%`, transformOrigin: "left" }}
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: i * 0.08, ease: EASE_OUT_QUART }}
                  />
                )}
              </div>
              <span
                className={`w-9 flex-none text-right font-mono text-[13px] font-bold tabular-nums ${clamped != null ? "stat-gold" : "text-muted-foreground/60"}`}
              >
                {clamped != null ? clamped.toFixed(1) : "—"}
              </span>
              {isWinner ? (
                <span className="badge-gold flex-none whitespace-nowrap text-[10px]">Bäst helhetsbetyg</span>
              ) : (
                <span className="w-[118px] flex-none" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
