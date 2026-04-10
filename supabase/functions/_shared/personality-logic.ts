// personality-logic.ts — shared pure functions for scout-personality-analysis
//
// NOTE (VCE09 W2): This file lives under supabase/functions/_shared/ which is
// intentionally OUTSIDE the tsconfig.app.json scope (include: ["src"]).
// It targets the Deno/Edge-Function runtime and is type-checked by the Deno
// LSP + Supabase CLI — not by the Vite/browser tsc pass. Vitest runs it as
// plain ESM via Node, which is why the .ts extension import in index.ts works
// only at deploy time (Deno) and the unit tests import from this file directly.

// ---------------------------------------------------------------------------
// 7 composite archetypes (closed taxonomy, v6)
// ---------------------------------------------------------------------------
export const ARCHETYPES = [
  'MENTALITY_MONSTER',
  'HIGH_PERFORMING_SOLO',
  'COMPLETE_PROFESSIONAL',
  'SILENT_LEADER',
  'COACHABLE_RAW_TALENT',
  'TOXIC_HIGH_PERFORMER',
  'RELIABLE_SOLDIER',
] as const;

export type Archetype = typeof ARCHETYPES[number];

// ---------------------------------------------------------------------------
// clamp — restrict val to [min, max]
// ---------------------------------------------------------------------------
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// resolveArchetype — deterministic rule set + score-based fallback
// ---------------------------------------------------------------------------
export function resolveArchetype(profile: Record<string, number>): string {
  const dt = profile.decision_tempo ?? 5;
  const ra = profile.risk_appetite ?? 5;
  const al = profile.ambition_level ?? 5;
  const to = profile.team_orientation ?? 5;
  const tu = profile.tactical_understanding ?? 5;
  const sn = profile.structure_need ?? 5;
  const cm = profile.career_motivation ?? 5;
  const eg = profile.ego ?? 5;
  const re = profile.resilience ?? 5;
  const co = profile.coachability ?? 5;
  const xf = profile.x_factor ?? 5;
  const cs = profile.contradiction_score ?? 0.3;

  // TOXIC_HIGH_PERFORMER: high ego + low team + low coachability
  if (eg >= 8 && to <= 3 && co <= 4 && al >= 8) return 'TOXIC_HIGH_PERFORMER';
  // MENTALITY_MONSTER: high resilience + high decision tempo + high ambition
  if (re >= 8 && dt >= 8 && al >= 8 && cm >= 8) return 'MENTALITY_MONSTER';
  // RELIABLE_SOLDIER: team-first, structure-driven, moderate ambition, coachable
  if (to >= 6 && sn >= 7 && al >= 4 && al <= 6 && co >= 6) return 'RELIABLE_SOLDIER';
  // COMPLETE_PROFESSIONAL: balanced high + x-factor + low contradiction
  if (dt >= 7 && al >= 7 && to >= 6 && tu >= 7 && sn >= 5 && xf >= 7 && cs <= 0.4) return 'COMPLETE_PROFESSIONAL';
  // HIGH_PERFORMING_SOLO: high ego + high ambition + moderate team
  if (al >= 8 && to <= 5 && dt >= 7 && eg >= 7) return 'HIGH_PERFORMING_SOLO';
  // SILENT_LEADER: high team, low ego, high resilience
  if (to >= 7 && eg <= 5 && re >= 6 && al >= 6) return 'SILENT_LEADER';
  // COACHABLE_RAW_TALENT: high coachability + structure need
  if (co >= 7 && dt <= 5 && sn >= 6 && al >= 5) return 'COACHABLE_RAW_TALENT';

  // Fallback: score-based with all 12 dimensions
  const scores: Array<[string, number]> = [
    ['MENTALITY_MONSTER',      (dt + al + cm + re) / 4],
    ['COMPLETE_PROFESSIONAL',  (dt + al + to + tu + sn + xf + re) / 7],
    ['HIGH_PERFORMING_SOLO',   (al + dt + ra + eg) / 4],
    ['SILENT_LEADER',          (to + cm + tu + re) / 4],
    ['COACHABLE_RAW_TALENT',   (sn + tu + cm + co) / 4],
    ['RELIABLE_SOLDIER',       (to + sn + cm + co) / 4],
    ['TOXIC_HIGH_PERFORMER',   (ra + al + eg) / 3 - co / 3],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

// ---------------------------------------------------------------------------
// resolveRecommendation — SIGN / MONITOR / PASS
// ---------------------------------------------------------------------------
export function resolveRecommendation(
  archetype: string,
  dimScores: Record<string, number>,
  contradictionScore: number,
  confidenceScore: number
): 'SIGN' | 'MONITOR' | 'PASS' {
  const generic7 = [
    'decision_tempo', 'risk_appetite', 'ambition_level',
    'team_orientation', 'tactical_understanding', 'structure_need', 'career_motivation',
  ];
  const avg7 = generic7.reduce((sum, k) => sum + (dimScores[k] ?? 5), 0) / 7;
  const co = dimScores.coachability ?? 5;
  const re = dimScores.resilience ?? 5;

  // PASS: toxic + low coachability, or high contradiction + low resilience
  if (archetype === 'TOXIC_HIGH_PERFORMER' && co <= 4) return 'PASS';
  if (contradictionScore >= 0.7 && re <= 4) return 'PASS';

  // SIGN: strong profile + manageable risk
  if (avg7 >= 7 && contradictionScore <= 0.4 && co >= 6 && confidenceScore >= 0.5) return 'SIGN';
  if (archetype === 'COMPLETE_PROFESSIONAL' && avg7 >= 6.5) return 'SIGN';
  if (archetype === 'MENTALITY_MONSTER' && avg7 >= 7 && co >= 5) return 'SIGN';

  return 'MONITOR';
}

// ---------------------------------------------------------------------------
// computeConfidence — deterministic blend: evidence + llm + source quality
// ---------------------------------------------------------------------------
export function computeConfidence(
  evidenceCount: number,
  llmConfidence: number,
  dataSourceQuality: string
): number {
  const maxEvidence = 11;
  const evidenceRatio = Math.min(evidenceCount / maxEvidence, 1.0);
  const baseline =
    dataSourceQuality === 'VERIFIED' ? 0.75 :
    dataSourceQuality === 'MIXED'    ? 0.55 :
                                       0.40;
  const deterministic = (0.60 * evidenceRatio) + (0.30 * llmConfidence) + (0.10 * baseline);
  return Math.round(clamp(deterministic, 0.10, 0.95) * 100) / 100;
}
