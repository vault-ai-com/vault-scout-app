// scout-personality-analysis — BPA Football v21 — 2026-03-29 determinism-fix
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "v24-advisory-board-caps";

import { createRateLimiter, getRateLimitHeaders, type RateLimitResult } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { ARCHETYPES, clamp, createClampTracker, resolveArchetype, resolveRecommendation, computeConfidence, capConfidenceByDataAvailability, evaluateStressArchetype, countInsufficientDimensions } from '../_shared/personality-logic.ts';
import { validateAnalysis, checkInputCompleteness, buildInputCompletenessWarning, type QualityReport, type InputCompletenessResult } from '../_shared/quality-validation.ts';
import { callAnthropic, MODELS } from '../_shared/anthropic-client.ts';
import { sanitizePromptInput } from '../_shared/sanitize.ts';
import { buildSeasonContext } from '../_shared/constants.ts';

// ---------------------------------------------------------------------------
// Rate limiter — in-memory per isolate (Deno Deploy)
// Key: player_id (no JWT auth) | Window: 15 min | Max: 5 requests per player
// ---------------------------------------------------------------------------
const rateLimiter = createRateLimiter(5);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  const _corsHeaders = getCorsHeaders(req.headers.get("origin"));

  const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(
    JSON.stringify({ ...(typeof body === 'object' ? body as object : { data: body }), _v: VERSION }),
    { status, headers: { ..._corsHeaders, 'Content-Type': 'application/json', ...extra } }
  );

  // JWT authentication (shared helper)
  const authResult = await authenticateRequest(req);
  if (!authResult.ok) {
    return respond({ success: false, error: authResult.error }, authResult.status);
  }
  const _userId = authResult.userId;

  let rl: RateLimitResult | null = null;

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

    // FIX: global auth header so service_role overrides inbound JWT
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
    });

    const body = await req.json();
    const player_id: string = (body.player_id ?? '').slice(0, 100);

    if (!player_id) {
      return respond({ success: false, error: 'player_id required' }, 400);
    }

    // Rate limit check — keyed on player_id (no JWT in this function)
    rl = await rateLimiter.check(`scout-personality-analysis:${player_id}`, supabase);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Max 5 personality analyses per 15 minutes per player.', retry_after_seconds: retryAfterSec, _v: VERSION }),
        { status: 429, headers: { ..._corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec), ...getRateLimitHeaders(rl) } }
      );
    }

    const rlHeaders = getRateLimitHeaders(rl);

    // Check cache (48h) — FIX: use analysis_data column + maybeSingle
    const { data: cached } = await supabase
      .from('scout_analyses')
      .select('id, analysis_data, created_at')
      .eq('player_id', player_id)
      .eq('analysis_type', 'personality')
      .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.analysis_data) {
      return new Response(
        JSON.stringify({ ...(cached.analysis_data as object), _v: VERSION }),
        { headers: { ..._corsHeaders, 'Content-Type': 'application/json', ...rlHeaders } }
      );
    }

    // FIX: use date_of_birth (not age) + maybeSingle
    const { data: player, error: playerErr } = await supabase
      .from('scout_players')
      .select('id, name, position_primary, date_of_birth, nationality, current_club, current_league, tier, career_phase, profile_data')
      .eq('id', player_id)
      .maybeSingle();

    if (playerErr || !player) {
      return respond({
        success: false,
        error: 'PLAYER_NOT_FOUND_V21',
        db_error: playerErr ? JSON.stringify(playerErr) : 'NO_ROWS',
        player_id,
      }, 404, rlHeaders);
    }

    // Load KB context
    const kbKeys = [
      'bpa_football_framework',
      'psychological_dimensions',
      'archetype_definitions',
      'coaching_integration',
      'career_motivation_framework',
    ];
    const { data: kbRows } = await supabase
      .from('knowledge_bank')
      .select('key, content')
      .eq('cluster', 'vault_ai_scout')
      .in('key', kbKeys)
      .limit(5);

    const kbContext = (kbRows ?? []).map((r: { key: string; content: unknown }) => {
      const content = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
      return `[KB: ${r.key}]\n${content}`;
    }).join('\n\n');

    // Compute age from date_of_birth
    const ageStr = player.date_of_birth
      ? String(new Date().getFullYear() - new Date(player.date_of_birth).getFullYear())
      : 'okänd';

    // Sprint 182: Input completeness + season context for LLM prompt injection
    const inputCompleteness: InputCompletenessResult = checkInputCompleteness({
      profile_data: player.profile_data as Record<string, unknown> | null,
      source_ids: [],
    });
    const _inputCompletenessWarning = buildInputCompletenessWarning(inputCompleteness);
    const _seasonContext = buildSeasonContext(player.profile_data as Record<string, unknown> | null);

    const systemPrompt = `Du är en världsledande fotbollspsykolog och beteendeanalytiker.
Din uppgift är att analysera en fotbollsspelares psykologiska profil baserat på tillgänglig information.
Använd EXAKT dessa 12 dimensioner och returnera JSON.

## KRITISKT: Anti-Hallucineringsregler (BRYT ALDRIG)
- Du får ENBART använda information som EXPLICIT finns i spelardata nedan (Namn, Position, Klubb, Liga, Ålder, Nationalitet, Profildata).
- ALDRIG använda din generella träningskunskap om specifika spelare, klubbar, matchresultat, titlar eller karriärhistorik.
- Om Profildata saknas eller är tom — det finns INGEN verifierad profildata. HITTA INTE PÅ.
- Varje "evidence"-fält MÅSTE referera ENBART till data som finns i prompten ovan. ALDRIG citera prestationer eller händelser som inte finns i input.
- Om du inte hittar specifik evidens i inputdatan för en dimension, sätt score till null och evidence till "Otillräcklig verifierad data — ingen evidens tillgänglig".
- När data är gles, sätt CONFIDENCE_LABEL LÅGT (0.2-0.4) och data_source_quality till "PUBLIC_ONLY".
- Generera ALDRIG trovärdigt klingande narrativ från din träningskunskap. Vid tvivel, skriv "Otillräcklig data".
- Om du märker att du skriver evidens som INTE direkt kan spåras till inputdatan, STOPPA och skriv "Otillräcklig data" istället.

Grunddimensioner (alla 1-10):
- decision_tempo: Hur snabbt fattar spelaren beslut under press
- risk_appetite: Benägenhet att ta risker på och av planen
- ambition_level: Drivkraft att nå toppen
- team_orientation: Lagspelarprofil vs solist
- tactical_understanding: Taktisk intelligens och flexibilitet
- structure_need: Behov av tydlig struktur och direktiv
- career_motivation: Yttre vs inre motivation

KB-förstärkta dimensioner (alla 1-10):
- ego: Ego-profil — narcissism vs självkännedom, hur spelaren hanterar uppmärksamhet
- resilience: Mental motståndskraft — hur spelaren hanterar motgångar, skador, bänkning
- coachability: Träningsbarhet — öppenhet för feedback, vilja att utvecklas
- x_factor: Unik kvalitet som sticker ut — karisma, clutch-gen, oförutsägbarhet

Motsägelsefullhet (0-1):
- contradiction_score: Graden av motsägelser i beteendemönster (0=konsekvent, 1=starkt motstridigt). Letar efter gap mellan ord och handling, image och verklighet.

Arketyper (välj EN, closed taxonomy):
${ARCHETYPES.join(', ')}

Returformat — EXAKT detta JSON (inga andra fält):
{"dimensions":{"decision_tempo":{"score":N,"evidence":"..."},"risk_appetite":{"score":N,"evidence":"..."},"ambition_level":{"score":N,"evidence":"..."},"team_orientation":{"score":N,"evidence":"..."},"tactical_understanding":{"score":N,"evidence":"..."},"structure_need":{"score":N,"evidence":"..."},"career_motivation":{"score":N,"evidence":"..."},"ego":{"score":N,"evidence":"..."},"resilience":{"score":N,"evidence":"..."},"coachability":{"score":N,"evidence":"..."},"x_factor":{"score":N,"evidence":"..."}},"contradiction_score":{"score":0.3,"evidence":"..."},"composite_archetype":"ARCHETYPE_NAME","composite_archetype_reasoning":"...","stress_archetype":"...","coaching_approach":["tip1","tip2","tip3"],"integration_risks":["risk1","risk2"],"CONFIDENCE_LABEL":0.75,"data_source_quality":"PUBLIC_ONLY","confidence_reasoning":"..."}

VIKTIGT: composite_archetype MÅSTE vara exakt ett av: ${ARCHETYPES.join(', ')}
VIKTIGT: stress_archetype = fritext som beskriver spelarens beteende under extrem press (max 100 tecken).
VIKTIGT: Om färre än 6 dimensioner har tillräcklig data i inputen, sätt CONFIDENCE_LABEL under 0.4 och data_source_quality till "PUBLIC_ONLY".

${kbContext ? 'Knowledge Bank Context:\n' + kbContext : ''}`;

    const spi = sanitizePromptInput;
    const userPrompt = `Analysera: ${spi(player.name)} (${spi(player.position_primary)}, ${spi(player.tier)}, ${spi(player.career_phase)})
Klubb: ${spi(player.current_club)} | Liga: ${spi(player.current_league)}
Ålder: ${ageStr} | Nationalitet: ${spi(player.nationality)}
${player.profile_data ? 'Profildata: ' + spi(typeof player.profile_data === 'string' ? player.profile_data : JSON.stringify(player.profile_data)) : ''}
${_inputCompletenessWarning}${_seasonContext}

Returnera JSON med exakt ovanstående struktur. Alla dimensionsscores 1-10. contradiction_score 0-1. CONFIDENCE_LABEL 0-1. coaching_approach max 7 items. integration_risks max 6 items. stress_archetype max 100 tecken.`;

    const startTime = Date.now();

    // VCE09 F2: temperature:0 preserved for determinism. F7: try/catch preserves respond() with rlHeaders.
    let rawText: string;
    try {
      const llmResult = await callAnthropic({
        model: MODELS.opus,
        max_tokens: 2500,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        timeoutMs: 55000,
      });
      rawText = llmResult.text || '{}';
    } catch (llmErr) {
      const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
      return respond({ success: false, error: 'LLM error: ' + errMsg.slice(0, 200) }, 500, rlHeaders);
    }

    // FIX: strip markdown fences, use indexOf/lastIndexOf for robust parsing
    let parsed: Record<string, unknown> = {};
    try {
      const stripped = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      const jsonStr = start !== -1 && end > start ? stripped.slice(start, end + 1) : '{}';
      parsed = JSON.parse(jsonStr);
    } catch { parsed = {}; }

    const dims = (parsed.dimensions as Record<string, { score: number; evidence: string }>) ?? {};
    const ct = createClampTracker();

    const getDim = (key: string): { score: number; evidence: string } => {
      const d = dims[key];
      if (d && typeof d.score === 'number') {
        return { score: ct.clamp(Math.round(d.score), 1, 10, key), evidence: String(d.evidence || 'Baserat på tillgänglig data').slice(0, 500) };
      }
      return { score: 5, evidence: 'Otillräcklig data för dimension' };
    };

    const dt = getDim('decision_tempo');
    const ra = getDim('risk_appetite');
    const al = getDim('ambition_level');
    const to = getDim('team_orientation');
    const tu = getDim('tactical_understanding');
    const sn = getDim('structure_need');
    const cm = getDim('career_motivation');
    const ego = getDim('ego');
    const resilience = getDim('resilience');
    const coachability = getDim('coachability');
    const xFactor = getDim('x_factor');

    // Contradiction score: 0-1 scale (separate from 1-10 dimensions)
    const csRaw = parsed.contradiction_score as { score?: number; evidence?: string } | undefined;
    const contradictionScore = csRaw && typeof csRaw.score === 'number'
      ? ct.clamp(Math.round(csRaw.score * 100) / 100, 0, 1, 'contradiction_score')
      : 0.3;
    const contradictionEvidence = String(csRaw?.evidence || 'Otillräcklig data för motsägelsebedömning').slice(0, 500);

    const dimScores: Record<string, number> = {
      decision_tempo: dt.score, risk_appetite: ra.score, ambition_level: al.score,
      team_orientation: to.score, tactical_understanding: tu.score,
      structure_need: sn.score, career_motivation: cm.score,
      ego: ego.score, resilience: resilience.score, coachability: coachability.score,
      x_factor: xFactor.score, contradiction_score: contradictionScore,
    };
    const llmArchetype = String(parsed.composite_archetype ?? '');
    const composite_archetype = ARCHETYPES.includes(llmArchetype)
      ? llmArchetype
      : resolveArchetype(dimScores);

    const coachingRaw = Array.isArray(parsed.coaching_approach) ? parsed.coaching_approach : [];
    const coaching_approach = coachingRaw.slice(0, 7).map(String).filter((s: string) => s.length > 0);
    if (coaching_approach.length === 0) coaching_approach.push('Anpassa träningsupplägg till spelarens profil');

    const risksRaw = Array.isArray(parsed.integration_risks) ? parsed.integration_risks : [];
    const integration_risks = risksRaw.slice(0, 6).map(String).filter((s: string) => s.length > 0);
    if (integration_risks.length === 0) integration_risks.push('Standardintegrationsrisk');

    const llmConf = typeof parsed.CONFIDENCE_LABEL === 'number'
      ? clamp(parsed.CONFIDENCE_LABEL, 0, 1)
      : 0.5;
    const dataSourceQuality = ['PUBLIC_ONLY', 'MIXED', 'VERIFIED'].includes(String(parsed.data_source_quality))
      ? String(parsed.data_source_quality)
      : 'PUBLIC_ONLY';
    const evidenceCount = Object.values(dims).filter(
      (d: unknown) => d && typeof (d as { evidence: string }).evidence === 'string' && (d as { evidence: string }).evidence.length > 10
    ).length;
    const maxEvidence = 11; // 7 generic + 4 KB-enhanced
    const rawConfidence = computeConfidence(evidenceCount, llmConf, dataSourceQuality);

    // --- Advisory Board confidence cap (Jordet+Knutson+Ankersen consensus) ---
    // Count dimensions with "Otillräcklig data" evidence
    const dimEntries: Record<string, { score: number; evidence: string }> = {
      decision_tempo: dt, risk_appetite: ra, ambition_level: al,
      team_orientation: to, tactical_understanding: tu, structure_need: sn,
      career_motivation: cm, ego, resilience, coachability, x_factor: xFactor,
    };
    const insufficientCount = countInsufficientDimensions(dimEntries);

    // Extract match count from profile_data if available
    const profileData = player.profile_data as Record<string, unknown> | null;
    const matchCount = profileData
      ? (typeof (profileData as Record<string, unknown>).total_matches === 'number'
        ? (profileData as Record<string, unknown>).total_matches as number
        : typeof (profileData as Record<string, unknown>).matches === 'number'
          ? (profileData as Record<string, unknown>).matches as number
          : undefined)
      : undefined;

    const confidenceCap = capConfidenceByDataAvailability(
      rawConfidence, insufficientCount, 11, dataSourceQuality, matchCount
    );
    const confidence_score = confidenceCap.confidence;
    const confidence_reasoning = confidenceCap.cap_applied
      ? `Capped: ${confidenceCap.cap_reason} (raw: ${rawConfidence}, insufficent: ${insufficientCount}/11)`
      : String(parsed.confidence_reasoning || `Evidence ratio: ${evidenceCount}/${maxEvidence}, LLM: ${llmConf}, Source: ${dataSourceQuality}`);

    const duration_ms = Date.now() - startTime;

    // Stress archetype — Jordet Advisory: EJ BEDÖMBAR utan beteendedata
    const stressEval = evaluateStressArchetype(
      String(parsed.stress_archetype || composite_archetype).slice(0, 200),
      insufficientCount,
      11,
      resilience.evidence,
      dt.evidence,
    );
    const stressArchetype = stressEval.stress_archetype;

    const profile = {
      decision_tempo: { name: 'Beslutstempo', ...dt },
      risk_appetite: { name: 'Riskapetit', ...ra },
      ambition_level: { name: 'Ambitionsnivå', ...al },
      team_orientation: { name: 'Lagorientering', ...to },
      tactical_understanding: { name: 'Taktisk förståelse', ...tu },
      structure_need: { name: 'Strukturbehov', ...sn },
      career_motivation: { name: 'Karriärmotivation', ...cm },
      ego: { name: 'Ego', ...ego },
      resilience: { name: 'Resiliens', ...resilience },
      coachability: { name: 'Träningsbarhet', ...coachability },
      x_factor: { name: 'X-faktor', ...xFactor },
      contradiction_score: { name: 'Motsägelsefullhet', score: contradictionScore, evidence: contradictionEvidence },
      stress_archetype: stressArchetype,
      coaching_approach,
      integration_risks,
      confidence_score,
      composite_archetype,
      composite_archetype_reasoning: String(parsed.composite_archetype_reasoning || '').slice(0, 1000),
      confidence_reasoning,
      data_source_quality: dataSourceQuality,
    };

    const clampEvents = ct.getEvents();

    // Overall score: weighted average of all 11 scored dims (7 generic 70% + 4 KB 30%)
    const avg7 = (dt.score + ra.score + al.score + to.score + tu.score + sn.score + cm.score) / 7;
    const kbScores = [ego.score, resilience.score, coachability.score, xFactor.score];
    const avgKb = kbScores.reduce((a, b) => a + b, 0) / kbScores.length;
    const overall_score = ct.clamp(Math.round((avg7 * 0.7 + avgKb * 0.3) * 10) / 10, 1, 10, 'overall_score');

    const recommendation = resolveRecommendation(composite_archetype, dimScores, contradictionScore, confidence_score);

    // Quality validation — deterministic checks on analysis output
    const generic7Scores: Record<string, number> = {
      decision_tempo: dt.score, risk_appetite: ra.score, ambition_level: al.score,
      team_orientation: to.score, tactical_understanding: tu.score,
      structure_need: sn.score, career_motivation: cm.score,
    };
    const qualityReport: QualityReport = validateAnalysis({
      overall_score,
      confidence: confidence_score,
      recommendation,
      dimension_scores: generic7Scores,
      personality_scores: dimScores,
      evidence_count: evidenceCount,
      clamp_events: clampEvents,
      insufficient_dimension_count: insufficientCount,
      total_dimension_count: 11,
    });
    if (qualityReport.gate === 'HALT') {
      console.warn(`[scout-personality] QUALITY HALT: score=${qualityReport.score}, checks=${JSON.stringify(qualityReport.checks.filter(c => c.status === 'HALT'))}`);
    }

    const result = {
      success: true,
      player_id,
      profile,
      duration_ms,
      cache_hit: false,
      quality_pipeline: qualityReport,
      ...(clampEvents.length > 0 ? { clamp_events: clampEvents } : {}),
      // Advisory Board transparency (v24)
      advisory_caps: {
        confidence_cap_applied: confidenceCap.cap_applied,
        confidence_raw: rawConfidence,
        confidence_capped: confidence_score,
        cap_reason: confidenceCap.cap_reason,
        insufficient_dimensions: insufficientCount,
        total_dimensions: 11,
        stress_assessable: stressEval.assessable,
        match_count: matchCount ?? null,
      },
    };

    await supabase.from('scout_analyses').insert({
      player_id,
      analysis_type: 'personality',
      overall_score,
      confidence: confidence_score,
      recommendation,
      summary: `Arketyp: ${composite_archetype} | ${recommendation} | Q:${qualityReport.score}/${qualityReport.gate}`,
      analysis_data: result,
    });

    return new Response(
      JSON.stringify({ ...result, _v: VERSION }),
      { headers: { ..._corsHeaders, 'Content-Type': 'application/json', ...rlHeaders } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return respond({ success: false, error: msg }, 500, rl ? getRateLimitHeaders(rl) : {});
  }
});
