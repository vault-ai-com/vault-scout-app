import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, User, Loader2, Trophy, MapPin,
  TrendingUp, Calendar, ChevronRight,
} from "lucide-react";
import { useGetCoach } from "@/hooks/use-coach-search";
import { useAnalyzeCoach } from "@/hooks/use-coach-analyze";
import { useCoachPersonality } from "@/hooks/use-coach-personality";
import type { CoachPersonalityResponse } from "@/hooks/use-coach-personality";
import { CoachAnalysisPanel } from "@/components/CoachAnalysisPanel";
import { CoachPersonalityPanel } from "@/components/CoachPersonalityPanel";
import { TIER_LABELS, TIER_COLORS, COACH_CAREER_PHASE_LABELS } from "@/types/scout";
import type { AnalysisResult } from "@/types/scout";

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

const CoachDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: coachData, isLoading: loadingCoach } = useGetCoach(id);
  const coach = coachData?.coach ?? null;

  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [personalityData, setPersonalityData] = useState<CoachPersonalityResponse | null>(null);

  const analyze = useAnalyzeCoach();
  const personality = useCoachPersonality();

  const handleAnalyze = useCallback((type: string) => {
    if (!id) return;
    analyze.mutate(
      { coach_id: id, analysis_type: type },
      { onSuccess: (data) => setAnalysisResult(data.result) },
    );
  }, [id, analyze]);

  const handlePersonality = useCallback(() => {
    if (!id) return;
    personality.mutate(
      { coach_id: id },
      { onSuccess: (data) => setPersonalityData(data) },
    );
  }, [id, personality]);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-accent transition-colors">Dashboard</Link>
        <ChevronRight className="w-3 h-3" />
        <Link to="/coaches" className="hover:text-accent transition-colors">Tränare</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-medium truncate max-w-[200px]">
          {coach?.name ?? `#${id}`}
        </span>
      </motion.nav>

      {/* Back link */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Link to="/coaches" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Tillbaka
        </Link>
      </motion.div>

      {/* Loading */}
      {loadingCoach && (
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

      {/* Coach header */}
      {coach && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="rounded-xl glass-premium gradient-accent-top p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-16 h-16 rounded-2xl icon-premium flex items-center justify-center ring-2 ring-accent/20">
              <User className="w-7 h-7 text-accent" />
            </div>
            <div>
              <span className="section-tag">Tränarprofil</span>
              <div className="flex items-center gap-2.5 mt-1">
                <h1 className="text-2xl font-bold text-foreground tracking-tight">{coach.name}</h1>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[coach.tier] ?? TIER_COLORS.development}`}>
                  {TIER_LABELS[coach.tier] ?? coach.tier}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                {coach.coaching_style && (
                  <span className="flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-accent/60" />
                    {coach.coaching_style}
                  </span>
                )}
                {coach.current_club && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-accent/60" />
                    {coach.current_club}
                  </span>
                )}
                {coach.current_league && <span className="text-muted-foreground/60">{coach.current_league}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatPill icon={Calendar} label="Ålder" value={coach.age > 0 ? `${coach.age} år` : null} />
            <StatPill icon={MapPin} label="Nationalitet" value={coach.nationality} />
            <StatPill icon={TrendingUp} label="Karriärfas" value={COACH_CAREER_PHASE_LABELS[coach.career_phase] ?? coach.career_phase} />
            <StatPill icon={Trophy} label="Formation" value={coach.formation_preference} />
          </div>
        </motion.div>
      )}

      {/* Analysis panel */}
      {(coach || !loadingCoach) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-xl glass-premium card-accent-left p-6 md:p-8">
          <h2 className="section-tag mb-4">AI-analys (CDIM-16)</h2>
          <CoachAnalysisPanel
            result={analysisResult}
            loading={analyze.isPending}
            error={analyze.error?.message ?? null}
            onAnalyze={handleAnalyze}
          />
        </motion.div>
      )}

      {/* Personality panel */}
      {analysisResult && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <CoachPersonalityPanel
            data={personalityData}
            loading={personality.isPending}
            error={personality.error?.message ?? null}
            onAnalyze={handlePersonality}
          />
        </motion.div>
      )}
    </div>
  );
};

export default CoachDetail;
