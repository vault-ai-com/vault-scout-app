import { motion } from "framer-motion";
import { DIMENSION_GROUPS } from "@/types/scout";
import type { StatGridDimension } from "@/components/StatGrid";
import { EASE_OUT_QUART } from "@/lib/motion";

/**
 * DimensionRadar — the player's profile across the 5 weighted dimension groups
 * (Taktisk / Teknisk / Fysisk / Mental / Social) as a radar of group-average
 * scores (0–10).
 *
 * Honest by construction: renders ONLY when every group has at least one scored
 * dimension — otherwise returns null and the StatGrid below carries the
 * per-dimension detail (with "—" for missing data, never a bluffed number).
 * The scores are AI analysis (TOLKAT); the section badge already states this,
 * so no measured-cohort / percentile claim is implied here.
 */

const SIZE = 300;
const C = SIZE / 2;
const R = 100;
const LEVELS = [2, 4, 6, 8, 10] as const;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}

function fmt(n: number): string {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function DimensionRadar({ dimensions }: { dimensions: StatGridDimension[] }) {
  const byId = new Map(dimensions.map((d) => [d.id, d]));
  const n = DIMENSION_GROUPS.length;

  const axes = DIMENSION_GROUPS.map((g, i) => {
    const scored = g.dims
      .map((id) => byId.get(id))
      .filter((d): d is StatGridDimension => d?.score != null)
      .map((d) => Math.min(10, Math.max(0, d.score as number)));
    const avg = scored.length ? scored.reduce((s, v) => s + v, 0) / scored.length : null;
    return { label: g.label, avg, angle: (360 / n) * i };
  });

  // Only draw the shape when the profile is complete — no center-collapsed axis.
  if (axes.some((a) => a.avg == null)) return null;

  const vertices = axes.map((a) => polar(R * ((a.avg as number) / 10), a.angle));
  const polygon = vertices.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(" ");
  const overall = axes.reduce((s, a) => s + (a.avg as number), 0) / n;

  return (
    <motion.div
      className="card-editorial mb-4 p-5"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: EASE_OUT_QUART }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[13.5px] font-bold text-foreground">Spelarprofil</h3>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
          5 viktade grupper · snitt {fmt(overall)}
        </span>
      </div>

      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full max-w-[340px] overflow-visible"
          role="img"
          aria-label={`Radardiagram: profil per dimensionsgrupp, snitt ${fmt(overall)} av 10`}
        >
          {/* concentric rings */}
          {LEVELS.map((lvl) => {
            const pts = axes
              .map((a) => polar(R * (lvl / 10), a.angle))
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

          {/* spokes + axis labels + value */}
          {axes.map((a) => {
            const outer = polar(R, a.angle);
            const lbl = polar(R + 18, a.angle);
            const val = polar(R + 32, a.angle);
            return (
              <g key={a.label}>
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
                  {a.label}
                </text>
                <text
                  x={val.x}
                  y={val.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[10px] font-bold tabular-nums"
                  style={{ fill: "hsl(var(--gold-text))" }}
                >
                  {fmt(a.avg as number)}
                </text>
              </g>
            );
          })}

          {/* subject shape */}
          <polygon
            points={polygon}
            strokeWidth={2}
            strokeLinejoin="round"
            style={{ fill: "hsl(var(--gold-text) / 0.14)", stroke: "hsl(var(--gold-text))" }}
          />
          {vertices.map((v, i) => (
            <circle
              key={i}
              cx={v.x}
              cy={v.y}
              r={3.5}
              strokeWidth={2}
              style={{ fill: "hsl(var(--gold-text))", stroke: "hsl(var(--background))" }}
            />
          ))}
        </svg>
      </div>
    </motion.div>
  );
}
