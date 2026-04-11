import { motion } from "framer-motion";
import { DIMENSION_LABELS } from "@/types/scout";
import type { DimensionScore } from "@/types/scout";

interface DimensionChartProps {
  scores: DimensionScore[];
  labelMap?: Record<string, string>;
}

function scoreColor(score: number | null): string {
  if (score == null) return "bg-zinc-600";
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-accent";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

export function DimensionChart({ scores, labelMap = DIMENSION_LABELS }: DimensionChartProps) {
  if (!scores.length) {
    return <p className="text-sm text-muted-foreground">Inga dimensionspoäng tillgängliga.</p>;
  }

  return (
    <motion.div
      className="space-y-2"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
    >
      {scores.map((dim) => {
        const pct = dim.score != null ? Math.max(0, Math.min(100, dim.score * 10)) : 0;
        const label = labelMap[dim.dimension_id] ?? dim.dimension_name;

        return (
          <motion.div
            key={dim.dimension_id}
            className="group"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-36 flex-shrink-0 truncate" title={label}>
                {label}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${scoreColor(dim.score)}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <span className="text-xs font-bold w-6 text-right text-foreground">
                {dim.score != null ? Math.min(10, Math.max(0, dim.score)).toFixed(1) : "—"}
              </span>
            </div>
            {dim.evidence && (
              <p className="text-[10px] text-muted-foreground/60 ml-[152px] mt-0.5 hidden group-hover:block group-focus-within:block">
                {dim.evidence}
              </p>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
