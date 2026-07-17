import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { DIMENSION_GROUPS, DIMENSION_LABELS } from "@/types/scout";
import { EASE_OUT_QUART } from "@/lib/motion";

/**
 * StatGrid — the analytical core of PlayerDetail.
 * 16 dimensions in 5 weighted groups (Taktisk 22 / Teknisk 27 / Fysisk 18 /
 * Mental 23 / Social 10). Every row: 0–10 bar (scaleX whileInView, staggered),
 * gold score, evidence as expandable muted subtext. Missing dimensions are
 * shown honestly as "—" with a data-gap flag — never a bluffed number.
 */

export interface StatGridDimension {
  id: string;
  name: string;
  score: number | null;
  confidence: number | null;
  evidence: string | null;
}

function barColorClass(score: number): string {
  if (score >= 8) return "bg-success";
  if (score >= 6) return "bg-accent";
  if (score >= 4) return "bg-warning";
  return "bg-destructive";
}

const fmtScore = (n: number): string =>
  n.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Single dimension row
// ---------------------------------------------------------------------------

function DimensionRow({
  dimId,
  dim,
  index,
}: {
  dimId: string;
  dim: StatGridDimension | undefined;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = DIMENSION_LABELS[dimId] ?? dim?.name ?? dimId;
  const score = dim?.score ?? null;
  const clamped = score == null ? null : Math.min(10, Math.max(0, score));
  const evidence = dim?.evidence ?? null;
  const isLongEvidence = !!evidence && evidence.length > 110;

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="w-[168px] flex-none truncate text-[12.5px] font-medium text-foreground/90" title={label}>
          {label}
        </span>

        {clamped != null ? (
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/50">
            <motion.div
              className={`h-full origin-left rounded-full ${barColorClass(clamped)}`}
              style={{ width: `${clamped * 10}%` }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.06, ease: EASE_OUT_QUART }}
            />
          </div>
        ) : (
          <div
            className="h-1.5 min-w-0 flex-1 rounded-full border border-dashed border-border"
            role="img"
            aria-label={`${label}: data saknas`}
          />
        )}

        <span className={`w-9 flex-none text-right font-mono text-[13px] font-bold ${clamped != null ? "stat-gold" : "text-muted-foreground/60"}`}>
          {clamped != null ? fmtScore(clamped) : "—"}
        </span>
      </div>

      {clamped == null && (
        <p className="mt-1 pl-[180px] text-[10.5px] italic text-muted-foreground/60">
          Data saknas i denna analys — betygsätts inte.
        </p>
      )}

      {evidence && (
        <div className="mt-1 pl-[180px]">
          <p className={`text-[11px] leading-relaxed text-muted-foreground ${expanded ? "" : "line-clamp-1"}`}>
            {evidence}
          </p>
          {isLongEvidence && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-0.5 inline-flex min-h-[28px] items-center gap-1 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
              {expanded ? "Visa mindre" : "Visa hela underlaget"}
            </button>
          )}
          {dim?.confidence != null && (
            <span className="ml-0 mt-0.5 block text-[10px] tabular-nums text-muted-foreground/60">
              Konfidens {Math.round(Math.min(1, Math.max(0, dim.confidence)) * 100)} %
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatGrid — 5 group cards
// ---------------------------------------------------------------------------

export function StatGrid({ dimensions }: { dimensions: StatGridDimension[] }) {
  const byId = new Map(dimensions.map((d) => [d.id, d]));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {DIMENSION_GROUPS.map((group, gi) => {
        const rows = group.dims.map((dimId) => byId.get(dimId));
        const scored = rows.filter((d): d is StatGridDimension => d?.score != null);
        const avg =
          scored.length > 0
            ? scored.reduce((sum, d) => sum + Math.min(10, Math.max(0, d.score as number)), 0) / scored.length
            : null;
        const missing = group.dims.length - scored.length;

        return (
          <motion.section
            key={group.id}
            aria-label={`${group.label} — viktning ${group.weightPct} %`}
            className="card-editorial p-5"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: gi * 0.06, ease: EASE_OUT_QUART }}
          >
            <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border/60 pb-3">
              <div className="min-w-0">
                <h3 className="text-[13.5px] font-bold text-foreground">{group.label}</h3>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                  Viktning {group.weightPct} % · {group.dims.length} dimensioner
                </span>
              </div>
              <div className="flex-none text-right">
                <span className={`font-mono text-lg font-extrabold ${avg != null ? "stat-gold" : "text-muted-foreground/60"}`}>
                  {avg != null ? fmtScore(avg) : "—"}
                </span>
                <span className="block text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">Gruppsnitt</span>
              </div>
            </div>

            <div className="divide-y divide-border/40">
              {group.dims.map((dimId, i) => (
                <DimensionRow key={dimId} dimId={dimId} dim={byId.get(dimId)} index={i} />
              ))}
            </div>

            {missing > 0 && scored.length > 0 && (
              <p className="mt-3 border-t border-border/40 pt-2.5 text-[10.5px] text-muted-foreground/70">
                {missing} av {group.dims.length} dimensioner saknar data — gruppsnittet bygger på {scored.length} betygsatta.
              </p>
            )}
          </motion.section>
        );
      })}
    </div>
  );
}
