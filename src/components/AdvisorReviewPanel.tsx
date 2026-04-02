import { motion } from "framer-motion";
import { Users, Loader2, AlertTriangle, CheckCircle, ShieldAlert, MessageSquare } from "lucide-react";
import type { AdvisorReviewResponse, AdvisorOpinion } from "@/types/scout";
import { VERDICT_LABELS, VERDICT_COLORS } from "@/types/scout";

interface AdvisorReviewPanelProps {
  review: AdvisorReviewResponse | null;
  loading: boolean;
  error: string | null;
  onReview: () => void;
}

function VerdictIcon({ verdict }: { verdict: AdvisorOpinion["verdict"] }) {
  switch (verdict) {
    case "AGREE":
      return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    case "CHALLENGE":
      return <MessageSquare className="w-4 h-4 text-amber-400" />;
    case "FLAG":
      return <ShieldAlert className="w-4 h-4 text-red-400" />;
  }
}

function OpinionCard({ opinion }: { opinion: AdvisorOpinion }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg p-4 bg-card/60 border border-border/30 backdrop-blur-sm space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <VerdictIcon verdict={opinion.verdict} />
          <span className="text-sm font-semibold text-foreground">{opinion.advisor_name}</span>
          <span className="text-[10px] text-muted-foreground/70">{opinion.domain}</span>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${VERDICT_COLORS[opinion.verdict]}`}>
          {VERDICT_LABELS[opinion.verdict]}
        </span>
      </div>

      {/* Summary */}
      <p className="text-xs font-medium text-foreground/90">{opinion.summary}</p>

      {/* Detail (collapsed by default for cleanliness) */}
      <details className="group">
        <summary className="text-[10px] text-accent cursor-pointer hover:underline">
          Visa fullständig analys
        </summary>
        <p className="text-xs text-foreground/80 mt-2 leading-relaxed whitespace-pre-line">
          {opinion.detail}
        </p>
      </details>

      {/* Risk flags */}
      {opinion.risk_flags.length > 0 && (
        <div>
          <h5 className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">Risker</h5>
          <ul className="space-y-0.5">
            {opinion.risk_flags.map((flag, i) => (
              <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {opinion.recommendations.length > 0 && (
        <div>
          <h5 className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">Rekommendationer</h5>
          <ul className="space-y-0.5">
            {opinion.recommendations.map((rec, i) => (
              <li key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                <span className="text-emerald-400 mt-0.5">→</span> {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confidence + evidence */}
      <div className="flex items-center justify-between pt-1 border-t border-border/20">
        {opinion.evidence_refs.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[70%]">
            {opinion.evidence_refs.join(", ")}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          Konfidens {Math.round(opinion.confidence * 100)}%
        </span>
      </div>
    </motion.div>
  );
}

export function AdvisorReviewPanel({ review, loading, error, onReview }: AdvisorReviewPanelProps) {
  return (
    <div className="rounded-xl p-6 md:p-8 glass-premium card-accent-left space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-tag flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          Sport Advisory Board
        </h3>
        {!review && !loading && (
          <button
            type="button"
            onClick={onReview}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-accent/30 text-accent hover:bg-accent/10 btn-premium transition-colors"
          >
            Begär expertgranskning
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          <span className="text-sm text-muted-foreground">Konsulterar experter...</span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {review && !loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Consensus banner */}
          {review.consensus && (
            <div className={`rounded-lg p-3 border text-sm font-medium ${
              review.opinions.some((o) => o.verdict === "FLAG")
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : review.opinions.every((o) => o.verdict === "AGREE")
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-400"
            }`}>
              {review.consensus}
            </div>
          )}

          {/* Opinion cards */}
          <div className="space-y-3">
            {review.opinions.map((opinion) => (
              <OpinionCard key={opinion.advisor_id} opinion={opinion} />
            ))}
          </div>

          {/* Footer metadata */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
            <span>{review.advisors_consulted} expert{review.advisors_consulted !== 1 ? "er" : ""} konsulterade</span>
            <span>{(review.duration_ms / 1000).toFixed(1)}s</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
