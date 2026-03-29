import { motion } from "framer-motion";
import { Brain, Loader2, AlertTriangle, Shield, Zap } from "lucide-react";
import type { PersonalityProfile, PersonalityDimension } from "@/types/scout";
import { ARCHETYPE_LABELS, ARCHETYPE_COLORS, DATA_SOURCE_LABELS } from "@/types/scout";

interface PersonalityPanelProps {
  profile: PersonalityProfile | null;
  loading: boolean;
  error: string | null;
  onAnalyze: () => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  decision_tempo: "Beslutstempo",
  risk_appetite: "Riskvillighet",
  structure_need: "Strukturbehov",
  team_orientation: "Lagkänsla",
  tactical_understanding: "Spelförståelse",
  ambition_level: "Ambitionsnivå",
  career_motivation: "Karriärmotivation",
};

const DIMENSION_KEYS = [
  "decision_tempo",
  "risk_appetite",
  "structure_need",
  "team_orientation",
  "tactical_understanding",
  "ambition_level",
  "career_motivation",
] as const;

function ScoreBar({ score, label, evidence }: { score: number; label: string; evidence: string }) {
  const clamped = Math.min(10, Math.max(1, score));
  const pct = (clamped / 10) * 100;
  const color =
    clamped >= 7 ? "bg-emerald-500" : clamped >= 4 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs font-bold text-foreground">{clamped.toFixed(1)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
      <p className="text-[10px] text-muted-foreground leading-tight">{evidence}</p>
    </div>
  );
}

/** Pick top 3 scoring dimensions for CDM card */
function getTopDimensions(profile: PersonalityProfile) {
  return DIMENSION_KEYS
    .map((key) => {
      const dim = profile[key] as PersonalityDimension | undefined;
      if (!dim) return null;
      return { key, dim, label: DIMENSION_LABELS[key] ?? key };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.dim.score - a.dim.score)
    .slice(0, 3);
}

export function PersonalityPanel({ profile, loading, error, onAnalyze }: PersonalityPanelProps) {
  return (
    <div className="rounded-xl p-6 md:p-8 glass-premium card-accent-left space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-tag flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5" />
          Psykologisk profil
        </h3>
        {!profile && !loading && (
          <button
            type="button"
            onClick={onAnalyze}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-primary/30 text-primary hover:bg-primary/10 btn-premium transition-colors"
          >
            Kör djupanalys
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Analyserar personlighet...</span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {profile && !loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Composite archetype badge + data source quality */}
          {(profile.composite_archetype || profile.data_source_quality) && (
            <div className="flex items-center gap-2">
              {profile.composite_archetype && (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border ${ARCHETYPE_COLORS[profile.composite_archetype] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}`}>
                  <Zap className="w-3.5 h-3.5" />
                  {ARCHETYPE_LABELS[profile.composite_archetype] ?? profile.composite_archetype}
                </span>
              )}
              {profile.data_source_quality && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground border border-border/30 bg-card/40">
                  <Shield className="w-3 h-3" />
                  {DATA_SOURCE_LABELS[profile.data_source_quality] ?? profile.data_source_quality}
                </span>
              )}
            </div>
          )}

          {/* CDM — Core Decision Model (top 3 dimensions) */}
          {(() => {
            const top3 = getTopDimensions(profile);
            return (
              <div className="rounded-lg p-3 bg-card/60 border border-border/30 backdrop-blur-sm">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Kärnprofil
                </span>
                <div className="flex items-center gap-3 mt-2">
                  {top3.map((d) => (
                    <div key={d.key} className="flex items-center gap-1.5">
                      <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-extrabold ${
                        d.dim.score >= 7 ? "border-emerald-500/60 text-emerald-400" : d.dim.score >= 4 ? "border-amber-500/60 text-amber-400" : "border-red-500/60 text-red-400"
                      }`}>
                        {d.dim.score.toFixed(0)}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 7 personality dimensions */}
          <div className="space-y-3">
            {DIMENSION_KEYS.map((key) => {
              const dim = profile[key] as PersonalityDimension | undefined;
              if (!dim) return null;
              return (
                <ScoreBar
                  key={key}
                  score={dim.score}
                  label={DIMENSION_LABELS[key] ?? key}
                  evidence={dim.evidence}
                />
              );
            })}
          </div>

          {/* Stress archetype */}
          <div className="rounded-lg p-3 bg-card/60 border border-border/30 backdrop-blur-sm">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Stressarketyp
            </span>
            <p className="text-sm font-medium text-foreground mt-1">{profile.stress_archetype}</p>
          </div>

          {/* Coaching approach + Integration risks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <h4 className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                Coachingförslag
              </h4>
              <ul className="space-y-1">
                {profile.coaching_approach.map((item, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <span className="text-emerald-400 mt-0.5">→</span> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1.5">
                Integrationsrisker
              </h4>
              <ul className="space-y-1">
                {profile.integration_risks.map((item, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Confidence + reasoning */}
          <div className="flex items-center justify-between">
            {profile.confidence_reasoning && (
              <span className="text-[10px] text-muted-foreground/70 max-w-[70%] truncate" title={profile.confidence_reasoning}>
                {profile.confidence_reasoning}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">
              Konfidens {Math.min(100, Math.max(0, profile.confidence_score * 100)).toFixed(0)}%
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
