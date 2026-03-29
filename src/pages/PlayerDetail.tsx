import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, User, FileText, Loader2, Trophy, MapPin,
  TrendingUp, Calendar, Ruler, Weight, Footprints,
  ChevronRight, Star, GitCompare,
} from "lucide-react";
import { useGetPlayer } from "@/hooks/use-scout-search";
import { useIsOnWatchlist, useToggleWatchlist } from "@/hooks/use-scout-watchlist";
import { NotesPanel } from "@/components/NotesPanel";
import { useAnalyzePlayer } from "@/hooks/use-scout-analyze";
import { useGenerateReport } from "@/hooks/use-scout-report";
import { usePersonalityAnalysis } from "@/hooks/use-scout-personality";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { PersonalityPanel } from "@/components/PersonalityPanel";
import { ComparablePlayersPanel } from "@/components/ComparablePlayersPanel";
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
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-card/60 border border-border/30 backdrop-blur-sm">
      <Icon className="w-3.5 h-3.5 text-accent/50" />
      <div>
        <div className="text-[10px] text-muted-foreground/70 font-medium">{label}</div>
        <div className="text-xs font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: playerData, isLoading: loadingPlayer } = useGetPlayer(id);
  const { data: watchlistData } = useIsOnWatchlist(id ?? "");
  const isOnWatchlist = watchlistData?.isOnWatchlist ?? false;
  const watchlistId = watchlistData?.watchlistId ?? null;
  const toggleWatchlist = useToggleWatchlist();
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
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-accent transition-colors">Dashboard</Link>
        <ChevronRight className="w-3 h-3" />
        <Link to="/players" className="hover:text-accent transition-colors">Spelare</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-medium truncate max-w-[200px]">
          {player?.name ?? `#${id}`}
        </span>
      </motion.nav>

      {/* Back link */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <Link to="/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Tillbaka
        </Link>
      </motion.div>

      {/* Player loading state */}
      {loadingPlayer && (
        <div className="rounded-xl glass-premium p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl skeleton-shimmer" />
            <div className="space-y-3 flex-1">
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
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="rounded-xl glass-premium gradient-accent-top p-6 md:p-8"
        >
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl icon-premium flex items-center justify-center ring-2 ring-accent/20">
                <User className="w-7 h-7 text-accent" />
              </div>
              <div>
                <span className="section-tag">Spelarprofil</span>
                <div className="flex items-center gap-2.5 mt-1">
                  <h1 className="text-2xl font-bold text-foreground tracking-tight">{player.name}</h1>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[player.tier] ?? TIER_COLORS.development}`}>
                    {TIER_LABELS[player.tier] ?? player.tier}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-accent/60" />
                    {player.position_primary}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-accent/60" />
                    {player.current_club}
                  </span>
                  {player.current_league && <span className="text-muted-foreground/60">{player.current_league}</span>}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => id && toggleWatchlist.mutate({ playerId: id, isOnWatchlist, watchlistId })}
                disabled={toggleWatchlist.isPending}
                aria-label={isOnWatchlist ? "Ta bort från bevakningslista" : "Lägg till i bevakningslista"}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 ${
                  isOnWatchlist
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                    : "bg-card/60 text-muted-foreground border-border/40 hover:text-amber-400 hover:border-amber-500/30"
                }`}
              >
                <Star className={`w-4 h-4 ${isOnWatchlist ? "fill-amber-400" : ""}`} />
                {isOnWatchlist ? "Bevakar" : "Bevaka"}
              </button>
              <Link
                to={`/comparison?ids=${id}`}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border border-border/40 bg-card/60 text-muted-foreground hover:text-accent hover:border-accent/40 transition-colors"
              >
                <GitCompare className="w-4 h-4" />
                Jämför
              </Link>
              {analysisResult && (
                <button type="button" onClick={handleReport} disabled={report.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-accent text-accent-foreground btn-premium disabled:opacity-50 shadow-lg shadow-accent/20">
                  {report.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Rapport
                </button>
              )}
            </div>
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
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="rounded-xl glass-premium card-accent-left p-6 md:p-8">
          <h2 className="section-tag mb-4">AI-analys</h2>
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

      {/* Comparable players */}
      {player && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <ComparablePlayersPanel player={player} />
        </motion.div>
      )}

      {/* Notes panel */}
      {player && id && (
        <NotesPanel playerId={id} />
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
