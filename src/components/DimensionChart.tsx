import { DIMENSION_LABELS } from "@/types/scout";
import type { DimensionScore } from "@/types/scout";

interface DimensionChartProps {
  scores: DimensionScore[];
}

function scoreColor(score: number | null): string {
  if (score == null) return "bg-zinc-600";
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-primary";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

export function DimensionChart({ scores }: DimensionChartProps) {
  if (!scores.length) {
    return <p className="text-sm text-muted-foreground">Inga dimensionspoäng tillgängliga.</p>;
  }

  return (
    <div className="space-y-2">
      {scores.map((dim) => {
        const pct = dim.score != null ? Math.max(0, Math.min(100, dim.score * 10)) : 0;
        const label = DIMENSION_LABELS[dim.dimension_id] ?? dim.dimension_name;

        return (
          <div key={dim.dimension_id} className="group">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-36 flex-shrink-0 truncate" title={label}>
                {label}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${scoreColor(dim.score)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-semibold w-6 text-right text-foreground">
                {dim.score != null ? Math.min(10, Math.max(0, dim.score)).toFixed(1) : "—"}
              </span>
            </div>
            {dim.evidence && (
              <p className="text-[10px] text-muted-foreground/60 ml-[152px] mt-0.5 hidden group-hover:block group-focus-within:block">
                {dim.evidence}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
