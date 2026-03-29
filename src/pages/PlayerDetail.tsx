import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, User, FileText, Loader2, Trophy, MapPin,
  TrendingUp, Calendar, Ruler, Weight, Footprints,
  ChevronRight,
} from "lucide-react";
import { useGetPlayer } from "@/hooks/use-scout-search";
import { useAnalyzePlayer } from "@/hooks/use-scout-analyze";
import { useGenerateReport } from "@/hooks/use-scout-report";
import { usePersonalityAnalysis } from "@/hooks/use-scout-personality";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { PersonalityPanel } from "@/components/PersonalityPanel";
import { TIER_LABELS, TIER_COLORS } from "@/types/scout";
import type { AnalysisType, AnalysisResult, PersonalityProfile } from "@/types/scout";

const phaseLabels: Record<string, string> = {
  EMERGENCE: "Genombrott",
  DEVELOPMENT: "Utveckling",
  PRIME_EARLY: "Tidig prime",
  PEAK: "Peak",
  MATURITY: "Mognad",
  TWILIGHT: "Avslut",
};

function StatPill({ icon: Icon, label, value }: { icon: typeof Trophy; label: string; value: string | number | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-xs font-medium text-foreground">{value}</div>
      </div>
    </div>
  );
}

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: playerData, isLoading: loadingPlayer } = useGetPlayer(id);
  const player = playerData?.player ?? null;

  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [personalityProfile, setPersonalityProfile] = useState<PersonalityProfile | null>(null);

  const analyze = useAnalyzePlayer();
  const report = useGenerateReport();
  const personality = usePersonalityAnalysis();

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

  const handlePersonality = useCallback(() => {
    if (!id) return;
    personality.mutate(
      { player_id: id },
      {
        onSuccess: (data) => {
          setPersonalityProfile(data.profile);
        },
      },
    );
  }, [id, personality]);

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
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground transition-colors">Dashboard</Link>
        <ChevronRight className="w-3 h-3" />
        <Link to="/players" className="hover:text-foreground transition-colors">Spelare</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-medium truncate max-w-[200px]">
          {player?.name ?? `#${id}`}
        </span>
      </motion.nav>

      {/* Back link */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <Link to="/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Tillbaka
        </Link>
      </motion.div>

      {/* Player loading state */}
      {loadingPlayer && (
        <div className="rounded-2xl p-6 bg-card border border-border">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full skeleton-shimmer" />
            <div className="space-y-2 flex-1">
              <div className="h-6 w-48 rounded-lg skeleton-shimmer" />
              <div className="h-4 w-32 rounded-lg skeleton-shimmer" />
            </div>
          </div>
        </div>
      )}

      {/* Player header card */}
      {player && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl p-6 bg-card border border-border glass glass-border"
        >
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center ring-2 ring-primary/20">
                <User className="w-7 h-7 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold text-foreground">{player.name}</h1>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[player.tier] ?? TIER_COLORS.development}`}>
                    {TIER_LABELS[player.tier] ?? player.tier}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Trophy className="w-3.5 h-3.5" />
                    {player.position_primary}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {player.current_club}
                  </span>
                  {player.current_league && <span>{player.current_league}</span>}
                </div>
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

          {/* Player stats pills */}
          <div className="flex flex-wrap gap-2">
            <StatPill icon={Calendar} label="Ålder" value={player.age ? `${player.age} år` : null} />
            <StatPill icon={MapPin} label="Nationalitet" value={player.nationality} />
            <StatPill icon={TrendingUp} label="Karriärfas" value={phaseLabels[player.career_phase] ?? player.career_phase} />
            <StatPill icon={Ruler} label="Längd" value={player.height_cm ? `${player.height_cm} cm` : null} />
            <StatPill icon={Weight} label="Vikt" value={player.weight_kg ? `${player.weight_kg} kg` : null} />
            <StatPill icon={Footprints} label="Fot" value={player.preferred_foot} />
            {player.market_value != null && (
              <StatPill icon={TrendingUp} label="Marknadsvärde" value={`€${(player.market_value / 1_000_000).toFixed(1)}M`} />
            )}
          </div>
        </motion.div>
      )}

      {/* Analysis panel */}
      {(player || !loadingPlayer) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-2xl p-6 bg-card border border-border">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">AI-analys</h2>
          <AnalysisPanel
            result={analysisResult}
            loading={analyze.isPending}
            error={analyze.error?.message ?? null}
            onAnalyze={handleAnalyze}
          />
        </motion.div>
      )}

      {/* Personality panel — separate async analysis */}
      {analysisResult && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <PersonalityPanel
            profile={personalityProfile}
            loading={personality.isPending}
            error={personality.error?.message ?? null}
            onAnalyze={handlePersonality}
          />
        </motion.div>
      )}

      {/* Report error */}
      {report.error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {report.error.message}
        </div>
      )}
    </div>
  );
};

export default PlayerDetail;
