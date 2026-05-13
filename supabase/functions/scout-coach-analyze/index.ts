import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// scout-coach-analyze — Vault AI Scout Coach Analysis Engine
// ============================================================================
// POST { coach_id, analysis_type } (user derived from JWT)
// Runs Claude analysis on a coach using 16 CDIM dimensions.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRateLimiter, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { validateAnalysis, checkInputCompleteness, buildInputCompletenessWarning, checkFabricationPatterns, type QualityReport, type InputCompletenessResult } from "../_shared/quality-validation.ts";
import { callAnthropic, MODELS } from "../_shared/anthropic-client.ts";
import { sanitizePromptInput } from "../_shared/sanitize.ts";
import { buildSeasonContext } from "../_shared/constants.ts";

const rateLimiter = createRateLimiter(10);

const ALLOWED_ANALYSIS_TYPES = ["full_scout", "quick_scan"] as const;
type AnalysisType = (typeof ALLOWED_ANALYSIS_TYPES)[number];

interface DimensionScore {
  dimension_id: string;
  dimension_name: string;
  score: number;
  evidence: string;
}

interface AnalysisResult {
  overall_score: number;
  confidence: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  risk_factors: string[];
  recommendation: string;
  dimension_scores: DimensionScore[];
}

interface CoachData {
  id: string;
  name: string;
  nationality: string;
  date_of_birth?: string;
  current_club: string;
  current_league?: string;
  tier?: string;
  career_phase?: string;
  coaching_style?: string;
  formation_preference?: string;
  titles?: unknown[];
  career_history?: unknown[];
  profile_data?: Record<string, unknown>;
}

function json(data: unknown, status = 200, origin: string | null = null, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json", ...extra },
  });
}

function computeAge(dob: unknown): number | null {
  if (!dob || typeof dob !== "string") return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return { url, serviceKey };
}

async function supabaseRpc(functionName: string, params: Record<string, unknown>): Promise<unknown> {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RPC ${functionName} failed (${response.status}): ${errorText}`);
  }
  const text = await response.text();
  if (!text || text.trim() === "") return null;
  return JSON.parse(text);
}

async function supabaseQuery(table: string, query: string): Promise<unknown[]> {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Query ${table} failed (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<unknown[]>;
}

// ---------------------------------------------------------------------------
// Knowledge Bank loading
// ---------------------------------------------------------------------------

const COACH_KB_KEYS = [
  "coach_tactical_dimensions",
  "coach_development_dimensions",
  "coach_mental_leadership_dimensions",
  "coach_results_context_dimensions",
  "coach_behavioral_signals",
  "coach_archetypes",
];

async function loadKnowledgeBank(): Promise<string> {
  try {
    const rows = await supabaseQuery(
      "knowledge_bank",
      `cluster=eq.vault_ai_coach&key=in.(${COACH_KB_KEYS.map(k => `"${k}"`).join(",")})&select=key,title,content`
    );
    if (!Array.isArray(rows) || rows.length === 0) return "";
    return (rows as Record<string, unknown>[])
      .map(r => {
        const content = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
        return `### ${r.title}\n${content}`;
      })
      .join("\n\n---\n\n");
  } catch (err) {
    console.warn("[scout-coach-analyze] Failed to load KB:", err);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MINUTES: Record<AnalysisType, number> = {
  full_scout: 1440,
  quick_scan: 720,
};

async function checkCachedAnalysis(coachId: string, analysisType: AnalysisType): Promise<{ analysis_id: string; result: AnalysisResult; duration_ms: number } | null> {
  try {
    const ttl = CACHE_TTL_MINUTES[analysisType];
    const cutoff = new Date(Date.now() - ttl * 60 * 1000).toISOString();
    const rows = await supabaseQuery(
      "scout_analyses",
      `coach_id=eq.${encodeURIComponent(coachId)}&entity_type=eq.coach&analysis_type=eq.${analysisType}&status=eq.completed&completed_at=gte.${cutoff}&order=completed_at.desc&limit=1&select=id,analysis_data,duration_ms`
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;
    const analysisData = row.analysis_data as AnalysisResult | null;
    if (!analysisData || typeof analysisData.overall_score !== "number") return null;
    return { analysis_id: row.id as string, result: analysisData, duration_ms: (row.duration_ms as number) ?? 0 };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Vault AI Scout — Coach Analyst, a world-class football coaching analyst built by Vault AI.
You provide rigorous, evidence-based coach assessments using 16 CDIM dimensions.

## 16 Coach Dimensions (CDIM)

### Tactical (22% weight)
- CDIM-01: Tactical Intelligence & System Design (0-10)
- CDIM-02: Match Coaching & In-Game Adaptation (0-10)
- CDIM-03: Playing Model Implementation (0-10)

### Development (27% weight)
- CDIM-04: Player Development Track Record (0-10)
- CDIM-05: Youth Integration — Academy to First Team (0-10)
- CDIM-06: Tactical Communication & Pedagogy (0-10)
- CDIM-07: Modern Football Adaptation (0-10)

### Mental/Leadership (23% weight)
- CDIM-08: Man-Management & Group Dynamics (0-10)
- CDIM-09: Mental Resilience & Pressure Handling (0-10)
- CDIM-10: Leadership Style & Authority (0-10)
- CDIM-11: Work Intensity & Preparation (0-10)

### Results (18% weight)
- CDIM-12: Results History & Merits (0-10)
- CDIM-13: European & International Experience (0-10)
- CDIM-14: Resource Utilization — Overperformance vs Budget (0-10)

### Context (10% weight)
- CDIM-15: Club Culture Fit (0-10)
- CDIM-16: Career Trajectory & Timing (0-10)

## Weighted Overall Score
overall_score = Tactical*0.22 + Development*0.27 + Mental*0.23 + Results*0.18 + Context*0.10

## CRITICAL: Anti-Hallucination Rules (NEVER VIOLATE)
- You may ONLY use information explicitly provided in the Coach Profile and Knowledge Bank sections of the user prompt.
- NEVER use your general training knowledge about specific coaches, clubs, match results, titles, or career histories.
- If Titles says "No titles recorded" or is empty — the coach has ZERO verified titles. Do NOT invent any.
- If Career History says "No career history" or is empty — there is NO verified career data. Do NOT fabricate.
- Every "evidence" field MUST reference ONLY data from the Coach Profile above. NEVER cite achievements, statistics, or events not present in the input.
- If data is insufficient for a dimension, you MUST score it null and write "Insufficient data — no verified information available".
- When data is sparse, score LOWER and set confidence LOW. Do NOT generate plausible-sounding but unverified narratives.
- If you find yourself writing evidence that is not directly traceable to the input data, STOP and write "Insufficient data" instead.

## Output Rules
- Be direct and specific. No filler language.
- Every claim must reference data from the coach profile provided above — NOTHING ELSE.
- If data is insufficient for a dimension, score it null and state "Insufficient data".
- confidence = 0.0-1.0 based on data completeness and quality. Sparse profile = LOW confidence.
- recommendation must be one of: "SIGN", "MONITOR", "PASS", "INSUFFICIENT_DATA".
- If fewer than 8 dimensions have sufficient data, recommendation MUST be "INSUFFICIENT_DATA".

You MUST respond with valid JSON only. No markdown, no explanation outside the JSON.`;

const ANALYSIS_TYPE_INSTRUCTIONS: Record<AnalysisType, string> = {
  full_scout: `Perform a FULL SCOUT analysis covering all 16 CDIM dimensions. Be thorough.
Provide detailed evidence for each dimension score. Assess DIF cultural fit specifically.`,
  quick_scan: `Perform a QUICK SCAN — focus on the top 6 most differentiating dimensions.
Keep summary under 200 words. Skip dimensions where data is clearly insufficient.`,
};

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

// VCE09 F5: callAnthropic adds default 55s timeout (previously no timeout)
async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const result = await callAnthropic({
    model: MODELS.sonnet,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return result.text;
}

// ---------------------------------------------------------------------------
// Parse & validate result
// ---------------------------------------------------------------------------

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function parseAnalysisResult(raw: string): AnalysisResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in Claude response");

  const parsed = JSON.parse(jsonMatch[0]);

  const dimensionScores: DimensionScore[] = (parsed.dimension_scores ?? []).map((d: Record<string, unknown>) => ({
    dimension_id: String(d.dimension_id ?? ""),
    dimension_name: String(d.dimension_name ?? ""),
    score: d.score != null ? clamp(Number(d.score), 0, 10) : null,
    evidence: String(d.evidence ?? "Insufficient data"),
  }));

  return {
    overall_score: clamp(Number(parsed.overall_score ?? 0), 0, 10),
    confidence: clamp(Number(parsed.confidence ?? 0), 0, 1),
    summary: String(parsed.summary ?? ""),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String) : [],
    risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors.map(String) : [],
    recommendation: ["SIGN", "MONITOR", "PASS", "INSUFFICIENT_DATA"].includes(parsed.recommendation) ? parsed.recommendation : "MONITOR",
    dimension_scores: dimensionScores,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const reqOrigin = req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(reqOrigin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // JWT authentication (shared helper)
  const authResult = await authenticateRequest(req);
  if (!authResult.ok) {
    return json({ error: authResult.error }, authResult.status, reqOrigin);
  }
  const userId = authResult.userId;
  const isServiceRole = authResult.isServiceRole;

  // Rate limit — persistent via DB
  const { url: _rlUrl, serviceKey: _rlKey } = getSupabaseConfig();
  const _rlSb = createClient(_rlUrl, _rlKey);
  const rl = await rateLimiter.check(`scout-coach-analyze:${userId}`, _rlSb);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 10 requests per 15 minutes.", retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec), ...getRateLimitHeaders(rl) } }
    );
  }
  const rlHeaders = getRateLimitHeaders(rl);

  try {
    const body = await req.json();
    const coachId = body.coach_id;
    const analysisType = body.analysis_type ?? "full_scout";

    if (!coachId || typeof coachId !== "string") {
      return json({ error: "coach_id required" }, 400, reqOrigin, rlHeaders);
    }
    if (!ALLOWED_ANALYSIS_TYPES.includes(analysisType as AnalysisType)) {
      return json({ error: `Invalid analysis_type. Allowed: ${ALLOWED_ANALYSIS_TYPES.join(", ")}` }, 400, reqOrigin, rlHeaders);
    }

    const startTime = Date.now();

    // Check cache
    const cached = await checkCachedAnalysis(coachId, analysisType as AnalysisType);
    if (cached) {
      return json({
        success: true,
        analysis_id: cached.analysis_id,
        duration_ms: cached.duration_ms,
        cache_hit: true,
        result: cached.result,
      }, 200, reqOrigin, rlHeaders);
    }

    // Load coach data
    const coachRows = await supabaseQuery("scout_coaches", `id=eq.${encodeURIComponent(coachId)}&limit=1`);
    if (!Array.isArray(coachRows) || coachRows.length === 0) {
      return json({ error: "Coach not found" }, 404, reqOrigin, rlHeaders);
    }
    const coach = coachRows[0] as CoachData;

    // Start analysis record
    const startResult = await supabaseRpc("start_scout_coach_analysis", {
      p_coach_id: coachId,
      p_analysis_type: analysisType,
      p_user_id: isServiceRole ? null : userId,
    }) as Array<{ analysis_id: string }>;
    const analysisId = startResult[0]?.analysis_id;
    if (!analysisId) throw new Error("Failed to start analysis");

    // Load Knowledge Bank
    const kbContext = await loadKnowledgeBank();

    // Sprint 182: Input completeness + season context for LLM prompt injection
    const inputCompleteness: InputCompletenessResult = checkInputCompleteness({
      profile_data: coach.profile_data ?? null,
      source_ids: [],
    });
    const _inputCompletenessWarning = buildInputCompletenessWarning(inputCompleteness);
    const _seasonContext = buildSeasonContext(coach.profile_data ?? null);

    // Build user prompt
    const age = computeAge(coach.date_of_birth);
    const profileStr = coach.profile_data ? JSON.stringify(coach.profile_data) : "No additional profile data";
    const titlesStr = Array.isArray(coach.titles) && coach.titles.length > 0 ? JSON.stringify(coach.titles) : "No titles recorded";
    const careerStr = Array.isArray(coach.career_history) && coach.career_history.length > 0 ? JSON.stringify(coach.career_history) : "No career history";

    const spi = sanitizePromptInput;
    const hasTitles = Array.isArray(coach.titles) && coach.titles.length > 0;
    const hasCareer = Array.isArray(coach.career_history) && coach.career_history.length > 0;
    const hasProfile = !!coach.profile_data && Object.keys(coach.profile_data).length > 0;

    const userPrompt = `Analyze the following football coach. Each data source is tagged with [DB] or [LLM].
You may ONLY cite facts from [DB]-tagged sections. Everything you infer yourself = [LLM].
If a section says "INGEN DATA TILLGÄNGLIG", you MUST NOT fabricate information for that area.

## Coach Profile [DB]
- Name: ${spi(coach.name)}
- Age: ${age ?? "Unknown"}
- Nationality: ${spi(coach.nationality) || "Unknown"}
- Current Club: ${spi(coach.current_club) || "Unknown"}
- Current League: ${spi(coach.current_league) || "Unknown"}
- Tier: ${spi(coach.tier) || "Unknown"}
- Career Phase: ${spi(coach.career_phase) || "Unknown"}
- Coaching Style: ${spi(coach.coaching_style) || "Unknown"}
- Preferred Formation: ${spi(coach.formation_preference) || "Unknown"}

## Titles [DB]
${hasTitles ? spi(titlesStr) : "INGEN DATA TILLGÄNGLIG — citera ALDRIG titlar eller meriter."}

## Career History [DB]
${hasCareer ? spi(careerStr) : "INGEN DATA TILLGÄNGLIG — citera ALDRIG karriärhistorik, klubbar eller resultat."}

## Additional Profile Data [DB]
${hasProfile ? spi(profileStr) : "INGEN DATA TILLGÄNGLIG."}

${kbContext ? `## Knowledge Bank Context\n${kbContext}\n` : ""}
${_inputCompletenessWarning}${_seasonContext}

## Analysis Instructions
${ANALYSIS_TYPE_INSTRUCTIONS[analysisType as AnalysisType]}

Respond with a JSON object containing:
{
  "overall_score": number (0-10, weighted: Tactical 22% + Development 27% + Mental 23% + Results 18% + Context 10%),
  "confidence": number (0-1),
  "summary": "2-3 sentence assessment",
  "strengths": ["top 3 strengths"],
  "weaknesses": ["top 3 weaknesses"],
  "risk_factors": ["key risk factors"],
  "recommendation": "SIGN" | "MONITOR" | "PASS" | "INSUFFICIENT_DATA",
  "dimension_scores": [
    {"dimension_id": "CDIM-01", "dimension_name": "Taktisk intelligens & systemdesign", "score": number, "evidence": "..."},
    ... (all 16 CDIM dimensions)
  ]
}`;

    // Build system prompt with KB
    const fullSystemPrompt = kbContext
      ? `${SYSTEM_PROMPT}\n\n## Loaded Knowledge Bank\n${kbContext}`
      : SYSTEM_PROMPT;

    // Call Claude
    const rawResponse = await callClaude(fullSystemPrompt, userPrompt);
    const result = parseAnalysisResult(rawResponse);

    const durationMs = Date.now() - startTime;

    // Quality validation — deterministic checks on analysis output
    const dimScoresMap: Record<string, number> = {};
    for (const d of result.dimension_scores) {
      dimScoresMap[d.dimension_id] = d.score;
    }
    const qualityReport: QualityReport = validateAnalysis({
      overall_score: result.overall_score,
      confidence: result.confidence,
      recommendation: result.recommendation,
      dimension_scores: dimScoresMap,
      evidence_count: result.dimension_scores.filter(d => d.evidence && d.evidence.length > 15 && !d.evidence.includes('Insufficient data')).length,
    });
    if (qualityReport.gate === 'HALT') {
      console.warn(`[scout-coach-analyze] QUALITY HALT: score=${qualityReport.score}, checks=${JSON.stringify(qualityReport.checks.filter(c => c.status === 'HALT'))}`);
    }

    // --- P0: Fabrication detection (shared patterns) ---
    const fabricationCheck = checkFabricationPatterns(rawResponse, hasTitles || hasCareer);
    if (fabricationCheck.status === 'HALT' || fabricationCheck.status === 'WARN') {
      console.warn(`[scout-coach-analyze] FABRICATION ${fabricationCheck.status}: ${fabricationCheck.detail}`);
      qualityReport.checks.push(fabricationCheck);
      if (fabricationCheck.status === 'HALT') qualityReport.gate = 'HALT';
    }

    // --- P0: Confidence cap for sparse coach data ---
    const dataFieldCount = [hasTitles, hasCareer, hasProfile, !!coach.coaching_style, !!coach.formation_preference].filter(Boolean).length;
    if (dataFieldCount <= 1 && result.confidence > 0.45) {
      result.confidence = 0.45;
    } else if (dataFieldCount <= 2 && result.confidence > 0.60) {
      result.confidence = 0.60;
    }

    // Save via RPC
    let saveError: string | null = null;
    try {
      await supabaseRpc("complete_scout_coach_analysis", {
        p_analysis_id: analysisId,
        p_overall_score: result.overall_score,
        p_confidence: result.confidence,
        p_summary: result.summary,
        p_strengths: result.strengths,
        p_weaknesses: result.weaknesses,
        p_risk_factors: result.risk_factors,
        p_recommendation: result.recommendation,
        p_analysis_data: { ...result, _v: "v1-cdim16", analysis_type: analysisType, quality_pipeline: qualityReport },
        p_agents_used: ["COACH00", "claude-sonnet-4-6"],
        p_kb_files_used: COACH_KB_KEYS,
        p_scores: result.dimension_scores.map(d => ({
          dimension_id: d.dimension_id,
          dimension_name: d.dimension_name,
          score: d.score,
          confidence: result.confidence,
          evidence: d.evidence,
        })),
      });
    } catch (saveErr) {
      console.error("[scout-coach-analyze] Failed to save analysis:", saveErr);
      saveError = String(saveErr);
    }

    return json({
      success: true,
      analysis_id: analysisId,
      duration_ms: durationMs,
      cache_hit: false,
      quality_pipeline: qualityReport,
      ...(saveError ? { save_error: saveError } : {}),
      result,
    }, 200, reqOrigin, rlHeaders);

  } catch (err) {
    console.error("scout-coach-analyze unhandled error:", err);
    return json({ error: "Internal error", detail: String(err) }, 500, reqOrigin, rlHeaders);
  }
});
