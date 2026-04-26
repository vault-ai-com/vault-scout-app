import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// scout-analyze-player — Vault AI Scout Main Analysis Engine
// ============================================================================
// POST { player_id, analysis_type } (user derived from JWT)
// Runs Claude Sonnet 4.6 analysis on a player, saves structured results.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRateLimiter, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { validateAnalysis, checkInputCompleteness, type QualityReport, type InputCompletenessResult } from "../_shared/quality-validation.ts";
import { callAnthropic, MODELS, AnthropicError } from "../_shared/anthropic-client.ts";

const rateLimiter = createRateLimiter(10);

const ALLOWED_ANALYSIS_TYPES = [
  "full_scout",
  "quick_scan",
  "match_review",
  "transfer_assessment",
] as const;

type AnalysisType = (typeof ALLOWED_ANALYSIS_TYPES)[number];

type KbGroup = "tactical" | "technical_physical" | "behavioral_contextual" | "all";

const KB_KEYS_BY_GROUP: Record<KbGroup, string[]> = {
  tactical: ["football_dimensions"],
  technical_physical: ["football_dimensions"],
  behavioral_contextual: [
    "football_behavioral_signals",
    "football_dim_15_impulse_control",
    "football_dim_16_drive_motivation",
    "player_archetypes",
    "career_phases",
  ],
  all: [
    "football_dimensions",
    "football_dim_15_impulse_control",
    "football_dim_16_drive_motivation",
    "player_archetypes",
    "career_phases",
    "football_behavioral_signals",
  ],
};

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
// Multi-agent types
// ---------------------------------------------------------------------------

interface AgentResult {
  agentName: string;
  status: "success" | "error" | "timeout";
  dimension_scores: DimensionScore[];
  raw_text: string;
  overall_score?: number;
  confidence?: number;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  risk_factors?: string[];
  error?: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// System prompt — Vault AI Scout persona + dimension framework
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_STATIC = `You are Vault AI Scout, a world-class football scouting analyst built by Vault AI.
You provide rigorous, evidence-based player assessments. Never speculate beyond the data provided.

## CRITICAL: Anti-Hallucination Rules (NEVER VIOLATE)
- You may ONLY use information explicitly provided in the Player Profile, Statistics, Match History, and Knowledge Bank sections below.
- NEVER use your general training knowledge about specific players, clubs, match results, titles, transfer fees, or career histories.
- If Statistics says "No statistical data available" — there are ZERO verified stats. Do NOT invent any.
- If Match History says "No match history available" — there is NO verified match data. Do NOT fabricate match events.
- Every "evidence" field MUST reference ONLY data from the input. NEVER cite achievements, statistics, or events not present in the player data provided.
- If data is insufficient for a dimension, you MUST score it null and write "Insufficient data — no verified information available".
- When data is sparse, score LOWER and set confidence LOW (0.2-0.4). Do NOT generate plausible-sounding but unverified narratives.
- If you find yourself writing evidence that is not directly traceable to the input data, STOP and write "Insufficient data" instead.`;

const SYSTEM_PROMPT_RULES = `## Output Rules
- Be direct and specific. No filler language.
- Every claim must reference data from the player profile or stats provided.
- If data is insufficient for a dimension, score it null and state "Insufficient data — no verified information available".
- confidence = 0.0-1.0 based on data completeness and quality.
- recommendation must be one of: "SIGN", "MONITOR", "PASS", "INSUFFICIENT_DATA".
- If fewer than 8 dimensions have sufficient data from the input, recommendation MUST be "INSUFFICIENT_DATA".
- NEVER fabricate statistics, match events, or career details not present in the input data.

You MUST respond with valid JSON only. No markdown, no explanation outside the JSON.`;

// RC1 — Sprint 170: Explicit array-format requirement injected in system prompt
// Eliminates competing dict-style reference from dimension framework bullet-list
const DIMENSION_SCORES_FORMAT_REQUIREMENT = `
## CRITICAL: dimension_scores OUTPUT FORMAT
dimension_scores MUST be a JSON array of objects. NEVER use object/dict format.

Each object MUST have these exact fields:
- dimension_id: string (e.g. "DIM-01")
- dimension_name: string
- score: number (0-10) or null if insufficient data
- confidence: number (0-1)
- evidence: string

CORRECT format (array):
[{"dimension_id": "DIM-01", "dimension_name": "Positional Awareness", "score": 7.5, "confidence": 0.8, "evidence": "Shows excellent positioning..."}]

WRONG format (object/dict — NEVER use this):
{"DIM-01": {"score": 7}}
{"DIM-01": 7}

ALWAYS use array format with dimension_id field. NEVER use object format.`;

async function getSystemPrompt(): Promise<string> {
  try {
    const dimFramework = await supabaseRpc("get_dimension_framework_prompt", { p_type: "performance" });
    if (typeof dimFramework === "string" && dimFramework.length > 0) {
      return `${SYSTEM_PROMPT_STATIC}\n\n${dimFramework}\n\nScore each applicable dimension 0-10 with specific evidence from the player data.\n\n${DIMENSION_SCORES_FORMAT_REQUIREMENT}\n\n${SYSTEM_PROMPT_RULES}`;
    }
    console.warn("[scout-analyze] RPC returned empty/null, using fallback");
    return `${SYSTEM_PROMPT_STATIC}\n\n${DIMENSION_SCORES_FORMAT_REQUIREMENT}\n\n${SYSTEM_PROMPT_RULES}`;
  } catch (err) {
    console.warn("[scout-analyze] Failed to load dimension framework from DB, using fallback:", err);
    return `${SYSTEM_PROMPT_STATIC}\n\n${DIMENSION_SCORES_FORMAT_REQUIREMENT}\n\n${SYSTEM_PROMPT_RULES}`;
  }
}

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

  const text = await response.text();
  if (!text || text.trim() === "") return null;
  return JSON.parse(text);
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
        `&input_completeness=not.is.null` +
        `&input_completeness=neq.EMPTY` +
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
  analysisType: AnalysisType,
  group: KbGroup = "all"
): Promise<{ context: string; filesUsed: string[] }> {
  try {
    // Load scouting-relevant KB entries by cluster + key, filtered by agent group
    const kbKeys = KB_KEYS_BY_GROUP[group];
    const kbEntries = await supabaseQuery(
      "knowledge_bank",
      `cluster=eq.vault_ai_scout&key=in.(${kbKeys.join(",")})&select=key,title,content&order=updated_at.desc&limit=10`
    );

    const expectedKbCount = kbKeys.length; // dynamic based on group
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

  // --- Career & club history ---
  const careerParts: string[] = [];
  if (pd.career_history) careerParts.push(JSON.stringify(pd.career_history, null, 2));
  if (pd.career_clubs) careerParts.push(`Clubs: ${JSON.stringify(pd.career_clubs, null, 2)}`);
  if (pd.career_timeline) careerParts.push(`Timeline: ${JSON.stringify(pd.career_timeline, null, 2)}`);
  if (Array.isArray(pd.previous_clubs)) careerParts.push(`Previous Clubs: ${(pd.previous_clubs as string[]).join(", ")}`);
  else if (typeof pd.previous_clubs === "string") careerParts.push(`Previous Clubs: ${pd.previous_clubs}`);
  if (typeof pd.previous_club === "string") careerParts.push(`Previous Club: ${pd.previous_club}`);
  const careerHistoryBlock = careerParts.length > 0 ? `\n## Career History\n${careerParts.join("\n")}` : "";

  const careerStatsParts: string[] = [];
  if (pd.career_goals != null) careerStatsParts.push(`- Goals: ${pd.career_goals}`);
  if (pd.career_assists != null) careerStatsParts.push(`- Assists: ${pd.career_assists}`);
  if (pd.career_matches != null) careerStatsParts.push(`- Matches: ${pd.career_matches}`);
  else if (pd.career_total_matches != null) careerStatsParts.push(`- Matches: ${pd.career_total_matches}`);
  else if (pd.career_total_appearances != null) careerStatsParts.push(`- Appearances: ${pd.career_total_appearances}`);
  if (pd.career_yellow_cards != null) careerStatsParts.push(`- Yellow Cards: ${pd.career_yellow_cards}`);
  if (pd.career_red_cards != null) careerStatsParts.push(`- Red Cards: ${pd.career_red_cards}`);
  if (pd.caps_sweden != null) careerStatsParts.push(`- Sweden Caps: ${pd.caps_sweden}`);
  if (pd.caps_international != null) careerStatsParts.push(`- International Caps: ${pd.caps_international}`);
  if (pd.u21_caps != null) careerStatsParts.push(`- U21 Caps: ${pd.u21_caps}`);
  const careerStatsBlock = careerStatsParts.length > 0 ? `\n## Career Totals\n${careerStatsParts.join("\n")}` : "";

  const honorsBlock = pd.awards || pd.honours
    ? `\n## Awards & Honours\n${pd.awards ? JSON.stringify(pd.awards, null, 2) : ""}${pd.honours ? `\n${JSON.stringify(pd.honours, null, 2)}` : ""}`
    : "";

  // --- Current season stats ---
  const seasonParts: string[] = [];
  if (pd.season_2025) seasonParts.push(JSON.stringify(pd.season_2025, null, 2));
  if (pd.allsvenskan_2026) seasonParts.push(`Allsvenskan 2026: ${JSON.stringify(pd.allsvenskan_2026, null, 2)}`);
  if (pd.allsvenskan_stats) seasonParts.push(`Allsvenskan: ${JSON.stringify(pd.allsvenskan_stats, null, 2)}`);
  if (pd.eliteserien_2025) seasonParts.push(`Eliteserien 2025: ${JSON.stringify(pd.eliteserien_2025, null, 2)}`);
  if (pd.stats_2025_26) seasonParts.push(`2025/26: ${JSON.stringify(pd.stats_2025_26, null, 2)}`);
  if (pd.allsvenskan_2025_starts != null) seasonParts.push(`Allsvenskan 2025 Starts: ${pd.allsvenskan_2025_starts}`);
  if (pd.allsvenskan_2025_minutes != null) seasonParts.push(`Allsvenskan 2025 Minutes: ${pd.allsvenskan_2025_minutes}`);
  if (pd.allsvenskan_2025_avg_rating != null) seasonParts.push(`Allsvenskan 2025 Avg Rating: ${pd.allsvenskan_2025_avg_rating}`);
  if (pd.allsvenskan_2025_goals_conceded != null) seasonParts.push(`Goals Conceded: ${pd.allsvenskan_2025_goals_conceded}`);
  if (pd.allsvenskan_2025_clean_sheets != null) seasonParts.push(`Clean Sheets: ${pd.allsvenskan_2025_clean_sheets}`);
  if (pd.allsvenskan_2025_save_pct != null) seasonParts.push(`Save %: ${pd.allsvenskan_2025_save_pct}`);
  const currentSeasonBlock = seasonParts.length > 0 ? `\n## Current Season Stats\n${seasonParts.join("\n")}` : "";

  const goalParts: string[] = [];
  if (pd.goals_2025 != null) goalParts.push(`- Goals 2025: ${pd.goals_2025}${pd.goals_2025_league != null ? ` (league: ${pd.goals_2025_league})` : ""}`);
  if (pd.goals_2024_25 != null) goalParts.push(`- Goals 2024/25: ${pd.goals_2024_25}`);
  if (pd.goals_2025_26 != null) goalParts.push(`- Goals 2025/26: ${pd.goals_2025_26}`);
  if (pd.assists_2024_25 != null) goalParts.push(`- Assists 2024/25: ${pd.assists_2024_25}`);
  if (pd.minutes_2024_25 != null) goalParts.push(`- Minutes 2024/25: ${pd.minutes_2024_25}`);
  if (pd.appearances_2024_25 != null) goalParts.push(`- Appearances 2024/25: ${pd.appearances_2024_25}`);
  if (pd.appearances_2025_26 != null) goalParts.push(`- Appearances 2025/26: ${pd.appearances_2025_26}`);
  if (pd.pass_accuracy_2024_25 != null) goalParts.push(`- Pass Accuracy 2024/25: ${pd.pass_accuracy_2024_25}%`);
  if (pd.pass_completion_pct != null) goalParts.push(`- Pass Completion: ${pd.pass_completion_pct}%`);
  if (pd.goals_per_match != null) goalParts.push(`- Goals/Match: ${pd.goals_per_match}`);
  if (pd.xg_2025_spring != null) goalParts.push(`- xG 2025 Spring: ${pd.xg_2025_spring}`);
  if (pd.shots_on_target_2025 != null) goalParts.push(`- Shots on Target 2025: ${pd.shots_on_target_2025}`);
  const recentGoalsBlock = goalParts.length > 0 ? `\n## Recent Goal Contributions\n${goalParts.join("\n")}` : "";

  // --- Strengths & weaknesses (prior scouting assessment) ---
  const strengthsList = Array.isArray(pd.strengths) ? (pd.strengths as string[]).map((s) => `- ${s}`).join("\n") : typeof pd.strengths === "string" ? pd.strengths : null;
  const storedStrengthsBlock = strengthsList ? `\n## Scouted Strengths (Prior Assessment)\n${strengthsList}` : "";

  const weaknessParts: string[] = [];
  if (Array.isArray(pd.weaknesses)) weaknessParts.push(...(pd.weaknesses as string[]).map((w) => `- ${w}`));
  else if (typeof pd.weaknesses === "string") weaknessParts.push(pd.weaknesses);
  if (typeof pd.key_weakness === "string") weaknessParts.push(`- Key weakness: ${pd.key_weakness}`);
  if (typeof pd.disqualifying_weakness === "string") weaknessParts.push(`- Disqualifying: ${pd.disqualifying_weakness}`);
  const storedWeaknessesBlock = weaknessParts.length > 0 ? `\n## Scouted Weaknesses (Prior Assessment)\n${weaknessParts.join("\n")}` : "";

  const styleNotesBlock = typeof pd.style_notes === "string" ? `\n## Playing Style Notes\n${pd.style_notes}` : "";

  // --- Injury & physical ---
  const injuryParts: string[] = [];
  if (pd.injury_history) injuryParts.push(`History: ${JSON.stringify(pd.injury_history, null, 2)}`);
  if (pd.injury_risk_score != null) injuryParts.push(`Risk Score: ${pd.injury_risk_score}/10`);
  if (pd.injury_days_total != null) injuryParts.push(`Total Injury Days: ${pd.injury_days_total}`);
  if (pd.knee_injury_months != null) injuryParts.push(`Knee Injury Duration: ${pd.knee_injury_months} months`);
  const injuryBlock = injuryParts.length > 0 ? `\n## Injury Profile\n${injuryParts.join("\n")}` : "";

  const physicalParts: string[] = [];
  if (pd.physical_sprint != null) physicalParts.push(`- Sprint: ${pd.physical_sprint}`);
  if (pd.physical_strength != null) physicalParts.push(`- Strength: ${pd.physical_strength}`);
  if (pd.physical_endurance != null) physicalParts.push(`- Endurance: ${pd.physical_endurance}`);
  if (pd.top_speed_kmh != null) physicalParts.push(`- Top Speed: ${pd.top_speed_kmh} km/h`);
  const physicalBlock = physicalParts.length > 0 ? `\n## Physical Attributes\n${physicalParts.join("\n")}` : "";

  // --- Transfer & context ---
  const transferParts: string[] = [];
  if (pd.transfer_interest) transferParts.push(`Interest: ${pd.transfer_interest}`);
  if (typeof pd.estimated_transfer_eur === "number") transferParts.push(`Estimated Value: \u20ac${pd.estimated_transfer_eur.toLocaleString()}`);
  if (typeof pd.transfer_fee_eur === "number") transferParts.push(`Fee Paid: \u20ac${pd.transfer_fee_eur.toLocaleString()}`);
  if (typeof pd.transfer_type === "string") transferParts.push(`Type: ${pd.transfer_type}`);
  if (typeof pd.transfer_date === "string") transferParts.push(`Date: ${pd.transfer_date}`);
  const transferBlock = transferParts.length > 0 ? `\n## Transfer Context\n${transferParts.join("\n")}` : "";

  const agentBlock = typeof pd.agent === "string"
    ? `\n## Agent\n${pd.agent}${typeof pd.agent_note === "string" ? ` — ${pd.agent_note}` : ""}`
    : "";

  const vaultFlagsBlock = pd.vault_flags ? `\n## Scout Flags\n${JSON.stringify(pd.vault_flags, null, 2)}` : "";

  const keyQuotesList = Array.isArray(pd.key_quotes) ? (pd.key_quotes as string[]).map((q) => `"${q}"`).join("\n") : typeof pd.key_quotes === "string" ? pd.key_quotes : null;
  const keyQuotesBlock = keyQuotesList ? `\n## Key Quotes\n${keyQuotesList}` : "";

  const notesBlock = typeof pd.notes === "string" ? `\n## Notes\n${pd.notes}` : "";
  const descriptionBlock = typeof pd.description === "string" ? `\n## Description\n${pd.description}` : "";

  const typeInstruction = ANALYSIS_TYPE_INSTRUCTIONS[analysisType];

  return `${typeInstruction}

${playerBlock}
${statsBlock}
${matchBlock}
${metadataBlock}
${careerHistoryBlock}
${careerStatsBlock}
${honorsBlock}
${currentSeasonBlock}
${recentGoalsBlock}
${storedStrengthsBlock}
${storedWeaknessesBlock}
${styleNotesBlock}
${injuryBlock}
${physicalBlock}
${transferBlock}
${agentBlock}
${vaultFlagsBlock}
${keyQuotesBlock}
${notesBlock}
${descriptionBlock}

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
  const { text: rawResponseText, usage: apiUsage, stop_reason } = await callAnthropic({
    model: MODELS.sonnet,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    timeoutMs: 55000,
  });

  if (!rawResponseText) {
    throw new Error("No text content in Anthropic response");
  }

  // Parse JSON from response — handle potential markdown wrapping
  let jsonText = rawResponseText.trim();
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
  } else if (!result.dimension_scores) {
    // RC7 — Sprint 170: warn if single-agent path returns no dimension_scores
    console.warn("[scout-analyze] dimension_scores missing from single-agent response — analysis may be incomplete");
  }

  // Log token usage
  console.log(
    `Claude usage: ${apiUsage.input_tokens} in / ${apiUsage.output_tokens} out, stop: ${stop_reason}`
  );

  return result;
}

// ---------------------------------------------------------------------------
// runSingleAgent — per-agent Claude call with timeout, JSON parsing, bounds validation
// ---------------------------------------------------------------------------

async function runSingleAgent(
  agentName: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 40000
): Promise<AgentResult> {
  const startTime = Date.now();

  // VCE09 F1: callAnthropic() throws — wrap in try/catch to preserve never-throw contract
  let rawText: string;
  let agentUsage: { input_tokens: number; output_tokens: number };
  let duration_ms: number;

  try {
    const result = await callAnthropic({
      model: MODELS.sonnet,
      max_tokens: 4096,  // RC2 — Sprint 170: was 2048, caused JSON truncation for 7-dim agent
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      timeoutMs,
    });
    duration_ms = Date.now() - startTime;
    rawText = result.text;
    agentUsage = result.usage;

    // RC2 supplement: warn if response was truncated despite increased limit
    if (result.stop_reason === "max_tokens") {
      console.warn(`[multi-agent] Agent "${agentName}" hit max_tokens — JSON likely truncated`);
    }
  } catch (err) {
    duration_ms = Date.now() - startTime;
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    const isApiErr = err instanceof AnthropicError;
    console.warn(
      `[multi-agent] Agent "${agentName}" ${
        isTimeout ? "timed out" : isApiErr ? `API error (${err.status})` : "fetch failed"
      }: ${(err as Error).message}`
    );
    return {
      agentName,
      status: isTimeout ? "timeout" : "error",
      dimension_scores: [],
      raw_text: "",
      error: (err as Error).message,
      duration_ms,
    };
  }

  console.log(
    `[multi-agent] Agent "${agentName}" usage: ${agentUsage.input_tokens} in / ${agentUsage.output_tokens} out — ${duration_ms}ms`
  );

  // Parse JSON — handle potential markdown wrapping
  let jsonText = rawText.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  let parsed: Partial<AnalysisResult>;
  try {
    parsed = JSON.parse(jsonText) as Partial<AnalysisResult>;
  } catch (parseErr) {
    console.warn(
      `[multi-agent] Agent "${agentName}" JSON parse failed: ${(parseErr as Error).message}`
    );
    return {
      agentName,
      status: "error",
      dimension_scores: [],
      raw_text: rawText,
      error: `JSON parse failed: ${(parseErr as Error).message}`,
      duration_ms,
    };
  }

  // RC3 — Sprint 170: Normalize object-format dimension_scores to array format
  // LLM sometimes returns {"DIM-01": {score: 7, confidence: 0.8}} instead of array
  if (parsed.dimension_scores && typeof parsed.dimension_scores === "object" && !Array.isArray(parsed.dimension_scores)) {
    console.warn(`[multi-agent] Agent "${agentName}" returned object-format dimension_scores — normalizing to array`);
    const objScores = parsed.dimension_scores as Record<string, unknown>;
    parsed.dimension_scores = Object.entries(objScores).map(([dimId, val]) => {
      if (typeof val === "number") {
        return { dimension_id: dimId, score: val, confidence: null, evidence: "", dimension_name: "" };
      }
      const v = val as Record<string, unknown> | null;
      return {
        dimension_id: dimId,
        score: v && typeof v.score === "number" ? v.score : null,
        confidence: v && typeof v.confidence === "number" ? v.confidence : null,
        evidence: v && typeof v.evidence === "string" ? v.evidence : "",
        dimension_name: v && typeof v.dimension_name === "string" ? v.dimension_name : "",
      };
    }) as DimensionScore[];
  }

  // RC6 — Sprint 170: Normalize 'dim' field alias to 'dimension_id' in array format
  if (Array.isArray(parsed.dimension_scores)) {
    for (const dim of parsed.dimension_scores as Array<Record<string, unknown>>) {
      if (dim.dim && !dim.dimension_id) {
        dim.dimension_id = String(dim.dim);
      }
    }
  }

  // Filter dimension_scores to only include dimensions within agent's assigned scope (VCE09 F5 fix)
  const assignedDims = AGENT_DIMENSIONS[agentName]?.ids ?? [];
  const dimensionScores: DimensionScore[] = [];
  if (Array.isArray(parsed.dimension_scores)) {
    for (const dim of parsed.dimension_scores) {
      // Only keep dimensions assigned to this agent
      if (assignedDims.length > 0 && !assignedDims.includes(dim.dimension_id)) {
        continue;
      }
      if (typeof dim.score === "number" && (dim.score < 0 || dim.score > 10)) {
        console.warn(
          `[multi-agent] Agent "${agentName}" dimension ${dim.dimension_id} score out of range: ${dim.score}, clamping`
        );
        dim.score = Math.min(10, Math.max(0, dim.score));
      }
      dimensionScores.push(dim);
    }
  }

  // Clamp overall_score if present
  let overallScore = parsed.overall_score;
  if (typeof overallScore === "number" && (overallScore < 0 || overallScore > 10)) {
    overallScore = Math.min(10, Math.max(0, overallScore));
  }

  // Clamp confidence if present
  let confidence = parsed.confidence;
  if (typeof confidence === "number" && (confidence < 0 || confidence > 1)) {
    confidence = Math.min(1, Math.max(0, confidence));
  }

  return {
    agentName,
    status: "success",
    dimension_scores: dimensionScores,
    raw_text: rawText,
    overall_score: overallScore,
    confidence,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : undefined,
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : undefined,
    risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors : undefined,
    duration_ms,
  };
}

// ---------------------------------------------------------------------------
// runMultiAgentAnalysis — 3 parallel Claude agents via Promise.allSettled
// ---------------------------------------------------------------------------

// Dimension assignment per agent
const AGENT_DIMENSIONS: Record<string, { ids: string[]; label: string }> = {
  tactical: {
    ids: ["DIM-01", "DIM-02", "DIM-03"],
    label: "Tactical (DIM-01 Positional Awareness, DIM-02 Tactical Flexibility, DIM-03 Pressing & Recovery)",
  },
  technical_physical: {
    ids: ["DIM-04", "DIM-05", "DIM-06", "DIM-07", "DIM-08", "DIM-09", "DIM-10"],
    label:
      "Technical (DIM-04 Ball Control, DIM-05 Passing Quality, DIM-06 Shooting Efficiency, DIM-07 Dribbling & 1v1) " +
      "and Physical (DIM-08 Sprint & Acceleration, DIM-09 Endurance, DIM-10 Strength & Duels)",
  },
  behavioral_contextual: {
    ids: ["DIM-11", "DIM-12", "DIM-13", "DIM-14", "DIM-15", "DIM-16"],
    label:
      "Mental (DIM-11 Decision Making Under Pressure, DIM-12 Mental Resilience, DIM-15 Impulse Control, DIM-16 Drive) " +
      "and Social/Context (DIM-13 Leadership & Communication, DIM-14 Club & League Adaptation)",
  },
};

function buildAgentUserPrompt(
  baseUserPrompt: string,
  agentName: string
): string {
  const agentDims = AGENT_DIMENSIONS[agentName];
  if (!agentDims) return baseUserPrompt;

  const focusInstruction = `\n\n## Agent Scope\nYou are Agent "${agentName}". Score ONLY the following dimensions: ${agentDims.label}.\nFor all other dimensions, omit them from dimension_scores entirely (do not include dimensions outside your scope).\nFocus your overall_score and confidence on your assigned dimensions only.`;

  // Inject scope restriction before the JSON schema line
  const schemaMarker = "Respond with a single JSON object matching this structure exactly:";
  const schemaIdx = baseUserPrompt.indexOf(schemaMarker);
  if (schemaIdx !== -1) {
    return (
      baseUserPrompt.slice(0, schemaIdx) +
      focusInstruction +
      "\n\n" +
      baseUserPrompt.slice(schemaIdx)
    );
  }
  return baseUserPrompt + focusInstruction;
}

async function runMultiAgentAnalysis(
  systemPromptBase: string,
  player: PlayerData,
  analysisType: AnalysisType
): Promise<AgentResult[]> {
  const agentNames = ["tactical", "technical_physical", "behavioral_contextual"] as const;

  console.log(
    `[multi-agent] Launching ${agentNames.length} parallel agents for player "${player.name}" (${analysisType})`
  );

  // Load KB per agent group for selective context — reduces token waste
  const [kbTactical, kbTechnical, kbBehavioral] = await Promise.all([
    loadKnowledgeContext(player, analysisType, "tactical"),
    loadKnowledgeContext(player, analysisType, "technical_physical"),
    loadKnowledgeContext(player, analysisType, "behavioral_contextual"),
  ]);

  const agentKb: Record<string, { context: string; filesUsed: string[] }> = {
    tactical: kbTactical,
    technical_physical: kbTechnical,
    behavioral_contextual: kbBehavioral,
  };

  // Run all 3 agents in parallel — allSettled so one failure does not abort others
  const settled = await Promise.allSettled(
    agentNames.map((name) => {
      const kb = agentKb[name];
      const agentUserPrompt = buildAgentUserPrompt(
        buildUserPrompt(player, analysisType, kb.context),
        name
      );
      return runSingleAgent(name, systemPromptBase, agentUserPrompt, 40000);
    })
  );

  const results: AgentResult[] = settled.map((outcome, idx) => {
    if (outcome.status === "fulfilled") {
      return outcome.value;
    }
    const agentName = agentNames[idx];
    console.warn(
      `[multi-agent] Agent "${agentName}" promise rejected unexpectedly: ${outcome.reason}`
    );
    return {
      agentName,
      status: "error" as const,
      dimension_scores: [],
      raw_text: "",
      error: String(outcome.reason),
      duration_ms: 0,
    };
  });

  const successCount = results.filter((r) => r.status === "success").length;
  console.log(
    `[multi-agent] Agents complete: ${successCount}/${agentNames.length} succeeded`
  );

  // Require at least 2 of 3 agents to succeed (VCE09 F6 — partial coverage gate)
  if (successCount < 2) {
    const errors = results.map((r) => `${r.agentName}: ${r.error ?? r.status}`).join("; ");
    throw new Error(`Multi-agent failed — only ${successCount}/3 succeeded (need >=2). Errors: ${errors}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// mergeAgentResults — deterministic synthesis of multi-agent outputs
// ---------------------------------------------------------------------------

// Dimension weight groups (matches scout terminal DIM framework)
const DIM_WEIGHTS: Record<string, number> = {
  "DIM-01": 0.22 / 3,  // Tactical 22% split across 3 dims
  "DIM-02": 0.22 / 3,
  "DIM-03": 0.22 / 3,
  "DIM-04": 0.27 / 4,  // Technical 27% split across 4 dims
  "DIM-05": 0.27 / 4,
  "DIM-06": 0.27 / 4,
  "DIM-07": 0.27 / 4,
  "DIM-08": 0.18 / 3,  // Physical 18% split across 3 dims
  "DIM-09": 0.18 / 3,
  "DIM-10": 0.18 / 3,
  "DIM-11": 0.23 / 4,  // Mental 23% split across 4 dims
  "DIM-12": 0.23 / 4,
  "DIM-15": 0.23 / 4,
  "DIM-16": 0.23 / 4,
  "DIM-13": 0.10 / 2,  // Social/Context 10% split across 2 dims
  "DIM-14": 0.10 / 2,
};

function deriveRecommendation(overallScore: number): string {
  if (overallScore > 7) return "SIGN";
  if (overallScore >= 4) return "MONITOR";
  return "PASS";
}

function deduplicateStrings(arrays: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const item of arr) {
      const key = item.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
  }
  return result;
}

function mergeAgentResults(results: AgentResult[]): AnalysisResult {
  const successful = results.filter((r) => r.status === "success");
  if (successful.length === 0) {
    throw new Error("mergeAgentResults called with no successful agent results");
  }

  // Collect all dimension scores — agents already filtered to their assigned scope (VCE09 F5)
  const allDimScores: DimensionScore[] = [];
  for (const agent of successful) {
    for (const dim of agent.dimension_scores) {
      allDimScores.push(dim);
    }
  }

  // Compute weighted overall_score from dimension scores
  let weightedSum = 0;
  let totalWeight = 0;
  for (const dim of allDimScores) {
    if (typeof dim.score !== "number") continue;
    const weight = DIM_WEIGHTS[dim.dimension_id];
    if (weight !== undefined) {
      weightedSum += dim.score * weight;
      totalWeight += weight;
    }
  }

  // Normalise — if not all dims present, scale by covered weight
  const overallScore =
    totalWeight > 0
      ? Math.min(10, Math.max(0, Math.round((weightedSum / totalWeight) * 10) / 10))
      : 0;

  // INSUFFICIENT_DATA guard: if dims existed but ALL were null → flag it (Sprint 162 P0)
  if (totalWeight === 0 && allDimScores.length > 0) {
    console.warn(
      `[scout-analyze-player] INSUFFICIENT_DATA: ${allDimScores.length} dimension scores returned but ALL were null/non-numeric. Flagging as INSUFFICIENT_DATA.`
    );
    throw new Error("INSUFFICIENT_DATA: All dimension scores were null — cannot produce meaningful overall score");
  }

  // confidence = lowest among successful agents (conservative)
  const confidences = successful
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");
  const confidence =
    confidences.length > 0 ? Math.min(...confidences) : 0.5;

  // strengths / weaknesses / risk_factors — concat and deduplicate
  const strengths = deduplicateStrings(successful.map((r) => r.strengths));
  const weaknesses = deduplicateStrings(successful.map((r) => r.weaknesses));
  const riskFactors = deduplicateStrings(successful.map((r) => r.risk_factors));

  // summary — concatenate non-empty summaries
  const summaryParts = successful
    .map((r) => r.summary)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  const summary = summaryParts.join(" ");

  const recommendation = deriveRecommendation(overallScore);

  console.log(
    `[multi-agent] Merge complete — overall_score: ${overallScore}, confidence: ${confidence.toFixed(2)}, recommendation: ${recommendation}, dims: ${allDimScores.length}`
  );

  return {
    overall_score: overallScore,
    confidence,
    summary: summary || "Multi-agent analysis complete.",
    strengths,
    weaknesses,
    risk_factors: riskFactors,
    recommendation,
    dimension_scores: allDimScores,
  };
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
  corsHeaders?: Record<string, string>,
  extra?: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    {
      status,
      headers: {
        ...(corsHeaders ?? getCorsHeaders(null)),
        "Content-Type": "application/json",
        ...(extra ?? {}),
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

  // JWT authentication (shared helper)
  const authResult = await authenticateRequest(req);
  if (!authResult.ok) {
    return errorResponse(authResult.error, authResult.status, corsHeaders);
  }
  const userId = authResult.userId;
  const isServiceRole = authResult.isServiceRole;

  // Rate limit check — persistent via DB
  const _rlSb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const rl = await rateLimiter.check(`scout-analyze-player:${userId}`, _rlSb);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ success: false, error: "Rate limit exceeded. Max 10 analyses per 15 minutes.", retry_after_seconds: retryAfterSec }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec), ...getRateLimitHeaders(rl) },
      }
    );
  }

  const rlHeaders = getRateLimitHeaders(rl);

  let analysisId: string | undefined;
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
          headers: { ...corsHeaders, "Content-Type": "application/json", ...rlHeaders },
        }
      );
    }

    console.log(`[scout-analyze-player] Cache MISS — running fresh analysis`);

    // 3. Create analysis entry via RPC (cache miss path)
    const analysisEntry = (await supabaseRpc("start_scout_analysis", {
      p_player_id: player_id,
      p_analysis_type: analysis_type,
      p_user_id: isServiceRole ? null : userId,
    })) as { analysis_id: string } | string;

    analysisId =
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

    // 3b. Data Completeness Gate (Sprint 151) — block analysis if input is EMPTY
    const inputCompleteness: InputCompletenessResult = checkInputCompleteness({
      profile_data: player.profile_data as Record<string, unknown> | null,
      source_ids: player.source_urls ?? [],
    });

    if (inputCompleteness.level === 'EMPTY') {
      console.warn(
        `[scout-analyze-player] DATA COMPLETENESS GATE: EMPTY input for ${player.name}. Blocking analysis.`
      );
      // Save as INSUFFICIENT_DATA instead of running LLM
      await supabaseRpc("complete_scout_analysis", {
        p_analysis_id: analysisId,
        p_overall_score: 0,
        p_confidence: 0,
        p_summary: `INSUFFICIENT_DATA: No verified profile data available for ${player.name}. Analysis blocked by Data Completeness Gate.`,
        p_strengths: [],
        p_weaknesses: [],
        p_risk_factors: ["No verified data sources"],
        p_recommendation: "INSUFFICIENT_DATA",
        p_analysis_data: { gate: 'BLOCKED', reason: 'EMPTY_INPUT', input_completeness: inputCompleteness },
        p_agents_used: [],
        p_kb_files_used: [],
        p_scores: [],
        p_input_completeness: inputCompleteness.level,
        p_provenance_tier: inputCompleteness.tier,
        p_input_snapshot: inputCompleteness.input_snapshot,
        p_source_count: inputCompleteness.source_count,
      });

      return new Response(
        JSON.stringify({
          success: false,
          analysis_id: analysisId,
          error: "INSUFFICIENT_DATA",
          message: `Data Completeness Gate blocked analysis: input is EMPTY for ${player.name}. No verified profile data available.`,
          input_completeness: inputCompleteness,
        }),
        { status: 422, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[scout-analyze-player] Input completeness: ${inputCompleteness.level}, tier: ${inputCompleteness.tier}, sources: ${inputCompleteness.source_count}`
    );

    // 4. Load knowledge bank context
    const { context: kbContext, filesUsed: kbFilesUsed } = await loadKnowledgeContext(player, analysis_type);

    // 5. Run analysis (multi-agent with single-agent fallback)
    const startTime = Date.now();
    const systemPrompt = await getSystemPrompt();
    let result: AnalysisResult;
    let agentsUsed: string[] = ["claude-sonnet-4-6"];

    try {
      // Multi-agent path — 3 parallel specialized Claude agents
      const agentResults = await runMultiAgentAnalysis(systemPrompt, player, analysis_type);
      result = mergeAgentResults(agentResults);
      agentsUsed = agentResults.map(r =>
        r.status === "success" ? `scout-${r.agentName}` : `scout-${r.agentName}-${r.status.toUpperCase()}`
      );
      console.log(`[scout-analyze-player] Multi-agent path succeeded`);
    } catch (multiErr) {
      // INSUFFICIENT_DATA = genuine data problem — do NOT fallback (Sprint 162 P0)
      if (multiErr instanceof Error && multiErr.message.startsWith("INSUFFICIENT_DATA")) {
        throw multiErr;
      }
      // Fallback — single-agent (existing runClaudeAnalysis) for other errors (network, parsing, etc.)
      console.warn(`[scout-analyze-player] Multi-agent failed, falling back to single-agent: ${(multiErr as Error).message}`);
      const fallbackPrompt = buildUserPrompt(player, analysis_type, kbContext);
      result = await runClaudeAnalysis(systemPrompt, fallbackPrompt);
      agentsUsed = ["claude-sonnet-4-6-fallback"];
    }

    const durationMs = Date.now() - startTime;

    console.log(
      `[scout-analyze-player] Analysis complete in ${durationMs}ms. Score: ${result.overall_score}, Rec: ${result.recommendation}`
    );

    // 6b. Quality validation — deterministic checks on analysis output
    const dimScoresMap: Record<string, number> = {};
    for (const d of (result.dimension_scores ?? [])) {
      if (typeof d.score === "number") {
        dimScoresMap[d.dimension_id] = d.score;
      }
    }
    const qualityReport: QualityReport = validateAnalysis({
      overall_score: result.overall_score,
      confidence: result.confidence,
      recommendation: result.recommendation,
      dimension_scores: dimScoresMap,
      evidence_count: (result.dimension_scores ?? []).filter(d => d.evidence && d.evidence.length > 15 && !d.evidence.includes('Insufficient data')).length,
    }, inputCompleteness);
    if (qualityReport.gate === 'HALT') {
      console.warn(`[scout-analyze-player] QUALITY HALT: score=${qualityReport.score}, checks=${JSON.stringify(qualityReport.checks.filter(c => c.status === 'HALT'))}`);
    }

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
      p_analysis_data: { ...result, quality_pipeline: qualityReport },
      p_agents_used: agentsUsed,
      p_kb_files_used: kbFilesUsed,
      p_scores: (result.dimension_scores ?? []).filter(d => typeof d.score === "number"),
      p_input_completeness: inputCompleteness.level,
      p_provenance_tier: inputCompleteness.tier,
      p_input_snapshot: inputCompleteness.input_snapshot,
      p_source_count: inputCompleteness.source_count,
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
        quality_pipeline: qualityReport,
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
        headers: { ...corsHeaders, "Content-Type": "application/json", ...rlHeaders },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scout-analyze-player] ERROR: ${message}`);

    // Mark analysis as failed if we have an analysisId (V64 F11 — prevent orphaned "running" entries)
    try {
      if (analysisId) {
        await supabaseRpc("fail_scout_analysis", {
          p_analysis_id: analysisId,
          p_error_message: message.substring(0, 500),
        });
      }
    } catch (failErr) {
      console.warn(`[scout-analyze-player] Failed to mark analysis as failed:`, failErr);
    }

    // Classify error for status code
    if (message.includes("not found")) {
      return errorResponse(message, 404, corsHeaders, rlHeaders);
    }
    if (
      message.includes("required") ||
      message.includes("must be") ||
      message.includes("analysis_type")
    ) {
      return errorResponse(message, 400, corsHeaders, rlHeaders);
    }
    if (message.includes("Missing") && message.includes("environment")) {
      return errorResponse("Server configuration error", 500, corsHeaders, rlHeaders);
    }
    if (message.includes("Anthropic API error")) {
      return errorResponse(`Analysis engine error: ${message}`, 502, corsHeaders, rlHeaders);
    }
    if (
      (err instanceof DOMException && err.name === "TimeoutError") ||
      message.includes("TimeoutError") ||
      message.includes("signal") ||
      message.includes("aborted")
    ) {
      return errorResponse(
        "Analysis timed out. Try again or use quick_scan.",
        504,
        corsHeaders,
        rlHeaders
      );
    }

    return errorResponse("Internal error", 500, corsHeaders, rlHeaders);
  }
});
