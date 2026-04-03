// scout-personality-analysis — BPA Football v21 — 2026-03-29 determinism-fix
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "v23-12dim-bpa";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory per isolate (Deno Deploy)
// Key: player_id (no JWT auth) | Window: 15 min | Max: 5 requests per player
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const rateLimitStore = new Map<string, number[]>();

function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitStore.get(key) ?? []).filter(ts => ts > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = timestamps[0] + RATE_LIMIT_WINDOW_MS - now;
    rateLimitStore.set(key, timestamps);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }
  timestamps.push(now);
  rateLimitStore.set(key, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 7 composite archetypes (closed taxonomy, v6)
const ARCHETYPES = [
  'MENTALITY_MONSTER',
  'HIGH_PERFORMING_SOLO',
  'COMPLETE_PROFESSIONAL',
  'SILENT_LEADER',
  'COACHABLE_RAW_TALENT',
  'TOXIC_HIGH_PERFORMER',
  'RELIABLE_SOLDIER',
];

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function resolveArchetype(profile: Record<string, number>): string {
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
    ['MENTALITY_MONSTER', (dt + al + cm + re) / 4],
    ['COMPLETE_PROFESSIONAL', (dt + al + to + tu + sn + xf + re) / 7],
    ['HIGH_PERFORMING_SOLO', (al + dt + ra + eg) / 4],
    ['SILENT_LEADER', (to + cm + tu + re) / 4],
    ['COACHABLE_RAW_TALENT', (sn + tu + cm + co) / 4],
    ['RELIABLE_SOLDIER', (to + sn + cm + co) / 4],
    ['TOXIC_HIGH_PERFORMER', (ra + al + eg) / 3 - co / 3],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

function resolveRecommendation(
  archetype: string,
  dimScores: Record<string, number>,
  contradictionScore: number,
  confidenceScore: number
): 'SIGN' | 'MONITOR' | 'PASS' {
  const generic7 = ['decision_tempo', 'risk_appetite', 'ambition_level',
    'team_orientation', 'tactical_understanding', 'structure_need', 'career_motivation'];
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

function computeConfidence(
  evidenceCount: number,
  llmConfidence: number,
  dataSourceQuality: string
): number {
  const maxEvidence = 11;
  const evidenceRatio = Math.min(evidenceCount / maxEvidence, 1.0);
  const baseline = dataSourceQuality === 'VERIFIED' ? 0.75 : dataSourceQuality === 'MIXED' ? 0.55 : 0.40;
  const deterministic = (0.60 * evidenceRatio) + (0.30 * llmConfidence) + (0.10 * baseline);
  return Math.round(clamp(deterministic, 0.10, 0.95) * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const respond = (body: unknown, status = 200) => new Response(
    JSON.stringify({ ...(typeof body === 'object' ? body as object : { data: body }), _v: VERSION }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

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
    const rl = checkRateLimit(player_id);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Max 5 personality analyses per 15 minutes per player.', retry_after_seconds: retryAfterSec, _v: VERSION }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) } }
      );
    }

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
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      }, 404);
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

    const systemPrompt = `Du är en världsledande fotbollspsykolog och beteendeanalytiker.
Din uppgift är att analysera en fotbollsspelares psykologiska profil baserat på tillgänglig information.
Använd EXAKT dessa 12 dimensioner och returnera JSON.

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

${kbContext ? 'Knowledge Bank Context:\n' + kbContext : ''}`;

    const userPrompt = `Analysera: ${player.name} (${player.position_primary}, ${player.tier}, ${player.career_phase})
Klubb: ${player.current_club} | Liga: ${player.current_league}
Ålder: ${ageStr} | Nationalitet: ${player.nationality}
${player.profile_data ? 'Profildata: ' + (typeof player.profile_data === 'string' ? player.profile_data : JSON.stringify(player.profile_data)).slice(0, 2000) : ''}

Returnera JSON med exakt ovanstående struktur. Alla dimensionsscores 1-10. contradiction_score 0-1. CONFIDENCE_LABEL 0-1. coaching_approach max 7 items. integration_risks max 6 items. stress_archetype max 100 tecken.`;

    const startTime = Date.now();
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

    const llmResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2500,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!llmResp.ok) {
      const errText = await llmResp.text();
      return respond({ success: false, error: 'LLM error: ' + errText.slice(0, 200) }, 500);
    }

    const llmData = await llmResp.json();
    const rawText: string = llmData.content?.[0]?.text ?? '{}';

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

    const getDim = (key: string): { score: number; evidence: string } => {
      const d = dims[key];
      if (d && typeof d.score === 'number') {
        return { score: clamp(Math.round(d.score), 1, 10), evidence: String(d.evidence || 'Baserat på tillgänglig data').slice(0, 500) };
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
      ? clamp(Math.round(csRaw.score * 100) / 100, 0, 1)
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
    const confidence_score = computeConfidence(evidenceCount, llmConf, dataSourceQuality);
    const confidence_reasoning = String(parsed.confidence_reasoning || `Evidence ratio: ${evidenceCount}/${maxEvidence}, LLM: ${llmConf}, Source: ${dataSourceQuality}`);

    const duration_ms = Date.now() - startTime;

    // Stress archetype from LLM or fallback to composite
    const stressArchetype = String(parsed.stress_archetype || composite_archetype).slice(0, 200);

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

    const result = {
      success: true,
      player_id,
      profile,
      duration_ms,
      cache_hit: false,
    };

    // Overall score: weighted average of all 11 scored dims (7 generic 70% + 4 KB 30%)
    const avg7 = (dt.score + ra.score + al.score + to.score + tu.score + sn.score + cm.score) / 7;
    const kbScores = [ego.score, resilience.score, coachability.score, xFactor.score];
    const avgKb = kbScores.reduce((a, b) => a + b, 0) / kbScores.length;
    const overall_score = Math.round((avg7 * 0.7 + avgKb * 0.3) * 10) / 10;

    const recommendation = resolveRecommendation(composite_archetype, dimScores, contradictionScore, confidence_score);

    await supabase.from('scout_analyses').insert({
      player_id,
      analysis_type: 'personality',
      overall_score,
      confidence: confidence_score,
      recommendation,
      summary: `Arketyp: ${composite_archetype} | ${recommendation}`,
      analysis_data: result,
    });

    return new Response(
      JSON.stringify({ ...result, _v: VERSION }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return respond({ success: false, error: msg }, 500);
  }
});
