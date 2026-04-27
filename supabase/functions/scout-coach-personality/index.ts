// scout-coach-personality — Coach BPA v1 — 12 dimensions + 7 archetypes
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "v1-12dim-coach-bpa";

import { createRateLimiter, getRateLimitHeaders, type RateLimitResult } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { clamp, createClampTracker } from '../_shared/personality-logic.ts';
import { COACH_ARCHETYPES, resolveCoachArchetype, resolveCoachRecommendation, computeCoachConfidence } from '../_shared/coach-personality-logic.ts';
import { validateAnalysis, type QualityReport } from '../_shared/quality-validation.ts';
import { callAnthropic, MODELS } from '../_shared/anthropic-client.ts';
import { sanitizePromptInput } from '../_shared/sanitize.ts';

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

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
    });

    const body = await req.json();
    const coach_id: string = (body.coach_id ?? '').slice(0, 100);

    if (!coach_id) {
      return respond({ success: false, error: 'coach_id required' }, 400);
    }

    // Rate limit
    rl = await rateLimiter.check(`scout-coach-personality:${coach_id}`, supabase);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded.', retry_after_seconds: retryAfterSec, _v: VERSION }),
        { status: 429, headers: { ..._corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec), ...getRateLimitHeaders(rl) } }
      );
    }
    const rlHeaders = getRateLimitHeaders(rl);

    // Check cache (48h)
    const { data: cached } = await supabase
      .from('scout_analyses')
      .select('id, analysis_data, created_at')
      .eq('coach_id', coach_id)
      .eq('entity_type', 'coach')
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

    // Load coach
    const { data: coach, error: coachErr } = await supabase
      .from('scout_coaches')
      .select('*')
      .eq('id', coach_id)
      .maybeSingle();

    if (coachErr || !coach) {
      return respond({ success: false, error: 'Coach not found' }, 404);
    }

    // Load KB
    const { data: kbRows } = await supabase
      .from('knowledge_bank')
      .select('key, title, content')
      .eq('cluster', 'vault_ai_coach')
      .in('key', ['coach_behavioral_signals', 'coach_archetypes']);

    const kbContext = (kbRows ?? []).map((r: Record<string, unknown>) => {
      const c = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
      return `### ${r.title}\n${c}`;
    }).join('\n\n');

    // Build Claude prompt
    const titlesStr = Array.isArray(coach.titles) && coach.titles.length > 0 ? JSON.stringify(coach.titles) : 'None';
    const careerStr = Array.isArray(coach.career_history) && coach.career_history.length > 0 ? JSON.stringify(coach.career_history) : 'None';
    const profileStr = coach.profile_data ? JSON.stringify(coach.profile_data) : 'None';

    const systemPrompt = `You are Vault AI Scout — Coach Personality Analyst. You produce rigorous behavioral profiles of football coaches.

## 12 Coach-BPA Dimensions
1. decision_tempo (1-10): How quickly the coach makes tactical/organizational decisions
2. risk_appetite (1-10): Willingness to take tactical risks
3. structure_need (1-10): Need for order, routines, and frameworks
4. team_orientation (1-10): Collective vs individual star focus
5. tactical_innovation (1-10): Willingness to experiment tactically
6. ambition_level (1-10): Career ambition
7. career_motivation (1-10): Internal drive (1=salary/security, 10=passion/mission)
8. ego (1-10): Self-confidence and need for recognition
9. resilience (1-10): Mental toughness under adversity
10. learning_orientation (1-10): Willingness to evolve as a coach
11. x_factor (1-10): Charisma and presence
12. contradiction_score (0-1): Internal contradictions in profile (0=consistent, 1=full of gaps)

## 7 Coach Archetypes
${COACH_ARCHETYPES.join(', ')}

${kbContext}

## CRITICAL: Anti-Hallucination Rules (NEVER VIOLATE)
- You may ONLY use information explicitly provided in the coach data above (Name, Nationality, Club, Titles, Career History, Profile Data).
- NEVER use your general training knowledge about specific coaches, clubs, match results, titles, or career histories.
- If Titles says "None" — the coach has ZERO verified titles. Do NOT invent any.
- If Career History says "None" — there is NO verified career data. Do NOT fabricate career details.
- Every "evidence" field MUST reference ONLY the data provided above. NEVER cite achievements or events not in the input.
- If you cannot find specific evidence in the input data for a dimension, set score to 5 and evidence to "Insufficient verified data — default score applied".
- When data is sparse, set confidence_score LOW (0.2-0.4) and data_source_quality to "PUBLIC_ONLY".
- Do NOT generate plausible-sounding narratives from your training knowledge. If in doubt, write "Insufficient data".

## Rules
- Score each dimension with specific evidence from the coach data PROVIDED ABOVE ONLY.
- data_source_quality: PUBLIC_ONLY (media/press only), MIXED (some insider), VERIFIED (official data). Default to PUBLIC_ONLY if uncertain.
- stress_archetype: How the coach handles extreme pressure situations. Write "Unknown — insufficient data" if no evidence.
- coaching_approach: 3-5 recommendations. Base ONLY on verified data, not assumptions.
- integration_risks: 2-4 risks. Base ONLY on verified data.

Return ONLY valid JSON.`;

    const spi = sanitizePromptInput;
    const userPrompt = `Analyze the personality profile of this football coach:

Name: ${spi(coach.name)}
Nationality: ${spi(coach.nationality) || 'Unknown'}
Current Club: ${spi(coach.current_club) || 'Unknown'}
League: ${spi(coach.current_league) || 'Unknown'}
Coaching Style: ${spi(coach.coaching_style) || 'Unknown'}
Formation: ${spi(coach.formation_preference) || 'Unknown'}
Titles: ${spi(titlesStr)}
Career History: ${spi(careerStr)}
Profile Data: ${spi(profileStr)}

Return JSON with this structure:
{
  "decision_tempo": {"score": N, "evidence": "..."},
  "risk_appetite": {"score": N, "evidence": "..."},
  "structure_need": {"score": N, "evidence": "..."},
  "team_orientation": {"score": N, "evidence": "..."},
  "tactical_innovation": {"score": N, "evidence": "..."},
  "ambition_level": {"score": N, "evidence": "..."},
  "career_motivation": {"score": N, "evidence": "..."},
  "ego": {"score": N, "evidence": "..."},
  "resilience": {"score": N, "evidence": "..."},
  "learning_orientation": {"score": N, "evidence": "..."},
  "x_factor": {"score": N, "evidence": "..."},
  "contradiction_score": {"score": N, "evidence": "..."},
  "stress_archetype": "...",
  "coaching_approach": ["..."],
  "integration_risks": ["..."],
  "confidence_score": N,
  "data_source_quality": "PUBLIC_ONLY|MIXED|VERIFIED"
}`;

    // Call Claude — VCE09 F7: try/catch preserves respond() error handling
    let rawText: string;
    try {
      const coachResult = await callAnthropic({
        model: MODELS.sonnet,
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      rawText = coachResult.text;
    } catch (coachErr) {
      const errMsg = coachErr instanceof Error ? coachErr.message : String(coachErr);
      return respond({ success: false, error: `Claude API error: ${errMsg}` }, 502);
    }

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return respond({ success: false, error: 'Failed to parse Claude response' }, 502);

    const parsed = JSON.parse(jsonMatch[0]);
    const ct = createClampTracker();

    // Extract and clamp dimensions
    const dims = ['decision_tempo', 'risk_appetite', 'structure_need', 'team_orientation',
      'tactical_innovation', 'ambition_level', 'career_motivation', 'ego', 'resilience',
      'learning_orientation', 'x_factor'];

    const dimScores: Record<string, number> = {};
    const dimEntries: Record<string, { score: number; evidence: string }> = {};

    for (const d of dims) {
      const raw = parsed[d];
      const score = ct.clamp(Number(raw?.score ?? 5), 1, 10, d);
      const evidence = String(raw?.evidence ?? 'No evidence provided');
      dimScores[d] = score;
      dimEntries[d] = { score, evidence };
    }

    // Contradiction score (0-1)
    const csRaw = parsed.contradiction_score;
    const cs = ct.clamp(Number(csRaw?.score ?? 0.3), 0, 1, 'contradiction_score');
    dimScores.contradiction_score = cs;
    dimEntries.contradiction_score = { score: cs, evidence: String(csRaw?.evidence ?? 'No evidence') };

    // Resolve archetype deterministically
    const archetype = resolveCoachArchetype(dimScores);

    // Compute confidence
    const llmConfidence = clamp(Number(parsed.confidence_score ?? 0.5), 0, 1);
    const dataSourceQuality = ['PUBLIC_ONLY', 'MIXED', 'VERIFIED'].includes(parsed.data_source_quality) ? parsed.data_source_quality : 'PUBLIC_ONLY';
    const evidenceCount = dims.filter(d => dimEntries[d].evidence !== 'No evidence provided').length;
    const confidence = computeCoachConfidence(evidenceCount, llmConfidence, dataSourceQuality);

    // Resolve recommendation
    const recommendation = resolveCoachRecommendation(archetype, dimScores, cs, confidence);

    // Quality validation — deterministic checks on analysis output
    const overallScore = Object.values(dimScores).filter((_, i) => i < 11).reduce((a, b) => a + b, 0) / 11;
    const qualityReport: QualityReport = validateAnalysis({
      overall_score: overallScore,
      confidence,
      recommendation,
      personality_scores: dimScores,
      evidence_count: evidenceCount,
      clamp_events: ct.getEvents(),
    });
    if (qualityReport.gate === 'HALT') {
      console.warn(`[scout-coach-personality] QUALITY HALT: score=${qualityReport.score}, checks=${JSON.stringify(qualityReport.checks.filter(c => c.status === 'HALT'))}`);
    }

    // Build result
    const result = {
      success: true,
      coach_id,
      profile: {
        ...dimEntries,
        stress_archetype: String(parsed.stress_archetype ?? 'Unknown'),
        coaching_approach: Array.isArray(parsed.coaching_approach) ? parsed.coaching_approach.slice(0, 7).map(String) : [],
        integration_risks: Array.isArray(parsed.integration_risks) ? parsed.integration_risks.slice(0, 6).map(String) : [],
        confidence_score: confidence,
        composite_archetype: archetype,
        confidence_reasoning: `Evidence: ${evidenceCount}/12 dims, LLM: ${llmConfidence}, Source: ${dataSourceQuality}`,
        data_source_quality: dataSourceQuality,
      },
      recommendation,
      quality_pipeline: qualityReport,
      clamp_events: ct.getEvents(),
      duration_ms: 0, // will be set below
    };

    // Save to scout_analyses
    const { error: insertErr } = await supabase.from('scout_analyses').insert({
      coach_id,
      player_id: null,
      entity_type: 'coach',
      analysis_type: 'personality',
      status: 'completed',
      overall_score: overallScore,
      confidence,
      recommendation,
      summary: `${coach.name}: ${archetype}. Confidence ${(confidence * 100).toFixed(0)}%. Q:${qualityReport.score}/${qualityReport.gate}`,
      strengths: dims.filter(d => dimScores[d] >= 7).slice(0, 3),
      weaknesses: dims.filter(d => dimScores[d] <= 4).slice(0, 3),
      analysis_data: result,
      completed_at: new Date().toISOString(),
      agents_used: ['COACH05', 'claude-sonnet-4-6'],
      kb_files_used: ['coach_behavioral_signals', 'coach_archetypes'],
    });

    if (insertErr) console.error('[scout-coach-personality] Save error:', insertErr);

    return new Response(
      JSON.stringify({ ...result, _v: VERSION }),
      { headers: { ..._corsHeaders, 'Content-Type': 'application/json', ...rlHeaders } }
    );

  } catch (err) {
    console.error('[scout-coach-personality] Unhandled error:', err);
    return respond({ success: false, error: String(err) }, 500);
  }
});
