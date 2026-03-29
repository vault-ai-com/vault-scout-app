import { motion } from "framer-motion";
import { Loader2, AlertTriangle, CheckCircle, Eye, XCircle, HelpCircle } from "lucide-react";
import { DimensionChart } from "@/components/DimensionChart";
import type { AnalysisResult, AnalysisType, Recommendation } from "@/types/scout";
import { RECOMMENDATION_COLORS } from "@/types/scout";

interface AnalysisPanelProps {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  onAnalyze: (type: AnalysisType) => void;
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

const analysisTypes: { value: AnalysisType; label: string }[] = [
  { value: "full_scout", label: "Fullständig" },
  { value: "quick_scan", label: "Snabb" },
  { value: "match_review", label: "Matchanalys" },
  { value: "transfer_assessment", label: "Transfervärdering" },
];

export function AnalysisPanel({ result, loading, error, onAnalyze }: AnalysisPanelProps) {
  return (
    <div className="space-y-4">
      {/* Analysis type buttons */}
      <div className="flex flex-wrap gap-2">
        {analysisTypes.map((t) => (
          <button key={t.value} type="button" onClick={() => onAnalyze(t.value)} disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-foreground hover:bg-card hover:border-primary/30 transition-colors disabled:opacity-50">
            {t.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-2 p-4 rounded-xl bg-card border border-border" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Analyserar spelare...</span>
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Recommendation badge + score */}
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
            <div className="text-right">
              <div className="text-2xl font-bold text-foreground">{Math.min(10, Math.max(0, result.overall_score)).toFixed(1)}</div>
              <div className="text-[10px] text-muted-foreground">
                Konfidens {Math.min(100, Math.max(0, result.confidence * 100)).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl p-4 bg-card border border-border">
            <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
          </div>

          {/* Dimension chart */}
          <div className="rounded-xl p-4 bg-card border border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Dimensionsanalys
            </h3>
            <DimensionChart scores={result.dimension_scores} />
          </div>

          {/* Strengths & Weaknesses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl p-4 bg-card border border-border">
              <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Styrkor</h3>
              <ul className="space-y-1">
                {result.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <span className="text-emerald-400 mt-0.5">+</span> {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl p-4 bg-card border border-border">
              <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Svagheter</h3>
              <ul className="space-y-1">
                {result.weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5">−</span> {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Risk factors */}
          {result.risk_factors.length > 0 && (
            <div className="rounded-xl p-4 bg-card border border-border">
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Riskfaktorer</h3>
              <ul className="space-y-1">
                {result.risk_factors.map((r, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
