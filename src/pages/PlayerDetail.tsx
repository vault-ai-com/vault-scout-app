import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useGetPlayer } from "@/hooks/use-scout-search";
import { useIsOnWatchlist, useToggleWatchlist } from "@/hooks/use-scout-watchlist";
import { usePlayerLatestAnalysis } from "@/hooks/use-player-latest-analysis";
import { useAnalyzePlayer } from "@/hooks/use-scout-analyze";
import { useGenerateReport } from "@/hooks/use-scout-report";
import { usePersonalityAnalysis } from "@/hooks/use-scout-personality";
import { useAdvisorReview } from "@/hooks/use-advisor-review";
import { PlayerHero } from "@/components/PlayerHero";
import { StatGrid, type StatGridDimension } from "@/components/StatGrid";
import { PersonalityPanel } from "@/components/PersonalityPanel";
import { AdvisorReviewPanel } from "@/components/AdvisorReviewPanel";
import { ComparablePlayersPanel } from "@/components/ComparablePlayersPanel";
import { VideoSection } from "@/components/VideoSection";
import { NotesPanel } from "@/components/NotesPanel";
import { ProvenanceBadge } from "@/components/Provenance";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton, SkeletonHero, SkeletonLine } from "@/components/Skeleton";
import {
  SecNavDesktop,
  SecNavMobile,
  SectionShell,
  useScrollSpy,
  type SecNavItem,
} from "@/components/report";
import { safeArray } from "@/types/scout";
import type {
  AnalysisResult,
  AnalysisType,
  AdvisorReviewResponse,
  PersonalityProfile,
} from "@/types/scout";
import { VideoEntrySchema } from "@/lib/videoUtils";
import { EASE_OUT_QUART } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Section registry — scroll-spy secnav (same pattern as MatchReport)
// ---------------------------------------------------------------------------

const SECTION_GROUPS = ["Översikt", "Analys", "Kontext"] as const;

const SECTIONS: SecNavItem[] = [
  { id: "overview", label: "Sammanfattning", group: "Översikt" },
  { id: "strengths", label: "Styrkor & risker", group: "Översikt" },
  { id: "dims", label: "Dimensioner", group: "Analys" },
  { id: "per90", label: "Per-90 & jämförelse", group: "Analys" },
  { id: "personality", label: "Personlighet", group: "Analys" },
  { id: "advisor", label: "Expertpanel", group: "Analys" },
  { id: "comparables", label: "Liknande spelare", group: "Kontext" },
  { id: "video", label: "Video", group: "Kontext" },
  { id: "notes", label: "Anteckningar", group: "Kontext" },
];

const SECTION_IDS = SECTIONS.map((s) => s.id);

// ---------------------------------------------------------------------------
// Effective analysis — persisted analysis renders FIRST; a fresh run overrides
// ---------------------------------------------------------------------------

interface EffectiveAnalysis {
  analysisId: string | null;
  createdAt: string | null;
  analysisType: string | null;
  overallScore: number | null;
  confidence: number | null;
  recommendation: string | null;
  summary: string | null;
  strengths: string[];
  weaknesses: string[];
  riskFactors: string[];
  dimensions: StatGridDimension[];
  source: "fresh" | "persisted";
}

/** Extract human-readable evidence from a jsonb column or plain string. */
function evidenceText(e: unknown): string | null {
  if (e == null) return null;
  if (typeof e === "string") return e.trim() || null;
  if (typeof e === "object") {
    const rec = e as Record<string, unknown>;
    for (const key of ["text", "evidence", "summary", "notes", "reasoning"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

const ANALYSIS_TYPE_LABELS: Record<string, string> = {
  full_scout: "Fullständig scout",
  quick_scan: "Snabbanalys",
  match_review: "Matchanalys",
  transfer_assessment: "Transfervärdering",
};

const ANALYSIS_TYPES: { value: AnalysisType; label: string }[] = [
  { value: "full_scout", label: "Fullständig" },
  { value: "quick_scan", label: "Snabb" },
  { value: "match_review", label: "Matchanalys" },
  { value: "transfer_assessment", label: "Transfervärdering" },
];

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function BulletList({ items, tone }: { items: string[]; tone: "success" | "destructive" | "warning" }) {
  const dot = {
    success: "bg-success",
    destructive: "bg-destructive/70",
    warning: "bg-warning",
  }[tone];
  return (
    <ul className="mt-2.5 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
          <span aria-hidden="true" className={`mt-[7px] h-1 w-1 flex-none rounded-full ${dot}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function AnalysisControls({
  onAnalyze,
  pending,
}: {
  onAnalyze: (type: AnalysisType) => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kör analys">
      {ANALYSIS_TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onAnalyze(t.value)}
          disabled={pending}
          className="inline-flex min-h-[44px] items-center rounded-sm border border-border bg-background/40 px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/40 hover:bg-accent/10 disabled:opacity-50 md:min-h-[36px]"
        >
          {t.label}
        </button>
      ))}
      {pending && (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
          Analyserar spelare…
        </span>
      )}
    </div>
  );
}

function PlayerDetailSkeleton() {
  return (
    <PageSkeleton
      ariaLabel="Laddar spelarprofil"
      gridClassName="lg:grid-cols-[210px_1fr]"
      header={
        <>
          <SkeletonLine className="h-3 w-40" />
          <SkeletonHero />
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: playerData, isLoading: loadingPlayer, refetch: refetchPlayer } = useGetPlayer(id);
  const { data: watchlistData } = useIsOnWatchlist(id ?? "");
  const isOnWatchlist = watchlistData?.isOnWatchlist ?? false;
  const watchlistId = watchlistData?.watchlistId ?? null;
  const toggleWatchlist = useToggleWatchlist();
  const player = playerData?.player ?? null;

  const latest = usePlayerLatestAnalysis(id);

  const [freshResult, setFreshResult] = useState<AnalysisResult | null>(null);
  const [freshAnalysisId, setFreshAnalysisId] = useState<string | null>(null);
  const [personalityProfile, setPersonalityProfile] = useState<PersonalityProfile | null>(null);
  const [advisorReview, setAdvisorReview] = useState<AdvisorReviewResponse | null>(null);

  const analyze = useAnalyzePlayer();
  const report = useGenerateReport();
  const personality = usePersonalityAnalysis();
  const advisorReviewMutation = useAdvisorReview();

  const { activeSection, registerRef, scrollToSection } = useScrollSpy(player ? SECTION_IDS : []);

  // Persisted analysis renders fully BEFORE anyone clicks "analysera";
  // a fresh run in this session takes precedence.
  const effective = useMemo<EffectiveAnalysis | null>(() => {
    if (freshResult) {
      return {
        analysisId: freshAnalysisId,
        createdAt: new Date().toISOString(),
        analysisType: null,
        overallScore: freshResult.overall_score,
        confidence: freshResult.confidence,
        recommendation: freshResult.recommendation,
        summary: freshResult.summary,
        strengths: freshResult.strengths,
        weaknesses: freshResult.weaknesses,
        riskFactors: freshResult.risk_factors,
        dimensions: freshResult.dimension_scores.map((d) => ({
          id: d.dimension_id,
          name: d.dimension_name,
          score: d.score,
          confidence: null,
          evidence: evidenceText(d.evidence),
        })),
        source: "fresh",
      };
    }
    const persisted = latest.data;
    if (persisted) {
      return {
        analysisId: persisted.analysis.id,
        createdAt: persisted.analysis.created_at,
        analysisType: persisted.analysis.analysis_type,
        overallScore: persisted.analysis.overall_score,
        confidence: persisted.analysis.confidence,
        recommendation: persisted.analysis.recommendation,
        summary: persisted.analysis.summary,
        strengths: persisted.analysis.strengths ?? [],
        weaknesses: persisted.analysis.weaknesses ?? [],
        riskFactors: persisted.analysis.risk_factors ?? [],
        dimensions: persisted.scores.map((s) => ({
          id: s.dimension_id,
          name: s.dimension_name,
          score: s.score,
          confidence: s.confidence,
          evidence: evidenceText(s.evidence),
        })),
        source: "persisted",
      };
    }
    return null;
  }, [freshResult, freshAnalysisId, latest.data]);

  const analysisId = freshAnalysisId ?? latest.data?.analysis.id ?? null;

  const handleAnalyze = useCallback(
    (type: AnalysisType) => {
      if (!id) return;
      analyze.mutate(
        { player_id: id, analysis_type: type },
        {
          onSuccess: (data) => {
            setFreshResult(data.result);
            setFreshAnalysisId(data.analysis_id);
          },
        },
      );
    },
    [id, analyze],
  );

  const handlePersonality = useCallback(() => {
    if (!id) return;
    personality.mutate(
      { player_id: id },
      { onSuccess: (data) => setPersonalityProfile(data.profile) },
    );
  }, [id, personality]);

  const handleAdvisorReview = useCallback(() => {
    if (!analysisId) return;
    advisorReviewMutation.mutate(
      { analysis_id: analysisId },
      { onSuccess: (data) => setAdvisorReview(data) },
    );
  }, [analysisId, advisorReviewMutation]);

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

  const scrollToOverview = useCallback(() => scrollToSection("overview"), [scrollToSection]);

  if (loadingPlayer) return <PlayerDetailSkeleton />;

  if (!player) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <span className="eyebrow justify-center">Hittades inte</span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">Spelaren finns inte</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Profilen kan ha tagits bort, eller så saknar du behörighet i den här arbetsytan.
        </p>
        <Link
          to="/players"
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" /> Tillbaka till Spelare
        </Link>
      </div>
    );
  }

  const analysedTypeLabel = effective?.analysisType ? ANALYSIS_TYPE_LABELS[effective.analysisType] ?? effective.analysisType : null;
  const hasStrengthData =
    !!effective && (effective.strengths.length > 0 || effective.weaknesses.length > 0 || effective.riskFactors.length > 0);

  let sectionNo = 0;
  const nextNo = () => ++sectionNo;

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-12">
      {/* Breadcrumb + back */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
        aria-label="Brödsmulor"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link to="/" className="min-h-[44px] inline-flex items-center transition-colors hover:text-accent md:min-h-0">
          Dashboard
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link to="/players" className="min-h-[44px] inline-flex items-center transition-colors hover:text-accent md:min-h-0">
          Spelare
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="max-w-[200px] truncate font-medium text-foreground">{player.name}</span>
      </motion.nav>

      {/* MACRO — PlayerHero */}
      <div className="mt-5">
        <PlayerHero
          player={player}
          overallScore={effective?.overallScore ?? null}
          confidence={effective?.confidence ?? null}
          recommendation={effective?.recommendation ?? null}
          archetype={personalityProfile?.composite_archetype ?? null}
          analysisDate={effective?.createdAt ?? null}
          isOnWatchlist={isOnWatchlist}
          watchlistPending={toggleWatchlist.isPending}
          onToggleWatchlist={() => id && toggleWatchlist.mutate({ playerId: id, isOnWatchlist, watchlistId })}
          compareHref={`/comparison?ids=${id}`}
          canReport={!!effective}
          reportPending={report.isPending}
          onReport={handleReport}
          onRunAnalysis={scrollToOverview}
        />
      </div>

      {/* MICRO — sticky scroll-spy secnav + sections */}
      <SecNavMobile items={SECTIONS} activeId={activeSection} onSelect={scrollToSection} />

      <div className="mt-8 grid gap-10 lg:grid-cols-[210px_1fr]">
        <SecNavDesktop
          items={SECTIONS}
          groups={SECTION_GROUPS}
          activeId={activeSection}
          onSelect={scrollToSection}
          layoutId="playerdetail-secnav-indicator"
        />

        <div className="min-w-0 space-y-14">
          {/* ── 01 Sammanfattning ─────────────────────────────────────── */}
          <SectionShell
            id="overview"
            index={nextNo()}
            title="Sammanfattning"
            sub="AI-analysens helhetsbild — sparad analys visas direkt, en ny körning ersätter den i vyn."
            registerRef={registerRef}
          >
            {latest.isLoading && !effective && (
              <div className="card-editorial p-5" aria-busy="true">
                <div className="h-3.5 w-full rounded-sm skeleton-shimmer" />
                <div className="mt-2.5 h-3.5 w-11/12 rounded-sm skeleton-shimmer" />
                <div className="mt-2.5 h-3.5 w-3/5 rounded-sm skeleton-shimmer" />
              </div>
            )}

            {effective?.summary && (
              <div className="card-editorial p-5 md:p-6">
                <p className="text-[15px] leading-relaxed text-foreground md:text-base">
                  {effective.summary} <ProvenanceBadge kind="TOLKAT" label="TOLKAT · AI-analys" />
                </p>
                <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground/80">
                  {effective.source === "persisted" ? "Sparad analys" : "Ny körning i denna session"}
                  {analysedTypeLabel && <> · {analysedTypeLabel}</>}
                  {effective.createdAt && (
                    <>
                      {" · "}
                      {new Date(effective.createdAt).toLocaleDateString("sv-SE", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </>
                  )}
                </p>
              </div>
            )}

            {!latest.isLoading && !effective && (
              <EmptyState>
                Ingen genomförd analys ännu för {player.name}. Kör en analys nedan — betyg, rekommendation,
                dimensioner och styrkor/risker fylls i här.
              </EmptyState>
            )}

            {latest.error && !effective && (
              <div className="mt-3">
                <EmptyState>
                  Kunde inte hämta sparad analys: {latest.error instanceof Error ? latest.error.message : "okänt fel"}.
                </EmptyState>
              </div>
            )}

            <div className="mt-4">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                {effective ? "Kör ny analys" : "Kör analys"}
              </div>
              <AnalysisControls onAnalyze={handleAnalyze} pending={analyze.isPending} />
              {analyze.error && (
                <div
                  role="alert"
                  className="mt-3 flex items-center gap-2 rounded-sm border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive"
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  {analyze.error.message}
                </div>
              )}
            </div>
          </SectionShell>

          {/* ── 02 Styrkor & risker ───────────────────────────────────── */}
          <SectionShell
            id="strengths"
            index={nextNo()}
            title="Styrkor & risker"
            sub="Vad som bär spelaren — och vad som kan fälla värvningen."
            registerRef={registerRef}
          >
            {hasStrengthData && effective ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(
                  [
                    { title: "Styrkor", items: effective.strengths, tone: "success" as const, empty: "Inga styrkor listade i analysen." },
                    { title: "Svagheter", items: effective.weaknesses, tone: "destructive" as const, empty: "Inga svagheter listade i analysen." },
                    { title: "Riskfaktorer", items: effective.riskFactors, tone: "warning" as const, empty: "Inga riskfaktorer listade i analysen." },
                  ] as const
                ).map((col, i) => (
                  <motion.div
                    key={col.title}
                    className="card-editorial p-5"
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: i * 0.08, ease: EASE_OUT_QUART }}
                  >
                    <h3
                      className={`text-[13px] font-bold ${
                        col.tone === "success" ? "text-success" : col.tone === "destructive" ? "text-destructive" : "text-warning"
                      }`}
                    >
                      {col.title}
                    </h3>
                    {col.items.length > 0 ? (
                      <BulletList items={col.items} tone={col.tone} />
                    ) : (
                      <p className="mt-2.5 text-[12px] text-muted-foreground/70">{col.empty}</p>
                    )}
                  </motion.div>
                ))}
              </div>
            ) : (
              <EmptyState>
                Styrkor, svagheter och riskfaktorer fylls i när en analys är genomförd.{" "}
                <button
                  type="button"
                  onClick={scrollToOverview}
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
                  style={{ color: "hsl(var(--gold-text))" }}
                >
                  Kör analys <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </EmptyState>
            )}
          </SectionShell>

          {/* ── 03 Dimensioner ────────────────────────────────────────── */}
          <SectionShell
            id="dims"
            index={nextNo()}
            title="Dimensioner"
            sub="16 dimensioner i 5 viktade grupper — betyg 0–10 med underlag per dimension. Saknad data betygsätts aldrig."
            registerRef={registerRef}
          >
            {effective && effective.dimensions.length > 0 ? (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2.5 text-[11px] text-muted-foreground">
                  <ProvenanceBadge kind="TOLKAT" label="TOLKAT · AI-analys" />
                  <span>
                    {effective.dimensions.filter((d) => d.score != null).length} av 16 dimensioner betygsatta ·
                    viktning Taktisk 22 % / Teknisk 27 % / Fysisk 18 % / Mental 23 % / Social 10 %
                  </span>
                </div>
                <StatGrid dimensions={effective.dimensions} />
              </>
            ) : (
              <EmptyState>
                Dimensionsbetygen fylls i när en analys är genomförd.{" "}
                <button
                  type="button"
                  onClick={() => handleAnalyze("full_scout")}
                  disabled={analyze.isPending}
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-50"
                  style={{ color: "hsl(var(--gold-text))" }}
                >
                  Kör fullständig analys <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </EmptyState>
            )}
          </SectionShell>

          {/* ── 04 Per-90 & jämförelse ────────────────────────────────── */}
          <SectionShell
            id="per90"
            index={nextNo()}
            title="Per-90 & jämförelse"
            sub="Mätdata per 90 minuter mot rätt kohort — visas bara när den finns, aldrig som gissning."
            registerRef={registerRef}
          >
            <div className="card-editorial p-5 md:p-6">
              <div className="flex flex-wrap items-center gap-2.5">
                <ProvenanceBadge kind="MATT" label="MÄTT · kräver datalager" />
                <span className="text-[12px] font-semibold text-foreground">Per-90-statistik är inte kopplad till spelarprofilen ännu.</span>
              </div>
              <ul className="mt-3.5 space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
                <li className="flex gap-2">
                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
                  Percentiler visas alltid med kohort och urvalsstorlek (t.ex. ”mittfältare Allsvenskan, n=142”) — aldrig utan.
                </li>
                <li className="flex gap-2">
                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
                  Duellsiffror redovisas med volym och vinstprocent åtskilda — hög volym är inte samma sak som övertag.
                </li>
                <li className="flex gap-2">
                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
                  Saknade fält visas som ”—” (NULL är inte 0) tills matchdatalagret (B1) är kopplat.
                </li>
              </ul>
              <Link
                to={`/comparison?ids=${id}`}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-border bg-background/40 px-4 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
              >
                Öppna jämförelsevyn <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </SectionShell>

          {/* ── 05 Personlighet ───────────────────────────────────────── */}
          <SectionShell
            id="personality"
            index={nextNo()}
            title="Personlighet"
            sub="Psykologisk profil — beslutstempo, resiliens, ego och arketyp med underlag per dimension."
            registerRef={registerRef}
          >
            <PersonalityPanel
              profile={personalityProfile}
              loading={personality.isPending}
              error={personality.error?.message ?? null}
              onAnalyze={handlePersonality}
            />
          </SectionShell>

          {/* ── 06 Expertpanel ────────────────────────────────────────── */}
          <SectionShell
            id="advisor"
            index={nextNo()}
            title="Expertpanel"
            sub="Oberoende granskning av analysen — verdikt, invändningar och risker per rådgivare."
            registerRef={registerRef}
          >
            {analysisId ? (
              <AdvisorReviewPanel
                review={advisorReview}
                loading={advisorReviewMutation.isPending}
                error={advisorReviewMutation.error?.message ?? null}
                onReview={handleAdvisorReview}
              />
            ) : (
              <EmptyState>
                Expertgranskningen utgår från en genomförd analys.{" "}
                <button
                  type="button"
                  onClick={scrollToOverview}
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
                  style={{ color: "hsl(var(--gold-text))" }}
                >
                  Kör analys först <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </EmptyState>
            )}
          </SectionShell>

          {/* ── 07 Liknande spelare ───────────────────────────────────── */}
          <SectionShell
            id="comparables"
            index={nextNo()}
            title="Liknande spelare"
            sub="Samma position och nivå — kandidater att jämföra mot innan beslut."
            registerRef={registerRef}
          >
            <ComparablePlayersPanel player={player} />
          </SectionShell>

          {/* ── 08 Video ──────────────────────────────────────────────── */}
          <SectionShell
            id="video"
            index={nextNo()}
            title="Video"
            sub="Klippbank för spelaren — bevislagret bakom det tolkade."
            registerRef={registerRef}
          >
            {id && (
              <VideoSection
                playerId={id}
                videos={safeArray(VideoEntrySchema, player.video_urls ?? [])}
                onUpdate={() => void refetchPlayer()}
              />
            )}
          </SectionShell>

          {/* ── 09 Anteckningar ───────────────────────────────────────── */}
          <SectionShell
            id="notes"
            index={nextNo()}
            title="Anteckningar"
            sub="Egna observationer — komplettera AI-underlaget med det ni ser själva."
            registerRef={registerRef}
          >
            {id && <NotesPanel playerId={id} />}
          </SectionShell>

          {/* Report error */}
          {report.error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-sm border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive"
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {report.error.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerDetail;
