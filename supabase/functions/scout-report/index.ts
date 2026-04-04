import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(data: unknown, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(msg: string, corsHeaders: Record<string, string>, status = 400): Response {
  return jsonResponse({ error: msg }, corsHeaders, status);
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// XSS defense: all user-controlled content MUST pass through escapeHtml before HTML injection
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
async function handleGenerate(body: Record<string, unknown>, corsHeaders: Record<string, string>): Promise<Response> {
  const playerId = body.player_id;
  if (!playerId || typeof playerId !== "string") return errorResponse("Missing or invalid 'player_id'", corsHeaders);
  if (!isValidUUID(playerId)) return errorResponse("Invalid player_id format", corsHeaders);
  const format = body.format === "json" ? "json" : "html";
  const db = getSupabaseClient();

  // Fetch player
  const { data: player, error: pErr } = await db.from("scout_players").select("*").eq("id", playerId).single();
  if (pErr || !player) return errorResponse(`Player not found: ${pErr?.message ?? "unknown"}`, corsHeaders, 404);

  // Fetch analysis — specific ID or most recent
  const analysisQuery = body.analysis_id && typeof body.analysis_id === "string" && isValidUUID(body.analysis_id)
    ? db.from("scout_analyses").select("*").eq("id", body.analysis_id).single()
    : db.from("scout_analyses").select("*").eq("player_id", playerId).neq("analysis_type", "personality").order("created_at", { ascending: false }).limit(1);
  const { data: aRows, error: aErr } = await analysisQuery;
  const analysis = Array.isArray(aRows) ? aRows[0] : aRows;
  if (aErr || !analysis) return errorResponse(`No analysis found: ${aErr?.message ?? "none"}`, corsHeaders, 404);

  // Fetch dimension scores
  const { data: scores } = await db.from("scout_scores").select("*")
    .eq("analysis_id", analysis.id).order("dimension_id", { ascending: true });

  // Fetch personality analysis (BPA — analysis_type = 'personality')
  let bpaProfile: Record<string, unknown> | null = null;
  {
    const { data: paRows } = await db
      .from("scout_analyses")
      .select("id,analysis_data,created_at")
      .eq("player_id", playerId)
      .eq("analysis_type", "personality")
      .order("created_at", { ascending: false })
      .limit(1);
    const paRow = Array.isArray(paRows) && paRows.length > 0 ? paRows[0] : null;
    if (paRow?.analysis_data && typeof paRow.analysis_data === "object") {
      const ad = paRow.analysis_data as Record<string, unknown>;
      // analysis_data = { success, player_id, profile: {...dims...}, duration_ms }
      bpaProfile = (ad.profile && typeof ad.profile === "object" ? ad.profile : ad) as Record<string, unknown>;
    }
  }

  // Optional: comparable players
  let comparisons: unknown[] = [];
  if (body.include_comparisons === true) {
    const { data: sim } = await db.from("scout_players").select("id,name,position_primary,tier,current_league,date_of_birth,current_club")
      .eq("position_primary", player.position_primary).eq("tier", player.tier).neq("id", playerId).limit(3);
    comparisons = sim ?? [];
  }

  // Load dimension framework from DB (SSOT)
  let dimFramework = "";
  try {
    const { data: dimText } = await db.rpc("get_dimension_framework_prompt", { p_type: "performance" });
    dimFramework = typeof dimText === "string" ? dimText : "";
  } catch (e) { console.warn("[scout-report] Failed to load dim framework:", e); }

  const systemPrompt = `Du är en världsledande fotbollsscout-analytiker för Vault AI Scout.
Generera en professionell scoutingrapport på SVENSKA. Var specifik, datadriven och beslutsam.
Använd dimensionspoängen (0-10) för att grunda din analys.

${dimFramework || "Dimensionsramverk (DIM-01→DIM-16): Taktisk 22%, Teknisk 27%, Fysisk 18%, Mental 23%, Social 10%."}

Returnera valid JSON med: overview(string), strengths(string[3-5]), weaknesses(string[2-4]),
dimensions([{name,score,comment}] — använd de svenska dimensionsnamnen),
transfer_recommendation({verdict:"SIGN"|"MONITOR"|"PASS",confidence:1-10,reasoning,estimated_value_eur}),
risk_assessment({level:"LOW"|"MEDIUM"|"HIGH",factors:string[]}), development_notes(string).
Allt på svenska.`;

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
${bpaProfile ? `\nBPA Personality Profile:
- Composite Archetype: ${bpaProfile.composite_archetype ?? "N/A"}
- Stress Archetype: ${bpaProfile.stress_archetype ?? "N/A"}
- BPA Dimensions (1-10): ${["decision_tempo","risk_appetite","structure_need","team_orientation","tactical_understanding","ambition_level","career_motivation","ego","resilience","coachability","x_factor"].map((k) => { const d = bpaProfile![k]; return `${k}=${typeof d === "object" && d !== null ? (d as Record<string, unknown>).score ?? "?" : "?"}`;}).join(", ")}
- Contradiction Score (0-1 scale, NOT 1-10): ${(() => { const cs = bpaProfile!.contradiction_score; return typeof cs === "object" && cs !== null ? (cs as Record<string, unknown>).score ?? "?" : "?"; })()}
- Coaching: ${Array.isArray(bpaProfile.coaching_approach) ? (bpaProfile.coaching_approach as string[]).join("; ") : "N/A"}
- Integration Risks: ${Array.isArray(bpaProfile.integration_risks) ? (bpaProfile.integration_risks as string[]).join("; ") : "N/A"}` : ""}
Generate the scouting report JSON.`;

  let report: Record<string, unknown>;
  try { report = parseAiJson(await callClaude(systemPrompt, userPrompt)); }
  catch (e) { return errorResponse(`Report generation failed: ${e}`, corsHeaders, 502); }

  // JSON format — return raw structured data
  if (format === "json") {
    return jsonResponse({
      success: true,
      player: { id: player.id, name: player.name, position_primary: player.position_primary },
      analysis_id: analysis.id, report,
    }, corsHeaders);
  }

  // HTML format — build premium report
  const dims = Array.isArray(report.dimensions) ? report.dimensions : (Array.isArray(report.dimension_scores) ? report.dimension_scores : []);
  const strengths = Array.isArray(report.strengths) ? report.strengths : [];
  const weaknesses = Array.isArray(report.weaknesses) ? report.weaknesses : [];
  const recRaw = report.transfer_recommendation ?? report.recommendation_detail ?? (typeof report.recommendation === "object" && report.recommendation !== null ? report.recommendation : typeof report.recommendation === "string" ? { verdict: report.recommendation } : {});
  const rec = recRaw as Record<string, unknown>;
  const risk = (report.risk_assessment ?? report.risk ?? {}) as Record<string, unknown>;
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
${(() => {
  if (!bpaProfile) return "";
  const ARCH_LABELS: Record<string, string> = {
    MENTALITY_MONSTER: "Mentalitetsmonster", HIGH_PERFORMING_SOLO: "Högpresterande Solist",
    COMPLETE_PROFESSIONAL: "Komplett Proffs", SILENT_LEADER: "Tyst Ledare",
    COACHABLE_RAW_TALENT: "Formbar Råtalang", TOXIC_HIGH_PERFORMER: "Toxisk Stjärna",
    RELIABLE_SOLDIER: "Pålitlig Soldat",
  };
  const archRaw = String(bpaProfile.composite_archetype ?? "");
  const archLabel = ARCH_LABELS[archRaw] ?? archRaw;
  const stressRaw = String(bpaProfile.stress_archetype ?? "");
  const BPA_DIMS = [
    { key: "decision_tempo", label: "Beslutstempo" }, { key: "risk_appetite", label: "Riskvillighet" },
    { key: "structure_need", label: "Strukturbehov" }, { key: "team_orientation", label: "Lagkänsla" },
    { key: "tactical_understanding", label: "Spelförståelse" }, { key: "ambition_level", label: "Ambitionsnivå" },
    { key: "career_motivation", label: "Karriärmotivation" }, { key: "ego", label: "Ego" },
    { key: "resilience", label: "Resiliens" }, { key: "coachability", label: "Träningsbarhet" },
    { key: "x_factor", label: "X-faktor" },
  ];
  const csRaw = bpaProfile.contradiction_score;
  const csVal = typeof csRaw === "object" && csRaw !== null ? Number((csRaw as Record<string, unknown>).score ?? 0) : 0;
  const csPct = Math.round(Math.min(1, Math.max(0, csVal)) * 100);
  const csClass = csPct >= 70 ? "rh" : csPct >= 40 ? "rm" : "rl";
  const coaching = Array.isArray(bpaProfile.coaching_approach) ? bpaProfile.coaching_approach as string[] : [];
  const risks = Array.isArray(bpaProfile.integration_risks) ? bpaProfile.integration_risks as string[] : [];
  return `<div class="card"><div class="ch">BPA — Beteendeprofil</div>
<div style="margin-bottom:14px">
  <span class="b ba" style="font-size:13px;padding:5px 12px">${escapeHtml(archLabel || "Okänd")}</span>
  ${stressRaw ? `<span class="b bg" style="font-size:12px">Stress: ${escapeHtml(stressRaw)}</span>` : ""}
</div>
${BPA_DIMS.map((dim) => {
  const d = bpaProfile![dim.key];
  const score = typeof d === "object" && d !== null ? Number((d as Record<string, unknown>).score ?? 0) : 0;
  const pct = Math.max(0, Math.min(100, score * 10));
  return `<div class="dr"><div class="dl">${escapeHtml(dim.label)}</div><div class="db"><div class="df" style="width:${pct}%"></div></div><div class="ds">${score > 0 ? score.toFixed(1) : "–"}</div></div>`;
}).join("")}
<div class="dr"><div class="dl">Motsägelsefullhet</div><div class="db"><div class="df" style="width:${csPct}%;background:linear-gradient(90deg,#00B894,#EF4444)"></div></div><div class="ds ${csClass}">${csPct}%</div></div>
${coaching.length > 0 ? `<div style="margin-top:14px"><div class="meta" style="margin-bottom:6px;font-weight:600">Coaching-approach</div>${coaching.map((c) => `<div class="si">${escapeHtml(c)}</div>`).join("")}</div>` : ""}
${risks.length > 0 ? `<div style="margin-top:14px"><div class="meta" style="margin-bottom:6px;font-weight:600">Integrationsrisker</div>${risks.map((r) => `<div class="wi">${escapeHtml(r)}</div>`).join("")}</div>` : ""}
</div>`;
})()}
${(() => {
  const advReview = (analysis.analysis_data as Record<string, unknown>)?.advisor_review as Record<string, unknown> | undefined;
  if (!advReview) return "";
  const opinions = Array.isArray(advReview.opinions) ? advReview.opinions as Array<Record<string, unknown>> : [];
  if (opinions.length === 0) return "";
  const consensusText = advReview.consensus ? String(advReview.consensus) : "";
  const VERDICT_CLASS: Record<string, string> = { AGREE: "bgr", CHALLENGE: "bg", FLAG: "br" };
  const VERDICT_LABEL: Record<string, string> = { AGREE: "Godkänd", CHALLENGE: "Invändning", FLAG: "Varning" };
  return `<div class="card"><div class="ch">Sport Advisory Board</div>
${consensusText ? `<div style="margin-bottom:14px;padding:10px 14px;background:#f0f9ff;border-radius:8px;font-size:13px;color:#1e40af">${escapeHtml(consensusText)}</div>` : ""}
${opinions.map((o) => {
  const v = String(o.verdict ?? "CHALLENGE");
  const flags = Array.isArray(o.risk_flags) ? o.risk_flags as string[] : [];
  const recs = Array.isArray(o.recommendations) ? o.recommendations as string[] : [];
  return `<div style="margin-bottom:16px;padding:12px 16px;background:#fafafa;border-radius:8px;border-left:4px solid ${v === "AGREE" ? "#00B894" : v === "FLAG" ? "#EF4444" : "#F59E0B"}">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div style="font-weight:600;font-size:14px">${escapeHtml(o.advisor_name)}</div>
    <span class="b ${VERDICT_CLASS[v] ?? "bg"}" style="font-size:11px">${escapeHtml(VERDICT_LABEL[v] ?? v)}</span>
  </div>
  <div class="meta" style="margin-bottom:4px">${escapeHtml(o.domain)} &bull; Confidence: ${Number(o.confidence ?? 0).toFixed(1)}</div>
  <div style="font-size:13px;color:#374151;margin-bottom:8px">${escapeHtml(o.summary)}</div>
  ${String(o.detail ?? "").length > 0 ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:12px;color:#6B7280">Visa detaljanalys</summary><div style="font-size:12px;color:#4B5563;margin-top:6px;white-space:pre-wrap">${escapeHtml(o.detail)}</div></details>` : ""}
  ${flags.length > 0 ? `<div style="margin-bottom:6px">${flags.map((f: string) => `<div style="font-size:12px;color:#DC2626;padding:2px 0">\u26A0 ${escapeHtml(f)}</div>`).join("")}</div>` : ""}
  ${recs.length > 0 ? `<div>${recs.map((r: string) => `<div style="font-size:12px;color:#059669;padding:2px 0">\u2192 ${escapeHtml(r)}</div>`).join("")}</div>` : ""}
</div>`;
}).join("")}
</div>`;
})()}
${report.development_notes ? `<div class="card"><div class="ch">Development Notes</div><div class="st">${escapeHtml(report.development_notes)}</div></div>` : ""}`;

  return jsonResponse({ success: true, report: wrapHtml(`${player.name} — Scouting Report`, htmlBody) }, corsHeaders);
}

// ---------------------------------------------------------------------------
// Action: compare — comparison report for 2-4 players
// ---------------------------------------------------------------------------
async function handleCompare(body: Record<string, unknown>, corsHeaders: Record<string, string>): Promise<Response> {
  const playerIds = body.player_ids;
  if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 4) {
    return errorResponse("'player_ids' must be an array of 2-4 player IDs", corsHeaders);
  }
  const compType = typeof body.comparison_type === "string" ? body.comparison_type : "head_to_head";
  if (!["head_to_head", "squad_fit", "replacement"].includes(compType)) {
    return errorResponse("Invalid comparison_type. Use: head_to_head, squad_fit, replacement", corsHeaders);
  }
  const db = getSupabaseClient();

  const { data: players, error: pErr } = await db.from("scout_players").select("*").in("id", playerIds);
  if (pErr || !players || players.length < 2) return errorResponse(`Players not found: ${pErr?.message ?? "none"}`, corsHeaders, 404);

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

  // Load compact dimension list from DB (SSOT)
  let compactDims = "";
  try {
    const { data: cText } = await db.rpc("get_dimension_framework_prompt", { p_type: "compact" });
    compactDims = typeof cText === "string" ? cText : "";
  } catch (e) { console.warn("[scout-report] Failed to load compact dims:", e); }

  const compSystemPrompt = `Du är en världsledande fotbollsscout-analytiker för Vault AI Scout.
Generera en ${compType.replace(/_/g, " ")}-jämförelse på SVENSKA. Var specifik, använd dimensionspoäng.
${compactDims || "Dimensioner: DIM-01 till DIM-16 (Taktisk, Teknisk, Fysisk, Mental, Social)."}
Returnera valid JSON: {summary(string), rankings([{player_name,rank,overall_score,rationale}]),
key_differentiators(string[3-5]), recommendation(string),
dimension_comparison([{dimension,scores:{player_name:score}}])}. Allt på svenska.`;

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
    compareData = parseAiJson(await callClaude(compSystemPrompt,
      `Type: ${compType.replace(/_/g, " ")}\n\n${playersCtx}\n\nGenerate comparison JSON.`));
  } catch (e) { return errorResponse(`Comparison failed: ${e}`, corsHeaders, 502); }

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
  }, corsHeaders);
}

// ---------------------------------------------------------------------------
// Action: watchlist_brief — executive summary of active watchlist
// ---------------------------------------------------------------------------
async function handleWatchlistBrief(body: Record<string, unknown>, corsHeaders: Record<string, string>): Promise<Response> {
  const db = getSupabaseClient();
  let query = db.from("scout_watchlist").select("*, scout_players(*)")
    .eq("status", "active")
    .order("deadline", { ascending: true, nullsFirst: false }).limit(20);
  const authUserId = body._userId as string | undefined;
  if (authUserId) query = query.eq("user_id", authUserId);

  const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const { data: rawItems, error: wErr } = await query;
  const items = rawItems ? [...rawItems].sort((a, b) => {
    const pa = PRIORITY_ORDER[String(a.priority ?? "medium").toLowerCase()] ?? 99;
    const pb = PRIORITY_ORDER[String(b.priority ?? "medium").toLowerCase()] ?? 99;
    if (pa !== pb) return pa - pb;
    const da = a.deadline ? new Date(a.deadline as string).getTime() : Infinity;
    const dtB = b.deadline ? new Date(b.deadline as string).getTime() : Infinity;
    return da - dtB;
  }) : rawItems;
  if (wErr) return errorResponse(`Watchlist fetch failed: ${wErr.message}`, corsHeaders, 500);
  if (!items || items.length === 0) {
    return jsonResponse({ success: true, count: 0, brief: "No active watchlist items.", items: [] }, corsHeaders);
  }

  const systemPrompt = `Du är en fotbollsscout-assistent för Vault AI Scout.
Generera en koncis executive watchlist-brief på SVENSKA. Var handlingsorienterad.
Returnera valid JSON: {executive_summary(string), priority_actions(string[3]),
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
  } catch (e) { return errorResponse(`Brief generation failed: ${e}`, corsHeaders, 502); }

  return jsonResponse({ success: true, count: items.length, brief: briefData }, corsHeaders);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", corsHeaders, 405);

  // JWT authentication
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Missing or invalid Authorization header", corsHeaders, 401);
  }

  let userId: string;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return errorResponse("Unauthorized", corsHeaders, 401);
    userId = user.id;
  } catch {
    return errorResponse("Authentication failed", corsHeaders, 401);
  }

  // Rate limit check — after auth + after corsHeaders set (W5)
  const rl = checkRateLimit(userId);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 10 report requests per 15 minutes.", retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec) } }
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", corsHeaders); }
  body._userId = userId;

  const action = body.action;
  if (!action || typeof action !== "string") {
    return errorResponse("Missing 'action'. Valid: generate, compare, watchlist_brief", corsHeaders);
  }

  try {
    switch (action) {
      case "generate": return await handleGenerate(body, corsHeaders);
      case "compare": return await handleCompare(body, corsHeaders);
      case "watchlist_brief": return await handleWatchlistBrief(body, corsHeaders);
      default: return errorResponse(`Unknown action '${action}'. Valid: generate, compare, watchlist_brief`, corsHeaders);
    }
  } catch (e) {
    console.error(`Unhandled error [${action}]:`, e);
    return errorResponse("Internal error", corsHeaders, 500);
  }
});
