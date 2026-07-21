import { motion } from "framer-motion";
import { DIMENSION_GROUPS } from "@/types/scout";
import { EASE_OUT_QUART } from "@/lib/motion";
import type { ComparisonEntry } from "@/hooks/use-comparison-slots";

/**
 * ComparisonRadar — up to 3 players' 5-group profiles (Taktisk / Teknisk /
 * Fysisk / Mental / Social) overlaid on one radar, colour-coded with a legend.
 *
 * Honest by construction: a player's shape is drawn ONLY when every group has
 * at least one scored dimension — players with incomplete data are named in a
 * caption instead of drawn as a collapsed shape. Scores are AI analysis
 * (TOLKAT); no measured-cohort / percentile claim is implied. The dimension
 * matrix below carries the per-dimension detail (with "—" for missing data).
 */

const SIZE = 320;
const C = SIZE / 2;
const R = 108;
const LEVELS = [2, 4, 6, 8, 10] as const;

// Distinct, dark-surface-legible series colours (max 3 players).
const SERIES = [
  { stroke: "hsl(var(--gold-text))", fill: "hsl(var(--gold-text) / 0.12)" },
  { stroke: "#3987e5", fill: "rgba(57,135,229,0.12)" },
  { stroke: "#199e70", fill: "rgba(25,158,112,0.12)" },
] as const;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}

function fmt(n: number): string {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Per-group average (0–10) for one entry; null when a group has no scored dimension. */
function groupAverages(entry: ComparisonEntry): Array<number | null> {
  const byId = new Map(entry.scores.map((s) => [s.dimension_id, s.score] as const));
  return DIMENSION_GROUPS.map((g) => {
    const vals = g.dims
      .map((id) => byId.get(id))
      .filter((v): v is number => v != null)
      .map((v) => Math.min(10, Math.max(0, v)));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
}

export function ComparisonRadar({
  entries,
  playerNames,
}: {
  entries: ComparisonEntry[];
  playerNames: string[];
}) {
  const n = DIMENSION_GROUPS.length;
  const angles = DIMENSION_GROUPS.map((_, i) => (360 / n) * i);

  const series = entries.slice(0, 3).map((e, i) => {
    const avgs = groupAverages(e);
    return {
      name: playerNames[i] || `Spelare ${i + 1}`,
      avgs,
      complete: avgs.every((a) => a != null),
      color: SERIES[i],
    };
  });

  const drawable = series.filter((s) => s.complete);
  const incomplete = series.filter((s) => !s.complete).map((s) => s.name);

  // Need ≥2 complete profiles for a comparison radar to say anything; below
  // that the matrix already carries the detail.
  if (drawable.length < 2) return null;

  return (
    <motion.div
      className="card-editorial p-5"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: EASE_OUT_QUART }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-bold text-foreground">Profilöverlägg</h3>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
          5 viktade grupper · score 0–10
        </span>
      </div>

      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full max-w-[360px] overflow-visible"
          role="img"
          aria-label={`Radardiagram: profilöverlägg för ${drawable.map((s) => s.name).join(", ")}`}
        >
          {/* rings */}
          {LEVELS.map((lvl) => {
            const pts = angles
              .map((ang) => polar(R * (lvl / 10), ang))
              .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(" ");
            return (
              <polygon
                key={lvl}
                points={pts}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={1}
                opacity={lvl === 10 ? 0.85 : 0.35}
              />
            );
          })}

          {/* spokes + group labels */}
          {DIMENSION_GROUPS.map((g, i) => {
            const outer = polar(R, angles[i]);
            const lbl = polar(R + 18, angles[i]);
            return (
              <g key={g.id}>
                <line
                  x1={C}
                  y1={C}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                  opacity={0.35}
                />
                <text
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[10px] font-semibold"
                  style={{ fill: "hsl(var(--muted-foreground))" }}
                >
                  {g.label}
                </text>
              </g>
            );
          })}

          {/* player shapes (drawn back-to-front so earlier series stay legible on top) */}
          {drawable
            .slice()
            .reverse()
            .map((s) => {
              const pts = s.avgs
                .map((a, i) => polar(R * ((a as number) / 10), angles[i]))
                .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(" ");
              return (
                <polygon
                  key={s.name}
                  points={pts}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  style={{ fill: s.color.fill, stroke: s.color.stroke }}
                />
              );
            })}
        </svg>
      </div>

      {/* legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1.5">
        {drawable.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-2 text-[11.5px] text-foreground/90">
            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: s.color.stroke }} aria-hidden="true" />
            <span className="truncate">{s.name}</span>
          </span>
        ))}
      </div>

      {incomplete.length > 0 && (
        <p className="mt-2 text-center text-[10.5px] italic text-muted-foreground/60">
          {incomplete.join(", ")} saknar fullständig data — visas i matrisen nedan, inte i radarn.
        </p>
      )}
    </motion.div>
  );
}
