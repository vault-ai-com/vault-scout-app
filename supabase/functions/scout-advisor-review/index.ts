import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// scout-advisor-review — Sport Advisory Board Expert Review
// ============================================================================
// POST { analysis_id }
// Auto-routes to max 3 sport advisors based on analysis content.
// Each advisor reviews the analysis with their domain expertise.
// ============================================================================

import { createRateLimiter, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory per isolate (Deno Deploy)
// Key: IP address | Window: 15 min | Max: 5 requests
// ---------------------------------------------------------------------------
const rateLimiter = createRateLimiter(5);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdvisorOpinion {
  advisor_id: string;
  advisor_name: string;
  domain: string;
  verdict: "AGREE" | "CHALLENGE" | "FLAG";
  confidence: number;
  summary: string;
  detail: string;
  risk_flags: string[];
  recommendations: string[];
  evidence_refs: string[];
}

interface AdvisorReviewResponse {
  success: boolean;
  analysis_id: string;
  player_name: string;
  duration_ms: number;
  advisors_consulted: number;
  opinions: AdvisorOpinion[];
  consensus: string | null;
}

interface RoutedAdvisor {
  advisor_id: string;
  advisor_name: string;
  matched_domains: string[];
  system_prompt: string;
}


function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1] ?? "unknown";
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Supabase helpers (same pattern as scout-analyze-player)
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
// Domain auto-routing — derive tags from analysis content
// ---------------------------------------------------------------------------

function deriveAdvisorTags(
  analysis: Record<string, unknown>,
  analysisType: string
): string[] {
  const tags: string[] = [];
  const riskFactors = (analysis.risk_factors as string[]) ?? [];
  const recommendation = analysis.recommendation as string;
  const confidence = analysis.confidence as number;
  const dimensionScores = (analysis.dimension_scores as Array<{ dimension_id: string; score: number | null }>) ?? [];

  // Medical: injury-related risk factors or low physical scores
  const hasMedicalRisk = riskFactors.some((r) =>
    /injur|medical|physical|hamstring|knee|muscle|fitness/i.test(r)
  );
  const physicalScores = dimensionScores
    .filter((d) => ["DIM-08", "DIM-09", "DIM-10"].includes(d.dimension_id))
    .map((d) => d.score)
    .filter((s): s is number => s !== null);
  const avgPhysical = physicalScores.length > 0
    ? physicalScores.reduce((a, b) => a + b, 0) / physicalScores.length
    : 10;

  if (hasMedicalRisk || avgPhysical < 5.5) {
    tags.push("medical", "injury_risk");
  }

  // Transfer economics: SIGN recommendation or transfer assessment
  if (recommendation === "SIGN" || analysisType === "transfer_assessment") {
    tags.push("transfer_economics", "valuation");
  }

  // Psychometrics: always relevant for mental dimension review
  const mentalScores = dimensionScores
    .filter((d) => ["DIM-11", "DIM-12", "DIM-15", "DIM-16"].includes(d.dimension_id))
    .map((d) => d.score)
    .filter((s): s is number => s !== null);
  if (mentalScores.length > 0) {
    tags.push("psychometrics", "mental_performance");
  }

  // League transition: for full scout analyses
  if (analysisType === "full_scout") {
    tags.push("league_transition");
  }

  // Data quality concerns
  if (confidence < 0.6) {
    tags.push("analytics_maturity");
  }

  // Compliance: always include for data governance awareness
  tags.push("compliance");

  return [...new Set(tags)];
}

// ---------------------------------------------------------------------------
// Load advisors — route + load personas
// ---------------------------------------------------------------------------

async function loadRoutedAdvisors(
  tags: string[],
  maxAdvisors: number
): Promise<RoutedAdvisor[]> {
  // Route via get_advisor_for_sprint
  const routingResult = (await supabaseRpc("get_advisor_for_sprint", {
    p_tags: tags,
  })) as Array<{
    advisor_id: string;
    advisor_name: string;
    matched_domains: string[];
    is_fallback: boolean;
  }>;

  if (!Array.isArray(routingResult) || routingResult.length === 0) {
    console.warn("[advisor-review] No advisors found for tags:", tags);
    return [];
  }

  // Filter to vault_sport_advisors only (exclude VDT advisors)
  const sportAdvisors = routingResult.filter(
    (a) => a.advisor_id.startsWith("clone_") && !a.is_fallback
  );

  const selected = sportAdvisors.slice(0, maxAdvisors);
  const advisors: RoutedAdvisor[] = [];

  for (const advisor of selected) {
    try {
      const persona = (await supabaseRpc("get_clone_persona_safe", {
        p_clone_id: advisor.advisor_id,
      })) as Array<{ chunk_index: number; chunk_text: string }>;

      if (!Array.isArray(persona) || persona.length === 0) {
        console.warn(`[advisor-review] No persona for ${advisor.advisor_id}`);
        continue;
      }

      const systemPrompt = persona
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .map((c) => c.chunk_text)
        .join("");

      advisors.push({
        advisor_id: advisor.advisor_id,
        advisor_name: advisor.advisor_name,
        matched_domains: advisor.matched_domains,
        system_prompt: systemPrompt,
      });
    } catch (err) {
      console.warn(`[advisor-review] Failed to load ${advisor.advisor_id}:`, err);
    }
  }

  return advisors;
}

// ---------------------------------------------------------------------------
// Call Claude Opus for each advisor
// ---------------------------------------------------------------------------

async function getAdvisorOpinion(
  advisor: RoutedAdvisor,
  playerName: string,
  analysisJson: string,
  dimFramework: string
): Promise<AdvisorOpinion> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const userPrompt = `Du ska granska följande spelanalys som expert inom dina domäner: ${advisor.matched_domains.join(", ")}.

${dimFramework}

## Spelanalys att granska
Spelare: ${playerName}

${analysisJson}

## Din uppgift
1. Granska analysen ur ditt expertperspektiv
2. Ge ditt omdöme: AGREE (analysen stämmer), CHALLENGE (invändningar), eller FLAG (allvarliga brister/risker)
3. Var specifik — referera till DIM-nummer och poäng
4. Kontrollera att overall_score matchar dimensionsvikterna (±0.5 tolerans)
5. Ge max 3 konkreta rekommendationer

Svara på SVENSKA med JSON:
{
  "verdict": "AGREE" | "CHALLENGE" | "FLAG",
  "confidence": <0.0-1.0>,
  "summary": "<max 150 tecken — din kärnbedömning>",
  "detail": "<200-400 ord — din fullständiga analys>",
  "risk_flags": ["<specifika risker du ser>"],
  "recommendations": ["<konkreta åtgärder>"],
  "evidence_refs": ["<DIM-nummer eller källtaggar>"]
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 2048,
      system: advisor.system_prompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(55000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const textBlock = result.content?.find(
    (b: { type: string }) => b.type === "text"
  );
  if (!textBlock?.text) {
    throw new Error("No text in Anthropic response");
  }

  // Extract JSON from response
  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in advisor response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate and clamp
  const verdict = ["AGREE", "CHALLENGE", "FLAG"].includes(parsed.verdict)
    ? parsed.verdict
    : "CHALLENGE";
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));

  return {
    advisor_id: advisor.advisor_id,
    advisor_name: advisor.advisor_name,
    domain: advisor.matched_domains[0] ?? "general",
    verdict,
    confidence,
    summary: String(parsed.summary ?? "").slice(0, 200),
    detail: String(parsed.detail ?? ""),
    risk_flags: Array.isArray(parsed.risk_flags)
      ? parsed.risk_flags.map(String).slice(0, 5)
      : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(String).slice(0, 3)
      : [],
    evidence_refs: Array.isArray(parsed.evidence_refs)
      ? parsed.evidence_refs.map(String).slice(0, 5)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Derive consensus from opinions
// ---------------------------------------------------------------------------

function deriveConsensus(opinions: AdvisorOpinion[]): string | null {
  if (opinions.length === 0) return null;

  const verdicts = opinions.map((o) => o.verdict);
  const allAgree = verdicts.every((v) => v === "AGREE");
  const anyFlag = verdicts.some((v) => v === "FLAG");
  const challenges = verdicts.filter((v) => v === "CHALLENGE").length;

  if (allAgree) return "Alla experter godkänner analysen.";
  if (anyFlag) {
    const flaggers = opinions
      .filter((o) => o.verdict === "FLAG")
      .map((o) => o.advisor_name);
    return `Varning: ${flaggers.join(", ")} flaggar allvarliga brister.`;
  }
  if (challenges > 0) {
    return `${challenges} av ${opinions.length} experter har invändningar.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validate UUID
// ---------------------------------------------------------------------------

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const cors = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // JWT authentication (shared helper)
  const authResult = await authenticateRequest(req);
  if (!authResult.ok) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      { status: authResult.status, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
  const userId = authResult.userId;

  // Rate limit check — keyed on userId
  const rl = rateLimiter.check(userId);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 5 advisor reviews per 15 minutes.", retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { ...cors, "Content-Type": "application/json", "Retry-After": String(retryAfterSec), ...getRateLimitHeaders(rl) } }
    );
  }

  const rlHeaders = getRateLimitHeaders(rl);
  const startTime = Date.now();

  try {
    const body = await req.json();
    const analysisId = body.analysis_id;

    if (!analysisId || typeof analysisId !== "string" || !isValidUUID(analysisId)) {
      return new Response(
        JSON.stringify({ error: "analysis_id (UUID) required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json", ...rlHeaders } }
      );
    }

    console.log(`[advisor-review] Starting review for analysis ${analysisId}`);

    // 1. Fetch the analysis
    const analyses = await supabaseQuery(
      "scout_analyses",
      `id=eq.${encodeURIComponent(analysisId)}&status=eq.completed&select=id,player_id,analysis_type,overall_score,confidence,summary,strengths,weaknesses,risk_factors,recommendation,analysis_data&limit=1`
    );

    if (!Array.isArray(analyses) || analyses.length === 0) {
      return new Response(
        JSON.stringify({ error: "Analysis not found or not completed" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json", ...rlHeaders } }
      );
    }

    const analysis = analyses[0] as Record<string, unknown>;
    const playerId = analysis.player_id as string;
    const analysisType = analysis.analysis_type as string;

    // Use analysis_data if available, otherwise build from top-level fields
    const analysisData = (analysis.analysis_data as Record<string, unknown>) ?? {
      overall_score: analysis.overall_score,
      confidence: analysis.confidence,
      summary: analysis.summary,
      strengths: analysis.strengths,
      weaknesses: analysis.weaknesses,
      risk_factors: analysis.risk_factors,
      recommendation: analysis.recommendation,
    };

    // 2. Fetch the player
    const players = await supabaseQuery(
      "scout_players",
      `id=eq.${encodeURIComponent(playerId)}&select=name,position_primary,current_club,current_league,tier,career_phase&limit=1`
    );

    if (!Array.isArray(players) || players.length === 0) {
      return new Response(
        JSON.stringify({ error: "Player not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json", ...rlHeaders } }
      );
    }

    const player = players[0] as Record<string, unknown>;
    const playerName = player.name as string;

    // 3. Auto-route advisors
    const tags = deriveAdvisorTags(analysisData, analysisType);
    console.log(`[advisor-review] Derived tags: ${tags.join(", ")}`);

    const advisors = await loadRoutedAdvisors(tags, 3);

    if (advisors.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          analysis_id: analysisId,
          player_name: playerName,
          duration_ms: Date.now() - startTime,
          advisors_consulted: 0,
          opinions: [],
          consensus: "Inga sport-advisors tillgängliga för denna analystyp.",
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json", ...rlHeaders } }
      );
    }

    // 4. Build analysis summary for advisors
    const analysisJson = JSON.stringify(
      {
        player: {
          name: playerName,
          position: player.position_primary,
          club: player.current_club,
          league: player.current_league,
          tier: player.tier,
          career_phase: player.career_phase,
        },
        analysis_type: analysisType,
        ...analysisData,
      },
      null,
      2
    );

    // 5. Load dimension framework from DB (SSOT)
    let dimFramework = "## Dimensionsramverk (DIM-01→DIM-16)\nTaktisk 22%, Teknisk 27%, Fysisk 18%, Mental 23%, Social 10%.";
    try {
      const dbDims = await supabaseRpc("get_dimension_framework_prompt", { p_type: "performance" }) as string;
      if (typeof dbDims === "string" && dbDims.length > 0) dimFramework = dbDims;
    } catch (e) { console.warn("[advisor-review] Failed to load dim framework:", e); }

    // 6. Get opinions from each advisor (sequential to avoid rate limits)
    const opinions: AdvisorOpinion[] = [];
    for (const advisor of advisors) {
      try {
        console.log(`[advisor-review] Consulting ${advisor.advisor_name} (${advisor.advisor_id})`);
        const opinion = await getAdvisorOpinion(advisor, playerName, analysisJson, dimFramework);
        opinions.push(opinion);
      } catch (err) {
        console.error(`[advisor-review] ${advisor.advisor_id} failed:`, err);
        // Continue with remaining advisors
      }
    }

    // 7. Derive consensus
    const consensus = deriveConsensus(opinions);

    const result: AdvisorReviewResponse = {
      success: true,
      analysis_id: analysisId,
      player_name: playerName,
      duration_ms: Date.now() - startTime,
      advisors_consulted: opinions.length,
      opinions,
      consensus,
    };

    console.log(
      `[advisor-review] Complete: ${opinions.length} opinions in ${result.duration_ms}ms`
    );

    // 8. Persist advisor review to analysis_data for report access
    if (opinions.length > 0) {
      try {
        const patchBody = {
          analysis_data: {
            ...analysisData,
            advisor_review: {
              advisors_consulted: opinions.length,
              consensus,
              reviewed_at: new Date().toISOString(),
              opinions: opinions.map((o) => ({
                advisor_name: o.advisor_name,
                domain: o.domain,
                verdict: o.verdict,
                confidence: o.confidence,
                summary: o.summary,
                detail: o.detail,
                risk_flags: o.risk_flags,
                recommendations: o.recommendations,
              })),
            },
          },
        };
        await fetch(
          `${Deno.env.get("SUPABASE_URL")}/rest/v1/scout_analyses?id=eq.${encodeURIComponent(analysisId)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify(patchBody),
          }
        );
      } catch (persistErr) {
        console.warn("[advisor-review] Failed to persist review:", persistErr);
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json", ...rlHeaders },
    });
  } catch (err) {
    console.error("[advisor-review] Error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json", ...rlHeaders } }
    );
  }
});
