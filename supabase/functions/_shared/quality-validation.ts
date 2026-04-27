// quality-validation.ts — shared deterministic quality validation for scout analyses
//
// Used by terminal (Nivå 2+3) as quality-overlay on edge function results.
// Also usable by edge functions themselves for inline quality checks.
// Pure functions, no side effects, fully testable.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface QualityCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'HALT';
  detail: string;
}

export interface QualityReport {
  score: number;       // 0-100
  gate: 'PASS' | 'WARN' | 'HALT';
  checks: QualityCheck[];
}

export interface AnalysisResult {
  overall_score: number;
  confidence: number;
  recommendation?: string;
  dimension_scores?: Record<string, number>;
  personality_scores?: Record<string, number>;
  evidence_count?: number;
  clamp_events?: Array<{ dim: string; original: number; clamped: number }>;
  insufficient_dimension_count?: number;
  total_dimension_count?: number;
}

// ---------------------------------------------------------------------------
// Input completeness types — Sprint 151: Data Completeness Gate
// ---------------------------------------------------------------------------
export type InputCompletenessLevel = 'EMPTY' | 'MINIMAL' | 'PARTIAL' | 'FULL';
export type ProvenanceTier = 'TIER_UNKNOWN' | 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface InputCompletenessInput {
  profile_data: Record<string, unknown> | null;
  source_ids: string[];
}

export interface InputCompletenessResult {
  level: InputCompletenessLevel;
  tier: ProvenanceTier;
  source_count: number;
  input_snapshot: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// checkInputCompleteness — deterministic gate on input data quality
// ---------------------------------------------------------------------------
export function checkInputCompleteness(input: InputCompletenessInput): InputCompletenessResult {
  const profile = input.profile_data;
  const sourceCount = input.source_ids.length;

  // Compute input snapshot: which top-level keys have non-null values
  const snapshot: Record<string, unknown> = {};
  if (profile && typeof profile === 'object') {
    for (const [key, val] of Object.entries(profile)) {
      if (val !== null && val !== undefined && val !== '') {
        if (typeof val === 'object') {
          const inner = val as Record<string, unknown>;
          const nonNullKeys = Object.keys(inner).filter(k => inner[k] !== null && inner[k] !== undefined);
          snapshot[key] = nonNullKeys.length > 0 ? `${nonNullKeys.length} fields` : 'empty_object';
        } else {
          snapshot[key] = typeof val;
        }
      }
    }
  }

  const fieldCount = Object.keys(snapshot).length;

  // Determine level
  let level: InputCompletenessLevel;
  if (!profile || fieldCount === 0) {
    level = 'EMPTY';
  } else if (fieldCount <= 3) {
    level = 'MINIMAL';
  } else if (fieldCount <= 8) {
    level = 'PARTIAL';
  } else {
    level = 'FULL';
  }

  // Determine tier
  let tier: ProvenanceTier;
  if (sourceCount === 0) {
    tier = 'TIER_UNKNOWN';
  } else if (sourceCount === 1) {
    tier = 'TIER_1';
  } else if (sourceCount <= 3) {
    tier = 'TIER_2';
  } else {
    tier = 'TIER_3';
  }

  return { level, tier, source_count: sourceCount, input_snapshot: snapshot };
}

// ---------------------------------------------------------------------------
// buildInputCompletenessWarning — Sprint 181: prompt warning for MINIMAL/PARTIAL
// Returns empty string for FULL/EMPTY (EMPTY is already blocked upstream).
// ---------------------------------------------------------------------------
export function buildInputCompletenessWarning(result: InputCompletenessResult): string {
  if (result.level === 'MINIMAL') {
    return `\n## DATA COMPLETENESS WARNING: MINIMAL INPUT\n` +
      `Only ${Object.keys(result.input_snapshot).length} profile fields available ` +
      `(tier=${result.tier}, sources=${result.source_count}).\n` +
      `Score LOWER overall, set confidence LOW (0.1-0.3). ` +
      `Dimensions without data MUST be null with evidence="Insufficient data".`;
  }
  if (result.level === 'PARTIAL') {
    return `\n## DATA COMPLETENESS NOTICE: PARTIAL INPUT\n` +
      `Only ${Object.keys(result.input_snapshot).length} profile fields available ` +
      `(tier=${result.tier}, sources=${result.source_count}).\n` +
      `Keep confidence MODERATE (0.3-0.6). ` +
      `Do NOT fabricate statistics or events not in the input.`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Score uniformity check — all dims within ±1 of each other = suspicious
// ---------------------------------------------------------------------------
export function checkScoreUniformity(scores: Record<string, number>): QualityCheck {
  const values = Object.values(scores);
  if (values.length < 3) {
    return { name: 'score_uniformity', status: 'PASS', detail: 'Too few dimensions to check' };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range <= 1) {
    return {
      name: 'score_uniformity',
      status: 'HALT',
      detail: `All ${values.length} dimensions within ±1 (range=${range.toFixed(1)}, min=${min.toFixed(1)}, max=${max.toFixed(1)}) — suspekt uniform`,
    };
  }
  if (range <= 2) {
    return {
      name: 'score_uniformity',
      status: 'WARN',
      detail: `Dimensions within ±2 (range=${range.toFixed(1)}) — low variance`,
    };
  }
  return { name: 'score_uniformity', status: 'PASS', detail: `Range=${range.toFixed(1)}` };
}

// ---------------------------------------------------------------------------
// High score + low confidence = suspicious
// ---------------------------------------------------------------------------
export function checkScoreConfidenceMismatch(
  overallScore: number,
  confidence: number,
): QualityCheck {
  if (overallScore > 8 && confidence < 0.5) {
    return {
      name: 'score_confidence_mismatch',
      status: 'HALT',
      detail: `Score ${overallScore} > 8 but confidence ${confidence} < 0.5`,
    };
  }
  if (overallScore > 7 && confidence < 0.4) {
    return {
      name: 'score_confidence_mismatch',
      status: 'HALT',
      detail: `Score ${overallScore} > 7 but confidence ${confidence} < 0.4`,
    };
  }
  if (overallScore > 7 && confidence < 0.5) {
    return {
      name: 'score_confidence_mismatch',
      status: 'WARN',
      detail: `Score ${overallScore} > 7 but confidence ${confidence} < 0.5`,
    };
  }
  return { name: 'score_confidence_mismatch', status: 'PASS', detail: 'OK' };
}

// ---------------------------------------------------------------------------
// Recommendation consistency — SIGN + many low dims = suspicious
// ---------------------------------------------------------------------------
export function checkRecommendationConsistency(
  recommendation: string,
  dimensionScores: Record<string, number>,
): QualityCheck {
  const values = Object.values(dimensionScores);
  const lowCount = values.filter(v => v < 5).length;

  if (recommendation === 'SIGN' && lowCount > 3) {
    return {
      name: 'recommendation_consistency',
      status: 'HALT',
      detail: `SIGN recommendation but ${lowCount} dimensions < 5`,
    };
  }
  if (recommendation === 'SIGN' && lowCount > 2) {
    return {
      name: 'recommendation_consistency',
      status: 'WARN',
      detail: `SIGN recommendation but ${lowCount} dimensions < 5`,
    };
  }
  return { name: 'recommendation_consistency', status: 'PASS', detail: 'OK' };
}

// ---------------------------------------------------------------------------
// Evidence count threshold
// ---------------------------------------------------------------------------
export function checkEvidenceCount(evidenceCount: number): QualityCheck {
  if (evidenceCount < 2) {
    return {
      name: 'evidence_count',
      status: 'HALT',
      detail: `Only ${evidenceCount} evidence sources — minimum 2 required`,
    };
  }
  if (evidenceCount < 4) {
    return {
      name: 'evidence_count',
      status: 'WARN',
      detail: `Only ${evidenceCount} evidence sources — recommend 4+`,
    };
  }
  return { name: 'evidence_count', status: 'PASS', detail: `${evidenceCount} sources` };
}

// ---------------------------------------------------------------------------
// Bounds check — verify scores are within valid ranges
// ---------------------------------------------------------------------------
export function checkBounds(result: AnalysisResult): QualityCheck {
  const violations: string[] = [];

  if (result.overall_score < 0 || result.overall_score > 10) {
    violations.push(`overall_score=${result.overall_score} outside [0,10]`);
  }
  if (result.confidence < 0 || result.confidence > 1) {
    violations.push(`confidence=${result.confidence} outside [0,1]`);
  }
  if (result.dimension_scores) {
    for (const [dim, score] of Object.entries(result.dimension_scores)) {
      if (score < 0 || score > 10) {
        violations.push(`${dim}=${score} outside [0,10]`);
      }
    }
  }
  if (result.personality_scores) {
    for (const [dim, score] of Object.entries(result.personality_scores)) {
      if (dim === 'contradiction_score') {
        if (score < 0 || score > 1) violations.push(`${dim}=${score} outside [0,1]`);
      } else {
        if (score < 1 || score > 10) violations.push(`${dim}=${score} outside [1,10]`);
      }
    }
  }

  if (violations.length > 0) {
    return { name: 'bounds', status: 'HALT', detail: violations.join('; ') };
  }
  return { name: 'bounds', status: 'PASS', detail: 'All scores within bounds' };
}

// ---------------------------------------------------------------------------
// Clamp events check — many clamps = LLM output was unreliable
// ---------------------------------------------------------------------------
export function checkClampEvents(
  clampEvents: Array<{ dim: string; original: number; clamped: number }>,
): QualityCheck {
  if (clampEvents.length >= 4) {
    return {
      name: 'clamp_events',
      status: 'HALT',
      detail: `${clampEvents.length} values clamped — LLM output unreliable`,
    };
  }
  if (clampEvents.length >= 2) {
    return {
      name: 'clamp_events',
      status: 'WARN',
      detail: `${clampEvents.length} values clamped`,
    };
  }
  if (clampEvents.length === 1) {
    return {
      name: 'clamp_events',
      status: 'PASS',
      detail: `1 value clamped: ${clampEvents[0].dim} (${clampEvents[0].original} → ${clampEvents[0].clamped})`,
    };
  }
  return { name: 'clamp_events', status: 'PASS', detail: 'No clamp events' };
}

// ---------------------------------------------------------------------------
// validateAnalysis — run all checks and produce a QualityReport
// ---------------------------------------------------------------------------
export function validateAnalysis(result: AnalysisResult, inputCompleteness?: InputCompletenessResult): QualityReport {
  const checks: QualityCheck[] = [];

  // RC5 — Sprint 170: HALT if dimension_scores is missing or empty
  // Prevents silent bypass of uniformity + consistency checks downstream
  if (!result.dimension_scores || Object.keys(result.dimension_scores).length === 0) {
    checks.push({
      name: 'missing_dimension_scores',
      status: 'HALT',
      detail: 'dimension_scores is missing or empty — no dimensions to validate',
    });
  }

  // Input completeness check (Sprint 151) — if provided, check data quality
  if (inputCompleteness) {
    if (inputCompleteness.level === 'EMPTY') {
      checks.push({
        name: 'input_completeness',
        status: 'HALT',
        detail: `Input data is EMPTY (0 fields, ${inputCompleteness.source_count} sources) — analysis should not have proceeded`,
      });
    } else if (inputCompleteness.level === 'MINIMAL') {
      checks.push({
        name: 'input_completeness',
        status: 'WARN',
        detail: `Input data is MINIMAL (tier=${inputCompleteness.tier}, sources=${inputCompleteness.source_count})`,
      });
    } else {
      checks.push({
        name: 'input_completeness',
        status: 'PASS',
        detail: `Input: ${inputCompleteness.level}, tier=${inputCompleteness.tier}, sources=${inputCompleteness.source_count}`,
      });
    }
  }

  // Bounds check (always)
  checks.push(checkBounds(result));

  // Score-confidence mismatch
  checks.push(checkScoreConfidenceMismatch(result.overall_score, result.confidence));

  // Score uniformity (if dimension_scores provided)
  if (result.dimension_scores && Object.keys(result.dimension_scores).length >= 3) {
    checks.push(checkScoreUniformity(result.dimension_scores));
  }

  // Score uniformity for personality scores
  if (result.personality_scores && Object.keys(result.personality_scores).length >= 3) {
    // Exclude contradiction_score from uniformity check (different scale)
    const filtered = Object.fromEntries(
      Object.entries(result.personality_scores).filter(([k]) => k !== 'contradiction_score')
    );
    if (Object.keys(filtered).length >= 3) {
      const personalityCheck = checkScoreUniformity(filtered);
      personalityCheck.name = 'personality_uniformity';
      checks.push(personalityCheck);
    }
  }

  // Recommendation consistency
  if (result.recommendation && result.dimension_scores) {
    checks.push(checkRecommendationConsistency(result.recommendation, result.dimension_scores));
  }

  // Evidence count
  if (result.evidence_count !== undefined) {
    checks.push(checkEvidenceCount(result.evidence_count));
  }

  // Insufficient dimension data check (Advisory Board v24)
  if (result.insufficient_dimension_count !== undefined && result.total_dimension_count !== undefined) {
    const ratio = result.total_dimension_count > 0
      ? result.insufficient_dimension_count / result.total_dimension_count
      : 1;
    if (ratio >= 0.7) {
      checks.push({
        name: 'insufficient_data_ratio',
        status: 'HALT',
        detail: `${result.insufficient_dimension_count}/${result.total_dimension_count} dimensioner saknar data (${Math.round(ratio * 100)}%) — profilen har minimalt informationsvärde`,
      });
    } else if (ratio >= 0.5) {
      checks.push({
        name: 'insufficient_data_ratio',
        status: 'WARN',
        detail: `${result.insufficient_dimension_count}/${result.total_dimension_count} dimensioner saknar data (${Math.round(ratio * 100)}%)`,
      });
    } else {
      checks.push({
        name: 'insufficient_data_ratio',
        status: 'PASS',
        detail: `${result.insufficient_dimension_count}/${result.total_dimension_count} dimensioner saknar data`,
      });
    }
  }

  // Clamp events
  if (result.clamp_events) {
    checks.push(checkClampEvents(result.clamp_events));
  }

  // Calculate score: start at 100, deduct for issues
  let score = 100;
  for (const check of checks) {
    if (check.status === 'HALT') {
      // EMPTY input = -40 (more severe than standard -25)
      score -= check.name === 'input_completeness' ? 40 : 25;
    }
    if (check.status === 'WARN') score -= 10;
  }
  score = Math.max(0, Math.min(100, score));

  // Calculate gate: HALT if any check is HALT OR score < 60 (quality minimum)
  const hasHalt = checks.some(c => c.status === 'HALT');
  const hasWarn = checks.some(c => c.status === 'WARN');
  const gate: 'PASS' | 'WARN' | 'HALT' = (hasHalt || score < 60) ? 'HALT' : hasWarn ? 'WARN' : 'PASS';

  return { score, gate, checks };
}
