// coach-personality-logic.ts — shared pure functions for scout-coach-personality
//
// 7 coach archetypes (closed taxonomy) + 12 BPA dimensions.
// Mirrors personality-logic.ts patterns for player archetypes.

import { clamp } from './personality-logic.ts';

// ---------------------------------------------------------------------------
// 7 coach composite archetypes
// ---------------------------------------------------------------------------
export const COACH_ARCHETYPES = [
  'VISIONARY_INNOVATOR',
  'IRON_DISCIPLINARIAN',
  'PLAYER_DEVELOPER',
  'TACTICAL_GENIUS',
  'MOTIVATIONAL_LEADER',
  'PRAGMATIC_SURVIVOR',
  'CULTURE_BUILDER',
] as const;

export type CoachArchetype = typeof COACH_ARCHETYPES[number];

// ---------------------------------------------------------------------------
// resolveCoachArchetype — deterministic rule set + score-based fallback
// ---------------------------------------------------------------------------
export function resolveCoachArchetype(profile: Record<string, number>): CoachArchetype {
  const dt = profile.decision_tempo ?? 5;
  const ra = profile.risk_appetite ?? 5;
  const sn = profile.structure_need ?? 5;
  const to = profile.team_orientation ?? 5;
  const ti = profile.tactical_innovation ?? 5;
  const al = profile.ambition_level ?? 5;
  const cm = profile.career_motivation ?? 5;
  const ego = profile.ego ?? 5;
  const re = profile.resilience ?? 5;
  const lo = profile.learning_orientation ?? 5;
  const xf = profile.x_factor ?? 5;

  // 1. VISIONARY_INNOVATOR: ti>=8 AND ra>=7 AND lo>=7
  if (ti >= 8 && ra >= 7 && lo >= 7) return 'VISIONARY_INNOVATOR';
  // 2. IRON_DISCIPLINARIAN: sn>=8 AND ego>=7 AND dt>=7
  if (sn >= 8 && ego >= 7 && dt >= 7) return 'IRON_DISCIPLINARIAN';
  // 3. PLAYER_DEVELOPER: to>=7 AND lo>=7 AND al IN [4,7]
  if (to >= 7 && lo >= 7 && al >= 4 && al <= 7) return 'PLAYER_DEVELOPER';
  // 4. TACTICAL_GENIUS: ti>=7 AND sn>=6 AND dt>=7
  if (ti >= 7 && sn >= 6 && dt >= 7) return 'TACTICAL_GENIUS';
  // 5. MOTIVATIONAL_LEADER: ego<=5 AND re>=7 AND xf>=7
  if (ego <= 5 && re >= 7 && xf >= 7) return 'MOTIVATIONAL_LEADER';
  // 6. PRAGMATIC_SURVIVOR: ra<=4 AND re>=6 AND cm>=6
  if (ra <= 4 && re >= 6 && cm >= 6) return 'PRAGMATIC_SURVIVOR';
  // 7. CULTURE_BUILDER: to>=8 AND sn>=6 AND ego<=5 AND lo>=6
  if (to >= 8 && sn >= 6 && ego <= 5 && lo >= 6) return 'CULTURE_BUILDER';

  // Fallback: score-based
  const scores: Array<[CoachArchetype, number]> = [
    ['VISIONARY_INNOVATOR', (ti + ra + lo + xf) / 4],
    ['IRON_DISCIPLINARIAN', (sn + ego + dt + re) / 4],
    ['PLAYER_DEVELOPER', (to + lo + cm) / 3],
    ['TACTICAL_GENIUS', (ti + sn + dt + al) / 4],
    ['MOTIVATIONAL_LEADER', (xf + re + to + cm) / 4],
    ['PRAGMATIC_SURVIVOR', (re + cm + sn) / 3],
    ['CULTURE_BUILDER', (to + sn + lo + cm) / 4],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

// ---------------------------------------------------------------------------
// resolveCoachRecommendation — SIGN / MONITOR / PASS
// ---------------------------------------------------------------------------
export function resolveCoachRecommendation(
  archetype: CoachArchetype,
  dimScores: Record<string, number>,
  contradictionScore: number,
  confidenceScore: number
): 'SIGN' | 'MONITOR' | 'PASS' {
  const generic7 = [
    'decision_tempo', 'risk_appetite', 'structure_need',
    'team_orientation', 'tactical_innovation', 'ambition_level', 'career_motivation',
  ];
  const avg7 = generic7.reduce((sum, k) => sum + (dimScores[k] ?? 5), 0) / 7;
  const re = dimScores.resilience ?? 5;
  const lo = dimScores.learning_orientation ?? 5;

  // PASS: high contradiction + low resilience, or iron disciplinarian with low learning
  if (contradictionScore >= 0.7 && re <= 4) return 'PASS';
  if (archetype === 'IRON_DISCIPLINARIAN' && lo <= 3 && contradictionScore >= 0.5) return 'PASS';

  // SIGN: strong profile
  if (avg7 >= 7 && contradictionScore <= 0.4 && confidenceScore >= 0.5) return 'SIGN';
  if (archetype === 'VISIONARY_INNOVATOR' && avg7 >= 6.5 && lo >= 7) return 'SIGN';
  if (archetype === 'CULTURE_BUILDER' && avg7 >= 6 && contradictionScore <= 0.3) return 'SIGN';

  return 'MONITOR';
}

// ---------------------------------------------------------------------------
// computeCoachConfidence — deterministic blend
// ---------------------------------------------------------------------------
export function computeCoachConfidence(
  evidenceCount: number,
  llmConfidence: number,
  dataSourceQuality: string
): number {
  const maxEvidence = 12; // 12 BPA dimensions
  const evidenceRatio = Math.min(evidenceCount / maxEvidence, 1.0);
  const baseline =
    dataSourceQuality === 'VERIFIED' ? 0.75 :
    dataSourceQuality === 'MIXED'    ? 0.55 :
                                       0.40;
  const deterministic = (0.60 * evidenceRatio) + (0.30 * llmConfidence) + (0.10 * baseline);
  return Math.round(clamp(deterministic, 0.10, 0.95) * 100) / 100;
}
