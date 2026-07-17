import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { animate, motion, useMotionValue } from "framer-motion";
import {
  Calendar,
  FileText,
  Footprints,
  GitCompare,
  Loader2,
  MapPin,
  Ruler,
  Star,
  TrendingUp,
  Trophy,
  Weight,
  Zap,
} from "lucide-react";
import { ProvenanceLegend } from "@/components/Provenance";
import {
  ARCHETYPE_LABELS,
  RECOMMENDATION_COLORS,
  RECOMMENDATION_LABELS,
  TIER_LABELS,
  asRecommendation,
} from "@/types/scout";
import type { CompositeArchetype, ScoutPlayer } from "@/types/scout";
import { EASE_OUT_QUART, SPRING_GENTLE, prefersReducedMotion } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Count-up number (SPRING_GENTLE) — reduced-motion snaps instantly
// ---------------------------------------------------------------------------

function useCountUp(target: number | null, decimals = 1): string {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState<string>((0).toFixed(decimals));

  useEffect(() => {
    if (target == null) return;
    if (prefersReducedMotion()) {
      mv.set(target);
      setDisplay(target.toFixed(decimals));
      return;
    }
    const unsub = mv.on("change", (v) => setDisplay(v.toFixed(decimals)));
    const controls = animate(mv, target, SPRING_GENTLE);
    return () => {
      controls.stop();
      unsub();
    };
  }, [target, decimals, mv]);

  return target == null ? "—" : display.replace(".", ",");
}

// ---------------------------------------------------------------------------
// Score dial — 120px variant with confidence as a thin outer ring
// ---------------------------------------------------------------------------

const RING_R = 56;
const RING_C = 2 * Math.PI * RING_R;

function ScoreDial({ score, confidence }: { score: number | null; confidence: number | null }) {
  const clamped = score == null ? null : Math.min(10, Math.max(0, score));
  const conf = confidence == null ? null : Math.min(1, Math.max(0, confidence));
  const display = useCountUp(clamped);
  const targetOffset = RING_C * (1 - (conf ?? 0));

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        className="relative h-[120px] w-[120px]"
        role="img"
        aria-label={
          clamped == null
            ? "Ingen analys ännu — inget betyg"
            : `Helhetsbetyg ${clamped.toFixed(1).replace(".", ",")} av 10, konfidens ${conf == null ? "okänd" : `${Math.round(conf * 100)} %`}`
        }
      >
        {/* Confidence ring — thin, gold, honest: empty when no analysis */}
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx={60} cy={60} r={RING_R} fill="none" stroke="hsl(var(--border))" strokeWidth={2.5} />
          {conf != null && (
            <motion.circle
              cx={60}
              cy={60}
              r={RING_R}
              fill="none"
              stroke="hsl(var(--accent))"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={RING_C}
              initial={{ strokeDashoffset: RING_C }}
              animate={{ strokeDashoffset: targetOffset }}
              transition={{ duration: 1.1, ease: EASE_OUT_QUART, delay: 0.2 }}
            />
          )}
        </svg>
        {/* Inner disc — big gold score */}
        <div className="absolute inset-[9px] flex flex-col items-center justify-center rounded-full border border-accent/25 bg-accent/[0.08]">
          <span className="stat-gold font-mono text-[32px] leading-none" aria-hidden="true">
            {display}
          </span>
          <span className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground" aria-hidden="true">
            av 10
          </span>
        </div>
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
        {conf == null ? "Konfidens —" : `Konfidens ${Math.round(conf * 100)} %`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fact item — honest gaps: missing data renders "—", never a bluffed value
// ---------------------------------------------------------------------------

function FactItem({ icon: Icon, label, value }: { icon: typeof Trophy; label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Icon className="h-3.5 w-3.5 flex-none text-accent/50" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{label}</div>
        <div className={`truncate text-xs font-semibold ${value ? "text-foreground" : "text-muted-foreground/60"}`}>
          {value ?? "—"}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict / archetype / tier pills — verdict is SEPARATE from the raw score
// ---------------------------------------------------------------------------

function LabeledPill({
  label,
  value,
  className,
  missingHint,
}: {
  label: string;
  value: string | null;
  className?: string;
  missingHint?: string;
}) {
  return (
    <span
      className={`inline-flex min-h-[28px] items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${
        value ? className ?? "border-border bg-secondary/60 text-foreground" : "border-dashed border-border text-muted-foreground/70"
      }`}
      title={!value && missingHint ? missingHint : undefined}
    >
      <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] opacity-70">{label}</span>
      {value ?? "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PlayerHero — macro view (above the fold)
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  EMERGENCE: "Genombrott",
  DEVELOPMENT: "Utveckling",
  PRIME_EARLY: "Tidig prime",
  PEAK: "Peak",
  MATURITY: "Mognad",
  TWILIGHT: "Avslut",
};

export interface PlayerHeroProps {
  player: ScoutPlayer;
  overallScore: number | null;
  confidence: number | null;
  recommendation: string | null;
  archetype: CompositeArchetype | null;
  analysisDate: string | null;
  isOnWatchlist: boolean;
  watchlistPending: boolean;
  onToggleWatchlist: () => void;
  compareHref: string;
  canReport: boolean;
  reportPending: boolean;
  onReport: () => void;
  onRunAnalysis: () => void;
}

export function PlayerHero({
  player,
  overallScore,
  confidence,
  recommendation,
  archetype,
  analysisDate,
  isOnWatchlist,
  watchlistPending,
  onToggleWatchlist,
  compareHref,
  canReport,
  reportPending,
  onReport,
  onRunAnalysis,
}: PlayerHeroProps) {
  const rec = asRecommendation(recommendation);
  const hasAnalysis = overallScore != null;

  const metaParts = [
    player.position_primary,
    player.current_club,
    player.current_league || null,
    player.age ? `${player.age} år` : null,
  ].filter((p): p is string => !!p);

  const analysedLabel = analysisDate
    ? new Date(analysisDate).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <motion.header
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
      className="surface-hero gradient-accent-top relative overflow-hidden rounded-sm border border-border p-6 md:p-8"
    >
      {/* Actions — top right */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onToggleWatchlist}
          disabled={watchlistPending}
          aria-pressed={isOnWatchlist}
          aria-label={isOnWatchlist ? "Ta bort från bevakningslista" : "Lägg till i bevakningslista"}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-sm border px-3.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
            isOnWatchlist
              ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
              : "border-border bg-background/40 text-muted-foreground hover:border-warning/40 hover:text-warning"
          }`}
        >
          <Star className={`h-4 w-4 ${isOnWatchlist ? "fill-current" : ""}`} aria-hidden="true" />
          {isOnWatchlist ? "Bevakar" : "Bevaka"}
        </button>
        <Link
          to={compareHref}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-border bg-background/40 px-3.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
        >
          <GitCompare className="h-4 w-4" aria-hidden="true" />
          Jämför
        </Link>
        <button
          type="button"
          onClick={onReport}
          disabled={!canReport || reportPending}
          title={canReport ? "Generera scoutrapport" : "Kräver en genomförd analys"}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-accent px-4 text-[12.5px] font-bold text-accent-foreground transition-opacity disabled:opacity-40"
        >
          {reportPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
          Rapport
        </button>
      </div>

      {/* Macro: identity left, score dial right */}
      <div className="mt-4 grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <span className="eyebrow">Spelarprofil</span>
          <h1
            className="mt-3 text-3xl font-extrabold leading-[1.05] text-foreground md:text-[40px]"
            style={{ letterSpacing: "-0.03em" }}
          >
            {player.name}
            {player.current_club && (
              <span className="mt-1 block text-[0.5em] font-bold leading-snug" style={{ color: "hsl(var(--gold-text))" }}>
                {player.current_club}
              </span>
            )}
          </h1>
          {metaParts.length > 0 && (
            <p className="mt-2.5 text-[14px] text-muted-foreground">{metaParts.join(" · ")}</p>
          )}

          {/* Verdict — deliberately separate from the raw score */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <LabeledPill
              label="Rekommendation"
              value={rec ? RECOMMENDATION_LABELS[rec] : null}
              className={rec ? `border ${RECOMMENDATION_COLORS[rec]}` : undefined}
              missingHint="Ingen genomförd analys ännu"
            />
            <LabeledPill
              label="Arketyp"
              value={archetype ? ARCHETYPE_LABELS[archetype] : null}
              className="border-border bg-secondary/60 text-foreground"
              missingHint="Kör personlighetsanalys för arketyp"
            />
            <span className="pill-gold min-h-[28px]">{TIER_LABELS[player.tier] ?? player.tier}</span>
            {player.career_phase && (
              <LabeledPill
                label="Fas"
                value={PHASE_LABELS[player.career_phase] ?? player.career_phase}
                className="border-border bg-secondary/60 text-foreground"
              />
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            {hasAnalysis ? (
              <>
                Rekommendationen är skild från råbetyget — en spelare kan ha högt betyg men låg passform mot ert behov.
                {analysedLabel && <> Senast analyserad {analysedLabel}.</>}
              </>
            ) : (
              <>
                Ingen genomförd analys ännu —{" "}
                <button
                  type="button"
                  onClick={onRunAnalysis}
                  className="inline font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
                  style={{ color: "hsl(var(--gold-text))" }}
                >
                  kör analys
                </button>{" "}
                för betyg, dimensioner och rekommendation.
              </>
            )}
          </p>
        </div>

        <div className="justify-self-start md:justify-self-end">
          <ScoreDial score={overallScore} confidence={confidence} />
        </div>
      </div>

      {/* Fact strip — registry data (MÄTT); gaps shown honestly as "—" */}
      <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/60 pt-5 sm:grid-cols-3 lg:grid-cols-6">
        <FactItem icon={Calendar} label="Ålder" value={player.age ? `${player.age} år` : null} />
        <FactItem icon={MapPin} label="Nationalitet" value={player.nationality || null} />
        <FactItem icon={Ruler} label="Längd" value={player.height_cm ? `${player.height_cm} cm` : null} />
        <FactItem icon={Weight} label="Vikt" value={player.weight_kg ? `${player.weight_kg} kg` : null} />
        <FactItem icon={Footprints} label="Fot" value={player.preferred_foot || null} />
        <FactItem
          icon={player.market_value != null ? TrendingUp : Zap}
          label="Marknadsvärde"
          value={player.market_value != null ? `€${(player.market_value / 1_000_000).toFixed(1).replace(".", ",")}M` : null}
        />
      </div>

      {/* Provenance legend — hero foot */}
      <ProvenanceLegend className="mt-5 border-t border-border/60 pt-4" />
    </motion.header>
  );
}
