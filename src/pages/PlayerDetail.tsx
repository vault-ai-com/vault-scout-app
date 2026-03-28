import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, User, FileText, Loader2 } from "lucide-react";
import { useAnalyzePlayer } from "@/hooks/use-scout-analyze";
import { useGenerateReport } from "@/hooks/use-scout-report";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import type { AnalysisType, AnalysisResult } from "@/types/scout";

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  const analyze = useAnalyzePlayer();
  const report = useGenerateReport();

  const handleAnalyze = useCallback((type: AnalysisType) => {
    if (!id) return;
    analyze.mutate(
      { player_id: id, analysis_type: type },
      {
        onSuccess: (data) => {
          setAnalysisResult(data.result);
          setAnalysisId(data.analysis_id);
        },
      },
    );
  }, [id, analyze]);

  const handleReport = useCallback(() => {
    if (!id) return;
    report.mutate(
      { player_id: id, format: "html", analysis_id: analysisId ?? undefined },
      {
        onSuccess: (data) => {
          if (typeof data.report === "string") {
            const blob = new Blob([data.report], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank");
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }
        },
      },
    );
  }, [id, analysisId, report]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Link to="/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" />
          Tillbaka till spelare
        </Link>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-2xl p-6 bg-card border border-border">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Spelare #{id}</h1>
              <p className="text-sm text-muted-foreground">Välj analystyp nedan för att starta</p>
            </div>
          </div>

          {/* Report button */}
          {analysisResult && (
            <button type="button" onClick={handleReport} disabled={report.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {report.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Rapport
            </button>
          )}
        </div>

        {/* Analysis panel */}
        <AnalysisPanel
          result={analysisResult}
          loading={analyze.isPending}
          error={analyze.error?.message ?? null}
          onAnalyze={handleAnalyze}
        />

        {/* Report error */}
        {report.error && (
          <div role="alert" className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {report.error.message}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default PlayerDetail;
