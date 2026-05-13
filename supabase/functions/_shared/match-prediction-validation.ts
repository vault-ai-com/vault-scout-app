// match-prediction-validation.ts — code-enforced validation for match predictions
//
// Equivalent of quality-validation.ts but for match prediction pipelines.
// Prevents fabrication of statistics, enforces data availability gates,
// validates provenance tagging, and catches common hallucination patterns.
//
// Used by: vault_match_prediction, vault_match_coach_prep, vault_post_match_review
// Pure functions, no side effects, fully testable.
//
// Sprint: Scout Data Integrity Audit 2026-05-02
// Audit: UCFA02 (4.2/10 DSD), UCFA04 (5/10 flow), UCFA05 (7/10 risk), VET06 PARTIAL GO 7.5/10

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ValidationCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'HALT';
  detail: string;
}

export interface ValidationReport {
  score: number;        // 0-100
  gate: 'PASS' | 'WARN' | 'HALT';
  checks: ValidationCheck[];
}

export type DataLayerStatus = 'AVAILABLE' | 'NO_DATA' | 'CHECK_BELOW';

export interface DataAvailability {
  fixture: DataLayerStatus;
  lineups: DataLayerStatus;
  events: DataLayerStatus;
  statistics: DataLayerStatus;
  xg: DataLayerStatus;
  player_stats: DataLayerStatus;
  derived: DataLayerStatus;
  context: DataLayerStatus;
  injuries: DataLayerStatus;
  player_progression: DataLayerStatus;
  xg_global_coverage_pct?: number;
  coverage_warnings?: string[];
}

export interface MatchPredictionResult {
  home_win_pct?: number;
  draw_pct?: number;
  away_win_pct?: number;
  predicted_home_goals?: number;
  predicted_away_goals?: number;
  confidence?: number;
  data_availability?: DataAvailability;
  agent_output?: string;       // raw text output for provenance scanning
  agent_id?: string;
}

// ---------------------------------------------------------------------------
// Check 1: Data Availability Gates
// HALT if critical data layers are missing
// ---------------------------------------------------------------------------
export function checkDataAvailability(da: DataAvailability): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Fixture is absolutely required
  if (da.fixture === 'NO_DATA') {
    checks.push({
      name: 'data_fixture',
      status: 'HALT',
      detail: 'Fixture data missing — cannot make prediction without basic match info',
    });
  }

  // Injuries = NO_DATA is a known P0 gap — HALT for lineup prediction agents
  if (da.injuries === 'NO_DATA') {
    checks.push({
      name: 'data_injuries',
      status: 'WARN',
      detail: 'Injury data unavailable (batch sync not implemented). Any injury claims in output = FABRICATION.',
    });
  }

  // Statistics missing = major gap
  if (da.statistics === 'NO_DATA') {
    checks.push({
      name: 'data_statistics',
      status: 'WARN',
      detail: 'Match statistics unavailable — prediction confidence should be LOW.',
    });
  }

  // xG global coverage check
  if (da.xg === 'NO_DATA') {
    checks.push({
      name: 'data_xg',
      status: 'WARN',
      detail: `xG data missing for this match. Global coverage: ${da.xg_global_coverage_pct ?? 0}%.`,
    });
  }
  if (da.xg_global_coverage_pct !== undefined && da.xg_global_coverage_pct < 10) {
    checks.push({
      name: 'data_xg_coverage',
      status: 'WARN',
      detail: `xG global coverage only ${da.xg_global_coverage_pct}% — xG-based analysis unreliable.`,
    });
  }

  // Lineups missing = can't validate starting XI claims
  if (da.lineups === 'NO_DATA') {
    checks.push({
      name: 'data_lineups',
      status: 'WARN',
      detail: 'Lineup data missing — any lineup claims must be marked [WEB] or [LLM].',
    });
  }

  // Count NO_DATA layers
  const layers: DataLayerStatus[] = [
    da.fixture, da.lineups, da.events, da.statistics,
    da.xg, da.player_stats, da.derived, da.context, da.injuries,
  ];
  const noDataCount = layers.filter(l => l === 'NO_DATA').length;

  if (noDataCount >= 5) {
    checks.push({
      name: 'data_coverage_overall',
      status: 'HALT',
      detail: `${noDataCount}/9 data layers = NO_DATA — insufficient data for reliable prediction.`,
    });
  } else if (noDataCount >= 3) {
    checks.push({
      name: 'data_coverage_overall',
      status: 'WARN',
      detail: `${noDataCount}/9 data layers = NO_DATA — prediction confidence should be reduced.`,
    });
  }

  if (checks.length === 0) {
    checks.push({
      name: 'data_availability',
      status: 'PASS',
      detail: 'All critical data layers available.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Check 2: Probability Bounds
// Probabilities must be 0-100 and sum to ~100%
// ---------------------------------------------------------------------------
export function checkProbabilityBounds(result: MatchPredictionResult): ValidationCheck {
  const { home_win_pct, draw_pct, away_win_pct } = result;

  if (home_win_pct === undefined || draw_pct === undefined || away_win_pct === undefined) {
    return {
      name: 'probability_bounds',
      status: 'WARN',
      detail: 'Probabilities not provided — cannot validate bounds.',
    };
  }

  const violations: string[] = [];

  if (home_win_pct < 0 || home_win_pct > 100) violations.push(`home_win_pct=${home_win_pct}`);
  if (draw_pct < 0 || draw_pct > 100) violations.push(`draw_pct=${draw_pct}`);
  if (away_win_pct < 0 || away_win_pct > 100) violations.push(`away_win_pct=${away_win_pct}`);

  const sum = home_win_pct + draw_pct + away_win_pct;
  if (Math.abs(sum - 100) > 2) {
    violations.push(`sum=${sum.toFixed(1)}% (expected ~100%)`);
  }

  if (violations.length > 0) {
    return {
      name: 'probability_bounds',
      status: 'HALT',
      detail: `Probability violations: ${violations.join('; ')}`,
    };
  }

  return { name: 'probability_bounds', status: 'PASS', detail: `Sum=${sum.toFixed(1)}%` };
}

// ---------------------------------------------------------------------------
// Check 3: Score Reasonableness
// Predicted scores should be within realistic bounds
// ---------------------------------------------------------------------------
export function checkScoreReasonableness(result: MatchPredictionResult): ValidationCheck {
  const { predicted_home_goals, predicted_away_goals } = result;

  if (predicted_home_goals === undefined || predicted_away_goals === undefined) {
    return { name: 'score_reasonableness', status: 'PASS', detail: 'No predicted score provided' };
  }

  const violations: string[] = [];

  if (predicted_home_goals < 0) violations.push(`home_goals=${predicted_home_goals} < 0`);
  if (predicted_away_goals < 0) violations.push(`away_goals=${predicted_away_goals} < 0`);
  if (predicted_home_goals > 8) violations.push(`home_goals=${predicted_home_goals} > 8 (unrealistic)`);
  if (predicted_away_goals > 8) violations.push(`away_goals=${predicted_away_goals} > 8 (unrealistic)`);

  if (violations.length > 0) {
    return {
      name: 'score_reasonableness',
      status: 'HALT',
      detail: `Score violations: ${violations.join('; ')}`,
    };
  }

  return { name: 'score_reasonableness', status: 'PASS', detail: 'Within realistic bounds' };
}

// ---------------------------------------------------------------------------
// Check 4: Confidence-Data Coupling
// Confidence cannot exceed data coverage quality
// ---------------------------------------------------------------------------
export function checkConfidenceDataCoupling(
  confidence: number | undefined,
  dataAvailability: DataAvailability | undefined,
): ValidationCheck {
  if (confidence === undefined) {
    return { name: 'confidence_data_coupling', status: 'WARN', detail: 'No confidence provided' };
  }

  if (confidence < 0 || confidence > 1) {
    return {
      name: 'confidence_data_coupling',
      status: 'HALT',
      detail: `Confidence ${confidence} outside [0, 1]`,
    };
  }

  if (!dataAvailability) {
    return { name: 'confidence_data_coupling', status: 'PASS', detail: 'No data_availability to cross-check' };
  }

  const layers: DataLayerStatus[] = [
    dataAvailability.fixture, dataAvailability.lineups, dataAvailability.events,
    dataAvailability.statistics, dataAvailability.xg, dataAvailability.player_stats,
    dataAvailability.derived, dataAvailability.context, dataAvailability.injuries,
  ];
  const availableCount = layers.filter(l => l === 'AVAILABLE').length;
  const coverageRatio = availableCount / layers.length;

  // Confidence should not vastly exceed data coverage
  if (confidence > 0.8 && coverageRatio < 0.5) {
    return {
      name: 'confidence_data_coupling',
      status: 'HALT',
      detail: `Confidence ${confidence} but only ${availableCount}/9 data layers available (${(coverageRatio * 100).toFixed(0)}%). Confidence inflated.`,
    };
  }

  if (confidence > 0.7 && coverageRatio < 0.4) {
    return {
      name: 'confidence_data_coupling',
      status: 'HALT',
      detail: `Confidence ${confidence} but only ${availableCount}/9 data layers available. Confidence inflated.`,
    };
  }

  if (confidence > 0.6 && coverageRatio < 0.3) {
    return {
      name: 'confidence_data_coupling',
      status: 'WARN',
      detail: `High confidence ${confidence} with low data coverage (${(coverageRatio * 100).toFixed(0)}%).`,
    };
  }

  return {
    name: 'confidence_data_coupling',
    status: 'PASS',
    detail: `Confidence ${confidence}, data coverage ${(coverageRatio * 100).toFixed(0)}%`,
  };
}

// ---------------------------------------------------------------------------
// Check 5: Provenance Tag Scan
// Scans agent output text for [API]/[WEB]/[LLM] tags
// ---------------------------------------------------------------------------
export function checkProvenanceTags(agentOutput: string | undefined): ValidationCheck {
  if (!agentOutput || agentOutput.length < 100) {
    return { name: 'provenance_tags', status: 'WARN', detail: 'No agent output to scan' };
  }

  const apiCount = (agentOutput.match(/\[API\]/g) || []).length;
  const webCount = (agentOutput.match(/\[WEB\]/g) || []).length;
  const llmCount = (agentOutput.match(/\[LLM\]/g) || []).length;
  const totalTags = apiCount + webCount + llmCount;

  // Count statistical claims (numbers that look like match stats)
  const statClaims = (agentOutput.match(/\d+[%]|\d+\.\d+\s*xG|\d+-\d+\s*(mål|goals)/gi) || []).length;

  if (totalTags === 0) {
    return {
      name: 'provenance_tags',
      status: 'HALT',
      detail: `0 provenance tags found in output (${agentOutput.length} chars). All data claims are untagged.`,
    };
  }

  if (statClaims > 5 && apiCount === 0) {
    return {
      name: 'provenance_tags',
      status: 'HALT',
      detail: `${statClaims} statistical claims but 0 [API] tags — statistics likely not from verified API data.`,
    };
  }

  if (totalTags < 3 && agentOutput.length > 1000) {
    return {
      name: 'provenance_tags',
      status: 'WARN',
      detail: `Only ${totalTags} tags in ${agentOutput.length} chars output. Expected more tagging.`,
    };
  }

  return {
    name: 'provenance_tags',
    status: 'PASS',
    detail: `[API]=${apiCount}, [WEB]=${webCount}, [LLM]=${llmCount}`,
  };
}

// ---------------------------------------------------------------------------
// Check 6: Fabrication Detection
// Scans output for known fabrication patterns
// ---------------------------------------------------------------------------
export function checkFabricationPatterns(
  agentOutput: string | undefined,
  dataAvailability: DataAvailability | undefined,
): ValidationCheck {
  if (!agentOutput) {
    return { name: 'fabrication_detection', status: 'PASS', detail: 'No output to scan' };
  }

  const fabrications: string[] = [];

  // Pattern 1: Injury claims when injuries = NO_DATA
  if (dataAvailability?.injuries === 'NO_DATA') {
    const injuryMentions = agentOutput.match(
      /skad(ad|ade|or)|injur(y|ies|ed)|saknas.*skad|miss.*through.*injury|out.*injured/gi,
    );
    if (injuryMentions && injuryMentions.length > 0) {
      // Allow mentions that explicitly say "no data" or "unavailable"
      const claimsMentions = injuryMentions.filter(
        m => !/(saknas|ej tillgänglig|no data|unavailable|okänd)/i.test(m),
      );
      if (claimsMentions.length > 0) {
        fabrications.push(
          `${claimsMentions.length} injury claim(s) but injuries data = NO_DATA: "${claimsMentions[0]}"`,
        );
      }
    }
  }

  // Pattern 2: xG values when xG = NO_DATA
  if (dataAvailability?.xg === 'NO_DATA') {
    const xgValues = agentOutput.match(/\d+\.\d+\s*xG|xG\s*[:=]\s*\d/gi);
    if (xgValues && xgValues.length > 0) {
      fabrications.push(
        `${xgValues.length} xG value(s) but xG data = NO_DATA: "${xgValues[0]}"`,
      );
    }
  }

  // Pattern 3: Hedging language that masks fabrication
  const hedgingPatterns = agentOutput.match(
    /troligen|uppskattningsvis|approximately|roughly|around.*\d+%|estimated.*\d+/gi,
  );
  if (hedgingPatterns && hedgingPatterns.length >= 3) {
    fabrications.push(
      `${hedgingPatterns.length} hedging phrases detected — may indicate fabricated estimates`,
    );
  }

  if (fabrications.length > 0) {
    return {
      name: 'fabrication_detection',
      status: fabrications.some(f => f.includes('NO_DATA')) ? 'HALT' : 'WARN',
      detail: fabrications.join('; '),
    };
  }

  return { name: 'fabrication_detection', status: 'PASS', detail: 'No fabrication patterns detected' };
}

// ---------------------------------------------------------------------------
// validateMatchPrediction — run all checks and produce a ValidationReport
// ---------------------------------------------------------------------------
export function validateMatchPrediction(
  result: MatchPredictionResult,
  dataAvailability?: DataAvailability,
): ValidationReport {
  const checks: ValidationCheck[] = [];

  // Data availability gates
  if (dataAvailability) {
    checks.push(...checkDataAvailability(dataAvailability));
  }

  // Probability bounds
  checks.push(checkProbabilityBounds(result));

  // Score reasonableness
  checks.push(checkScoreReasonableness(result));

  // Confidence-data coupling
  checks.push(checkConfidenceDataCoupling(result.confidence, dataAvailability));

  // Provenance tag scan
  checks.push(checkProvenanceTags(result.agent_output));

  // Fabrication detection
  checks.push(checkFabricationPatterns(result.agent_output, dataAvailability));

  // Calculate score
  let score = 100;
  for (const check of checks) {
    if (check.status === 'HALT') score -= 25;
    if (check.status === 'WARN') score -= 10;
  }
  score = Math.max(0, Math.min(100, score));

  // Calculate gate
  const hasHalt = checks.some(c => c.status === 'HALT');
  const hasWarn = checks.some(c => c.status === 'WARN');
  const gate: 'PASS' | 'WARN' | 'HALT' = (hasHalt || score < 60) ? 'HALT' : hasWarn ? 'WARN' : 'PASS';

  return { score, gate, checks };
}

// ---------------------------------------------------------------------------
// buildDataAvailabilityWarning — generates prompt warning from data_availability
// Inject this into agent prompts when data layers are missing
// ---------------------------------------------------------------------------
export function buildDataAvailabilityWarning(da: DataAvailability): string {
  const warnings: string[] = [];

  if (da.injuries === 'NO_DATA') {
    warnings.push('HALT: Skadedata ej tillgänglig. FABRICERA ALDRIG skadeinformation.');
  }
  if (da.xg === 'NO_DATA') {
    warnings.push(`VARNING: xG-data saknas. Global coverage: ${da.xg_global_coverage_pct ?? 0}%. Fabricera ALDRIG xG-värden.`);
  }
  if (da.lineups === 'NO_DATA') {
    warnings.push('VARNING: Lineups saknas. Markera uppställningsprognoser med [LLM].');
  }
  if (da.statistics === 'NO_DATA') {
    warnings.push('VARNING: Matchstatistik saknas. Sänk confidence.');
  }

  if (warnings.length === 0) return '';

  return `\n## DATA AVAILABILITY WARNINGS (CODE-ENFORCED)\n${warnings.map(w => `- ${w}`).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Check 7: Entity Validation (ENTITY_VALIDATOR)
// Calls validate_match_entities() SQL function to cross-validate team names
// against football_fixtures and player coverage against football_player_stats.
//
// HALT: fixture not found OR both teams have 0 players.
// WARN: either team has < 5 players.
//
// Sprint 202 — V59 Builder Hooks
// ---------------------------------------------------------------------------

export interface EntityValidationResult {
  valid: boolean;
  halt_reason: string | null;
  home_team: string;
  away_team: string;
  fixture_found: boolean;
  home_players_found: number;
  away_players_found: number;
  warnings: string[];
  fuzzy_match_used: boolean;
}

export async function checkEntityValidation(
  supabaseClient: {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
  },
  homeTeam: string,
  awayTeam: string,
  fixtureApiId?: number,
): Promise<ValidationCheck> {
  let result: EntityValidationResult;

  try {
    const params: Record<string, unknown> = {
      p_home_team: homeTeam,
      p_away_team: awayTeam,
    };
    if (fixtureApiId !== undefined && fixtureApiId !== null) {
      params.p_fixture_api_id = fixtureApiId;
    }

    const { data, error } = await supabaseClient.rpc(
      'validate_match_entities',
      params,
    );

    if (error) {
      return {
        name: 'entity_validation',
        status: 'HALT',
        detail: `validate_match_entities RPC error: ${
          (error as { message?: string }).message ?? String(error)
        }`,
      };
    }

    result = data as EntityValidationResult;
  } catch (err) {
    return {
      name: 'entity_validation',
      status: 'HALT',
      detail: `entity_validation exception: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!result.valid || result.halt_reason) {
    return {
      name: 'entity_validation',
      status: 'HALT',
      detail:
        result.halt_reason ??
        `Entity validation failed: fixture_found=${result.fixture_found}, ` +
          `home_players=${result.home_players_found}, away_players=${result.away_players_found}`,
    };
  }

  if (result.warnings && result.warnings.length > 0) {
    const warnDetail =
      result.warnings.join('; ') +
      (result.fuzzy_match_used ? ' [fuzzy_team_name_match]' : '');
    return {
      name: 'entity_validation',
      status: 'WARN',
      detail: warnDetail,
    };
  }

  return {
    name: 'entity_validation',
    status: 'PASS',
    detail:
      `fixture_found=true, home_players=${result.home_players_found}, ` +
      `away_players=${result.away_players_found}` +
      (result.fuzzy_match_used ? ' [fuzzy_team_name_match]' : ''),
  };
}
