import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { User, Trophy, MapPin, TrendingUp, Calendar } from "lucide-react";
import { useGetCoach } from "@/hooks/use-coach-search";
import { useAnalyzeCoach } from "@/hooks/use-coach-analyze";
import { useCoachPersonality } from "@/hooks/use-coach-personality";
import type { CoachPersonalityResponse } from "@/hooks/use-coach-personality";
import { CoachAnalysisPanel } from "@/components/CoachAnalysisPanel";
import { CoachPersonalityPanel } from "@/components/CoachPersonalityPanel";
import { DossierScaffold } from "@/components/scaffolds/DossierScaffold";
import { SectionShell, type SecNavItem } from "@/components/report";
import { TIER_LABELS, TIER_COLORS, COACH_CAREER_PHASE_LABELS } from "@/types/scout";
import type { AnalysisResult } from "@/types/scout";

function StatPill({ icon: Icon, label, value }: { icon: typeof Trophy; label: string; value: string | number | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-card/60 border border-border/30">
      <Icon className="w-3.5 h-3.5 text-accent/50" aria-hidden="true" />
      <div>
        <div className="text-[10px] text-muted-foreground/70 font-medium">{label}</div>
        <div className="text-xs font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

const SECTIONS: SecNavItem[] = [
  { id: "analys", label: "AI-analys", group: "Profil" },
  { id: "personlighet", label: "Personlighet", group: "Profil" },
];
const SECTION_GROUPS = ["Profil"] as const;

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

  const hero = coach ? (
    <div className="card-editorial p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center flex-none">
          <User className="w-7 h-7 text-accent" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <span className="eyebrow">Tränarprofil</span>
          <div className="flex items-center gap-2.5 mt-1 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{coach.name}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[coach.tier] ?? TIER_COLORS.development}`}>
              {TIER_LABELS[coach.tier] ?? coach.tier}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
            {coach.coaching_style && (
              <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-accent/60" aria-hidden="true" />{coach.coaching_style}</span>
            )}
            {coach.current_club && (
              <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-accent/60" aria-hidden="true" />{coach.current_club}</span>
            )}
            {coach.current_league && <span className="text-muted-foreground/60">{coach.current_league}</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-6">
        <StatPill icon={Calendar} label="Ålder" value={coach.age > 0 ? `${coach.age} år` : null} />
        <StatPill icon={MapPin} label="Nationalitet" value={coach.nationality} />
        <StatPill icon={TrendingUp} label="Karriärfas" value={COACH_CAREER_PHASE_LABELS[coach.career_phase] ?? coach.career_phase} />
        <StatPill icon={Trophy} label="Formation" value={coach.formation_preference} />
      </div>
    </div>
  ) : null;

  return (
    <DossierScaffold
      loading={loadingCoach}
      loadingAriaLabel="Laddar tränarprofil"
      notFound={!loadingCoach && !coach}
      notFoundTitle="Tränaren hittades inte"
      notFoundBody="Profilen finns inte eller är inte tillgänglig för din organisation. Gå tillbaka och välj en tränare från listan."
      backHref="/coaches"
      backLabel="Tillbaka till tränare"
      breadcrumb={[
        { label: "Dashboard", href: "/" },
        { label: "Tränare", href: "/coaches" },
        { label: coach?.name ?? `#${id}` },
      ]}
      hero={hero}
      sections={SECTIONS}
      sectionGroups={SECTION_GROUPS}
      layoutId="coachdetail-secnav-indicator"
    >
      {(spy) => (
        <>
          <SectionShell id="analys" index={1} title="AI-analys (CDIM-16)" registerRef={spy.registerRef}>
            <CoachAnalysisPanel
              result={analysisResult}
              loading={analyze.isPending}
              error={analyze.error?.message ?? null}
              onAnalyze={handleAnalyze}
            />
          </SectionShell>
          <SectionShell id="personlighet" index={2} title="Personlighet" registerRef={spy.registerRef}>
            <CoachPersonalityPanel
              data={personalityData}
              loading={personality.isPending}
              error={personality.error?.message ?? null}
              onAnalyze={handlePersonality}
            />
          </SectionShell>
        </>
      )}
    </DossierScaffold>
  );
};

export default CoachDetail;
