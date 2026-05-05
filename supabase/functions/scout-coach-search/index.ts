import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { createRateLimiter, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

const rateLimiter = createRateLimiter(30);

function json(data: unknown, status = 200, origin: string | null = null, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json", ...extra },
  });
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function computeAge(dob: string | null): number {
  if (!dob) return 0;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function mapCoach(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    nationality: row.nationality,
    age: computeAge(row.date_of_birth as string | null),
    date_of_birth: row.date_of_birth ?? null,
    current_club: row.current_club,
    current_league: row.current_league,
    tier: row.tier,
    career_phase: row.career_phase,
    coaching_style: row.coaching_style ?? null,
    formation_preference: row.formation_preference ?? null,
    titles: row.titles ?? [],
    latest_score: row.latest_score != null ? Number(row.latest_score) : null,
    latest_recommendation: row.latest_recommendation ?? null,
    latest_analysis_date: row.latest_analysis_date ?? null,
    api_coach_id: row.api_coach_id ?? null,
  };
}

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sb = createClient(supabaseUrl, serviceKey);

  // Rate limit check — persistent via DB
  const rl = await rateLimiter.check(`scout-coach-search:${userId}`, sb);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 30 requests per 15 minutes.", retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec), ...getRateLimitHeaders(rl) } }
    );
  }

  const rlHeaders = getRateLimitHeaders(rl);

  try {
    const body = await req.json();
    const action = body.action ?? "search";

    // --- DASHBOARD ---
    if (action === "dashboard") {
      const [coachesRes, analysesRes, tierRes, recentRes, footballCoachesRes] = await Promise.all([
        sb.from("scout_coaches").select("id", { count: "exact", head: true }),
        sb.from("scout_analyses").select("id", { count: "exact", head: true }).eq("entity_type", "coach").eq("status", "completed"),
        sb.from("scout_coaches").select("tier"),
        sb.from("scout_analyses").select("id, coach_id, analysis_type, overall_score, recommendation, completed_at")
          .eq("entity_type", "coach").eq("status", "completed")
          .order("completed_at", { ascending: false }).limit(5),
        sb.from("football_coaches").select("id", { count: "exact", head: true }),
      ]);

      const tierCounts: Record<string, number> = {};
      (tierRes.data ?? []).forEach((r: Record<string, string>) => { tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1; });

      const recentRows = recentRes.data ?? [];
      let recentAnalyses = null;
      if (recentRows.length > 0) {
        const coachIds = [...new Set(recentRows.map((r: Record<string, unknown>) => r.coach_id))];
        const { data: coaches } = await sb.from("scout_coaches").select("id, name").in("id", coachIds);
        const nameMap: Record<string, string> = {};
        (coaches ?? []).forEach((c: Record<string, string>) => { nameMap[c.id] = c.name; });
        recentAnalyses = recentRows.map((r: Record<string, unknown>) => ({
          id: r.id,
          name: nameMap[r.coach_id as string] ?? "Okänd",
          analysis_type: r.analysis_type,
          overall_score: Number(r.overall_score ?? 0),
          recommendation: r.recommendation ?? "MONITOR",
          completed_at: r.completed_at ?? new Date().toISOString(),
        }));
      }

      return json({
        action: "dashboard",
        data: {
          total_coaches: coachesRes.count ?? 0,
          total_analyses: analysesRes.count ?? 0,
          coaches_by_tier: tierCounts,
          recent_analyses: recentAnalyses,
          football_coaches_available: footballCoachesRes.count ?? 0,
          api_synced: (coachesRes.count ?? 0) > 21, // true after sync_football_coaches_to_scout()
        },
      }, 200, reqOrigin, rlHeaders);
    }

    // --- SEARCH (pg_trgm fuzzy via RPC) ---
    if (action === "search") {
      const rawQuery = typeof body.query === "string" ? body.query.trim() : "";
      const limit = Math.min(typeof body.limit === "number" ? body.limit : 50, 100);

      if (!rawQuery) return json({ action: "search", count: 0, coaches: [] }, 200, reqOrigin, rlHeaders);

      const { data, error } = await sb.rpc("search_all_coaches", {
        p_query: rawQuery,
        p_limit: limit,
      });
      if (error) return json({ error: error.message }, 500, reqOrigin, rlHeaders);

      const coaches = (data ?? []).map((r: Record<string, unknown>) => {
        const { similarity: _sim, ...coach } = r;
        return mapCoach(coach);
      });

      return json({ action: "search", count: coaches.length, coaches }, 200, reqOrigin, rlHeaders);
    }

    // --- GET COACH ---
    if (action === "get_coach") {
      const coachId = body.coach_id;
      if (!coachId) return json({ error: "coach_id required" }, 400, reqOrigin, rlHeaders);
      if (typeof coachId !== "string" || !isValidUUID(coachId)) return json({ error: "Invalid coach_id format" }, 400, reqOrigin, rlHeaders);

      const { data, error } = await sb.from("scout_coaches").select("*").eq("id", coachId).single();
      if (error || !data) return json({ error: "Coach not found" }, 404, reqOrigin, rlHeaders);

      const coach = { ...mapCoach(data), career_history: data.career_history ?? [], profile_data: data.profile_data ?? null };
      return json({ action: "get_coach", coach }, 200, reqOrigin, rlHeaders);
    }

    // --- DISCOVER (keyword-based) ---
    if (action === "discover") {
      const criteria = typeof body.criteria === "string" ? body.criteria : "";
      const tier = typeof body.tier === "string" ? body.tier : null;

      let q = sb.from("scout_coaches").select("*");
      if (tier) q = q.eq("tier", tier);

      const { data } = await q.order("name").limit(50);
      let coaches = (data ?? []).map(mapCoach);

      if (criteria) {
        const keywords = criteria.toLowerCase().split(/\s+/);
        const scored = coaches.map((c: Record<string, unknown>) => {
          let score = 0;
          const haystack = `${c.name} ${c.current_club} ${c.current_league} ${c.nationality} ${c.tier} ${c.career_phase} ${c.coaching_style}`.toLowerCase();
          keywords.forEach((kw: string) => { if (haystack.includes(kw)) score++; });
          return { ...c, _score: score };
        });
        coaches = scored.filter((c: { _score: number }) => c._score > 0)
          .sort((a: { _score: number }, b: { _score: number }) => b._score - a._score)
          .map((c: Record<string, unknown>) => { const { _score, ...rest } = c; return rest; }) as typeof coaches;
      }

      return json({
        action: "discover",
        criteria,
        count: coaches.length,
        coaches,
      }, 200, reqOrigin, rlHeaders);
    }

    return json({ error: `Unknown action: ${action}` }, 400, reqOrigin, rlHeaders);
  } catch (err) {
    console.error("scout-coach-search unhandled error:", err);
    return json({ error: "Internal error" }, 500, reqOrigin, rlHeaders);
  }
});
