// scout-personality-analysis — BPA Football v21 — 2026-03-29 determinism-fix
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "v22-model-fix";

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
  const { decision_tempo: dt, risk_appetite: ra, ambition_level: al,
    team_orientation: to, tactical_understanding: tu, structure_need: sn,
    career_motivation: cm } = profile;

  // RELIABLE_SOLDIER: team-first, structure-driven, moderate ambition
  if (to >= 6 && sn >= 7 && al >= 4 && al <= 6) return 'RELIABLE_SOLDIER';
  // MENTALITY_MONSTER: high decision tempo + high ambition + high career motivation
  if (dt >= 8 && al >= 8 && cm >= 8) return 'MENTALITY_MONSTER';
  // TOXIC_HIGH_PERFORMER: high solo, low team
  if (ra >= 8 && to <= 3 && al >= 8) return 'TOXIC_HIGH_PERFORMER';
  // COMPLETE_PROFESSIONAL: balanced high across all
  if (dt >= 7 && al >= 7 && to >= 6 && tu >= 7 && sn >= 5) return 'COMPLETE_PROFESSIONAL';
  // HIGH_PERFORMING_SOLO: high ambition, moderate team
  if (al >= 8 && to <= 5 && dt >= 7) return 'HIGH_PERFORMING_SOLO';
  // SILENT_LEADER: high team, low structure need, moderate ambition
  if (to >= 7 && sn <= 4 && al >= 6) return 'SILENT_LEADER';
  // COACHABLE_RAW_TALENT: low decision tempo, high structure need
  if (dt <= 5 && sn >= 6 && al >= 5) return 'COACHABLE_RAW_TALENT';

  // Fallback: score-based
  const scores: Array<[string, number]> = [
    ['MENTALITY_MONSTER', (dt + al + cm) / 3],
    ['COMPLETE_PROFESSIONAL', (dt + al + to + tu + sn) / 5],
    ['HIGH_PERFORMING_SOLO', (al + dt + ra) / 3],
    ['SILENT_LEADER', (to + cm + tu) / 3],
    ['COACHABLE_RAW_TALENT', (sn + tu + cm) / 3],
    ['RELIABLE_SOLDIER', (to + sn + cm) / 3],
    ['TOXIC_HIGH_PERFORMER', (ra + al) / 2],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

function computeConfidence(
  evidenceCount: number,
  llmConfidence: number,
  dataSourceQuality: string
): number {
  const maxEvidence = 7;
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

    // JWT authentication — verify user before running expensive LLM analysis
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond({ success: false, error: 'Missing Authorization header' }, 401);
    }
    try {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(
        authHeader.replace('Bearer ', '')
      );
      if (authErr || !user) {
        return respond({ success: false, error: 'Unauthorized' }, 401);
      }
    } catch {
      return respond({ success: false, error: 'Authentication failed' }, 401);
    }

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
        JSON.stringify({ ...(cached.analysis_data as object), cache_hit: true, _v: VERSION }),
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
        serviceKeyLen: serviceKey.length,
        supabaseUrlLen: supabaseUrl.length,
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
Använd EXAKT dessa 7 dimensioner och returnera JSON.

Dimensioner (alla 1-10):
- decision_tempo: Hur snabbt fattar spelaren beslut under press
- risk_appetite: Benägenhet att ta risker på och av planen
- ambition_level: Drivkraft att nå toppen
- team_orientation: Lagspelarprofil vs solist
- tactical_understanding: Taktisk intelligens och flexibilitet
- structure_need: Behov av tydlig struktur och direktiv
- career_motivation: Yttre vs inre motivation

Arketyper (välj EN, closed taxonomy):
${ARCHETYPES.join(', ')}

Returformat — EXAKT detta JSON (inga andra fält):
{"dimensions":{"decision_tempo":{"score":N,"evidence":"..."},"risk_appetite":{"score":N,"evidence":"..."},"ambition_level":{"score":N,"evidence":"..."},"team_orientation":{"score":N,"evidence":"..."},"tactical_understanding":{"score":N,"evidence":"..."},"structure_need":{"score":N,"evidence":"..."},"career_motivation":{"score":N,"evidence":"..."}},"composite_archetype":"ARCHETYPE_NAME","composite_archetype_reasoning":"...","coaching_approach":["tip1","tip2","tip3"],"integration_risks":["risk1","risk2"],"CONFIDENCE_LABEL":0.75,"data_source_quality":"PUBLIC_ONLY","confidence_reasoning":"..."}

VIKTIGT: composite_archetype MÅSTE vara exakt ett av: ${ARCHETYPES.join(', ')}

${kbContext ? 'Knowledge Bank Context:\n' + kbContext : ''}`;

    const userPrompt = `Analysera: ${player.name} (${player.position_primary}, ${player.tier}, ${player.career_phase})
Klubb: ${player.current_club} | Liga: ${player.current_league}
Ålder: ${ageStr} | Nationalitet: ${player.nationality}
${player.profile_data ? 'Profildata: ' + (typeof player.profile_data === 'string' ? player.profile_data : JSON.stringify(player.profile_data)).slice(0, 2000) : ''}

Returnera JSON med exakt ovanstående struktur. Alla scores 1-10. CONFIDENCE_LABEL 0-1. coaching_approach max 7 items. integration_risks max 6 items.`;

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
        max_tokens: 2000,
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

    const dimScores = {
      decision_tempo: dt.score, risk_appetite: ra.score, ambition_level: al.score,
      team_orientation: to.score, tactical_understanding: tu.score,
      structure_need: sn.score, career_motivation: cm.score,
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
    const confidence_score = computeConfidence(evidenceCount, llmConf, dataSourceQuality);
    const confidence_reasoning = String(parsed.confidence_reasoning || `Evidence ratio: ${evidenceCount}/${7}, LLM: ${llmConf}, Source: ${dataSourceQuality}`);

    const duration_ms = Date.now() - startTime;

    const profile = {
      decision_tempo: { name: 'Beslutstempo', ...dt },
      risk_appetite: { name: 'Riskapetit', ...ra },
      ambition_level: { name: 'Ambitionsnivå', ...al },
      team_orientation: { name: 'Lagorientering', ...to },
      tactical_understanding: { name: 'Taktisk förståelse', ...tu },
      structure_need: { name: 'Strukturbehov', ...sn },
      career_motivation: { name: 'Karriärmotivation', ...cm },
      stress_archetype: composite_archetype,
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

    // FIX: use analysis_data column (not result_json)
    await supabase.from('scout_analyses').insert({
      player_id,
      analysis_type: 'personality',
      overall_score: confidence_score * 10,
      confidence: confidence_score,
      recommendation: 'MONITOR',
      summary: `Arketyp: ${composite_archetype}`,
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
