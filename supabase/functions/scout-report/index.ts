import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { createRateLimiter, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { callAnthropic, MODELS, type ModelId } from "../_shared/anthropic-client.ts";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory per isolate (Deno Deploy)
// Key: userId | Window: 15 min | Max: 10 requests
// ---------------------------------------------------------------------------
const rateLimiter = createRateLimiter(10);

function jsonResponse(data: unknown, corsHeaders: Record<string, string>, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra } });
}
function errorResponse(msg: string, corsHeaders: Record<string, string>, status = 400, extra: Record<string, string> = {}): Response {
  return jsonResponse({ error: msg }, corsHeaders, status, extra);
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function e(str: unknown): string {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const escapeHtml = e;

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

// ---------------------------------------------------------------------------
// Claude API — thin wrapper over shared callAnthropic() (VCE09 F4: timeoutMs preserved)
// ---------------------------------------------------------------------------
async function callClaude(
  system: string, user: string,
  opts: { model?: string; maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const result = await callAnthropic({
    model: (opts.model as ModelId | undefined) ?? MODELS.sonnet,
    max_tokens: opts.maxTokens ?? 4096,
    system,
    messages: [{ role: "user", content: user }],
    timeoutMs: opts.timeoutMs ?? 45000,
  });
  return result.text;
}

function parseAiJson(raw: string): Record<string, unknown> {
  // Try direct parse first (cleanest path)
  try { return JSON.parse(raw.trim()); } catch { /* fallback to regex */ }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned invalid format");
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------------
// Vault Scout Report — Design System CSS (Pitch Deck Gold Standard)
// ---------------------------------------------------------------------------
const VAULT_REPORT_CSS = `
:root{
  --navy:#0B1D33;--navy-deep:#060D18;--navy-mid:#1E3A5F;--navy-light:#2D4A6F;
  --accent:#00d4aa;--accent-light:#33e0be;
  --gold:#FDCB6E;--green:#00B894;--red:#E17055;--orange:#F39C12;
  --purple:#6C5CE7;--purple-light:#A29BFE;
  --bg:#F8F9FC;--text:#1a1a2e;--text-light:#6b7280;
  --slide-w:1280px;--slide-h:720px
}
*{margin:0;padding:0;box-sizing:border-box}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300..900&display=swap');
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#e5e5e5;color:var(--text);
  line-height:1.6;-webkit-font-smoothing:antialiased;padding:40px 20px}

/* 16:9 Slide System — matches Vault Pitch Deck */
.slide{width:var(--slide-w);height:var(--slide-h);margin:20px auto;position:relative;
  overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.15);page-break-after:always}
.slide-content{padding:60px 80px;height:100%;display:flex;flex-direction:column;position:relative}

.dark-slide{background:linear-gradient(160deg,var(--navy) 0%,var(--navy-deep) 100%);color:#fff}
.light-slide{background:#ffffff;color:var(--text)}
.accent-slide{background:linear-gradient(160deg,var(--navy) 0%,rgba(0,212,170,.06) 100%);color:#fff}

/* Typography — Pitch Deck hierarchy */
.section-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;margin-bottom:8px;display:inline-block}
.dark-slide .section-tag,.accent-slide .section-tag{color:var(--accent-light)}
.light-slide .section-tag{color:var(--accent)}
.slide-title{font-size:38px;font-weight:800;line-height:1.15;margin-bottom:8px;letter-spacing:-.02em}
.dark-slide .slide-title,.accent-slide .slide-title{color:#fff}
.light-slide .slide-title{color:var(--text)}
.slide-subtitle{font-size:18px;font-weight:400;margin-bottom:24px}
.dark-slide .slide-subtitle,.accent-slide .slide-subtitle{color:rgba(255,255,255,.7)}
.light-slide .slide-subtitle{color:var(--text-light)}
h2{font-size:20px;font-weight:700;margin-bottom:14px}
.dark-slide h2,.accent-slide h2{color:var(--gold)}
.light-slide h2{color:var(--text)}
h3{font-size:15px;font-weight:600;margin-bottom:8px}
.dark-slide h3,.accent-slide h3{color:rgba(255,255,255,.9)}
.light-slide h3{color:var(--text)}
.text{font-size:14px;line-height:1.85}
.dark-slide .text,.accent-slide .text{color:rgba(255,255,255,.85)}
.light-slide .text{color:var(--text-light)}

/* Footer — pushed to bottom via flex */
.slide-footer{margin-top:auto;padding-top:16px;border-top:1px solid rgba(0,0,0,.08);
  display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.04em}
.dark-slide .slide-footer,.accent-slide .slide-footer{border-top-color:rgba(255,255,255,.15);color:rgba(255,255,255,.25)}
.light-slide .slide-footer{color:rgba(0,0,0,.3)}
.sf-brand{font-weight:600}
.dark-slide .sf-brand,.accent-slide .sf-brand{color:rgba(0,212,170,.5)}
.light-slide .sf-brand{color:var(--accent)}
.slide-num{position:absolute;bottom:24px;right:32px;font-size:11px;font-weight:500;opacity:.35}

/* Badges */
.badge{display:inline-block;padding:5px 14px;border-radius:8px;font-size:12px;font-weight:700;margin-right:8px;margin-bottom:4px}
.b-sign{background:rgba(0,184,148,.12);color:var(--green);border:1px solid rgba(0,184,148,.3)}
.b-monitor{background:rgba(253,203,110,.12);color:var(--gold);border:1px solid rgba(253,203,110,.3)}
.b-pass{background:rgba(225,112,85,.12);color:var(--red);border:1px solid rgba(225,112,85,.3)}
.b-info{background:rgba(108,92,231,.1);color:var(--purple-light);border:1px solid rgba(108,92,231,.2)}
.b-gold{background:rgba(253,203,110,.1);color:var(--gold);border:1px solid rgba(253,203,110,.2)}

/* Stat boxes */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-top:16px}
.stat{text-align:center;padding:18px 14px;border-radius:12px}
.dark-slide .stat,.accent-slide .stat{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.light-slide .stat{background:var(--bg);border:1px solid rgba(0,0,0,.06)}
.stat-val{font-size:42px;font-weight:900}
.dark-slide .stat-val,.accent-slide .stat-val{color:var(--gold)}
.light-slide .stat-val{color:var(--accent)}
.stat-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-top:6px}
.dark-slide .stat-lbl,.accent-slide .stat-lbl{color:rgba(255,255,255,.4)}
.light-slide .stat-lbl{color:var(--text-light)}

/* Dimension bars */
.dim-group{margin-bottom:16px}
.dim-group-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;
  padding-bottom:6px;border-bottom:1px solid rgba(0,0,0,.06)}
.dark-slide .dim-group-hdr{border-bottom-color:rgba(255,255,255,.06)}
.dim-group-label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.dim-group-weight{font-size:11px}
.dark-slide .dim-group-weight{color:rgba(255,255,255,.35)}
.light-slide .dim-group-weight{color:var(--text-light)}
.dim-row{display:flex;align-items:center;padding:5px 0}
.dim-name{width:200px;font-size:13px}
.dark-slide .dim-name{color:rgba(255,255,255,.75)}
.light-slide .dim-name{color:var(--text)}
.dim-bar{flex:1;height:8px;border-radius:4px;margin:0 12px;overflow:hidden}
.dark-slide .dim-bar{background:rgba(255,255,255,.06)}
.light-slide .dim-bar{background:rgba(0,0,0,.06)}
.dim-fill{height:100%;border-radius:4px;transition:width .3s ease}
.dim-score{width:36px;text-align:right;font-size:13px;font-weight:600}

/* Cards */
.card-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{padding:20px;border-radius:12px;transition:border-color .2s}
.dark-slide .card,.accent-slide .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
.light-slide .card{background:var(--bg);border:1px solid rgba(0,0,0,.06)}
.card-title{font-size:14px;font-weight:700;margin-bottom:8px}
.card-text{font-size:13px;line-height:1.75}
.dark-slide .card-text,.accent-slide .card-text{color:rgba(255,255,255,.7)}
.light-slide .card-text{color:var(--text-light)}

/* Timeline */
.timeline{position:relative;padding-left:28px}
.timeline::before{content:'';position:absolute;left:8px;top:4px;bottom:4px;width:2px;
  background:linear-gradient(180deg,var(--accent),rgba(0,212,170,.15))}
.tl-item{position:relative;margin-bottom:18px}
.tl-item::before{content:'';position:absolute;left:-23px;top:6px;width:12px;height:12px;
  border-radius:50%;background:var(--accent);border:2px solid var(--navy);box-shadow:0 0 8px rgba(0,212,170,.3)}
.tl-title{font-size:14px;font-weight:700;margin-bottom:4px}
.tl-text{font-size:13px;line-height:1.7}
.dark-slide .tl-text{color:rgba(255,255,255,.7)}
.light-slide .tl-text{color:var(--text-light)}

/* Risk steps */
.risk-step{display:flex;align-items:flex-start;gap:16px;margin-bottom:14px}
.risk-num{width:28px;height:28px;border-radius:50%;background:rgba(225,112,85,.12);color:var(--red);
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}

/* Triggers */
.trigger-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.trigger-col h3{margin-bottom:12px}
.trigger-item{font-size:13px;padding:7px 0}
.dark-slide .trigger-item{color:rgba(255,255,255,.75);border-bottom:1px solid rgba(255,255,255,.04)}
.light-slide .trigger-item{color:var(--text-light);border-bottom:1px solid rgba(0,0,0,.06)}

/* Coaching */
.coach-step{display:flex;gap:16px;margin-bottom:16px}
.coach-num{width:32px;height:32px;border-radius:10px;background:rgba(0,212,170,.12);color:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0}

/* Advisor cards */
.advisor-card{padding:18px;border-radius:12px;border-left:4px solid var(--gold);margin-bottom:14px}
.dark-slide .advisor-card,.accent-slide .advisor-card{background:rgba(255,255,255,.03)}
.light-slide .advisor-card{background:var(--bg)}
.advisor-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.advisor-name{font-size:15px;font-weight:600}
.advisor-domain{font-size:11px}
.dark-slide .advisor-domain{color:rgba(255,255,255,.4)}
.light-slide .advisor-domain{color:var(--text-light)}

/* Compatibility */
.compat-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.compat-item{padding:18px;border-radius:12px}
.dark-slide .compat-item,.accent-slide .compat-item{background:rgba(0,212,170,.04);border:1px solid rgba(0,212,170,.12)}
.light-slide .compat-item{background:var(--bg);border:1px solid rgba(0,212,170,.12)}
.compat-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);font-weight:700;margin-bottom:8px}
.compat-text{font-size:13px;line-height:1.7}
.dark-slide .compat-text,.accent-slide .compat-text{color:rgba(255,255,255,.8)}
.light-slide .compat-text{color:var(--text-light)}

/* Contradiction Score */
.cs-meter{display:flex;align-items:center;gap:12px;margin-top:16px;padding:14px 18px;border-radius:12px}
.dark-slide .cs-meter{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05)}
.light-slide .cs-meter{background:var(--bg);border:1px solid rgba(0,0,0,.06)}
.cs-bar{flex:1;height:8px;border-radius:4px;overflow:hidden}
.dark-slide .cs-bar{background:rgba(255,255,255,.06)}
.light-slide .cs-bar{background:rgba(0,0,0,.06)}
.cs-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--green),var(--gold),var(--red))}
.cs-val{font-size:15px;font-weight:700;min-width:40px;text-align:right}

/* Cover */
.cover-rec{margin-top:auto;padding:20px 24px;border-radius:14px}
.dark-slide .cover-rec{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
.light-slide .cover-rec{border:1px solid rgba(0,0,0,.08);background:var(--bg)}

/* Meta */
.meta-row{display:flex;justify-content:space-between;padding:10px 0;font-size:13px}
.dark-slide .meta-row{border-bottom:1px solid rgba(255,255,255,.04)}
.light-slide .meta-row{border-bottom:1px solid rgba(0,0,0,.06)}
.dark-slide .meta-label{color:rgba(255,255,255,.45)}
.light-slide .meta-label{color:var(--text-light)}
.dark-slide .meta-value{color:rgba(255,255,255,.9);font-weight:500}
.light-slide .meta-value{color:var(--text);font-weight:500}

.slide-divider{width:60px;height:3px;background:linear-gradient(90deg,var(--accent),var(--gold));border-radius:2px;margin:12px 0 20px}
.watermark{text-align:center;padding:32px 0;color:rgba(0,0,0,.25);font-size:11px;letter-spacing:.08em}

/* Responsive — fluid fallback below 1320px */
@media(max-width:1320px){
  .slide{width:100%;height:auto;min-height:600px}
  .slide-content{padding:40px 48px}
}
@media(max-width:640px){
  .slide-content{padding:24px 24px}
  .card-grid,.trigger-grid,.compat-grid{grid-template-columns:1fr}
  .dim-name{width:120px;font-size:12px}
  .slide-title{font-size:28px}
  .stat-val{font-size:32px}
  .stats-grid{grid-template-columns:repeat(auto-fit,minmax(100px,1fr))}
}

/* Print — proper 16:9 page breaks */
@media print{
  @page{size:1280px 720px;margin:0}
  body{background:#fff;padding:0}
  .slide{width:1280px;height:720px;margin:0;box-shadow:none;page-break-after:always;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .dark-slide,.accent-slide{background:var(--navy)!important;color:#fff!important}
  .light-slide{background:#fff!important}
  .watermark{display:none}
  .card,.risk-step,.coach-step,.trigger-item,.compat-item{page-break-inside:avoid}
}`;

// ---------------------------------------------------------------------------
// SVG Generators
// ---------------------------------------------------------------------------
function generateRadarSvg(data: { axis: string; value: number }[]): string {
  const cx = 160, cy = 160, r = 120, n = data.length;
  if (n < 3) return "";
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const point = (i: number, scale: number) => {
    const a = startAngle + i * angleStep;
    return { x: cx + scale * r * Math.cos(a), y: cy + scale * r * Math.sin(a) };
  };

  // Grid polygons
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const grids = gridLevels.map(lv => {
    const pts = Array.from({ length: n }, (_, i) => point(i, lv));
    return `<polygon points="${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
  }).join("");

  // Axis lines + labels
  const axes = data.map((d, i) => {
    const p = point(i, 1.0);
    const lp = point(i, 1.22);
    const anchor = lp.x < cx - 10 ? "end" : lp.x > cx + 10 ? "start" : "middle";
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="rgba(255,255,255,.6)" font-family="Inter,sans-serif">${escapeHtml(d.axis)}</text>`;
  }).join("");

  // Data polygon
  const dataPts = data.map((d, i) => point(i, Math.max(0, Math.min(1, d.value / 10))));
  const dataPath = `<polygon points="${dataPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="rgba(0,184,148,.18)" stroke="#00B894" stroke-width="2"/>`;

  // Data points
  const dots = dataPts.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#00B894"/>`
  ).join("");

  return `<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:320px;display:block;margin:0 auto">${grids}${axes}${dataPath}${dots}</svg>`;
}

function generateScoreCircleSvg(score: number, max = 10): string {
  const pct = Math.max(0, Math.min(1, score / max));
  const r = 54, circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const color = score >= 7 ? "#00B894" : score >= 4 ? "#FDCB6E" : "#E17055";
  return `<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" style="width:140px;height:140px">
<circle cx="70" cy="70" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="8"/>
<circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
  stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 70 70)"/>
<text x="70" y="65" text-anchor="middle" font-size="32" font-weight="800" fill="${color}" font-family="Inter,sans-serif">${score.toFixed(1)}</text>
<text x="70" y="82" text-anchor="middle" font-size="11" fill="rgba(255,255,255,.4)" font-family="Inter,sans-serif">/ ${max}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DIM_GROUPS: { key: string; label: string; weight: string; dims: string[] }[] = [
  { key: "tactical", label: "Taktisk", weight: "22%", dims: ["DIM-01", "DIM-02", "DIM-03"] },
  { key: "technical", label: "Teknisk", weight: "27%", dims: ["DIM-04", "DIM-05", "DIM-06", "DIM-07"] },
  { key: "physical", label: "Fysisk", weight: "18%", dims: ["DIM-08", "DIM-09", "DIM-10"] },
  { key: "mental", label: "Mental", weight: "23%", dims: ["DIM-11", "DIM-12", "DIM-15", "DIM-16"] },
  { key: "social", label: "Social/Kontext", weight: "10%", dims: ["DIM-13", "DIM-14"] },
];

const BPA_KEYS = [
  { key: "decision_tempo", label: "Beslutstempo" }, { key: "risk_appetite", label: "Riskvillighet" },
  { key: "structure_need", label: "Strukturbehov" }, { key: "team_orientation", label: "Lagkänsla" },
  { key: "tactical_understanding", label: "Spelförståelse" }, { key: "ambition_level", label: "Ambitionsnivå" },
  { key: "career_motivation", label: "Karriärmotivation" }, { key: "ego", label: "Ego" },
  { key: "resilience", label: "Resiliens" }, { key: "coachability", label: "Träningsbarhet" },
  { key: "x_factor", label: "X-faktor" }, { key: "contradiction_score", label: "Motsägelse" },
];

const RADAR_KEYS = ["decision_tempo", "risk_appetite", "structure_need", "team_orientation", "ambition_level", "ego", "resilience"];

const ARCH_LABELS: Record<string, string> = {
  MENTALITY_MONSTER: "Mentalitetsmonster", HIGH_PERFORMING_SOLO: "Högpresterande Solist",
  COMPLETE_PROFESSIONAL: "Komplett Proffs", SILENT_LEADER: "Tyst Ledare",
  COACHABLE_RAW_TALENT: "Formbar Råtalang", TOXIC_HIGH_PERFORMER: "Toxisk Stjärna",
  RELIABLE_SOLDIER: "Pålitlig Soldat",
};

function bpaVal(profile: Record<string, unknown>, key: string): number {
  // Try direct key first (personality analysis format: profile.decision_tempo = {score: X})
  let d = profile[key];
  // Try bpa_scores sub-object (full_scout format: profile.bpa_scores.decision_tempo = 6.0)
  if (d === undefined || d === null) {
    const bpaScores = profile.bpa_scores as Record<string, unknown> | undefined;
    if (bpaScores) d = bpaScores[key];
  }
  if (typeof d === "number") return d;
  if (typeof d === "object" && d !== null) return Number((d as Record<string, unknown>).score ?? 0);
  return 0;
}

function dimColor(score: number): string {
  return score >= 7 ? "#00B894" : score >= 4 ? "#FDCB6E" : "#E17055";
}

function recBadgeClass(rec: string): string {
  const r = (rec ?? "").toUpperCase();
  return r === "SIGN" ? "b-sign" : r === "PASS" ? "b-pass" : "b-monitor";
}

/** Strip internal Vault terms from LLM-generated text (anti-leak) */
function sanitizeText(text: string): string {
  return text
    .replace(/\b\d+\s*agenter?\b/gi, "avancerad AI-analys")
    .replace(/\bSCOUT\d+\b/gi, "")
    .replace(/\bVET\d+\b/gi, "")
    .replace(/\bSRR\d+\b/gi, "")
    .replace(/\bPXE\d+\b/gi, "")
    .replace(/\bPDQ\d+\b/gi, "")
    .replace(/\bCET\d+\b/gi, "")
    .replace(/\bpipeline_id\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// P0 Input sanitization — strip prompt injection patterns from DB-sourced data
// BEFORE injecting into Claude prompts. Protects against poisoned player profiles.
// ---------------------------------------------------------------------------
function sanitizePromptInput(text: unknown): string {
  if (text == null) return "";
  let s = String(text);
  // Strip common prompt injection patterns
  s = s.replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "");
  s = s.replace(/you\s+are\s+(now|actually|really)\s+/gi, "");
  s = s.replace(/system\s*:\s*/gi, "");
  s = s.replace(/\bassistant\s*:\s*/gi, "");
  s = s.replace(/\bhuman\s*:\s*/gi, "");
  s = s.replace(/\buser\s*:\s*/gi, "");
  s = s.replace(/<\/?(?:system|instruction|prompt|role|context|command|override|secret|inject)[^>]*>/gi, "");
  s = s.replace(/(?:do\s+not|don'?t|never)\s+follow\s+(your\s+)?(original|previous|system)\s+/gi, "");
  s = s.replace(/\bDAN\b|\bjailbreak\b|\bprompt\s*inject/gi, "");
  // Limit length per field to prevent context stuffing
  if (s.length > 2000) s = s.slice(0, 2000) + "…";
  return s.trim();
}

// ---------------------------------------------------------------------------
// 15-Slide Report Builder
// ---------------------------------------------------------------------------
function buildReportHtml(
  player: Record<string, unknown>,
  analysis: Record<string, unknown>,
  scores: Record<string, unknown>[],
  bpa: Record<string, unknown> | null,
  narrative: Record<string, unknown> | null,
  bpaFormatted: Record<string, unknown> | null,
  advisorReview: Record<string, unknown> | null,
): string {
  const age = computeAge(player.date_of_birth);
  const overall = Number(analysis.overall_score ?? 0);
  const confidence = Number(analysis.confidence ?? 0);
  const rec = String(analysis.recommendation ?? "MONITOR");
  // Sanitize summary — strip internal agent/pipeline details (business secrets)
  const rawSummary = String(analysis.summary ?? "");
  const summary = rawSummary.replace(/\s*—?\s*\d+\s*agenter.*$/i, "").replace(/\s*VET\d+\s*\w+/gi, "").replace(/\s*SCOUT\d+/gi, "").trim();

  // Score map for dimension lookup
  const scoreMap = new Map<string, { name: string; score: number }>();
  for (const s of scores) {
    scoreMap.set(String(s.dimension_id), { name: String(s.dimension_name ?? s.dimension_id), score: Number(s.score ?? 0) });
  }

  // === SLIDE 1: COVER (dark) ===
  const slide1 = `<section class="slide slide-dark" id="s1">
<div class="slide-tag">Vault AI Scout Report</div>
<h1>${e(player.name)}</h1>
<div class="sub" style="margin:8px 0 16px">${e(player.position_primary)} &bull; ${e(player.current_club)} &bull; ${e(player.current_league)}</div>
<div style="margin-bottom:16px">
  <span class="badge b-info">${e(player.nationality)}</span>
  <span class="badge b-gold">${age ? `${age} \u00e5r` : "Okänd ålder"}</span>
  <span class="badge b-info">${e(player.tier)}</span>
  <span class="badge b-gold">${e(player.career_phase)}</span>
  <span class="badge ${recBadgeClass(rec)}" style="font-size:14px;padding:6px 18px">${e(rec)}</span>
</div>
<div class="cover-rec">
  <div style="display:flex;align-items:center;gap:16px">
    ${generateScoreCircleSvg(overall)}
    <div>
      <div style="font-size:16px;font-weight:700;margin-bottom:4px">Overall Score: ${overall.toFixed(1)}/10</div>
      <div style="font-size:13px;color:rgba(255,255,255,.5)">Confidence: ${(confidence * 100).toFixed(0)}%</div>
      <div class="text" style="margin-top:8px">${e(summary).substring(0, 200)}${summary.length > 200 ? "..." : ""}</div>
    </div>
  </div>
</div>
</section>`;

  // === SLIDE 2: FIRST IMPRESSION (light) ===
  const firstImpression = narrative?.first_impression ?? summary;
  const slide2 = `<section class="slide slide-light" id="s2">
<div class="slide-tag">Första Intrycket</div>
<div class="text" style="font-size:15px;line-height:1.9">${e(firstImpression)}</div>
</section>`;

  // === SLIDE 3: PLAYER PROFILE (dark) ===
  const initials = String(player.name ?? "").split(" ").map(w => (w[0] ?? "").toUpperCase()).join("").substring(0, 2);
  const strengths = Array.isArray(analysis.strengths) ? analysis.strengths as string[] : [];
  const weaknesses = Array.isArray(analysis.weaknesses) ? analysis.weaknesses as string[] : [];
  const marketValue = player.market_value_eur ? `€${(Number(player.market_value_eur) / 1e6).toFixed(1)}M` : "Okänt";
  const contractEnd = player.contract_expires ? String(player.contract_expires).substring(0, 10) : "Okänt";
  const slide3 = `<section class="slide slide-dark" id="s3">
<div class="slide-tag">Spelarprofil</div>
<div style="display:flex;align-items:center;gap:20px;margin-bottom:20px">
  <div style="width:64px;height:64px;border-radius:50%;background:rgba(0,184,148,.15);border:2px solid #00B894;
    display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#00B894;flex-shrink:0">${e(initials)}</div>
  <div>
    <h2 style="color:#e8edf5;margin-bottom:2px">${e(player.name)}</h2>
    <div class="sub">${e(player.position_primary)} &bull; ${e(player.current_club)} &bull; ${e(player.current_league)}</div>
  </div>
</div>
<div class="stats-grid">
  <div class="stat"><div class="stat-val">${overall.toFixed(1)}</div><div class="stat-lbl">Overall</div></div>
  <div class="stat"><div class="stat-val">${e(marketValue)}</div><div class="stat-lbl">Marknadsvärde</div></div>
  <div class="stat"><div class="stat-val">${age ?? "?"}</div><div class="stat-lbl">Ålder</div></div>
  <div class="stat"><div class="stat-val">${(confidence * 100).toFixed(0)}%</div><div class="stat-lbl">Confidence</div></div>
  <div class="stat"><div class="stat-val">${e(contractEnd)}</div><div class="stat-lbl">Kontrakt</div></div>
</div>
</section>`;

  // === SLIDE 4: OVERALL SCORE ===
  const recReasoning = typeof analysis.analysis_data === "object" && analysis.analysis_data !== null
    ? String((analysis.analysis_data as Record<string, unknown>).recommendation_reasoning ?? summary)
    : summary;
  const slide4 = `<section class="slide slide-accent" id="s4">
<div class="slide-tag">Overall Score</div>
<div style="text-align:center;margin-bottom:24px">
  ${generateScoreCircleSvg(overall)}
  <div style="margin-top:12px">
    <span class="badge ${recBadgeClass(rec)}" style="font-size:16px;padding:8px 24px">${e(rec)}</span>
  </div>
  <div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,.4)">Confidence: ${(confidence * 100).toFixed(0)}%</div>
</div>
<div class="text" style="text-align:center;max-width:600px;margin:0 auto">${e(recReasoning).substring(0, 400)}</div>
<div style="display:flex;gap:16px;margin-top:20px">
  <div style="flex:1">
    <h3 style="color:#00B894">Styrkor</h3>
    ${strengths.map(s => `<div style="padding:4px 0;font-size:13px;color:rgba(255,255,255,.75)">✓ ${e(s)}</div>`).join("")}
  </div>
  <div style="flex:1">
    <h3 style="color:#E17055">Svagheter</h3>
    ${weaknesses.map(w => `<div style="padding:4px 0;font-size:13px;color:rgba(255,255,255,.75)">⚠ ${e(w)}</div>`).join("")}
  </div>
</div>
</section>`;

  // === SLIDE 5: 16 DIMENSIONS ===
  const dimGroupsHtml = DIM_GROUPS.map(g => {
    const rows = g.dims.map(dimId => {
      const d = scoreMap.get(dimId);
      if (!d) return "";
      const pct = Math.max(0, Math.min(100, d.score * 10));
      return `<div class="dim-row"><div class="dim-name">${e(d.name)}</div><div class="dim-bar"><div class="dim-fill" style="width:${pct}%;background:${dimColor(d.score)}"></div></div><div class="dim-score" style="color:${dimColor(d.score)}">${d.score.toFixed(1)}</div></div>`;
    }).join("");
    return `<div class="dim-group"><div class="dim-group-hdr"><span class="dim-group-label">${e(g.label)}</span><span class="dim-group-weight">${e(g.weight)}</span></div>${rows}</div>`;
  }).join("");

  const slide5 = `<section class="slide slide-light" id="s5">
<div class="slide-tag">16 Dimensioner</div>
<h2 style="margin-bottom:20px">Dimensionsanalys</h2>
${dimGroupsHtml}
</section>`;

  // === SLIDE 6: BPA RADAR ===
  let slide6 = "";
  if (bpa) {
    const radarData = RADAR_KEYS.map(k => {
      const lbl = BPA_KEYS.find(b => b.key === k)?.label ?? k;
      return { axis: lbl, value: bpaVal(bpa, k) };
    });

    const archRaw = String(bpa.composite_archetype ?? "");
    const archLabel = ARCH_LABELS[archRaw] ?? archRaw;
    const stressArch = String(bpa.stress_archetype ?? "");

    const csRaw = bpa.contradiction_score ?? (bpa.bpa_scores as Record<string, unknown> | undefined)?.contradiction_score ?? 0;
    const csVal = typeof csRaw === "number" ? csRaw : (typeof csRaw === "object" && csRaw !== null ? Number((csRaw as Record<string, unknown>).score ?? 0) : 0);
    const csPct = Math.round(Math.min(1, Math.max(0, csVal)) * 100);
    const csColor = csPct >= 70 ? "#E17055" : csPct >= 40 ? "#FDCB6E" : "#00B894";

    const bpaBarsHtml = BPA_KEYS.map(dim => {
      const score = bpaVal(bpa, dim.key);
      const pct = Math.max(0, Math.min(100, score * 10));
      return `<div class="dim-row"><div class="dim-name">${e(dim.label)}</div><div class="dim-bar"><div class="dim-fill" style="width:${pct}%;background:${dimColor(score)}"></div></div><div class="dim-score" style="color:${dimColor(score)}">${score > 0 ? score.toFixed(1) : "–"}</div></div>`;
    }).join("");

    slide6 = `<section class="slide slide-dark" id="s6">
<div class="slide-tag">Beteendeprofil (BPA)</div>
<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
  <span class="badge b-info" style="font-size:13px;padding:6px 16px">${e(archLabel || "Okänd arketyp")}</span>
  ${stressArch ? `<span class="badge b-gold">Stress: ${e(stressArch)}</span>` : ""}
</div>
<div style="margin-bottom:24px">${generateRadarSvg(radarData)}</div>
<h3 style="margin-bottom:12px">Alla BPA-dimensioner (12)</h3>
${bpaBarsHtml}
<div class="cs-meter" style="margin-top:16px">
  <span style="font-size:12px;color:rgba(255,255,255,.5);min-width:130px">Contradiction Score</span>
  <div class="cs-bar"><div class="cs-fill" style="width:${csPct}%"></div></div>
  <span class="cs-val" style="color:${csColor}">${csPct}%</span>
</div>
</section>`;
  }

  // === SLIDE 7: PSYCHOLOGY CARDS ===
  let slide7 = "";
  if (bpaFormatted) {
    const cards = Array.isArray(bpaFormatted.psychology_cards) ? bpaFormatted.psychology_cards as Record<string, unknown>[] : [];
    if (cards.length > 0) {
      const CARD_ACCENTS = ["#00B894", "#FDCB6E", "#A29BFE", "#F39C12"];
      slide7 = `<section class="slide slide-dark" id="s7">
<div class="slide-tag">Karaktär &amp; Psykologi</div>
<div class="card-grid">
${cards.map((c, i) => {
  const scores = c.scores as Record<string, string> | undefined;
  const scoreHtml = scores ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;gap:12px;flex-wrap:wrap">${
    Object.entries(scores).map(([, v]) => `<span style="font-size:11px;color:${CARD_ACCENTS[i % 4]};opacity:.85">${e(v)}</span>`).join("")
  }</div>` : "";
  return `<div class="card" style="border-left:3px solid ${CARD_ACCENTS[i % 4]}">
  <div class="card-title" style="color:${CARD_ACCENTS[i % 4]}">${e(c.title)}</div>
  <div class="card-text">${e(c.content)}</div>
  ${scoreHtml}
</div>`;
}).join("")}
</div>
</section>`;
    }
  }

  // === SLIDE 8: STRESS RESPONSE ===
  let slide8 = "";
  if (bpaFormatted) {
    const stressItems = Array.isArray(bpaFormatted.stress_response) ? bpaFormatted.stress_response as Record<string, unknown>[] : [];
    if (stressItems.length > 0) {
      slide8 = `<section class="slide slide-light" id="s8">
<div class="slide-tag">Stressrespons</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">
${stressItems.map(s => `<div class="card">
  <h3>${e(s.title)}</h3>
  <div class="card-text">${e(s.content)}</div>
</div>`).join("")}
</div>
</section>`;
    }
  }

  // === SLIDE 9: RISK ANALYSIS ===
  let slide9 = "";
  if (bpaFormatted) {
    const rf = bpaFormatted.risk_flow as Record<string, unknown> | undefined;
    const steps = rf && Array.isArray(rf.steps) ? rf.steps as Record<string, unknown>[] : [];
    const caseStudy = rf ? String(rf.case_study ?? "") : "";
    const warningChain = rf ? String(rf.warning_chain ?? "") : "";
    const bigQuestion = rf ? String(rf.big_question ?? "") : "";
    if (steps.length > 0) {
      slide9 = `<section class="slide slide-light" id="s9">
<div class="slide-tag">Riskanalys — Kill Chain</div>
<h2 style="margin-bottom:16px">Vad bryter spelaren?</h2>
${warningChain ? `<div style="background:#fef3c7;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#92400e;font-weight:500;letter-spacing:.02em">${e(warningChain)}</div>` : ""}
${steps.map(s => `<div class="risk-step">
  <div class="risk-num">${e(s.step)}</div>
  <div><div style="font-size:14px;font-weight:600;margin-bottom:2px">${e(s.title)}</div>
  <div class="card-text">${e(s.description ?? s.desc)}</div></div>
</div>`).join("")}
${bigQuestion ? `<div style="margin-top:16px;background:linear-gradient(135deg,#0B1D33,#1a3a5c);border-radius:8px;padding:16px 20px;color:#fff"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#FDCB6E;margin-bottom:6px">Den stora frågan</div><div style="font-size:15px;font-weight:500;line-height:1.5">${e(bigQuestion)}</div></div>` : ""}
${caseStudy ? `<div class="card" style="margin-top:12px;border-left:3px solid #ef4444"><div class="card-title" style="color:#ef4444">Case Study</div><div class="card-text">${e(caseStudy)}</div></div>` : ""}
</section>`;
    }
  } else {
    // Fallback: use risk factors from analysis
    const riskFactors = Array.isArray(analysis.risk_factors) ? analysis.risk_factors as string[] : [];
    if (riskFactors.length > 0) {
      slide9 = `<section class="slide slide-light" id="s9">
<div class="slide-tag">Riskanalys</div>
${riskFactors.map((f, i) => `<div class="risk-step"><div class="risk-num">${i + 1}</div><div class="card-text">${e(f)}</div></div>`).join("")}
</section>`;
    }
  }

  // === SLIDE 10: TRIGGERS ===
  let slide10 = "";
  if (bpaFormatted) {
    const triggers = bpaFormatted.triggers as Record<string, unknown> | undefined;
    const best = triggers && Array.isArray(triggers.activates_best ?? triggers.best) ? (triggers.activates_best ?? triggers.best) as string[] : [];
    const worst = triggers && Array.isArray(triggers.activates_worst ?? triggers.worst) ? (triggers.activates_worst ?? triggers.worst) as string[] : [];
    if (best.length > 0 || worst.length > 0) {
      slide10 = `<section class="slide slide-dark" id="s10">
<div class="slide-tag">Beteendetriggers</div>
<div class="trigger-grid">
  <div class="trigger-col"><h3 style="color:#00B894">Aktiverar bästa</h3>
    ${best.map(b => `<div class="trigger-item">✓ ${e(b)}</div>`).join("")}
  </div>
  <div class="trigger-col"><h3 style="color:#E17055">Aktiverar sämsta</h3>
    ${worst.map(w => `<div class="trigger-item">⚠ ${e(w)}</div>`).join("")}
  </div>
</div>
</section>`;
    }
  }

  // === SLIDE 11: CAREER ANALYSIS ===
  let slide11 = "";
  if (narrative) {
    const chapters = Array.isArray(narrative.career_chapters) ? narrative.career_chapters as Record<string, unknown>[] : [];
    if (chapters.length > 0) {
      slide11 = `<section class="slide slide-light" id="s11">
<div class="slide-tag">Karriäranalys</div>
<div class="timeline">
${chapters.map(ch => `<div class="tl-item"><div class="tl-title">${e(ch.title)}</div><div class="tl-text">${e(ch.content)}</div></div>`).join("")}
</div>
${narrative.player_summary ? `<div class="text" style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06)">${e(narrative.player_summary)}</div>` : ""}
</section>`;
    }
  }

  // === SLIDE 12: COMPATIBILITY PROFILE ===
  let slide12 = "";
  if (bpaFormatted) {
    const compat = bpaFormatted.compatibility_profile ?? bpaFormatted.compatibility;
    if (compat && typeof compat === "object") {
      const c = compat as Record<string, unknown>;
      slide12 = `<section class="slide slide-accent" id="s12">
<div class="slide-tag">Kompatibilitetsprofil</div>
<h2 style="margin-bottom:16px">Generell spelarprofil</h2>
<div class="compat-grid">
  <div class="compat-item"><div class="compat-label">Spelstil-krav</div><div class="compat-text">${e(c.play_style ?? c.play_style_requirement ?? "Ej tillgänglig")}</div></div>
  <div class="compat-item"><div class="compat-label">Liga-nivå</div><div class="compat-text">${e(c.league_level ?? "Ej tillgänglig")}</div></div>
  <div class="compat-item"><div class="compat-label">Kulturprofil</div><div class="compat-text">${e(c.culture_profile ?? c.culture ?? "Ej tillgänglig")}</div></div>
  <div class="compat-item"><div class="compat-label">Idealmiljö</div><div class="compat-text">${e(c.ideal_environment ?? c.ideal_env ?? "Ej tillgänglig")}</div></div>
</div>
</section>`;
    }
  }

  // === SLIDE 13: COACHING BLUEPRINT ===
  let slide13 = "";
  if (bpaFormatted) {
    const steps = Array.isArray(bpaFormatted.coaching_blueprint) ? bpaFormatted.coaching_blueprint as Record<string, unknown>[] : [];
    if (steps.length > 0) {
      slide13 = `<section class="slide slide-dark" id="s13">
<div class="slide-tag">Coaching Blueprint</div>
${steps.map((s, idx) => {
  const isFirst = idx === 0;
  const accent = isFirst ? "border:1px solid var(--accent);background:rgba(0,212,170,.08)" : "";
  const badge = isFirst ? `<span style="display:inline-block;background:var(--accent);color:var(--navy);font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle">VECKA 1</span>` : "";
  return `<div class="coach-step" style="${accent}">
  <div class="coach-num">${e(s.step)}</div>
  <div><div style="font-size:14px;font-weight:600;margin-bottom:2px">${e(s.title)}${badge}</div>
  <div class="card-text">${e(s.description ?? s.desc)}</div></div>
</div>`;
}).join("")}
</section>`;
    }
  } else if (bpa) {
    // Fallback: raw coaching approach from BPA
    const coaching = Array.isArray(bpa.coaching_approach) ? bpa.coaching_approach as string[] : [];
    if (coaching.length > 0) {
      slide13 = `<section class="slide slide-dark" id="s13">
<div class="slide-tag">Coaching Blueprint</div>
${coaching.map((c, i) => `<div class="coach-step"><div class="coach-num">${i + 1}</div><div class="card-text">${e(c)}</div></div>`).join("")}
</section>`;
    }
  }

  // === SLIDE 14: EXPERT REVIEW (Sport Advisory Board + Bosse) ===
  let slide14 = "";
  {
    const bosseReview = bpa ? String(bpa.bosse_review ?? "") : "";
    const bosseOverride = bpa ? Boolean(bpa.bosse_override) : false;
    const verif = bpa?.verification as Record<string, unknown> | undefined;

    // CONFIDENTIALITY: All advisor/expert names are ANONYMIZED in output.
    // Real names (SA01-SA06, Bosse clone) are NEVER exposed to customers.
    const EXPERT_DOMAINS = [
      { title: "Mental Performance Expert", domain: "Beslutsfattande & prestation under press" },
      { title: "Sports Medicine Expert", domain: "Skadeprevention & fysisk belastning" },
      { title: "Talent ID Expert", domain: "Karriärtrajektoria & talangutveckling" },
      { title: "Club Strategy Expert", domain: "Transferstrategi & klubbpassform" },
      { title: "Football Analytics Expert", domain: "Statistisk analys & dimensionsvalidering" },
      { title: "Cultural Integration Expert", domain: "Kulturell anpassning & lagdynamik" },
    ];

    if (advisorReview) {
      const opinions = Array.isArray(advisorReview.opinions) ? advisorReview.opinions as Record<string, unknown>[] : [];
      const consensus = advisorReview.consensus ? String(advisorReview.consensus) : "";
      const VERDICT_COLORS: Record<string, string> = { AGREE: "#00d4aa", CHALLENGE: "#f4c430", FLAG: "#ef4444" };
      const VERDICT_LABELS: Record<string, string> = { AGREE: "Godkänd", CHALLENGE: "Invändning", FLAG: "Varning" };
      if (opinions.length > 0) {
        slide14 = `<section class="slide slide-light" id="s14">
<div class="slide-tag">Sport Advisory Board</div>
${consensus ? `<div style="margin-bottom:20px;padding:14px 18px;border-radius:12px;background:rgba(0,212,170,.06);border:1px solid rgba(0,212,170,.15);font-size:14px;color:rgba(255,255,255,.85)">${e(consensus)}</div>` : ""}
${bosseReview ? `<div class="advisor-card" style="border-left-color:#f4c430">
  <div class="advisor-hdr">
    <div><span class="advisor-name">Senior Scout Expert</span><span class="advisor-domain" style="margin-left:8px">Scoutinganalys</span></div>
    <span class="badge" style="background:rgba(244,196,48,.15);color:#f4c430;border:1px solid rgba(244,196,48,.3)">${bosseOverride ? "Override" : "Bedömning"}</span>
  </div>
  <div class="card-text">${e(bosseReview)}</div>
</div>` : ""}
${opinions.map((o, idx) => {
  const v = String(o.verdict ?? "CHALLENGE");
  const color = VERDICT_COLORS[v] ?? "#f4c430";
  const label = VERDICT_LABELS[v] ?? v;
  const flags = Array.isArray(o.risk_flags) ? o.risk_flags as string[] : [];
  const recs = Array.isArray(o.recommendations) ? o.recommendations as string[] : [];
  const expertLabel = o.domain ? String(o.domain) + " Expert" : `Expert ${idx + 1}`;
  return `<div class="advisor-card" style="border-left-color:${color}">
  <div class="advisor-hdr">
    <div><span class="advisor-name">${e(expertLabel)}</span><span class="advisor-domain" style="margin-left:8px">${e(o.domain)}</span></div>
    <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${e(label)}</span>
  </div>
  <div class="card-text" style="margin-bottom:8px">${e(o.summary)}</div>
  ${String(o.detail ?? "").length > 0 ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:12px;color:rgba(255,255,255,.4)">Visa detaljanalys</summary><div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:6px;white-space:pre-wrap">${e(o.detail)}</div></details>` : ""}
  ${flags.length > 0 ? flags.map(f => `<div style="font-size:12px;color:#ef4444;padding:2px 0">⚠ ${e(f)}</div>`).join("") : ""}
  ${recs.length > 0 ? recs.map(r => `<div style="font-size:12px;color:#00d4aa;padding:2px 0">→ ${e(r)}</div>`).join("") : ""}
</div>`;
}).join("")}
</section>`;
      }
    } else if (bosseReview) {
      slide14 = `<section class="slide slide-light" id="s14">
<div class="slide-tag">Sport Advisory Board</div>
<div class="advisor-card" style="border-left-color:#f4c430">
  <div class="advisor-hdr">
    <div><span class="advisor-name">Senior Scout Expert</span><span class="advisor-domain" style="margin-left:8px">Scoutinganalys</span></div>
    <span class="badge" style="background:rgba(244,196,48,.15);color:#f4c430;border:1px solid rgba(244,196,48,.3)">${bosseOverride ? "Override" : "Bedömning"}</span>
  </div>
  <div class="card-text" style="font-size:15px;line-height:1.8">${e(bosseReview)}</div>
</div>
${verif ? `<div style="margin-top:16px;margin-bottom:16px;padding:12px 16px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05)">
  <div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:8px">Oberoende verifiering</div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
    <span style="color:#00d4aa">Kvalitetscheck: ${e(String(verif.vet06_gate ?? "N/A"))}</span>
    <span style="color:rgba(255,255,255,.6)">Verifierade claims: ${verif.vet07_verified ?? "N/A"}</span>
    <span style="color:rgba(255,255,255,.6)">Ifrågasatta: ${verif.vet07_contradicted ?? "N/A"}</span>
  </div>
</div>` : ""}
<h3 style="margin-top:20px;margin-bottom:12px;color:rgba(255,255,255,.6)">Sport Advisory Board — 6 domänexperter</h3>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
${EXPERT_DOMAINS.map(a => `<div style="padding:12px 14px;border-radius:10px;background:rgba(0,212,170,.04);border:1px solid rgba(0,212,170,.1)">
  <div style="font-size:13px;font-weight:600">${e(a.title)}</div>
  <div style="font-size:11px;color:rgba(255,255,255,.4)">${e(a.domain)}</div>
</div>`).join("")}
</div>
</section>`;
    } else {
      slide14 = `<section class="slide slide-light" id="s14">
<div class="slide-tag">Sport Advisory Board</div>
<h2 style="margin-bottom:8px">Oberoende expertgranskning</h2>
<div class="text" style="margin-bottom:20px">Vault AI:s Sport Advisory Board består av 6 domänexperter som granskar varje rapport oberoende av AI-analysen.</div>
${EXPERT_DOMAINS.map(a => `<div class="advisor-card" style="border-left-color:rgba(0,212,170,.4)">
  <div class="advisor-hdr">
    <div><span class="advisor-name">${e(a.title)}</span><span class="advisor-domain" style="margin-left:8px">${e(a.domain)}</span></div>
    <span class="badge b-info">Tillgänglig</span>
  </div>
</div>`).join("")}
</section>`;
    }
  }

  // === SLIDE 15: QA METADATA (customer-safe — no internal agent/KB names) ===
  const agentCount = Array.isArray(analysis.agents_used) ? (analysis.agents_used as string[]).length : 0;
  const kbCount = Array.isArray(analysis.kb_files_used) ? (analysis.kb_files_used as string[]).length : 0;
  const slideCount = [slide1, slide2, slide3, slide4, slide5, slide6, slide7, slide8, slide9, slide10, slide11, slide12, slide13, slide14].filter(s => s.length > 0).length + 1;
  const verificationData = bpa?.verification as Record<string, unknown> | undefined;

  const slide15 = `<section class="slide slide-dark" id="s15">
<div class="slide-tag">Kvalitetssäkring</div>
<h2 style="margin-bottom:16px">Rapport-metadata</h2>
<div class="meta-row"><span class="meta-label">Rapport genererad</span><span class="meta-value">${new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} (svensk tid)</span></div>
<div class="meta-row"><span class="meta-label">Spelare</span><span class="meta-value">${e(player.name)}</span></div>
<div class="meta-row"><span class="meta-label">Overall Score</span><span class="meta-value">${overall.toFixed(1)} / 10</span></div>
<div class="meta-row"><span class="meta-label">Confidence</span><span class="meta-value">${(confidence * 100).toFixed(0)}%</span></div>
<div class="meta-row"><span class="meta-label">Recommendation</span><span class="meta-value">${e(rec)}</span></div>
<div class="meta-row"><span class="meta-label">Dimensioner analyserade</span><span class="meta-value">${scores.length} / 16</span></div>
<div class="meta-row"><span class="meta-label">Beteendeprofil (BPA)</span><span class="meta-value">${bpa ? "Ja — 12 dimensioner" : "Ej tillgänglig"}</span></div>
<div class="meta-row"><span class="meta-label">Sport Advisory Board</span><span class="meta-value">${advisorReview ? `${(advisorReview.opinions as unknown[])?.length ?? 0} granskare` : "6 experter tillgängliga"}</span></div>
<div class="meta-row"><span class="meta-label">AI-analyslager</span><span class="meta-value">${agentCount > 0 ? `${agentCount} specialiserade modeller` : "Standard"}</span></div>
<div class="meta-row"><span class="meta-label">Datakällor</span><span class="meta-value">${kbCount > 0 ? `${kbCount} kunskapsbaser` : "Grunddata"}</span></div>
<div class="meta-row"><span class="meta-label">Oberoende verifiering</span><span class="meta-value">${verificationData?.vet06_gate ? `${e(String(verificationData.vet06_gate))}` : bpa ? "Genomförd" : "Ej tillämplig"}</span></div>
<div class="meta-row" style="border:none"><span class="meta-label">Antal sektioner</span><span class="meta-value">${slideCount}</span></div>
<div style="margin-top:20px;padding:14px 18px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,255,255,.45);line-height:1.7">
<strong style="color:rgba(255,255,255,.6)">Disclaimer:</strong> Behavioral screening — ej klinisk bedömning. Denna rapport bygger på AI-baserad beteendeanalys och bör ej ersätta professionell psykologisk utvärdering. All data behandlas i enlighet med GDPR. © ${new Date().getFullYear()} Vault AI.
</div>
</section>`;

  // === ASSEMBLE — transform to pitch-deck 16:9 slide structure ===
  const allSlides = [slide1, slide2, slide3, slide4, slide5, slide6, slide7, slide8, slide9, slide10, slide11, slide12, slide13, slide14, slide15].filter(s => s.length > 0);
  const totalPages = allSlides.length;
  const slides = allSlides.map((html, i) => {
    const pageNum = i + 1;
    const footer = `<div class="slide-footer"><span class="sf-brand">Vault AI Scout</span><span>Behavioral Football Intelligence</span><span>CONFIDENTIAL</span></div>`;
    return html
      // Convert <section> to <div> with pitch-deck slide-type classes
      .replace(/<section class="slide slide-dark"/g, '<div class="slide dark-slide"')
      .replace(/<section class="slide slide-light"/g, '<div class="slide light-slide"')
      .replace(/<section class="slide slide-accent"/g, '<div class="slide accent-slide"')
      // Convert slide-tag to section-tag (div→span, pitch-deck pattern)
      .replace(/<div class="slide-tag">([^<]*)<\/div>/g, '<span class="section-tag">$1</span>')
      // Add slide-title class to h1 (pitch-deck typography)
      .replace(/<h1>/g, '<h1 class="slide-title">')
      // Inject slide-content wrapper after opening slide tag
      .replace(/(<div class="slide (?:dark|light|accent)-slide" id="s\d+">)/, '$1<div class="slide-content">')
      // Inject footer + close slide-content + slide-num before end
      .replace(/<\/section>$/, `${footer}</div><span class="slide-num">${pageNum} / ${totalPages}</span></div>`);
  }).join("\n");

  return `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${escapeHtml(player.name)} — Vault AI Scout Report</title>
<style>${VAULT_REPORT_CSS}</style></head>
<body>${slides}
<div class="watermark">Vault AI Scout &mdash; Behavioral Football Intelligence &mdash; ${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" })}</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Action: generate — multi-step scouting report (SRR01 + SRR02 + code rendering)
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

  // Extract BPA from analysis_data (full_scout stores bpa_scores inline)
  // Also check for separate personality analysis as fallback
  let bpaProfile: Record<string, unknown> | null = null;
  {
    const ad = analysis.analysis_data as Record<string, unknown> | null;
    if (ad?.bpa_scores && typeof ad.bpa_scores === "object") {
      // BPA embedded in the full_scout analysis_data
      bpaProfile = {
        bpa_scores: ad.bpa_scores,
        composite_archetype: ad.bpa_archetype ?? null,
        stress_archetype: ad.stress_archetype ?? null,
        contradiction_score: (ad.bpa_scores as Record<string, unknown>)?.contradiction_score ?? null,
        bosse_review: ad.bosse_review ?? null,
        bosse_override: ad.bosse_override ?? null,
        dif_compatibility: ad.dif_compatibility ?? null,
        verification: ad.verification ?? null,
      };
    } else {
      // Fallback: separate personality analysis
      const { data: paRows } = await db.from("scout_analyses").select("id,analysis_data,created_at")
        .eq("player_id", playerId).eq("analysis_type", "personality")
        .order("created_at", { ascending: false }).limit(1);
      const paRow = Array.isArray(paRows) && paRows.length > 0 ? paRows[0] : null;
      if (paRow?.analysis_data && typeof paRow.analysis_data === "object") {
        const pad = paRow.analysis_data as Record<string, unknown>;
        bpaProfile = (pad.profile && typeof pad.profile === "object" ? pad.profile : pad) as Record<string, unknown>;
      }
    }
  }

  // Extract advisor review from analysis_data
  const advisorReview = (analysis.analysis_data as Record<string, unknown>)?.advisor_review as Record<string, unknown> | null ?? null;

  const playerAge = computeAge(player.date_of_birth);
  const scoresCtx = (scores ?? []).map((s: Record<string, unknown>) => `${sanitizePromptInput(s.dimension_id)}: ${sanitizePromptInput(s.dimension_name)} = ${s.score}/10`).join("\n");

  // JSON format — return structured data only (no LLM calls)
  if (format === "json") {
    return jsonResponse({
      success: true,
      player: { id: player.id, name: player.name, position_primary: player.position_primary },
      analysis_id: analysis.id,
      analysis: { overall_score: analysis.overall_score, confidence: analysis.confidence, recommendation: analysis.recommendation, summary: analysis.summary, strengths: analysis.strengths, weaknesses: analysis.weaknesses },
      scores: scores ?? [],
      bpa_profile: bpaProfile,
      advisor_review: advisorReview,
    }, corsHeaders);
  }

  // --- STEP 1: SRR01 Narrative Writer (Opus) — generates ALL text content ---
  // Single Opus call generates: career narrative + psychology + triggers + coaching + compatibility
  let narrative: Record<string, unknown> | null = null;
  let bpaFormatted: Record<string, unknown> | null = null;
  const rawSummary = String(analysis.summary ?? "");

  const bpaDimsCtx = bpaProfile
    ? BPA_KEYS.map(d => `${d.label}: ${bpaVal(bpaProfile!, d.key).toFixed(1)}/10`).join("\n")
    : "";
  const csValForPrompt = bpaProfile
    ? (() => { const v = bpaProfile!.contradiction_score ?? (bpaProfile!.bpa_scores as Record<string, unknown> | undefined)?.contradiction_score ?? 0; return typeof v === "number" ? v : 0; })()
    : 0;

  // STEP 1: Run SRR01 (Opus, narrative) and SRR02 (Sonnet, BPA text) IN PARALLEL
  const narrativeSystem = `Du är SRR01 — världsledande fotbollsanalytiker för Vault AI Scout.
Skriv på SVENSKA. Professionell, dramatisk, beskrivande text.
Em-dash (—) för pauser. Bold för insikter. GENERELL — nämn aldrig en köpande klubb.
Returnera ENBART valid JSON (inga kommentarer, inga markdown-block):
{"first_impression":"2 stycken om spelaren","career_chapters":[{"title":"Rubrik","content":"3-5 meningar"}],"player_summary":"1 stycke sammanfattning"}
5-7 karriärkapitel: bakgrund, genombrott, spelstil, mental profil, nuvarande form, framtid.
ANTI-HALLUCINATION: Basera ALLT på given data. Fabricera aldrig klubbbyten, mål, eller händelser.
ANTI-LEAK: Nämn ALDRIG antal agenter, pipeline-IDs, SCOUT00-05, VET, SRR, eller andra interna systemtermer. Skriv som en mänsklig analytiker.`;

  // P0: sanitize all DB-sourced fields before injecting into Claude prompt
  const spi = sanitizePromptInput;
  const narrativeUser = `Spelare: ${spi(player.name)}
Position: ${spi(player.position_primary)} | Ålder: ${playerAge ?? "okänd"} | Klubb: ${spi(player.current_club)}
Liga: ${spi(player.current_league)} | Nationalitet: ${spi(player.nationality)}
Tier: ${spi(player.tier)} | Karriärfas: ${spi(player.career_phase)}
Sammanfattning: ${spi(rawSummary)}
Overall: ${analysis.overall_score}/10 | Confidence: ${analysis.confidence}
Recommendation: ${analysis.recommendation}
Styrkor: ${(analysis.strengths ?? []).map(s => spi(s)).join(", ")}
Svagheter: ${(analysis.weaknesses ?? []).map(s => spi(s)).join(", ")}
Dimensioner:\n${scoresCtx}
Marknadsvärde: ${player.market_value_eur ? `€${player.market_value_eur}` : "Okänt"}
Kontrakt: ${player.contract_expires ?? "Okänt"}`;

  const bpaSystem = bpaProfile ? `Du är SRR02 — sportpsykolog och beteendeanalytiker för Vault AI Scout.
Skriv på SVENSKA. RIK BESKRIVANDE TEXT — tolka BPA-poängen till djupa insikter, inte siffror.
Professionell, empatisk, specifik. GENERELL — nämn aldrig en köpande klubb.
Returnera ENBART valid JSON (inga kommentarer, inga markdown-block):
{"psychology_cards":[{"title":"Omklädningsrummet","content":"2-3 meningar","scores":{"primary":"dimension_name: X.X","secondary":"dimension_name: X.X"}},{"title":"Ego & drivkraft","content":"2-3 meningar","scores":{"primary":"ego: X.X","secondary":"ambition_level: X.X"}},{"title":"Beslutsmönster","content":"2-3 meningar","scores":{"primary":"decision_tempo: X.X","secondary":"risk_appetite: X.X"}},{"title":"Karriärmotivation","content":"2-3 meningar","scores":{"primary":"career_motivation: X.X","secondary":"ambition_level: X.X"}}],"stress_response":[{"title":"Kärnmekanism","content":"2-3 meningar"},{"title":"Stressrespons","content":"2-3 meningar"},{"title":"Strukturbehov","content":"2-3 meningar"}],"risk_flow":{"steps":[{"step":1,"title":"Titel","description":"2 meningar"}],"warning_chain":"trigger → eskalering → beteendeförändring → konsekvens → kollaps","big_question":"Den kritiska frågan som avgör spelarens framtid","case_study":"Scenario"},"triggers":{"activates_best":["trigger1","trigger2","trigger3"],"activates_worst":["trigger1","trigger2","trigger3"]},"coaching_blueprint":[{"step":1,"title":"Coach vecka 1","description":"Första konkreta interventionen — vad coachen gör dag 1-7"},{"step":2,"title":"Steg","description":"2-3 meningar"},{"step":3,"title":"Steg","description":"2-3 meningar"},{"step":4,"title":"Steg","description":"2-3 meningar"},{"step":5,"title":"Steg","description":"2-3 meningar"}],"compatibility_profile":{"play_style":"Krav","league_level":"Nivå","culture_profile":"Profil","ideal_environment":"Miljö"}}
VIKTIGT: psychology_cards.scores = FAKTISKA BPA-scores (1-10) från given data, inte platshållare.
warning_chain = en kedja med → som visar HUR spelaren bryter ner (trigger→eskalering→konsekvens).
big_question = den ENA frågan en sportchef måste ställa sig om denna spelare.
coaching_blueprint steg 1 MÅSTE vara "Coach vecka 1" — konkret first-week intervention.
Fyll varje fält med rik beskrivande text baserad på BPA-data. 5-6 risk-steg. 5 coaching-steg.` : "";

  const bpaUser = bpaProfile ? `Spelare: ${spi(player.name)} (${spi(player.position_primary)}, ${spi(player.current_club)})
Ålder: ${playerAge ?? "okänd"} | Tier: ${spi(player.tier)} | Karriärfas: ${spi(player.career_phase)}
Overall: ${analysis.overall_score}/10 | Recommendation: ${analysis.recommendation}
Styrkor: ${(analysis.strengths ?? []).map(s => spi(s)).join(", ")}
Svagheter: ${(analysis.weaknesses ?? []).map(s => spi(s)).join(", ")}
Arketyp: ${spi(bpaProfile.composite_archetype ?? "N/A")}
Stress-arketyp: ${spi(bpaProfile.stress_archetype ?? "N/A")}
Contradiction Score: ${csValForPrompt.toFixed(2)}
BPA-dimensioner:\n${bpaDimsCtx}
Bosse Andersson: ${spi(bpaProfile.bosse_review ?? "N/A")}` : "";

  // Run BOTH calls in parallel — dramatically faster
  const [narrativeResult, bpaResult] = await Promise.allSettled([
    callClaude(narrativeSystem, narrativeUser, { model: "claude-opus-4-6", maxTokens: 3000, timeoutMs: 90000 }),
    bpaProfile ? callClaude(bpaSystem, bpaUser, { maxTokens: 4000, timeoutMs: 90000 }) : Promise.resolve(""),
  ]);

  // Deep-sanitize all string values in LLM-generated JSON to strip internal terms
  function sanitizeDeep(obj: unknown): unknown {
    if (typeof obj === "string") return sanitizeText(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeDeep);
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) result[k] = sanitizeDeep(v);
      return result;
    }
    return obj;
  }

  const warnings: string[] = [];

  if (narrativeResult.status === "fulfilled" && narrativeResult.value) {
    try {
      const parsed = sanitizeDeep(parseAiJson(narrativeResult.value)) as Record<string, unknown>;
      // Schema validation: require key fields
      if (!parsed.first_impression && !parsed.career_chapters) {
        warnings.push("SRR01 returned unexpected JSON schema — narrative may be incomplete");
      }
      narrative = parsed;
    } catch (err) {
      warnings.push(`SRR01 narrative parse failed: ${String(err).slice(0, 100)}`);
    }
  } else if (narrativeResult.status === "rejected") {
    warnings.push(`SRR01 narrative call failed: ${String(narrativeResult.reason).slice(0, 100)}`);
  }

  if (bpaResult.status === "fulfilled" && bpaResult.value) {
    try {
      const parsed = sanitizeDeep(parseAiJson(bpaResult.value)) as Record<string, unknown>;
      // Schema validation: require at least one key section
      if (!parsed.psychology_cards && !parsed.stress_response && !parsed.coaching_blueprint) {
        warnings.push("SRR02 returned unexpected JSON schema — BPA sections may be incomplete");
      }
      bpaFormatted = parsed;
    } catch (err) {
      warnings.push(`SRR02 BPA parse failed: ${String(err).slice(0, 100)}`);
    }
  } else if (bpaResult.status === "rejected") {
    warnings.push(`SRR02 BPA call failed: ${String(bpaResult.reason).slice(0, 100)}`);
  } else if (!bpaFormatted && bpaProfile) {
    warnings.push("BPA data exists but SRR02 formatting unavailable");
  }

  // --- STEP 3: Build 15-slide HTML (deterministic code rendering) ---
  const reportHtml = buildReportHtml(
    player, analysis, scores ?? [], bpaProfile, narrative, bpaFormatted, advisorReview
  );

  // --- STEP 4: SRR04 Quality Gate (deterministic pre-delivery check) ---
  const qgIssues: string[] = [];
  // Bounds check: scores must be [0,10], confidence [0,1]
  if (typeof analysis.overall_score === "number" && (analysis.overall_score < 0 || analysis.overall_score > 10)) {
    qgIssues.push(`overall_score out of bounds: ${analysis.overall_score}`);
  }
  if (typeof analysis.confidence === "number" && (analysis.confidence < 0 || analysis.confidence > 1)) {
    qgIssues.push(`confidence out of bounds: ${analysis.confidence}`);
  }
  if (scores) {
    for (const s of scores) {
      const sc = s as Record<string, unknown>;
      if (typeof sc.score === "number" && (sc.score < 0 || sc.score > 10)) {
        qgIssues.push(`dimension ${sc.dimension_id} score out of bounds: ${sc.score}`);
      }
    }
  }
  // Completeness check: verify key slides have content
  const slideIds = ["s1", "s2", "s3", "s4", "s5"];
  for (const sid of slideIds) {
    if (!reportHtml.includes(`id="${sid}"`)) {
      qgIssues.push(`Missing slide: ${sid}`);
    }
  }
  // Anti-leak check: internal terms must not appear in output
  const LEAK_TERMS = ["SRR0", "SCOUT0", "VET0", "PXE0", "PDQ0", "pipeline_id", "agent_execution", "Task()"];
  for (const term of LEAK_TERMS) {
    if (reportHtml.includes(term)) {
      qgIssues.push(`Internal term leak detected: ${term}`);
    }
  }
  // Design token check: verify Vault CSS present
  if (!reportHtml.includes("--navy") || !reportHtml.includes("--accent")) {
    qgIssues.push("Missing Vault CSS design tokens");
  }
  const qualityGate = qgIssues.length === 0 ? "GO" : "WARN";
  if (qgIssues.length > 0) {
    warnings.push(`SRR04 Quality Gate: ${qualityGate} — ${qgIssues.join("; ")}`);
  }

  return jsonResponse({
    success: true,
    report: reportHtml,
    quality_gate: qualityGate,
    ...(warnings.length > 0 ? { warnings } : {}),
  }, corsHeaders);
}

// ---------------------------------------------------------------------------
// Action: compare — comparison report for 2-4 players (unchanged)
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

  const playerData: Record<string, unknown>[] = [];
  for (const p of players) {
    const { data: aRows } = await db.from("scout_analyses").select("*")
      .eq("player_id", p.id).order("created_at", { ascending: false }).limit(1);
    const a = Array.isArray(aRows) && aRows.length > 0 ? aRows[0] : null;
    let sc: unknown[] = [];
    if (a) { const { data: sRows } = await db.from("scout_scores").select("*").eq("analysis_id", a.id); sc = sRows ?? []; }
    playerData.push({ player: p, analysis: a, scores: sc });
  }

  let compactDims = "";
  try {
    const { data: cText } = await db.rpc("get_dimension_framework_prompt", { p_type: "compact" });
    compactDims = typeof cText === "string" ? cText : "";
  } catch (_e) { /* ignore */ }

  const compSystemPrompt = `Du är en världsledande fotbollsscout-analytiker för Vault AI Scout.
Generera en ${compType.replace(/_/g, " ")}-jämförelse på SVENSKA. Var specifik, använd dimensionspoäng.
${compactDims || "Dimensioner: DIM-01 till DIM-16 (Taktisk, Teknisk, Fysisk, Mental, Social)."}
Returnera valid JSON: {summary(string), rankings([{player_name,rank,overall_score,rationale}]),
key_differentiators(string[3-5]), recommendation(string),
dimension_comparison([{dimension,scores:{player_name:score}}])}. Allt på svenska.`;

  // P0: sanitize DB-sourced fields in comparison prompts (defense-in-depth)
  const spiC = sanitizePromptInput;
  const playersCtx = playerData.map((pd: Record<string, unknown>) => {
    const p = pd.player as Record<string, unknown>;
    const a = pd.analysis as Record<string, unknown> | null;
    const s = pd.scores as Record<string, unknown>[];
    return `${spiC(p.name)} (${spiC(p.position_primary)}, ${spiC(p.current_club)}, ${spiC(p.current_league)}, tier ${spiC(p.tier)})
Analysis: ${spiC(a?.summary ?? "N/A")}
Scores: ${s.map(x => `${spiC(x.dimension_name)}:${x.score}`).join(", ") || "N/A"}`;
  }).join("\n\n");

  let compareData: Record<string, unknown>;
  try {
    compareData = parseAiJson(await callClaude(compSystemPrompt,
      `Type: ${compType.replace(/_/g, " ")}\n\n${playersCtx}\n\nGenerate comparison JSON.`));
  } catch (err) { return errorResponse(`Comparison failed: ${err}`, corsHeaders, 502); }

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
// Action: watchlist_brief — executive summary of active watchlist (unchanged)
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

  // P0: sanitize DB-sourced fields in watchlist prompts (defense-in-depth)
  const itemsCtx = items.map((i: Record<string, unknown>) => {
    const p = (i.scout_players ?? {}) as Record<string, unknown>;
    return `- ${sanitizePromptInput(p.name ?? "?")} (${sanitizePromptInput(p.position_primary ?? "?")}, ${sanitizePromptInput(p.current_club ?? "?")}) | Pri: ${i.priority} | Deadline: ${i.deadline ?? "none"} | ${sanitizePromptInput(i.notes ?? "")}`;
  }).join("\n");

  let briefData: Record<string, unknown>;
  try {
    briefData = parseAiJson(await callClaude(systemPrompt,
      `Watchlist (${items.length}):\n${itemsCtx}\nToday: ${new Date().toISOString().slice(0, 10)}\nGenerate brief JSON.`));
  } catch (err) { return errorResponse(`Brief generation failed: ${err}`, corsHeaders, 502); }

  return jsonResponse({ success: true, count: items.length, brief: briefData }, corsHeaders);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", corsHeaders, 405);

  // JWT authentication (shared helper)
  const authResult = await authenticateRequest(req);
  if (!authResult.ok) {
    return errorResponse(authResult.error, corsHeaders, authResult.status);
  }
  const userId = authResult.userId;

  const rl = await rateLimiter.check(`scout-report:${userId}`, getSupabaseClient());
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 10 report requests per 15 minutes.", retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec), ...getRateLimitHeaders(rl) } }
    );
  }

  // Merge rate-limit headers into cors so all subsequent responses include them
  const rlHeaders = getRateLimitHeaders(rl);
  const corsHeadersWithRl = { ...corsHeaders, ...rlHeaders };

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON body", corsHeadersWithRl); }
  body._userId = userId;

  const action = body.action;
  if (!action || typeof action !== "string") {
    return errorResponse("Missing 'action'. Valid: generate, compare, watchlist_brief", corsHeadersWithRl);
  }

  try {
    switch (action) {
      case "generate": return await handleGenerate(body, corsHeadersWithRl);
      case "compare": return await handleCompare(body, corsHeadersWithRl);
      case "watchlist_brief": return await handleWatchlistBrief(body, corsHeadersWithRl);
      default: return errorResponse(`Unknown action '${action}'. Valid: generate, compare, watchlist_brief`, corsHeadersWithRl);
    }
  } catch (err) {
    console.error(`Unhandled error [${action}]:`, err);
    return errorResponse("Internal error", corsHeadersWithRl, 500);
  }
});
