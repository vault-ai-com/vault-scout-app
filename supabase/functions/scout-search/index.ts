import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { createRateLimiter, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Rate limiter — in-memory per isolate (Deno Deploy)
// Key: userId | Window: 15 min | Max: 30 requests
// ---------------------------------------------------------------------------
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

function mapPlayer(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    position_primary: row.position_primary,
    age: computeAge(row.date_of_birth as string | null),
    nationality: row.nationality,
    current_club: row.current_club,
    current_league: row.current_league,
    tier: row.tier,
    career_phase: row.career_phase,
    date_of_birth: row.date_of_birth ?? null,
    market_value: row.market_value_eur != null ? Number(row.market_value_eur) : null,
    preferred_foot: (row.profile_data as Record<string, unknown>)?.preferred_foot ?? null,
    height_cm: (row.profile_data as Record<string, unknown>)?.height_cm ?? null,
    weight_kg: (row.profile_data as Record<string, unknown>)?.weight_kg ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const reqOrigin = req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(reqOrigin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // JWT authentication
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing or invalid Authorization header" }, 401, reqOrigin);
  }
  let userId: string;
  try {
    const _supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const authClient = createClient(_supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401, reqOrigin);
    }
    userId = user.id;
  } catch {
    return json({ error: "Authentication failed" }, 401, reqOrigin);
  }

  // Rate limit check — after auth, before any work
  const rl = rateLimiter.check(userId);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Max 30 requests per 15 minutes.", retry_after_seconds: retryAfterSec }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec), ...getRateLimitHeaders(rl) } }
    );
  }

  const rlHeaders = getRateLimitHeaders(rl);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body.action ?? "search";

    // --- DASHBOARD ---
    if (action === "dashboard") {
      const [playersRes, analysesRes, watchlistRes, tierRes, posRes, recentRes, critRes] = await Promise.all([
        sb.from("scout_players").select("id", { count: "exact", head: true }),
        sb.from("scout_analyses").select("id", { count: "exact", head: true }).eq("status", "completed"),
        sb.from("scout_watchlist").select("id", { count: "exact", head: true }),
        sb.from("scout_players").select("tier"),
        sb.from("scout_players").select("position_primary"),
        sb.from("scout_analyses").select("id, player_id, analysis_type, overall_score, recommendation, completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(5),
        sb.from("scout_watchlist").select("player_id, priority, status, deadline, notes, scout_players(name)").limit(10),
      ]);

      const tierCounts: Record<string, number> = {};
      (tierRes.data ?? []).forEach((r: Record<string, string>) => { tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1; });

      const posCounts: Record<string, number> = {};
      (posRes.data ?? []).forEach((r: Record<string, string>) => { posCounts[r.position_primary] = (posCounts[r.position_primary] ?? 0) + 1; });

      const recentRows = recentRes.data ?? [];
      let recentAnalyses = null;
      if (recentRows.length > 0) {
        const playerIds = [...new Set(recentRows.map((r: Record<string, unknown>) => r.player_id))];
        const { data: players } = await sb.from("scout_players").select("id, name").in("id", playerIds);
        const nameMap: Record<string, string> = {};
        (players ?? []).forEach((p: Record<string, string>) => { nameMap[p.id] = p.name; });
        recentAnalyses = recentRows.map((r: Record<string, unknown>) => ({
          id: r.id,
          name: nameMap[r.player_id as string] ?? "Okänd",
          analysis_type: r.analysis_type,
          overall_score: Number(r.overall_score ?? 0),
          recommendation: r.recommendation ?? "MONITOR",
          completed_at: r.completed_at ?? new Date().toISOString(),
        }));
      }

      const critWatchlist = (critRes.data ?? []).map((w: Record<string, unknown>) => ({
        name: (w.scout_players as Record<string, string>)?.name ?? "Okänd",
        priority: (w.priority as string) ?? "medium",
        status: (w.status as string) ?? "active",
        deadline: w.deadline ?? null,
        notes: w.notes ?? null,
      }));

      return json({
        action: "dashboard",
        data: {
          total_players: playersRes.count ?? 0,
          total_analyses: analysesRes.count ?? 0,
          watchlist_count: watchlistRes.count ?? 0,
          players_by_tier: tierCounts,
          players_by_position: posCounts,
          recent_analyses: recentAnalyses,
          critical_watchlist: critWatchlist.length > 0 ? critWatchlist : null,
        },
      }, 200, reqOrigin, rlHeaders);
    }

    // --- SEARCH (pg_trgm fuzzy via RPC) ---
    if (action === "search") {
      const rawQuery = typeof body.query === "string" ? body.query.trim() : "";
      const position = typeof body.position === "string" ? body.position : null;
      const tier = typeof body.tier === "string" ? body.tier : null;
      const limit = Math.min(typeof body.limit === "number" ? body.limit : 50, 100);

      if (!rawQuery) return json({ action: "search", count: 0, players: [] }, 200, reqOrigin, rlHeaders);

      const { data, error } = await sb.rpc("search_scout_players", {
        p_query: rawQuery,
        p_position: position,
        p_tier: tier,
        p_limit: limit,
      });
      if (error) return json({ error: error.message }, 500, reqOrigin, rlHeaders);

      // Strip internal scoring fields from RPC result
      const players = (data ?? []).map((r: Record<string, unknown>) => {
        const { name_sim, word_avg_sim, full_sim, ...player } = r;
        return player;
      });

      return json({ action: "search", count: players.length, players }, 200, reqOrigin, rlHeaders);
    }

    // --- GET PLAYER ---
    if (action === "get_player") {
      const playerId = body.player_id;
      if (!playerId) return json({ error: "player_id required" }, 400, reqOrigin, rlHeaders);
      if (typeof playerId !== "string" || !isValidUUID(playerId)) return json({ error: "Invalid player_id format" }, 400, reqOrigin, rlHeaders);

      const { data, error } = await sb.from("scout_players").select("*").eq("id", playerId).single();
      if (error || !data) return json({ error: "Player not found" }, 404, reqOrigin, rlHeaders);

      const player = { ...mapPlayer(data), profile_data: data.profile_data ?? null };
      return json({ action: "get_player", player }, 200, reqOrigin, rlHeaders);
    }

    // --- DISCOVER (keyword-based) ---
    if (action === "discover") {
      const criteria = typeof body.criteria === "string" ? body.criteria : "";
      const position = typeof body.position === "string" ? body.position : null;
      const maxAge = typeof body.max_age === "number" ? body.max_age : null;

      let q = sb.from("scout_players").select("*");
      if (position) q = q.eq("position_primary", position);

      const { data } = await q.order("name").limit(50);
      let players = (data ?? []).map(mapPlayer);

      if (maxAge) players = players.filter((p: { age: number }) => p.age <= maxAge);

      if (criteria) {
        const keywords = criteria.toLowerCase().split(/\s+/);
        const scored = players.map((p: Record<string, unknown>) => {
          let score = 0;
          const haystack = `${p.name} ${p.position_primary} ${p.current_club} ${p.current_league} ${p.nationality} ${p.tier} ${p.career_phase}`.toLowerCase();
          keywords.forEach((kw: string) => { if (haystack.includes(kw)) score++; });
          return { ...p, _score: score };
        });
        players = scored.filter((p: { _score: number }) => p._score > 0)
          .sort((a: { _score: number }, b: { _score: number }) => b._score - a._score)
          .map((p: Record<string, unknown>) => { const { _score, ...rest } = p; return rest; }) as typeof players;
      }

      return json({
        action: "discover",
        criteria,
        interpreted_params: { position, max_age: maxAge },
        reasoning: criteria ? `Sökte efter: ${criteria}` : null,
        count: players.length,
        players,
      }, 200, reqOrigin, rlHeaders);
    }

    return json({ error: `Unknown action: ${action}` }, 400, reqOrigin, rlHeaders);
  } catch (err) {
    console.error("scout-search unhandled error:", err);
    return json({ error: "Internal error" }, 500, reqOrigin, rlHeaders);
  }
});
