import { motion } from "framer-motion";
import { Loader2, AlertTriangle, CheckCircle, Eye, XCircle, HelpCircle } from "lucide-react";
import { DimensionChart } from "@/components/DimensionChart";
import { COACH_DIMENSION_LABELS, RECOMMENDATION_COLORS } from "@/types/scout";
import type { AnalysisResult, Recommendation } from "@/types/scout";

type CoachAnalysisType = "full_scout" | "quick_scan";

interface CoachAnalysisPanelProps {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onAnalyze: (type: CoachAnalysisType) => void;
}

const recIcons: Record<Recommendation, typeof CheckCircle> = {
  SIGN: CheckCircle,
  MONITOR: Eye,
  PASS: XCircle,
  INSUFFICIENT_DATA: HelpCircle,
};

const recLabels: Record<Recommendation, string> = {
  SIGN: "Signa",
  MONITOR: "Bevaka",
  PASS: "Pass",
  INSUFFICIENT_DATA: "Otillräcklig data",
};

const analysisTypes: { value: CoachAnalysisType; label: string }[] = [
  { value: "full_scout", label: "Fullständig" },
  { value: "quick_scan", label: "Snabb" },
];

export function CoachAnalysisPanel({ result, loading, error, onAnalyze }: CoachAnalysisPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {analysisTypes.map((t) => (
          <button key={t.value} type="button" onClick={() => onAnalyze(t.value)} disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border/50 text-foreground hover:bg-accent/10 hover:border-accent/30 hover:text-accent btn-premium transition-colors disabled:opacity-50">
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-2 p-4 rounded-xl glass-premium" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          <span className="text-sm text-muted-foreground">Analyserar tränare...</span>
        </motion.div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {result && !loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex items-center gap-3">
            {(() => {
              const Icon = recIcons[result.recommendation];
              const colorClass = RECOMMENDATION_COLORS[result.recommendation];
              return (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border ${colorClass}`}>
                  <Icon className="w-4 h-4" />
                  {recLabels[result.recommendation]}
                </span>
              );
            })()}
            <div className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center ${
              result.overall_score >= 7 ? "border-emerald-500/60" : result.overall_score >= 4 ? "border-amber-500/60" : "border-red-500/60"
            }`}>
              <span className="text-lg font-extrabold stat-gold leading-none">{Math.min(10, Math.max(0, result.overall_score)).toFixed(1)}</span>
              <span className="text-[8px] text-muted-foreground leading-none mt-0.5">
                {Math.min(100, Math.max(0, result.confidence * 100)).toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="rounded-xl p-4 glass-premium">
            <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
          </div>

          <div className="rounded-xl p-4 glass-premium">
            <h3 className="section-tag mb-3">CDIM-analys (16 dimensioner)</h3>
            <DimensionChart scores={result.dimension_scores} labelMap={COACH_DIMENSION_LABELS} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl p-4 glass-premium card-accent-left-green">
              <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Styrkor</h3>
              <motion.ul className="space-y-1" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }}>
                {result.strengths.map((s, i) => (
                  <motion.li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5"
                    variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }}>
                    <span className="text-emerald-400 mt-0.5">+</span> {s}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
            <div className="rounded-xl p-4 glass-premium card-accent-left-red">
              <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Svagheter</h3>
              <motion.ul className="space-y-1" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }}>
                {result.weaknesses.map((w, i) => (
                  <motion.li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5"
                    variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }}>
                    <span className="text-red-400 mt-0.5">−</span> {w}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          </div>

          {result.risk_factors.length > 0 && (
            <div className="rounded-xl p-4 glass-premium card-accent-left-gold">
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Riskfaktorer</h3>
              <motion.ul className="space-y-1" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }}>
                {result.risk_factors.map((r, i) => (
                  <motion.li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5"
                    variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }}>
                    <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" /> {r}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
