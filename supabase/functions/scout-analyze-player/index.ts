import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// scout-analyze-player — Vault AI Scout Main Analysis Engine
// ============================================================================
// POST { player_id, analysis_type } (user derived from JWT)
// Runs Claude Sonnet 4.6 analysis on a player, saves structured results.
// ============================================================================

// ---------------------------------------------------------------------------
// Rate limiter — in-memory per isolate (Deno Deploy)
// Key: userId | Window: 15 min | Max: 10 requests
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitStore = new Map<string, number[]>();

function checkRateLimit(userId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitStore.get(userId) ?? []).filter(ts => ts > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = timestamps[0] + RATE_LIMIT_WINDOW_MS - now;
    rateLimitStore.set(userId, timestamps);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }
  timestamps.push(now);
  rateLimitStore.set(userId, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}

const ALLOWED_ORIGINS = [
  "https://vaultai.se",
  "https://www.vaultai.se",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5174",
  "https://vault-scout-app.vercel.app",
];

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const ALLOWED_ANALYSIS_TYPES = [
  "full_scout",
  "quick_scan",
  "match_review",
  "transfer_assessment",
] as const;

type AnalysisType = (typeof ALLOWED_ANALYSIS_TYPES)[number];

interface RequestBody {
  player_id: string;
  analysis_type: AnalysisType;
}

interface PlayerData {
  id: string;
  name: string;
  position_primary: string;
  position_secondary?: string[];
  nationality: string;
  date_of_birth?: string;
  current_club: string;
  current_league?: string;
  contract_expires?: string;
  market_value_eur?: number;
  archetype?: string;
  career_phase?: string;
  tier?: string;
  profile_data?: Record<string, unknown>;
  source_urls?: string[];
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

// ---------------------------------------------------------------------------
// System prompt — Vault AI Scout persona + dimension framework
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Vault AI Scout, a world-class football scouting analyst built by Vault AI.
You provide rigorous, evidence-based player assessments. Never speculate beyond the data provided.

## Analysis Framework — FOOTBALL_DIMENSIONS (DIM-01 through DIM-16)

Score each applicable dimension 0-10 with specific evidence from the player data.

### Tactical — 22% weight (DIM-01 to DIM-03)
- DIM-01 Positionell medvetenhet: Movement off the ball, spatial intelligence, defensive positioning
- DIM-02 Taktisk flexibilitet: Ability to play multiple roles/formations, tactical adaptability
- DIM-03 Pressing & återerövring: Press intensity, counter-press success, ball recovery rate

### Technical — 27% weight (DIM-04 to DIM-07)
- DIM-04 Bollkontroll & första touch: Receiving under pressure, touch quality in tight spaces
- DIM-05 Passningskvalitet: Short/medium/long distribution accuracy, progressive passing
- DIM-06 Skotteffektivitet: Goal scoring ability, xG performance, shot placement
- DIM-07 Dribbling & 1v1: Take-on success rate, ball carrying, 1v1 offensive/defensive ability

### Physical — 18% weight (DIM-08 to DIM-10)
- DIM-08 Sprint & acceleration: Top speed, acceleration over 5/10/20m, sprint frequency
- DIM-09 Uthållighet: High-intensity distance per 90, stamina consistency across halves
- DIM-10 Styrka & duellspel: Aerial duel win rate, ground duel success, physical dominance

### Mental — 23% weight (DIM-11, DIM-12, DIM-15, DIM-16)
- DIM-11 Beslutsfattande under press: Big-match performance, late-game composure, decision quality under pressure
- DIM-12 Mental motståndskraft: Response to setbacks, consistency after errors, mental recovery
- DIM-15 Impulskontroll: Self-regulation, emotional composure, tackle discipline, yellow/red card patterns
- DIM-16 Drivkraft: Intrinsic motivation, work rate consistency, sprint frequency in final minutes, ambition trajectory

### Social & Contextual — 10% weight (DIM-13 to DIM-14)
- DIM-13 Ledarskap & kommunikation: On-pitch communication, work rate leadership, coachability
- DIM-14 Klubb & ligaanpassning: Playing style compatibility, league level fit, squad role projection

## Output Rules
- Be direct and specific. No filler language.
- Every claim must reference data from the player profile or stats provided.
- If data is insufficient for a dimension, score it null and state "Insufficient data".
- overall_score = weighted average: tactical(DIM-01→03) 22% + technical(DIM-04→07) 27% + physical(DIM-08→10) 18% + mental(DIM-11,12,15,16) 23% + social(DIM-13→14) 10%.
- confidence = 0.0-1.0 based on data completeness and quality.
- recommendation must be one of: "SIGN", "MONITOR", "PASS", "INSUFFICIENT_DATA".

You MUST respond with valid JSON only. No markdown, no explanation outside the JSON.`;

// ---------------------------------------------------------------------------
// Analysis type modifiers — appended to user prompt
// ---------------------------------------------------------------------------

const ANALYSIS_TYPE_INSTRUCTIONS: Record<AnalysisType, string> = {
  full_scout: `Perform a FULL SCOUT analysis covering all 16 dimensions. Be thorough.
Provide detailed evidence for each dimension score. Include transfer assessment context.`,

  quick_scan: `Perform a QUICK SCAN — focus on the top 5 most differentiating dimensions for this player's position.
Keep summary under 200 words. Skip dimensions where data is clearly insufficient.`,

  match_review: `Perform a MATCH REVIEW analysis focused on recent match data.
Emphasize DIM-01 (Positional Awareness), DIM-03 (Decision Making), DIM-07 (Athletic Profile), and DIM-10 (Composure).
Reference specific match events where available.`,

  transfer_assessment: `Perform a TRANSFER ASSESSMENT focused on value, risk, and fit.
Emphasize DIM-13 (Development Trajectory), DIM-14 (Market & Contract Context), DIM-09 (Injury Resilience), and DIM-12 (Team Fit).
Include a clear buy/pass recommendation with reasoning.`,
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url, serviceKey };
}

async function supabaseRpc(
  functionName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `RPC ${functionName} failed (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

async function supabaseQuery(
  table: string,
  query: string
): Promise<unknown[]> {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Query ${table} failed (${response.status}): ${errorText}`
    );
  }

  return response.json() as Promise<unknown[]>;
}

// ---------------------------------------------------------------------------
// Cache — return recent completed analysis if available
// ---------------------------------------------------------------------------

const CACHE_TTL_MINUTES: Record<AnalysisType, number> = {
  full_scout: 1440,          // 24h
  quick_scan: 720,           // 12h
  match_review: 360,         // 6h
  transfer_assessment: 720,  // 12h
};

async function checkCachedAnalysis(
  playerId: string,
  analysisType: AnalysisType
): Promise<{
  analysis_id: string;
  result: AnalysisResult;
  duration_ms: number;
} | null> {
  try {
    const ttl = CACHE_TTL_MINUTES[analysisType];
    const cutoff = new Date(Date.now() - ttl * 60 * 1000).toISOString();

    const rows = await supabaseQuery(
      "scout_analyses",
      `player_id=eq.${encodeURIComponent(playerId)}` +
        `&analysis_type=eq.${analysisType}` +
        `&status=eq.completed` +
        `&completed_at=gte.${cutoff}` +
        `&order=completed_at.desc` +
        `&limit=1` +
        `&select=id,analysis_data,duration_ms`
    );

    if (!Array.isArray(rows) || rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    const analysisData = row.analysis_data as AnalysisResult | null;
    if (!analysisData || typeof analysisData.overall_score !== "number") {
      return null;
    }

    return {
      analysis_id: row.id as string,
      result: analysisData,
      duration_ms: (row.duration_ms as number) ?? 0,
    };
  } catch (err) {
    console.warn("[scout-analyze-player] Cache check failed:", err);
    return null; // Cache miss on error — fall through to fresh analysis
  }
}

// ---------------------------------------------------------------------------
// Fetch player data from scout_players
// ---------------------------------------------------------------------------

async function fetchPlayerData(playerId: string): Promise<PlayerData> {
  const rows = await supabaseQuery(
    "scout_players",
    `id=eq.${encodeURIComponent(playerId)}&select=*&limit=1`
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Player not found: ${playerId}`);
  }

  return rows[0] as PlayerData;
}

// ---------------------------------------------------------------------------
// Load KB context relevant to scouting
// ---------------------------------------------------------------------------

async function loadKnowledgeContext(
  player: PlayerData,
  analysisType: AnalysisType
): Promise<{ context: string; filesUsed: string[] }> {
  try {
    // Load scouting-relevant KB entries by cluster + key (NOT category — categories don't match)
    const kbEntries = await supabaseQuery(
      "knowledge_bank",
      `cluster=eq.vault_ai_scout&key=in.(football_dimensions,football_dim_15_impulse_control,football_dim_16_drive_motivation,player_archetypes,career_phases,football_behavioral_signals)&select=key,title,content&order=updated_at.desc&limit=10`
    );

    const expectedKbCount = 6; // football_dimensions, dim_15, dim_16, player_archetypes, career_phases, behavioral_signals
    if (!Array.isArray(kbEntries) || kbEntries.length === 0) {
      console.warn(`[KB-GUARD] analyze-player: loaded 0/${expectedKbCount} KB entries`);
      return { context: "No additional knowledge bank context available.", filesUsed: [] };
    }
    if (kbEntries.length < expectedKbCount) {
      console.warn(`[KB-GUARD] analyze-player: loaded ${kbEntries.length}/${expectedKbCount} KB entries`);
    }

    const contextParts: string[] = [];
    const filesUsed: string[] = [];
    for (const entry of kbEntries) {
      const e = entry as { key?: string; title?: string; content?: unknown };
      if (e.title && e.content) {
        // Handle jsonb content — stringify if object
        const raw = typeof e.content === "string"
          ? e.content
          : JSON.stringify(e.content);
        const content = raw.length > 4000
          ? raw.substring(0, 4000) + "... [truncated]"
          : raw;
        contextParts.push(`### ${e.title}\n${content}`);
        if (e.key) filesUsed.push(e.key);
      }
    }

    return {
      context: contextParts.length > 0
        ? `## Knowledge Bank Context\n\n${contextParts.join("\n\n")}`
        : "No additional knowledge bank context available.",
      filesUsed,
    };
  } catch (err) {
    console.warn("Knowledge bank fetch failed:", err);
    return { context: "Knowledge bank context unavailable.", filesUsed: [] };
  }
}

// ---------------------------------------------------------------------------
// Build user prompt from player data
// ---------------------------------------------------------------------------

function buildUserPrompt(
  player: PlayerData,
  analysisType: AnalysisType,
  kbContext: string
): string {
  const pd = player.profile_data ?? {};
  const age = computeAge(player.date_of_birth);
  const playerBlock = `## Player Profile
- Name: ${player.name}
- Position: ${player.position_primary}${player.position_secondary?.length ? ` (also: ${player.position_secondary.join(", ")})` : ""}
- Age: ${age ?? "Unknown"}
- Nationality: ${player.nationality}
- Current Club: ${player.current_club}
- Current League: ${player.current_league ?? "Unknown"}
- Contract Expires: ${player.contract_expires ?? "Unknown"}
- Market Value: ${player.market_value_eur != null ? `\u20ac${player.market_value_eur.toLocaleString()}` : "Unknown"}
- Tier: ${player.tier ?? "Unknown"}
- Career Phase: ${player.career_phase ?? "Unknown"}
- Preferred Foot: ${pd.preferred_foot ?? "Unknown"}
- Height: ${pd.height_cm != null ? `${pd.height_cm} cm` : "Unknown"}
- Weight: ${pd.weight_kg != null ? `${pd.weight_kg} kg` : "Unknown"}`;

  const statsBlock = pd.stats
    ? `\n## Statistics\n${JSON.stringify(pd.stats, null, 2)}`
    : "\n## Statistics\nNo statistical data available.";

  const matchHistory = pd.match_history as Record<string, unknown>[] | undefined;
  const matchBlock =
    matchHistory && matchHistory.length > 0
      ? `\n## Recent Match History\n${JSON.stringify(matchHistory.slice(0, 10), null, 2)}`
      : "\n## Recent Match History\nNo match history available.";

  const metadataBlock = pd.metadata
    ? `\n## Additional Metadata\n${JSON.stringify(pd.metadata, null, 2)}`
    : "";

  const typeInstruction = ANALYSIS_TYPE_INSTRUCTIONS[analysisType];

  return `${typeInstruction}

${playerBlock}
${statsBlock}
${matchBlock}
${metadataBlock}

${kbContext}

Respond with a single JSON object matching this structure exactly:
{
  "overall_score": <number 0-10>,
  "confidence": <number 0.0-1.0>,
  "summary": "<string, 2-4 sentences>",
  "strengths": ["<string>", ...],
  "weaknesses": ["<string>", ...],
  "risk_factors": ["<string>", ...],
  "recommendation": "SIGN" | "MONITOR" | "PASS" | "INSUFFICIENT_DATA",
  "dimension_scores": [
    {
      "dimension_id": "DIM-01",
      "dimension_name": "Positional Awareness",
      "score": <number 0-10 or null>,
      "evidence": "<string>"
    },
    ...
  ]
}`;
}

// ---------------------------------------------------------------------------
// Call Anthropic Claude Sonnet 4.6
// ---------------------------------------------------------------------------

async function runClaudeAnalysis(
  systemPrompt: string,
  userPrompt: string
): Promise<AnalysisResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(55000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic API error (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  // Extract text from response
  const textBlock = data.content.find((c) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text content in Anthropic response");
  }

  // Parse JSON from response — handle potential markdown wrapping
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  let result: AnalysisResult;
  try {
    result = JSON.parse(jsonText) as AnalysisResult;
  } catch (parseErr) {
    throw new Error(
      `Failed to parse Claude response as JSON: ${(parseErr as Error).message}. Raw: ${jsonText.substring(0, 500)}`
    );
  }

  // Validate required fields + bounds (hallucination guard)
  if (typeof result.overall_score !== "number") {
    throw new Error("Missing or invalid overall_score in analysis result");
  }
  if (result.overall_score < 0 || result.overall_score > 10) {
    console.warn(`[scout-analyze] overall_score out of range: ${result.overall_score}, clamping`);
    result.overall_score = Math.min(10, Math.max(0, result.overall_score));
  }
  if (typeof result.confidence === "number" && (result.confidence < 0 || result.confidence > 1)) {
    console.warn(`[scout-analyze] confidence out of range: ${result.confidence}, clamping`);
    result.confidence = Math.min(1, Math.max(0, result.confidence));
  }
  if (!result.recommendation) {
    throw new Error("Missing recommendation in analysis result");
  }
  // Validate dimension scores bounds
  if (Array.isArray(result.dimension_scores)) {
    for (const dim of result.dimension_scores) {
      if (typeof dim.score === "number" && (dim.score < 0 || dim.score > 10)) {
        console.warn(`[scout-analyze] dimension ${dim.dimension_id} score out of range: ${dim.score}, clamping`);
        dim.score = Math.min(10, Math.max(0, dim.score));
      }
    }
  }

  // Log token usage
  console.log(
    `Claude usage: ${data.usage.input_tokens} in / ${data.usage.output_tokens} out, stop: ${data.stop_reason}`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validateRequest(body: unknown): RequestBody {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  const b = body as Record<string, unknown>;

  if (!b.player_id || typeof b.player_id !== "string") {
    throw new Error("player_id is required and must be a string");
  }
  if (b.player_id.length > 100) {
    throw new Error("player_id exceeds maximum length");
  }
  if (!isValidUUID(b.player_id)) {
    throw new Error("player_id must be a valid UUID");
  }

  if (
    !b.analysis_type ||
    !ALLOWED_ANALYSIS_TYPES.includes(b.analysis_type as AnalysisType)
  ) {
    throw new Error(
      `analysis_type must be one of: ${ALLOWED_ANALYSIS_TYPES.join(", ")}`
    );
  }

  return {
    player_id: b.player_id,
    analysis_type: b.analysis_type as AnalysisType,
  };
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

function errorResponse(
  message: string,
  status: number,
  corsHeaders?: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    {
      status,
      headers: {
        ...(corsHeaders ?? getCorsHeaders(null)),
        "Content-Type": "application/json",
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405, corsHeaders);
  }

  // JWT authentication
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse(
      "Missing or invalid Authorization header",
      401,
      corsHeaders
    );
  }

  let userId: string;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await authClient.auth.getUser();
    if (authErr || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }
    userId = user.id;
  } catch {
    return errorResponse("Authentication failed", 401, corsHeaders);
  }

  // Rate limit check — after auth, before any expensive work
  const rl = checkRateLimit(userId);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ success: false, error: "Rate limit exceeded. Max 10 analyses per 15 minutes.", retry_after_seconds: retryAfterSec }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
      }
    );
  }

  try {
    // 1. Parse and validate request
    const body = await req.json();
    const { player_id, analysis_type } = validateRequest(body);

    console.log(
      `[scout-analyze-player] Starting ${analysis_type} for player ${player_id} (user: ${userId})`
    );

    // 2. Check cache — return recent result if available
    const cached = await checkCachedAnalysis(player_id, analysis_type);
    if (cached) {
      console.log(
        `[scout-analyze-player] Cache HIT — returning analysis ${cached.analysis_id} (${analysis_type})`
      );
      return new Response(
        JSON.stringify({
          success: true,
          analysis_id: cached.analysis_id,
          duration_ms: cached.duration_ms,

          result: {
            overall_score: cached.result.overall_score,
            confidence: cached.result.confidence,
            summary: cached.result.summary,
            strengths: cached.result.strengths,
            weaknesses: cached.result.weaknesses,
            risk_factors: cached.result.risk_factors,
            recommendation: cached.result.recommendation,
            dimension_scores: cached.result.dimension_scores,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[scout-analyze-player] Cache MISS — running fresh analysis`);

    // 3. Create analysis entry via RPC (cache miss path)
    const analysisEntry = (await supabaseRpc("start_scout_analysis", {
      p_player_id: player_id,
      p_analysis_type: analysis_type,
      p_user_id: userId,
    })) as { analysis_id: string } | string;

    const analysisId =
      typeof analysisEntry === "string"
        ? analysisEntry
        : analysisEntry?.analysis_id;

    if (!analysisId) {
      throw new Error("start_scout_analysis did not return an analysis_id");
    }

    console.log(`[scout-analyze-player] Analysis ID: ${analysisId}`);

    // 3. Fetch player data
    const player = await fetchPlayerData(player_id);
    console.log(
      `[scout-analyze-player] Player loaded: ${player.name} (${player.position_primary}, ${player.current_club})`
    );

    // 4. Load knowledge bank context
    const { context: kbContext, filesUsed: kbFilesUsed } = await loadKnowledgeContext(player, analysis_type);

    // 5. Build prompts
    const userPrompt = buildUserPrompt(player, analysis_type, kbContext);

    // 6. Run Claude analysis
    const startTime = Date.now();
    const result = await runClaudeAnalysis(SYSTEM_PROMPT, userPrompt);
    const durationMs = Date.now() - startTime;

    console.log(
      `[scout-analyze-player] Analysis complete in ${durationMs}ms. Score: ${result.overall_score}, Rec: ${result.recommendation}`
    );

    // 7. Save results via RPC
    await supabaseRpc("complete_scout_analysis", {
      p_analysis_id: analysisId,
      p_overall_score: result.overall_score,
      p_confidence: result.confidence,
      p_summary: result.summary,
      p_strengths: result.strengths,
      p_weaknesses: result.weaknesses,
      p_risk_factors: result.risk_factors,
      p_recommendation: result.recommendation,
      p_analysis_data: result,
      p_agents_used: ["claude-sonnet-4-6"],
      p_kb_files_used: kbFilesUsed,
      p_scores: result.dimension_scores ?? [],
    });

    console.log(
      `[scout-analyze-player] Results saved for analysis ${analysisId}`
    );

    // 8. Return success response
    return new Response(
      JSON.stringify({
        success: true,
        analysis_id: analysisId,
        duration_ms: durationMs,
        result: {
          overall_score: result.overall_score,
          confidence: result.confidence,
          summary: result.summary,
          strengths: result.strengths,
          weaknesses: result.weaknesses,
          risk_factors: result.risk_factors,
          recommendation: result.recommendation,
          dimension_scores: result.dimension_scores,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scout-analyze-player] ERROR: ${message}`);

    // Classify error for status code
    if (message.includes("not found")) {
      return errorResponse(message, 404);
    }
    if (
      message.includes("required") ||
      message.includes("must be") ||
      message.includes("analysis_type")
    ) {
      return errorResponse(message, 400);
    }
    if (message.includes("Missing") && message.includes("environment")) {
      return errorResponse("Server configuration error", 500);
    }
    if (message.includes("Anthropic API error")) {
      return errorResponse(`Analysis engine error: ${message}`, 502);
    }
    if (
      (err instanceof DOMException && err.name === "TimeoutError") ||
      message.includes("TimeoutError") ||
      message.includes("signal") ||
      message.includes("aborted")
    ) {
      return errorResponse(
        "Analysis timed out. Try again or use quick_scan.",
        504
      );
    }

    return errorResponse("Internal error", 500);
  }
});
