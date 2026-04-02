import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

let _corsHeaders: Record<string, string> = getCorsHeaders(null);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(msg: string, status = 400): Response {
  return jsonResponse({ error: msg }, status);
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6-20250514", max_tokens: 4096, system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
  return (await resp.json())?.content?.[0]?.text ?? "";
}

function parseAiJson(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned invalid format");
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------------
// Vault AI Design System — CSS
// ---------------------------------------------------------------------------
const VAULT_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#0B1D33;color:#FFF;
  line-height:1.6;-webkit-font-smoothing:antialiased;padding:16px;max-width:720px;margin:0 auto}
.card{background:rgba(255,255,255,.05);border-radius:12px;padding:20px;margin-bottom:16px;
  border:1px solid rgba(255,255,255,.08)}
.ch{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6C5CE7;margin-bottom:12px}
h1{font-size:24px;font-weight:700;margin-bottom:4px}
h2{font-size:18px;font-weight:600;margin-bottom:8px;color:#FDCB6E}
.sub{color:rgba(255,255,255,.7);font-size:14px;margin-bottom:16px}
.meta{color:rgba(255,255,255,.5);font-size:12px}
.b{display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;margin:0 6px 4px 0}
.bg{background:rgba(253,203,110,.15);color:#FDCB6E}
.ba{background:rgba(108,92,231,.15);color:#6C5CE7}
.br{background:rgba(239,68,68,.15);color:#EF4444}
.bgr{background:rgba(0,184,148,.15);color:#00B894}
.dr{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.dl{font-size:13px;color:rgba(255,255,255,.8);flex:1}
.db{flex:2;height:6px;background:rgba(255,255,255,.08);border-radius:3px;margin:0 12px;overflow:hidden}
.df{height:100%;border-radius:3px;background:linear-gradient(90deg,#6C5CE7,#FDCB6E)}
.ds{font-size:13px;font-weight:600;min-width:32px;text-align:right}
.st{color:rgba(255,255,255,.85);font-size:14px;line-height:1.7}
.si,.wi{padding:6px 0;font-size:14px}
.si::before{content:"\\2714 ";color:#00B894}
.wi::before{content:"\\26A0 ";color:#EF4444}
.rh{color:#EF4444}.rm{color:#F59E0B}.rl{color:#00B894}
.wm{text-align:center;padding:20px 0;color:rgba(255,255,255,.2);font-size:11px}`;

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} — Vault AI Scout</title><style>${VAULT_CSS}</style></head>
<body>${body}
<div class="wm">Vault AI Scout — ${new Date().toISOString().slice(0, 10)}</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Action: generate — full scouting report for a single player
// ---------------------------------------------------------------------------
async function handleGenerate(body: Record<string, unknown>): Promise<Response> {
  const playerId = body.player_id;
  if (!playerId || typeof playerId !== "string") return errorResponse("Missing or invalid 'player_id'");
  if (!isValidUUID(playerId)) return errorResponse("Invalid player_id format");
  const format = body.format === "json" ? "json" : "html";
  const db = getSupabaseClient();

  // Fetch player
  const { data: player, error: pErr } = await db.from("scout_players").select("*").eq("id", playerId).single();
  if (pErr || !player) return errorResponse(`Player not found: ${pErr?.message ?? "unknown"}`, 404);

  // Fetch analysis — specific ID or most recent
  const analysisQuery = body.analysis_id && typeof body.analysis_id === "string" && isValidUUID(body.analysis_id)
    ? db.from("scout_analyses").select("*").eq("id", body.analysis_id).single()
    : db.from("scout_analyses").select("*").eq("player_id", playerId).order("created_at", { ascending: false }).limit(1);
  const { data: aRows, error: aErr } = await analysisQuery;
  const analysis = Array.isArray(aRows) ? aRows[0] : aRows;
  if (aErr || !analysis) return errorResponse(`No analysis found: ${aErr?.message ?? "none"}`, 404);

  // Fetch dimension scores
  const { data: scores } = await db.from("scout_scores").select("*")
    .eq("analysis_id", analysis.id).order("dimension_id", { ascending: true });

  // Optional: comparable players
  let comparisons: unknown[] = [];
  if (body.include_comparisons === true) {
    const { data: sim } = await db.from("scout_players").select("id,name,position_primary,tier,current_league,date_of_birth,current_club")
      .eq("position_primary", player.position_primary).eq("tier", player.tier).neq("id", playerId).limit(3);
    comparisons = sim ?? [];
  }

  // Claude prompt
  const systemPrompt = `You are a world-class football scout analyst for Vault AI Scout.
Generate a professional scouting report. Be specific, data-driven, and decisive.
Use the dimension scores (0-10) to ground your analysis.
Return valid JSON with: overview(string), strengths(string[3-5]), weaknesses(string[2-4]),
dimensions([{name,score,comment}]), transfer_recommendation({verdict:"SIGN"|"MONITOR"|"PASS",
confidence:1-10,reasoning,estimated_value_eur}), risk_assessment({level:"LOW"|"MEDIUM"|"HIGH",
factors:string[]}), development_notes(string).`;

  const playerAge = computeAge(player.date_of_birth);
  const userPrompt = `Player: ${player.name}
Position: ${player.position_primary} | Age: ${playerAge ?? "unknown"} | Club: ${player.current_club}
League: ${player.current_league} | Nationality: ${player.nationality}
Tier: ${player.tier} | Phase: ${player.career_phase}
Analysis: ${analysis.summary ?? "N/A"}
Detail: ${JSON.stringify(analysis.analysis_data ?? {})}
Scores:
${(scores ?? []).map((s: Record<string, unknown>) => `- ${s.dimension_name}: ${s.score}/10`).join("\n")}
${comparisons.length > 0 ? `\nComparables:\n${comparisons.map((c: Record<string, unknown>) => `- ${c.name} (${c.current_club}, ${c.current_league}, age ${computeAge(c.date_of_birth) ?? "?"})`).join("\n")}` : ""}
Generate the scouting report JSON.`;

  let report: Record<string, unknown>;
  try { report = parseAiJson(await callClaude(systemPrompt, userPrompt)); }
  catch (e) { return errorResponse(`Report generation failed: ${e}`, 502); }

  // JSON format — return raw structured data
  if (format === "json") {
    return jsonResponse({
      success: true,
      player: { id: player.id, name: player.name, position_primary: player.position_primary },
      analysis_id: analysis.id, report,
    });
  }

  // HTML format — build premium report
  const dims = Array.isArray(report.dimensions) ? report.dimensions : [];
  const strengths = Array.isArray(report.strengths) ? report.strengths : [];
  const weaknesses = Array.isArray(report.weaknesses) ? report.weaknesses : [];
  const rec = (report.transfer_recommendation ?? {}) as Record<string, unknown>;
  const risk = (report.risk_assessment ?? {}) as Record<string, unknown>;
  const riskFactors = Array.isArray(risk.factors) ? risk.factors : [];
  const verdictClass = rec.verdict === "SIGN" ? "bgr" : rec.verdict === "PASS" ? "br" : "bg";
  const riskClass = risk.level === "HIGH" ? "rh" : risk.level === "MEDIUM" ? "rm" : "rl";

  const htmlBody = `
<div class="card">
  <div class="ch">Scouting Report</div>
  <h1>${escapeHtml(player.name)}</h1>
  <div class="sub">${escapeHtml(player.position_primary)} &bull; ${escapeHtml(player.current_club)} &bull; ${escapeHtml(player.current_league)}</div>
  <div><span class="b ba">${escapeHtml(player.tier)}</span><span class="b bg">${escapeHtml(player.career_phase)}</span>
  <span class="b ba">Age ${escapeHtml(playerAge ?? "N/A")}</span><span class="b bg">${escapeHtml(player.nationality ?? "N/A")}</span></div>
</div>
<div class="card"><div class="ch">Overview</div><div class="st">${escapeHtml(report.overview ?? "")}</div></div>
<div class="card"><div class="ch">Dimension Scores</div>
${dims.map((d: Record<string, unknown>) => `<div class="dr"><div class="dl">${escapeHtml(d.name)}</div><div class="db"><div class="df" style="width:${Math.max(0, Math.min(100, Number(d.score) || 0))}%"></div></div><div class="ds">${escapeHtml(d.score)}</div></div>`).join("")}
</div>
<div class="card"><div class="ch">Strengths</div>
${strengths.map((s: string) => `<div class="si">${escapeHtml(s)}</div>`).join("")}</div>
<div class="card"><div class="ch">Weaknesses</div>
${weaknesses.map((w: string) => `<div class="wi">${escapeHtml(w)}</div>`).join("")}</div>
<div class="card"><div class="ch">Transfer Recommendation</div>
  <div style="margin-bottom:12px"><span class="b ${verdictClass}" style="font-size:14px;padding:6px 14px">${escapeHtml(rec.verdict ?? "N/A")}</span>
  <span class="meta" style="margin-left:8px">Confidence: ${escapeHtml(rec.confidence ?? "?")}/10</span></div>
  <div class="st">${escapeHtml(rec.reasoning ?? "")}</div>
  ${rec.estimated_value_eur ? `<div class="meta" style="margin-top:8px">Est. value: ${escapeHtml(rec.estimated_value_eur)}</div>` : ""}
</div>
<div class="card"><div class="ch">Risk Assessment</div>
  <h2 class="${riskClass}">${escapeHtml(risk.level ?? "N/A")} Risk</h2>
  ${riskFactors.map((f: string) => `<div class="wi">${escapeHtml(f)}</div>`).join("")}
</div>
${report.development_notes ? `<div class="card"><div class="ch">Development Notes</div><div class="st">${escapeHtml(report.development_notes)}</div></div>` : ""}`;

  return jsonResponse({ success: true, report: wrapHtml(`${player.name} — Scouting Report`, htmlBody) });
}

// ---------------------------------------------------------------------------
// Action: compare — comparison report for 2-4 players
// ---------------------------------------------------------------------------
async function handleCompare(body: Record<string, unknown>): Promise<Response> {
  const playerIds = body.player_ids;
  if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 4) {
    return errorResponse("'player_ids' must be an array of 2-4 player IDs");
  }
  const compType = typeof body.comparison_type === "string" ? body.comparison_type : "head_to_head";
  if (!["head_to_head", "squad_fit", "replacement"].includes(compType)) {
    return errorResponse("Invalid comparison_type. Use: head_to_head, squad_fit, replacement");
  }
  const db = getSupabaseClient();

  const { data: players, error: pErr } = await db.from("scout_players").select("*").in("id", playerIds);
  if (pErr || !players || players.length < 2) return errorResponse(`Players not found: ${pErr?.message ?? "none"}`, 404);

  // Fetch latest analysis + scores per player
  const playerData: Record<string, unknown>[] = [];
  for (const p of players) {
    const { data: aRows } = await db.from("scout_analyses").select("*")
      .eq("player_id", p.id).order("created_at", { ascending: false }).limit(1);
    const analysis = Array.isArray(aRows) && aRows.length > 0 ? aRows[0] : null;
    let scores: unknown[] = [];
    if (analysis) {
      const { data: sRows } = await db.from("scout_scores").select("*").eq("analysis_id", analysis.id);
      scores = sRows ?? [];
    }
    playerData.push({ player: p, analysis, scores });
  }

  const systemPrompt = `You are a world-class football scout analyst for Vault AI Scout.
Generate a ${compType.replace(/_/g, " ")} comparison. Be specific, use dimension scores.
Return valid JSON: {summary(string), rankings([{player_name,rank,overall_score,rationale}]),
key_differentiators(string[3-5]), recommendation(string),
dimension_comparison([{dimension,scores:{player_name:score}}])}`;

  const playersCtx = playerData.map((pd: Record<string, unknown>) => {
    const p = pd.player as Record<string, unknown>;
    const a = pd.analysis as Record<string, unknown> | null;
    const s = pd.scores as Record<string, unknown>[];
    return `${p.name} (${p.position_primary}, ${p.current_club}, ${p.current_league}, tier ${p.tier})
Analysis: ${a?.summary ?? "N/A"}
Scores: ${s.map(x => `${x.dimension_name}:${x.score}`).join(", ") || "N/A"}`;
  }).join("\n\n");

  let compareData: Record<string, unknown>;
  try {
    compareData = parseAiJson(await callClaude(systemPrompt,
      `Type: ${compType.replace(/_/g, " ")}\n\n${playersCtx}\n\nGenerate comparison JSON.`));
  } catch (e) { return errorResponse(`Comparison failed: ${e}`, 502); }

  // Persist to scout_comparisons (non-blocking)
  try {
    await db.from("scout_comparisons").insert({
      player_ids: playerIds, comparison_type: compType, result_data: compareData,
      title: players.map((p: Record<string, unknown>) => p.name).join(" vs "),
    });
  } catch (saveErr) { console.error("Save comparison failed:", saveErr); }

  return jsonResponse({
    success: true, comparison_type: compType,
    players: players.map((p: Record<string, unknown>) => ({ id: p.id, name: p.name, position_primary: p.position_primary })),
    report: compareData,
  });
}

// ---------------------------------------------------------------------------
// Action: watchlist_brief — executive summary of active watchlist
// ---------------------------------------------------------------------------
async function handleWatchlistBrief(body: Record<string, unknown>): Promise<Response> {
  const db = getSupabaseClient();
  let query = db.from("scout_watchlist").select("*, scout_players(*)")
    .eq("status", "active").order("priority", { ascending: true })
    .order("deadline", { ascending: true, nullsFirst: false }).limit(20);
  const authUserId = body._userId as string | undefined;
  if (authUserId) query = query.eq("user_id", authUserId);

  const { data: items, error: wErr } = await query;
  if (wErr) return errorResponse(`Watchlist fetch failed: ${wErr.message}`, 500);
  if (!items || items.length === 0) {
    return jsonResponse({ success: true, count: 0, brief: "No active watchlist items.", items: [] });
  }

  const systemPrompt = `You are a football scout assistant for Vault AI Scout.
Generate a concise executive watchlist brief. Be action-oriented.
Return valid JSON: {executive_summary(string), priority_actions(string[3]),
items([{name,status_note,urgency:"critical"|"high"|"normal"|"low"}]),
deadline_alerts(string[])}`;

  const itemsCtx = items.map((i: Record<string, unknown>) => {
    const p = (i.scout_players ?? {}) as Record<string, unknown>;
    return `- ${p.name ?? "?"} (${p.position_primary ?? "?"}, ${p.current_club ?? "?"}) | Pri: ${i.priority} | Deadline: ${i.deadline ?? "none"} | ${i.notes ?? ""}`;
  }).join("\n");

  let briefData: Record<string, unknown>;
  try {
    briefData = parseAiJson(await callClaude(systemPrompt,
      `Watchlist (${items.length}):\n${itemsCtx}\nToday: ${new Date().toISOString().slice(0, 10)}\nGenerate brief JSON.`));
  } catch (e) { return errorResponse(`Brief generation failed: ${e}`, 502); }

  return jsonResponse({ success: true, count: items.length, brief: briefData });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  _corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: _corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // JWT authentication
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Missing or invalid Authorization header", 401);
  }

  let userId: string;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return errorResponse("Unauthorized", 401);
    userId = user.id;
  } catch {
    return errorResponse("Authentication failed", 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body"); }
  body._userId = userId;

  const action = body.action;
  if (!action || typeof action !== "string") {
    return errorResponse("Missing 'action'. Valid: generate, compare, watchlist_brief");
  }

  try {
    switch (action) {
      case "generate": return await handleGenerate(body);
      case "compare": return await handleCompare(body);
      case "watchlist_brief": return await handleWatchlistBrief(body);
      default: return errorResponse(`Unknown action '${action}'. Valid: generate, compare, watchlist_brief`);
    }
  } catch (e) {
    console.error(`Unhandled error [${action}]:`, e);
    return errorResponse("Internal error", 500);
  }
});
