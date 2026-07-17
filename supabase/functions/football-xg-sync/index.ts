// ---------------------------------------------------------------------------
// football-xg-sync — Hämtar xG-data från FootyStats
// Sparar i football_xg-tabellen.
// Actions: sync_match_xg, sync_league_xg, test_footystats, resync_all_xg
// Sprint 205: FotMob removed — FootyStats is sole xG source.
// ---------------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateRequest } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// --- Config ---
const FOOTYSTATS_ALLSVENSKAN_SEASON_2026 = "16576";
const FOOTYSTATS_SUPERETTAN_SEASON_2026 = "16575";

// League ID → FootyStats season mapping
const FOOTYSTATS_SEASON_MAP: Record<number, string> = {
  113: FOOTYSTATS_ALLSVENSKAN_SEASON_2026,  // Allsvenskan
  114: FOOTYSTATS_SUPERETTAN_SEASON_2026,   // Superettan
};

// Fuzzy team name matching — handles API-Football vs FootyStats naming differences
function fuzzyTeamMatch(apiName: string, otherName: string): boolean {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/ä/g, "a").replace(/å/g, "a").replace(/ö/g, "o")
    .replace(/é/g, "e").replace(/ü/g, "u")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  const a = normalize(apiName);
  const b = normalize(otherName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const skipWords = new Set(["if", "ifk", "bk", "fk", "ff", "is", "fc", "aif", "sk"]);
  const sigWord = (s: string) => s.split(/\s+/).find(w => !skipWords.has(w) && w.length > 2) ?? s;
  const aSig = sigWord(a);
  const bSig = sigWord(b);
  if (aSig === bSig) return true;
  if (aSig.startsWith(bSig) || bSig.startsWith(aSig)) return true;
  const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2 && !skipWords.has(w)));
  const bWords = new Set(b.split(/\s+/).filter(w => w.length > 2 && !skipWords.has(w)));
  for (const w of aWords) { if (bWords.has(w)) return true; }
  for (const aw of aWords) {
    for (const bw of bWords) {
      if (aw.startsWith(bw) || bw.startsWith(aw)) return true;
    }
  }
  return false;
}

// --- Helpers ---
function jsonResponse(data: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

function errorResponse(msg: string, cors: Record<string, string>, status = 400): Response {
  return jsonResponse({ error: msg }, cors, status);
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

// --- FootyStats: Official API ---
async function fetchFootystatsXg(seasonId: string): Promise<Array<{
  home_team: string;
  away_team: string;
  date: string;
  home_xg: number | null;
  away_xg: number | null;
  home_xg_prematch: number | null;
  away_xg_prematch: number | null;
}>> {
  const apiKey = Deno.env.get("FOOTYSTATS_API_KEY");
  if (!apiKey) return [];

  try {
    const url = `https://api.football-data-api.com/league-matches?key=${apiKey}&season_id=${seasonId}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) {
      console.log(`FootyStats returned ${resp.status}`);
      return [];
    }

    const json = await resp.json();
    const matches = json.data || [];
    return matches
      .filter((m: Record<string, unknown>) => m.status === "complete")
      .map((m: Record<string, unknown>) => ({
        home_team: (m.home_name as string) ?? "",
        away_team: (m.away_name as string) ?? "",
        date: (m.date_unix
          ? new Date((m.date_unix as number) * 1000).toISOString().slice(0, 10)
          : ""),
        home_xg: m.team_a_xg != null ? Number(m.team_a_xg) : null,
        away_xg: m.team_b_xg != null ? Number(m.team_b_xg) : null,
        home_xg_prematch: m.team_a_xg_prematch != null ? Number(m.team_a_xg_prematch) : null,
        away_xg_prematch: m.team_b_xg_prematch != null ? Number(m.team_b_xg_prematch) : null,
      }));
  } catch (err) {
    console.log(`FootyStats error: ${err}`);
    return [];
  }
}

// --- Action: sync_match_xg ---
// Sync xG for a specific match (by api_fixture_id from API-Football)
async function syncMatchXg(apiFixtureId: number): Promise<{
  fixture_id: number;
  source: string;
  home_xg: number | null;
  away_xg: number | null;
}> {
  const sb = getServiceClient();

  const { data: fixture } = await sb.from("football_fixtures")
    .select("id, home_team_name, away_team_name, match_date, league_id")
    .eq("api_fixture_id", apiFixtureId)
    .single();

  if (!fixture) throw new Error(`Fixture ${apiFixtureId} not found in DB. Sync it first via football-data-sync.`);

  // FootyStats xG — select correct season based on league
  const seasonId = FOOTYSTATS_SEASON_MAP[fixture.league_id] ?? FOOTYSTATS_ALLSVENSKAN_SEASON_2026;
  const footyMatches = await fetchFootystatsXg(seasonId);
  const footyMatch = footyMatches.find((m) =>
    fuzzyTeamMatch(fixture.home_team_name, m.home_team) &&
    fuzzyTeamMatch(fixture.away_team_name, m.away_team)
  );

  if (!footyMatch || footyMatch.home_xg === null) {
    return { fixture_id: apiFixtureId, source: "none", home_xg: null, away_xg: null };
  }

  const shotXgData = {
    footystats_xg: { home: footyMatch.home_xg, away: footyMatch.away_xg },
    footystats_prematch_xg: { home: footyMatch.home_xg_prematch, away: footyMatch.away_xg_prematch },
  };

  const { error } = await sb.from("football_xg").upsert(
    {
      fixture_id: fixture.id,
      api_fixture_id: apiFixtureId,
      home_xg: footyMatch.home_xg,
      away_xg: footyMatch.away_xg,
      source: "footystats",
      shot_xg_data: shotXgData,
    },
    { onConflict: "api_fixture_id,source" },
  );
  if (error) throw new Error(`xG upsert: ${error.message}`);

  return {
    fixture_id: apiFixtureId,
    source: "footystats",
    home_xg: footyMatch.home_xg,
    away_xg: footyMatch.away_xg,
  };
}

// --- Action: sync_league_xg ---
// Sync xG for all finished fixtures in DB that lack xG data.
// Processes each league separately using correct FootyStats season ID.
// Optional league_id parameter to sync only one league.
async function syncLeagueXg(leagueId?: number): Promise<{
  checked: number;
  synced: number;
  results: Array<{ fixture: string; league: number; source: string; xg: string }>;
}> {
  const sb = getServiceClient();

  // Determine which leagues to process
  const leagueIds = leagueId ? [leagueId] : Object.keys(FOOTYSTATS_SEASON_MAP).map(Number);
  const allResults: Array<{ fixture: string; league: number; source: string; xg: string }> = [];
  let totalChecked = 0;

  for (const lid of leagueIds) {
    const seasonId = FOOTYSTATS_SEASON_MAP[lid];
    if (!seasonId) continue;

    // Fetch fixtures for THIS league — limit 200 to cover full season
    const { data: fixtures } = await sb.from("football_fixtures")
      .select("id, api_fixture_id, home_team_name, away_team_name, league_id")
      .eq("status_short", "FT")
      .eq("league_id", lid)
      .order("match_date", { ascending: false })
      .limit(200);

    if (!fixtures || fixtures.length === 0) continue;
    totalChecked += fixtures.length;

    const fixtureIds = fixtures.map((f) => f.api_fixture_id);
    const { data: existingXg } = await sb.from("football_xg")
      .select("api_fixture_id")
      .in("api_fixture_id", fixtureIds);
    const hasXg = new Set((existingXg ?? []).map((x) => x.api_fixture_id));

    const missing = fixtures.filter((f) => !hasXg.has(f.api_fixture_id));
    if (missing.length === 0) continue;

    // Fetch FootyStats ONCE per league (single API call per season)
    const footyMatches = await fetchFootystatsXg(seasonId);

    for (const f of missing) {
      try {
        const footyMatch = footyMatches.find((m) =>
          fuzzyTeamMatch(f.home_team_name, m.home_team) &&
          fuzzyTeamMatch(f.away_team_name, m.away_team)
        );

        if (footyMatch && footyMatch.home_xg !== null) {
          const { error } = await sb.from("football_xg").upsert(
            {
              fixture_id: f.id,
              api_fixture_id: f.api_fixture_id,
              home_xg: footyMatch.home_xg,
              away_xg: footyMatch.away_xg,
              source: "footystats",
              shot_xg_data: {
                footystats_xg: { home: footyMatch.home_xg, away: footyMatch.away_xg },
                footystats_prematch_xg: { home: footyMatch.home_xg_prematch, away: footyMatch.away_xg_prematch },
              },
            },
            { onConflict: "api_fixture_id,source" },
          );
          if (error) throw new Error(error.message);
          allResults.push({
            fixture: `${f.home_team_name} vs ${f.away_team_name}`,
            league: lid,
            source: "footystats",
            xg: `${footyMatch.home_xg?.toFixed(2)} - ${footyMatch.away_xg?.toFixed(2)}`,
          });
        } else {
          allResults.push({
            fixture: `${f.home_team_name} vs ${f.away_team_name}`,
            league: lid,
            source: "none",
            xg: "N/A",
          });
        }
      } catch (err) {
        allResults.push({
          fixture: `${f.home_team_name} vs ${f.away_team_name}`,
          league: lid,
          source: "error",
          xg: String(err),
        });
      }
    }
  }

  return {
    checked: totalChecked,
    synced: allResults.filter((r) => r.source === "footystats").length,
    results: allResults,
  };
}

// --- Main handler ---
Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return errorResponse(auth.error, corsHeaders, auth.status);
  }

  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "sync_match_xg": {
        const fixtureId = body.fixture_id as number;
        if (!fixtureId) return errorResponse("fixture_id required", corsHeaders);
        const result = await syncMatchXg(fixtureId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_league_xg": {
        // Optional league_id to sync only one league (113=Allsvenskan, 114=Superettan)
        const leagueIdParam = body.league_id as number | undefined;
        const result = await syncLeagueXg(leagueIdParam);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "test_footystats": {
        // Test both leagues
        const testResults: Record<string, { reachable: boolean; matches: number; sample: unknown[] }> = {};
        for (const [lid, sid] of Object.entries(FOOTYSTATS_SEASON_MAP)) {
          const footyMatches = await fetchFootystatsXg(sid);
          const leagueName = lid === "113" ? "Allsvenskan" : "Superettan";
          testResults[leagueName] = {
            reachable: footyMatches.length > 0,
            matches: footyMatches.length,
            sample: footyMatches.slice(0, 2).map((m) => ({
              match: `${m.home_team} vs ${m.away_team}`,
              date: m.date,
              xg: `${m.home_xg} - ${m.away_xg}`,
            })),
          };
        }
        return jsonResponse({ ok: true, leagues: testResults }, corsHeaders);
      }

      case "resync_all_xg": {
        // Resync all xG for all leagues — processes per league with correct season
        const sbResync = getServiceClient();
        const resyncResults: Array<{ fixture: string; league: number; source: string; xg: string }> = [];
        let resyncTotal = 0;

        for (const [lid, sid] of Object.entries(FOOTYSTATS_SEASON_MAP)) {
          const leagueId = Number(lid);

          const { data: leagueFixtures } = await sbResync.from("football_fixtures")
            .select("id, api_fixture_id, home_team_name, away_team_name")
            .eq("status_short", "FT")
            .eq("league_id", leagueId)
            .order("match_date", { ascending: false })
            .limit(200);

          if (!leagueFixtures || leagueFixtures.length === 0) continue;
          resyncTotal += leagueFixtures.length;

          const fixtureIds = leagueFixtures.map((f) => f.api_fixture_id);
          await sbResync.from("football_xg").delete().in("api_fixture_id", fixtureIds);

          const footyMatches = await fetchFootystatsXg(sid);

          for (const f of leagueFixtures) {
            try {
              const footyMatch = footyMatches.find((m) =>
                fuzzyTeamMatch(f.home_team_name, m.home_team) &&
                fuzzyTeamMatch(f.away_team_name, m.away_team)
              );

              if (footyMatch && footyMatch.home_xg !== null) {
                await sbResync.from("football_xg").upsert({
                  fixture_id: f.id,
                  api_fixture_id: f.api_fixture_id,
                  home_xg: footyMatch.home_xg,
                  away_xg: footyMatch.away_xg,
                  source: "footystats",
                  shot_xg_data: {
                    footystats_xg: { home: footyMatch.home_xg, away: footyMatch.away_xg },
                    footystats_prematch_xg: { home: footyMatch.home_xg_prematch, away: footyMatch.away_xg_prematch },
                  },
                }, { onConflict: "api_fixture_id,source" });

                resyncResults.push({
                  fixture: `${f.home_team_name} vs ${f.away_team_name}`,
                  league: leagueId,
                  source: "footystats",
                  xg: `${footyMatch.home_xg?.toFixed(2)} - ${footyMatch.away_xg?.toFixed(2)}`,
                });
              } else {
                resyncResults.push({
                  fixture: `${f.home_team_name} vs ${f.away_team_name}`,
                  league: leagueId,
                  source: "none",
                  xg: "N/A",
                });
              }
            } catch (err) {
              resyncResults.push({
                fixture: `${f.home_team_name} vs ${f.away_team_name}`,
                league: leagueId,
                source: "error",
                xg: String(err),
              });
            }
          }
        }

        return jsonResponse({
          ok: true,
          total: resyncTotal,
          synced: resyncResults.filter((r) => r.source === "footystats").length,
          results: resyncResults,
        }, corsHeaders);
      }

      default:
        return errorResponse(
          `Unknown action: ${action}. Valid: sync_match_xg, sync_league_xg, test_footystats, resync_all_xg`,
          corsHeaders,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("football-xg-sync error:", msg);
    return errorResponse(msg, corsHeaders, 500);
  }
});
