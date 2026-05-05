// ---------------------------------------------------------------------------
// football-data-sync — Synkar matchdata + spelar/tränare-profiler från API-Football till Supabase
// Actions: sync_fixture, sync_league_recent, sync_standings, sync_player_stats, sync_all_player_stats,
//   sync_player_profiles, sync_transfers, sync_injuries, sync_trophies, sync_coaches,
//   sync_team_stats, sync_full_league, sync_historical
// Konsumeras av: vault_match_coach_prep, vault_post_match_review, vault_match_prediction,
//   vault_ai_scout, vault_player_report, vault_coach_report, vault_team_report
// ---------------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateRequest } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { CURRENT_SEASON, ALLSVENSKAN_LEAGUE_ID } from "../_shared/constants.ts";

// --- Config ---
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

// --- Helpers ---
function jsonResponse(
  data: unknown,
  corsHeaders: Record<string, string>,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  msg: string,
  corsHeaders: Record<string, string>,
  status = 400,
): Response {
  return jsonResponse({ error: msg }, corsHeaders, status);
}

// --- API-Football client ---
async function apiFootball(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  const apiKey = Deno.env.get("API_FOOTBALL_KEY");
  if (!apiKey) throw new Error("Missing API_FOOTBALL_KEY secret");

  const url = new URL(`${API_FOOTBALL_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const resp = await fetch(url.toString(), {
    headers: { "x-apisports-key": apiKey },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API-Football ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

// --- Supabase client (service role for writes) ---
function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

// --- Action: sync_fixture ---
// Syncs ONE match with lineups, events, statistics
async function syncFixture(fixtureId: number): Promise<{
  fixture_id: number;
  home: string;
  away: string;
  score: string;
  events_count: number;
}> {
  // Fetch all data in parallel (including player stats)
  const [fixtureResp, lineupsResp, eventsResp, statsResp, playersResp] = await Promise.all([
    apiFootball("fixtures", { id: fixtureId }),
    apiFootball("fixtures/lineups", { fixture: fixtureId }),
    apiFootball("fixtures/events", { fixture: fixtureId }),
    apiFootball("fixtures/statistics", { fixture: fixtureId }),
    apiFootball("fixtures/players", { fixture: fixtureId }),
  ]) as [
    { response: Array<Record<string, unknown>> },
    { response: Array<Record<string, unknown>> },
    { response: Array<Record<string, unknown>> },
    { response: Array<Record<string, unknown>> },
    { response: Array<Record<string, unknown>> },
  ];

  const fixture = fixtureResp.response?.[0];
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  const teams = fixture.teams as Record<string, { id: number; name: string }>;
  const goals = fixture.goals as Record<string, number>;
  const fixtureInfo = fixture.fixture as Record<string, unknown>;
  const venue = fixtureInfo.venue as Record<string, unknown> | null;
  const league = fixture.league as Record<string, unknown>;

  const sb = getServiceClient();

  // 1. Upsert fixture (columns match DB: home_team_name, away_team_name, home_goals_ht, away_goals_ht)
  const { data: fData, error: fErr } = await sb.from("football_fixtures").upsert(
    {
      api_fixture_id: fixtureId,
      league_id: (league.id as number) ?? null,
      league_name: (league.name as string) ?? null,
      league_country: (league.country as string) ?? null,
      season: (league.season as number) ?? CURRENT_SEASON,
      home_team_name: teams.home?.name ?? "Unknown",
      home_team_id: teams.home?.id ?? null,
      away_team_name: teams.away?.name ?? "Unknown",
      away_team_id: teams.away?.id ?? null,
      match_date: (fixtureInfo.date as string) ?? null,
      status_short: ((fixtureInfo.status as Record<string, unknown>)?.short as string) ?? null,
      status_long: ((fixtureInfo.status as Record<string, unknown>)?.long as string) ?? null,
      home_goals: goals.home ?? null,
      away_goals: goals.away ?? null,
      home_goals_ht: (fixture.score as Record<string, Record<string, number>>)?.halftime?.home ?? null,
      away_goals_ht: (fixture.score as Record<string, Record<string, number>>)?.halftime?.away ?? null,
      venue_name: (venue?.name as string) ?? null,
      venue_city: (venue?.city as string) ?? null,
      referee: (fixtureInfo.referee as string) ?? null,
      raw_data: fixture,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "api_fixture_id" },
  ).select("id");
  if (fErr) throw new Error(`Fixture upsert: ${fErr.message}`);

  // Get the fixture UUID for FK references in child tables
  let fixtureUuid: string;
  if (fData && fData.length > 0) {
    fixtureUuid = fData[0].id;
  } else {
    // Fallback: query by api_fixture_id
    const { data: existing } = await sb.from("football_fixtures")
      .select("id").eq("api_fixture_id", fixtureId).single();
    if (!existing) throw new Error("Could not resolve fixture UUID");
    fixtureUuid = existing.id;
  }

  // 2. Upsert lineups (one per team)
  for (const lineup of (lineupsResp.response ?? [])) {
    const team = lineup.team as Record<string, unknown>;
    const coach = lineup.coach as Record<string, unknown> | null;
    const startXI = (lineup.startXI as Array<{ player: Record<string, unknown> }>) ?? [];
    const subs = (lineup.substitutes as Array<{ player: Record<string, unknown> }>) ?? [];

    // DB columns: fixture_id (FK), api_fixture_id, team_id, team_name, formation, coach_name, starting_xi, substitutes
    const { error: lErr } = await sb.from("football_lineups").upsert(
      {
        fixture_id: fixtureUuid,
        api_fixture_id: fixtureId,
        team_id: (team.id as number) ?? null,
        team_name: (team.name as string) ?? "Unknown",
        formation: (lineup.formation as string) ?? null,
        coach_name: (coach?.name as string) ?? null,
        starting_xi: startXI.map((p) => ({
          id: p.player.id,
          name: p.player.name,
          number: p.player.number,
          pos: p.player.pos,
          grid: p.player.grid,
        })),
        substitutes: subs.map((p) => ({
          id: p.player.id,
          name: p.player.name,
          number: p.player.number,
          pos: p.player.pos,
        })),
      },
      { onConflict: "api_fixture_id,team_id" },
    );
    if (lErr) throw new Error(`Lineup upsert: ${lErr.message}`);
  }

  // 3. Insert events (delete old + insert fresh)
  await sb.from("football_events").delete().eq("api_fixture_id", fixtureId);
  const events = (eventsResp.response ?? []) as Array<Record<string, unknown>>;
  if (events.length > 0) {
    const eventRows = events.map((e) => {
      const team = e.team as Record<string, unknown>;
      const player = e.player as Record<string, unknown>;
      const assist = e.assist as Record<string, unknown> | null;
      const time = e.time as Record<string, unknown>;
      // DB columns: fixture_id (FK), api_fixture_id, elapsed, extra_time, team_id, team_name, player_name, assist_name, event_type, event_detail, comments
      return {
        fixture_id: fixtureUuid,
        api_fixture_id: fixtureId,
        elapsed: (time.elapsed as number) ?? 0,
        extra_time: (time.extra as number) ?? null,
        team_id: (team.id as number) ?? null,
        team_name: (team.name as string) ?? null,
        player_name: (player.name as string) ?? null,
        assist_name: (assist?.name as string) ?? null,
        event_type: (e.type as string) ?? null,
        event_detail: (e.detail as string) ?? null,
        comments: (e.comments as string) ?? null,
      };
    });
    const { error: eErr } = await sb.from("football_events").insert(eventRows);
    if (eErr) throw new Error(`Events insert: ${eErr.message}`);
  }

  // 4. Upsert statistics (one per team)
  for (const stat of (statsResp.response ?? []) as Array<Record<string, unknown>>) {
    const team = stat.team as Record<string, unknown>;
    const stats = stat.statistics as Array<{ type: string; value: unknown }>;

    const getStatVal = (type: string): unknown =>
      stats?.find((s) => s.type === type)?.value ?? null;

    const parsePct = (val: unknown): number | null => {
      if (val === null || val === undefined) return null;
      const s = String(val).replace("%", "");
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };

    const parseNum = (val: unknown): number | null => {
      if (val === null || val === undefined) return null;
      const n = Number(val);
      return isNaN(n) ? null : n;
    };

    const rawStats: Record<string, unknown> = {};
    for (const s of stats ?? []) {
      rawStats[s.type] = s.value;
    }

    // DB columns: fixture_id (FK), shots_total (not total_shots), shots_blocked (not blocked_shots)
    const { error: sErr } = await sb.from("football_statistics").upsert(
      {
        fixture_id: fixtureUuid,
        api_fixture_id: fixtureId,
        team_id: (team.id as number) ?? null,
        team_name: (team.name as string) ?? null,
        shots_on_goal: parseNum(getStatVal("Shots on Goal")),
        shots_off_goal: parseNum(getStatVal("Shots off Goal")),
        shots_total: parseNum(getStatVal("Total Shots")),
        shots_blocked: parseNum(getStatVal("Blocked Shots")),
        shots_inside_box: parseNum(getStatVal("Shots insidebox")),
        shots_outside_box: parseNum(getStatVal("Shots outsidebox")),
        fouls: parseNum(getStatVal("Fouls")),
        corner_kicks: parseNum(getStatVal("Corner Kicks")),
        offsides: parseNum(getStatVal("Offsides")),
        possession: parsePct(getStatVal("Ball Possession")),
        yellow_cards: parseNum(getStatVal("Yellow Cards")),
        red_cards: parseNum(getStatVal("Red Cards")),
        goalkeeper_saves: parseNum(getStatVal("Goalkeeper Saves")),
        total_passes: parseNum(getStatVal("Total passes")),
        passes_accurate: parseNum(getStatVal("Passes accurate")),
        passes_pct: parsePct(getStatVal("Passes %")),
        expected_goals: parseNum(getStatVal("expected_goals")),
        raw_stats: rawStats,
      },
      { onConflict: "api_fixture_id,team_id" },
    );
    if (sErr) throw new Error(`Statistics upsert: ${sErr.message}`);
  }

  // 5. Upsert player stats (individual per-match statistics)
  let playerCount = 0;
  for (const teamData of (playersResp.response ?? []) as Array<Record<string, unknown>>) {
    const team = teamData.team as Record<string, unknown>;
    const players = (teamData.players as Array<Record<string, unknown>>) ?? [];

    for (const p of players) {
      const player = p.player as Record<string, unknown>;
      const statArr = p.statistics as Array<Record<string, unknown>>;
      const s = statArr?.[0]; // First (and usually only) statistics entry
      if (!s) continue;

      const games = s.games as Record<string, unknown> | null;
      const shots = s.shots as Record<string, unknown> | null;
      const goalsData = s.goals as Record<string, unknown> | null;
      const passes = s.passes as Record<string, unknown> | null;
      const tacklesData = s.tackles as Record<string, unknown> | null;
      const duels = s.duels as Record<string, unknown> | null;
      const dribbles = s.dribbles as Record<string, unknown> | null;
      const foulsData = s.fouls as Record<string, unknown> | null;
      const cards = s.cards as Record<string, unknown> | null;
      const penalty = s.penalty as Record<string, unknown> | null;

      const toNum = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };

      const parsePctStr = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const str = String(v).replace("%", "");
        const n = parseFloat(str);
        return isNaN(n) ? null : n;
      };

      const { error: psErr } = await sb.from("football_player_stats").upsert(
        {
          fixture_id: fixtureUuid,
          api_fixture_id: fixtureId,
          team_id: toNum(team.id),
          team_name: (team.name as string) ?? null,
          player_id: toNum(player.id) ?? 0,
          player_name: (player.name as string) ?? "Unknown",
          position: (games?.position as string) ?? null,
          rating: toNum(games?.rating),
          minutes_played: toNum(games?.minutes),
          is_substitute: (games?.substitute as boolean) ?? false,
          is_captain: (games?.captain as boolean) ?? false,
          shots_total: toNum(shots?.total),
          shots_on_target: toNum(shots?.on),
          goals: toNum(goalsData?.total),
          assists: toNum(goalsData?.assists),
          goals_conceded: toNum(goalsData?.conceded),
          saves: toNum(goalsData?.saves),
          passes_total: toNum(passes?.total),
          passes_key: toNum(passes?.key),
          passes_accuracy: parsePctStr(passes?.accuracy),
          tackles: toNum(tacklesData?.total),
          blocks: toNum(tacklesData?.blocks),
          interceptions: toNum(tacklesData?.interceptions),
          duels_total: toNum(duels?.total),
          duels_won: toNum(duels?.won),
          dribbles_attempted: toNum(dribbles?.attempts),
          dribbles_succeeded: toNum(dribbles?.success),
          fouls_drawn: toNum(foulsData?.drawn),
          fouls_committed: toNum(foulsData?.committed),
          yellow_cards: toNum(cards?.yellow) ?? 0,
          red_cards: toNum(cards?.red) ?? 0,
          penalty_scored: toNum(penalty?.scored) ?? 0,
          penalty_missed: toNum(penalty?.missed) ?? 0,
          penalty_saved: toNum(penalty?.saved) ?? 0,
          penalty_won: toNum(penalty?.won) ?? 0,
          penalty_committed: toNum(penalty?.commited) ?? 0, // API typo: "commited"
          offsides: toNum(s.offsides),
          raw_stats: s,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "api_fixture_id,player_id" },
      );
      if (psErr) throw new Error(`Player stats upsert: ${psErr.message}`);
      playerCount++;
    }
  }

  return {
    fixture_id: fixtureId,
    home: teams.home?.name ?? "Unknown",
    away: teams.away?.name ?? "Unknown",
    score: `${goals.home ?? "?"}-${goals.away ?? "?"}`,
    events_count: events.length,
    player_stats_count: playerCount,
  };
}

// --- Action: sync_league_recent ---
// Syncs all fixtures for a league in the current or specified season
async function syncLeagueRecent(
  leagueId: number,
  season: number,
  last?: number,
): Promise<{ synced: number; fixtures: Array<{ id: number; match: string; score: string }> }> {
  const resp = (await apiFootball("fixtures", {
    league: leagueId,
    season,
    last: last ?? 10,
  })) as { response: Array<Record<string, unknown>> };

  const results = [];
  for (const f of resp.response ?? []) {
    const fInfo = f.fixture as Record<string, unknown>;
    const id = fInfo.id as number;
    try {
      const result = await syncFixture(id);
      results.push({ id, match: `${result.home} vs ${result.away}`, score: result.score });
    } catch (err) {
      results.push({ id, match: "error", score: String(err) });
    }
  }

  // Batch-sync injuries for players in synced fixtures (best-effort)
  const sb = getServiceClient();
  const syncedFixtureIds = results.filter((r) => r.score !== "error").map((r) => r.id);
  let injuriesSynced = 0;
  if (syncedFixtureIds.length > 0) {
    const { data: players } = await sb
      .from("football_player_stats")
      .select("api_player_id")
      .in("api_fixture_id", syncedFixtureIds)
      .not("api_player_id", "is", null);
    const uniquePlayerIds = [...new Set((players ?? []).map((p: { api_player_id: number }) => p.api_player_id))];
    for (const pid of uniquePlayerIds.slice(0, 50)) { // Cap at 50 to avoid rate limits
      try {
        await syncInjuries(pid);
        injuriesSynced++;
      } catch (_) { /* best-effort — continue on per-player errors */ }
    }
  }

  return { synced: results.filter((r) => r.score !== "error").length, fixtures: results, injuries_synced: injuriesSynced };
}

// --- Action: sync_standings ---
async function syncStandings(
  leagueId: number,
  season: number,
): Promise<{ league: string; teams: number }> {
  const resp = (await apiFootball("standings", {
    league: leagueId,
    season,
  })) as { response: Array<Record<string, unknown>> };

  const leagueData = resp.response?.[0];
  if (!leagueData) throw new Error(`No standings for league ${leagueId}`);

  const league = leagueData.league as Record<string, unknown>;
  const standings = (league.standings as Array<Array<Record<string, unknown>>>)?.[0] ?? [];

  const sb = getServiceClient();

  for (const team of standings) {
    const teamInfo = team.team as Record<string, unknown>;
    const all = team.all as Record<string, unknown>;
    const goalsInfo = all?.goals as Record<string, number> | null;

    // DB columns: no description column, has raw_data + synced_at
    const { error } = await sb.from("football_standings").upsert(
      {
        league_id: leagueId,
        season,
        team_id: (teamInfo.id as number) ?? null,
        team_name: (teamInfo.name as string) ?? "Unknown",
        rank: (team.rank as number) ?? null,
        points: (team.points as number) ?? null,
        played: (all?.played as number) ?? null,
        wins: (all?.win as number) ?? null,
        draws: (all?.draw as number) ?? null,
        losses: (all?.lose as number) ?? null,
        goals_for: goalsInfo?.for ?? null,
        goals_against: goalsInfo?.against ?? null,
        goal_diff: (team.goalsDiff as number) ?? null,
        form: (team.form as string) ?? null,
        raw_data: team,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "league_id,season,team_id" },
    );
    if (error) throw new Error(`Standings upsert: ${error.message}`);
  }

  return {
    league: (league.name as string) ?? `League ${leagueId}`,
    teams: standings.length,
  };
}

// --- Action: sync_upcoming ---
// Fetches upcoming fixtures for a league (for coach prep)
async function syncUpcoming(
  leagueId: number,
  season: number,
  next?: number,
): Promise<{ count: number; fixtures: Array<{ id: number; match: string; date: string }> }> {
  const resp = (await apiFootball("fixtures", {
    league: leagueId,
    season,
    next: next ?? 5,
  })) as { response: Array<Record<string, unknown>> };

  const sb = getServiceClient();
  const results = [];

  for (const f of resp.response ?? []) {
    const fInfo = f.fixture as Record<string, unknown>;
    const teams = f.teams as Record<string, { id: number; name: string }>;
    const league = f.league as Record<string, unknown>;
    const venue = fInfo.venue as Record<string, unknown> | null;
    const id = fInfo.id as number;

    const { error } = await sb.from("football_fixtures").upsert(
      {
        api_fixture_id: id,
        league_id: (league.id as number) ?? null,
        league_name: (league.name as string) ?? null,
        league_country: (league.country as string) ?? null,
        season: (league.season as number) ?? season,
        home_team_name: teams.home?.name ?? "Unknown",
        home_team_id: teams.home?.id ?? null,
        away_team_name: teams.away?.name ?? "Unknown",
        away_team_id: teams.away?.id ?? null,
        match_date: (fInfo.date as string) ?? null,
        status_short: ((fInfo.status as Record<string, unknown>)?.short as string) ?? null,
        status_long: ((fInfo.status as Record<string, unknown>)?.long as string) ?? null,
        venue_name: (venue?.name as string) ?? null,
        venue_city: (venue?.city as string) ?? null,
        referee: (fInfo.referee as string) ?? null,
        raw_data: f,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "api_fixture_id" },
    );
    if (error) throw new Error(`Upcoming upsert: ${error.message}`);

    results.push({
      id,
      match: `${teams.home?.name} vs ${teams.away?.name}`,
      date: (fInfo.date as string)?.slice(0, 10) ?? "unknown",
    });
  }

  return { count: results.length, fixtures: results };
}

// --- Action: sync_player_stats (standalone — for backfilling) ---
async function syncPlayerStatsOnly(fixtureId: number): Promise<{
  fixture_id: number;
  players_synced: number;
}> {
  const playersResp = (await apiFootball("fixtures/players", {
    fixture: fixtureId,
  })) as { response: Array<Record<string, unknown>> };

  const sb = getServiceClient();

  // Resolve fixture UUID
  const { data: fxRow } = await sb.from("football_fixtures")
    .select("id").eq("api_fixture_id", fixtureId).single();
  if (!fxRow) throw new Error(`Fixture ${fixtureId} not found in DB`);
  const fixtureUuid = fxRow.id;

  let count = 0;
  for (const teamData of (playersResp.response ?? []) as Array<Record<string, unknown>>) {
    const team = teamData.team as Record<string, unknown>;
    const players = (teamData.players as Array<Record<string, unknown>>) ?? [];

    for (const p of players) {
      const player = p.player as Record<string, unknown>;
      const statArr = p.statistics as Array<Record<string, unknown>>;
      const s = statArr?.[0];
      if (!s) continue;

      const games = s.games as Record<string, unknown> | null;
      const shots = s.shots as Record<string, unknown> | null;
      const goalsData = s.goals as Record<string, unknown> | null;
      const passes = s.passes as Record<string, unknown> | null;
      const tacklesData = s.tackles as Record<string, unknown> | null;
      const duels = s.duels as Record<string, unknown> | null;
      const dribbles = s.dribbles as Record<string, unknown> | null;
      const foulsData = s.fouls as Record<string, unknown> | null;
      const cards = s.cards as Record<string, unknown> | null;
      const penalty = s.penalty as Record<string, unknown> | null;

      const toNum = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };

      const parsePctStr = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const str = String(v).replace("%", "");
        const n = parseFloat(str);
        return isNaN(n) ? null : n;
      };

      const { error: psErr } = await sb.from("football_player_stats").upsert(
        {
          fixture_id: fixtureUuid,
          api_fixture_id: fixtureId,
          team_id: toNum(team.id),
          team_name: (team.name as string) ?? null,
          player_id: toNum(player.id) ?? 0,
          player_name: (player.name as string) ?? "Unknown",
          position: (games?.position as string) ?? null,
          rating: toNum(games?.rating),
          minutes_played: toNum(games?.minutes),
          is_substitute: (games?.substitute as boolean) ?? false,
          is_captain: (games?.captain as boolean) ?? false,
          shots_total: toNum(shots?.total),
          shots_on_target: toNum(shots?.on),
          goals: toNum(goalsData?.total),
          assists: toNum(goalsData?.assists),
          goals_conceded: toNum(goalsData?.conceded),
          saves: toNum(goalsData?.saves),
          passes_total: toNum(passes?.total),
          passes_key: toNum(passes?.key),
          passes_accuracy: parsePctStr(passes?.accuracy),
          tackles: toNum(tacklesData?.total),
          blocks: toNum(tacklesData?.blocks),
          interceptions: toNum(tacklesData?.interceptions),
          duels_total: toNum(duels?.total),
          duels_won: toNum(duels?.won),
          dribbles_attempted: toNum(dribbles?.attempts),
          dribbles_succeeded: toNum(dribbles?.success),
          fouls_drawn: toNum(foulsData?.drawn),
          fouls_committed: toNum(foulsData?.committed),
          yellow_cards: toNum(cards?.yellow) ?? 0,
          red_cards: toNum(cards?.red) ?? 0,
          penalty_scored: toNum(penalty?.scored) ?? 0,
          penalty_missed: toNum(penalty?.missed) ?? 0,
          penalty_saved: toNum(penalty?.saved) ?? 0,
          penalty_won: toNum(penalty?.won) ?? 0,
          penalty_committed: toNum(penalty?.commited) ?? 0,
          offsides: toNum(s.offsides),
          raw_stats: s,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "api_fixture_id,player_id" },
      );
      if (psErr) throw new Error(`Player stats upsert: ${psErr.message}`);
      count++;
    }
  }

  return { fixture_id: fixtureId, players_synced: count };
}

// --- Action: sync_all_player_stats ---
// Backfill player stats for all completed fixtures that don't have player stats yet
async function syncAllPlayerStats(limit?: number): Promise<{
  total_fixtures: number;
  synced: number;
  total_players: number;
  errors: string[];
}> {
  const sb = getServiceClient();

  // Find completed fixtures without player stats
  const { data: fixtures, error: qErr } = await sb
    .from("football_fixtures")
    .select("api_fixture_id")
    .in("status_short", ["FT", "AET", "PEN"])
    .order("match_date", { ascending: false })
    .limit(limit ?? 50);

  if (qErr) throw new Error(`Query fixtures: ${qErr.message}`);
  if (!fixtures || fixtures.length === 0) return { total_fixtures: 0, synced: 0, total_players: 0, errors: [] };

  // Check which already have player stats
  const apiIds = fixtures.map((f) => f.api_fixture_id);
  const { data: existing } = await sb
    .from("football_player_stats")
    .select("api_fixture_id")
    .in("api_fixture_id", apiIds);

  const existingIds = new Set((existing ?? []).map((e) => e.api_fixture_id));
  const toSync = fixtures.filter((f) => !existingIds.has(f.api_fixture_id));

  let synced = 0;
  let totalPlayers = 0;
  const errors: string[] = [];

  for (const f of toSync) {
    try {
      const result = await syncPlayerStatsOnly(f.api_fixture_id);
      totalPlayers += result.players_synced;
      synced++;
    } catch (err) {
      errors.push(`${f.api_fixture_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { total_fixtures: fixtures.length, synced, total_players: totalPlayers, errors };
}

// --- Action: sync_player_profiles ---
// Syncs player profiles for a team from API-Football /players
async function syncPlayerProfiles(
  teamId: number,
  season: number,
): Promise<{ team_id: number; players_synced: number }> {
  const sb = getServiceClient();
  let page = 1;
  let totalSynced = 0;

  // API-Football paginates /players — loop all pages
  while (true) {
    const resp = (await apiFootball("players", {
      team: teamId,
      season,
      page,
    })) as { response: Array<Record<string, unknown>>; paging: { current: number; total: number } };

    for (const entry of resp.response ?? []) {
      const player = entry.player as Record<string, unknown>;
      const stats = (entry.statistics as Array<Record<string, unknown>>)?.[0];
      const team = stats?.team as Record<string, unknown> | null;
      const league = stats?.league as Record<string, unknown> | null;
      const games = stats?.games as Record<string, unknown> | null;

      const { error } = await sb.from("football_players").upsert(
        {
          api_player_id: player.id as number,
          name: (player.name as string) ?? "Unknown",
          firstname: (player.firstname as string) ?? null,
          lastname: (player.lastname as string) ?? null,
          nationality: (player.nationality as string) ?? null,
          birth_date: ((player.birth as Record<string, unknown>)?.date as string) ?? null,
          age: (player.age as number) ?? null,
          height: (player.height as string) ?? null,
          weight: (player.weight as string) ?? null,
          photo_url: (player.photo as string) ?? null,
          current_team_id: (team?.id as number) ?? teamId,
          current_team_name: (team?.name as string) ?? null,
          current_league_id: (league?.id as number) ?? null,
          position: (games?.position as string) ?? null,
          injured: (player.injured as boolean) ?? false,
          raw_profile: entry,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "api_player_id" },
      );
      if (error) throw new Error(`Player profile upsert: ${error.message}`);
      totalSynced++;
    }

    if (page >= (resp.paging?.total ?? 1)) break;
    page++;
  }

  return { team_id: teamId, players_synced: totalSynced };
}

// --- Action: sync_transfers ---
// Syncs transfer history for a player from API-Football /transfers
async function syncTransfers(playerId: number): Promise<{ player_id: number; transfers_synced: number }> {
  const resp = (await apiFootball("transfers", { player: playerId })) as {
    response: Array<{ player: Record<string, unknown>; transfers: Array<Record<string, unknown>> }>;
  };

  const sb = getServiceClient();
  let count = 0;

  for (const entry of resp.response ?? []) {
    const playerName = (entry.player?.name as string) ?? null;
    for (const t of entry.transfers ?? []) {
      const teams = t.teams as Record<string, Record<string, unknown>>;
      const { error } = await sb.from("football_transfers").upsert(
        {
          api_player_id: playerId,
          player_name: playerName,
          transfer_date: (t.date as string) ?? null,
          from_team_id: (teams?.out?.id as number) ?? null,
          from_team_name: (teams?.out?.name as string) ?? null,
          to_team_id: (teams?.in?.id as number) ?? null,
          to_team_name: (teams?.in?.name as string) ?? null,
          transfer_type: (t.type as string) ?? null,
          transfer_fee: null, // API-Football free tier may not include fee
          raw_data: t,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "api_player_id,transfer_date,from_team_id,to_team_id" },
      );
      if (error) throw new Error(`Transfer upsert: ${error.message}`);
      count++;
    }
  }

  return { player_id: playerId, transfers_synced: count };
}

// --- Action: sync_injuries ---
// Syncs injury/sidelined history for a player from API-Football /sidelined
async function syncInjuries(playerId: number): Promise<{ player_id: number; injuries_synced: number }> {
  const resp = (await apiFootball("sidelined", { player: playerId })) as {
    response: Array<Record<string, unknown>>;
  };

  const sb = getServiceClient();
  let count = 0;

  for (const entry of resp.response ?? []) {
    const { error } = await sb.from("football_injuries").upsert(
      {
        api_player_id: playerId,
        player_name: null, // API doesn't include name in sidelined response
        injury_type: (entry.type as string) ?? "Unknown",
        injury_reason: (entry.type as string) ?? null,
        start_date: (entry.start as string) ?? null,
        end_date: (entry.end as string) ?? null,
        raw_data: entry,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "api_player_id,injury_type,start_date" },
    );
    if (error) throw new Error(`Injury upsert: ${error.message}`);
    count++;
  }

  return { player_id: playerId, injuries_synced: count };
}

// --- Action: sync_trophies ---
// Syncs trophies for a player from API-Football /trophies
async function syncTrophies(playerId: number): Promise<{ player_id: number; trophies_synced: number }> {
  const resp = (await apiFootball("trophies", { player: playerId })) as {
    response: Array<Record<string, unknown>>;
  };

  const sb = getServiceClient();
  let count = 0;

  for (const entry of resp.response ?? []) {
    const { error } = await sb.from("football_trophies").upsert(
      {
        api_player_id: playerId,
        player_name: null,
        trophy_name: (entry.league as string) ?? "Unknown",
        league: (entry.league as string) ?? null,
        country: (entry.country as string) ?? null,
        season: (entry.season as string) ?? null,
        place: (entry.place as string) ?? null,
        raw_data: entry,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "api_player_id,trophy_name,season" },
    );
    if (error) throw new Error(`Trophy upsert: ${error.message}`);
    count++;
  }

  return { player_id: playerId, trophies_synced: count };
}

// --- Action: sync_coaches ---
// Syncs coach profile for a team from API-Football /coachs
async function syncCoaches(teamId: number): Promise<{ team_id: number; coaches_synced: number }> {
  const resp = (await apiFootball("coachs", { team: teamId })) as {
    response: Array<Record<string, unknown>>;
  };

  const sb = getServiceClient();
  let count = 0;

  for (const entry of resp.response ?? []) {
    const career = (entry.career as Array<Record<string, unknown>>) ?? [];
    const careerHistory = career.map((c) => ({
      team_id: (c.team as Record<string, unknown>)?.id,
      team_name: (c.team as Record<string, unknown>)?.name,
      start: c.start,
      end: c.end,
    }));

    // Find current team from career (end === null)
    const currentCareer = career.find((c) => c.end === null);
    const currentTeam = currentCareer?.team as Record<string, unknown> | undefined;

    const { error } = await sb.from("football_coaches").upsert(
      {
        api_coach_id: (entry.id as number) ?? 0,
        name: (entry.name as string) ?? "Unknown",
        firstname: (entry.firstname as string) ?? null,
        lastname: (entry.lastname as string) ?? null,
        nationality: (entry.nationality as string) ?? null,
        birth_date: ((entry.birth as Record<string, unknown>)?.date as string) ?? null,
        age: (entry.age as number) ?? null,
        photo_url: (entry.photo as string) ?? null,
        current_team_id: (currentTeam?.id as number) ?? teamId,
        current_team_name: (currentTeam?.name as string) ?? null,
        career_history: careerHistory,
        raw_profile: entry,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "api_coach_id" },
    );
    if (error) throw new Error(`Coach upsert: ${error.message}`);
    count++;
  }

  return { team_id: teamId, coaches_synced: count };
}

// --- Action: sync_team_stats ---
// Syncs team statistics for a season from API-Football /teams/statistics
async function syncTeamStats(
  teamId: number,
  leagueId: number,
  season: number,
): Promise<{ team_id: number; league_id: number; season: number }> {
  const resp = (await apiFootball("teams/statistics", {
    team: teamId,
    league: leagueId,
    season,
  })) as { response: Record<string, unknown> };

  const data = resp.response;
  if (!data) throw new Error(`No team stats for team ${teamId}`);

  const team = data.team as Record<string, unknown>;
  const fixtures = data.fixtures as Record<string, Record<string, unknown>> | null;
  const goals = data.goals as Record<string, Record<string, Record<string, unknown>>> | null;
  const clean_sheet = data.clean_sheet as Record<string, number> | null;
  const penalty = data.penalty as Record<string, Record<string, unknown>> | null;
  const form = (data.form as string) ?? null;
  const biggest = data.biggest as Record<string, unknown> | null;

  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  const sb = getServiceClient();
  const { error } = await sb.from("football_team_stats").upsert(
    {
      api_team_id: (team.id as number) ?? teamId,
      team_name: (team.name as string) ?? "Unknown",
      league_id: leagueId,
      season,
      matches_played: toNum(fixtures?.played?.total),
      wins: toNum(fixtures?.wins?.total),
      draws: toNum(fixtures?.draws?.total),
      losses: toNum(fixtures?.loses?.total),
      goals_for: toNum(goals?.for?.total?.total),
      goals_against: toNum(goals?.against?.total?.total),
      clean_sheets: toNum(clean_sheet?.total),
      penalty_scored: toNum(penalty?.scored?.total),
      penalty_missed: toNum(penalty?.missed?.total),
      form: form?.slice(-10) ?? null, // Last 10 matches
      biggest_win: (biggest?.wins as Record<string, unknown>)?.home as string ?? null,
      biggest_loss: (biggest?.loses as Record<string, unknown>)?.home as string ?? null,
      avg_goals_for: toNum(goals?.for?.average?.total),
      avg_goals_against: toNum(goals?.against?.average?.total),
      raw_data: data,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "api_team_id,league_id,season" },
  );
  if (error) throw new Error(`Team stats upsert: ${error.message}`);

  return { team_id: teamId, league_id: leagueId, season };
}

// --- Action: sync_full_league ---
// Bulk sync: all teams + players + coaches for a league+season
async function syncFullLeague(
  leagueId: number,
  season: number,
): Promise<{
  league_id: number;
  season: number;
  teams: number;
  players: number;
  coaches: number;
  errors: string[];
}> {
  // 1. Get all teams in the league via standings
  const standingsResp = (await apiFootball("standings", {
    league: leagueId,
    season,
  })) as { response: Array<Record<string, unknown>> };

  const leagueData = standingsResp.response?.[0];
  if (!leagueData) throw new Error(`No standings for league ${leagueId} season ${season}`);

  const league = leagueData.league as Record<string, unknown>;
  const standings = (league.standings as Array<Array<Record<string, unknown>>>)?.[0] ?? [];
  const teamIds = standings.map((t) => {
    const team = t.team as Record<string, unknown>;
    return team.id as number;
  }).filter(Boolean);

  let totalPlayers = 0;
  let totalCoaches = 0;
  const errors: string[] = [];

  // 2. Sync standings first
  try {
    await syncStandings(leagueId, season);
  } catch (err) {
    errors.push(`standings: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. For each team: sync player profiles + coaches + team stats
  for (const tId of teamIds) {
    // Player profiles
    try {
      const pResult = await syncPlayerProfiles(tId, season);
      totalPlayers += pResult.players_synced;
    } catch (err) {
      errors.push(`players team ${tId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Coaches
    try {
      const cResult = await syncCoaches(tId);
      totalCoaches += cResult.coaches_synced;
    } catch (err) {
      errors.push(`coaches team ${tId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Team stats
    try {
      await syncTeamStats(tId, leagueId, season);
    } catch (err) {
      errors.push(`team_stats ${tId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    league_id: leagueId,
    season,
    teams: teamIds.length,
    players: totalPlayers,
    coaches: totalCoaches,
    errors,
  };
}

// --- Action: sync_season_fixtures ---
// Fetches ALL completed fixtures for a league+season and syncs a batch.
// Use offset + batch_size to paginate through all fixtures across multiple calls.
async function syncSeasonFixtures(
  leagueId: number,
  season: number,
  offset = 0,
  batchSize = 30,
): Promise<{
  league_id: number;
  season: number;
  total_completed: number;
  batch_offset: number;
  batch_size: number;
  synced: number;
  has_more: boolean;
  errors: string[];
}> {
  // Fetch all fixtures for the season (no 'last' param = all)
  const resp = (await apiFootball("fixtures", {
    league: leagueId,
    season,
  })) as { response: Array<Record<string, unknown>> };

  const allFixtures = resp.response ?? [];
  // Only sync completed matches, sorted by date
  const completed = allFixtures
    .filter((f) => {
      const fixture = f.fixture as Record<string, unknown>;
      const status = fixture.status as Record<string, unknown>;
      return ["FT", "AET", "PEN"].includes((status?.short as string) ?? "");
    })
    .sort((a, b) => {
      const da = ((a.fixture as Record<string, unknown>).date as string) ?? "";
      const db = ((b.fixture as Record<string, unknown>).date as string) ?? "";
      return da.localeCompare(db);
    });

  // Slice the batch
  const batch = completed.slice(offset, offset + batchSize);

  let synced = 0;
  const errors: string[] = [];

  for (const f of batch) {
    const fixture = f.fixture as Record<string, unknown>;
    const fixtureId = fixture.id as number;
    try {
      await syncFixture(fixtureId);
      synced++;
    } catch (err) {
      errors.push(`fixture ${fixtureId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    league_id: leagueId,
    season,
    total_completed: completed.length,
    batch_offset: offset,
    batch_size: batchSize,
    synced,
    has_more: offset + batchSize < completed.length,
    errors,
  };
}

// --- Action: sync_historical ---
// Loops through multiple seasons for a league
async function syncHistorical(
  leagueId: number,
  fromSeason: number,
  toSeason: number,
): Promise<{
  league_id: number;
  seasons_synced: Array<{ season: number; teams: number; players: number; coaches: number }>;
  errors: string[];
}> {
  const results = [];
  const allErrors: string[] = [];

  for (let season = fromSeason; season <= toSeason; season++) {
    try {
      const result = await syncFullLeague(leagueId, season);
      results.push({
        season,
        teams: result.teams,
        players: result.players,
        coaches: result.coaches,
      });
      allErrors.push(...result.errors);
    } catch (err) {
      allErrors.push(`season ${season}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { league_id: leagueId, seasons_synced: results, errors: allErrors };
}

// --- Main handler ---
Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: accept service_role JWT via apikey header (terminal) OR standard user JWT
  // Note: Supabase runtime injects sb_secret_ format key as SUPABASE_SERVICE_ROLE_KEY,
  // but terminal sends JWT format service_role key. Check JWT payload for role claim.
  const apiKeyHeader = req.headers.get("apikey") ?? "";
  let isServiceRole = false;
  try {
    if (apiKeyHeader.startsWith("eyJ")) {
      const payload = JSON.parse(atob(apiKeyHeader.split(".")[1]));
      isServiceRole = payload.role === "service_role" &&
        payload.ref === "czyzohfllffpgctslbwk";
    }
  } catch { /* not a valid JWT, continue to standard auth */ }

  if (!isServiceRole) {
    const auth = await authenticateRequest(req);
    if (!auth.ok) {
      return errorResponse(auth.error, corsHeaders, auth.status);
    }
  }

  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "sync_fixture": {
        const fixtureId = body.fixture_id as number;
        if (!fixtureId) return errorResponse("fixture_id required", corsHeaders);
        const result = await syncFixture(fixtureId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_league_recent": {
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        const last = body.last as number | undefined;
        const result = await syncLeagueRecent(leagueId, season, last);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_standings": {
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        const result = await syncStandings(leagueId, season);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_upcoming": {
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        const next = body.next as number | undefined;
        const result = await syncUpcoming(leagueId, season, next);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_all": {
        // Full sync: standings + recent matches + upcoming
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        const [standings, recent, upcoming] = await Promise.all([
          syncStandings(leagueId, season),
          syncLeagueRecent(leagueId, season, body.last ?? 10),
          syncUpcoming(leagueId, season, body.next ?? 5),
        ]);
        return jsonResponse({ ok: true, standings, recent, upcoming }, corsHeaders);
      }

      case "sync_player_stats": {
        const fixtureId = body.fixture_id as number;
        if (!fixtureId) return errorResponse("fixture_id required", corsHeaders);
        const result = await syncPlayerStatsOnly(fixtureId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_all_player_stats": {
        const limit = body.limit as number | undefined;
        const result = await syncAllPlayerStats(limit);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_player_profiles": {
        const teamId = body.team_id as number;
        if (!teamId) return errorResponse("team_id required", corsHeaders);
        const season = (body.season as number) ?? CURRENT_SEASON;
        const result = await syncPlayerProfiles(teamId, season);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_transfers": {
        const playerId = body.player_id as number;
        if (!playerId) return errorResponse("player_id (api_player_id) required", corsHeaders);
        const result = await syncTransfers(playerId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_injuries": {
        const playerId = body.player_id as number;
        if (!playerId) return errorResponse("player_id (api_player_id) required", corsHeaders);
        const result = await syncInjuries(playerId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_trophies": {
        const playerId = body.player_id as number;
        if (!playerId) return errorResponse("player_id (api_player_id) required", corsHeaders);
        const result = await syncTrophies(playerId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_coaches": {
        const teamId = body.team_id as number;
        if (!teamId) return errorResponse("team_id required", corsHeaders);
        const result = await syncCoaches(teamId);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_team_stats": {
        const teamId = body.team_id as number;
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        if (!teamId) return errorResponse("team_id required", corsHeaders);
        const result = await syncTeamStats(teamId, leagueId, season);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_full_league": {
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        const result = await syncFullLeague(leagueId, season);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_historical": {
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const fromSeason = (body.from_season as number) ?? 2020;
        const toSeason = (body.to_season as number) ?? CURRENT_SEASON;
        const result = await syncHistorical(leagueId, fromSeason, toSeason);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      case "sync_season_fixtures": {
        const leagueId = (body.league_id as number) ?? ALLSVENSKAN_LEAGUE_ID;
        const season = (body.season as number) ?? CURRENT_SEASON;
        const offset = (body.offset as number) ?? 0;
        const batchSize = (body.batch_size as number) ?? 30;
        const result = await syncSeasonFixtures(leagueId, season, offset, batchSize);
        return jsonResponse({ ok: true, ...result }, corsHeaders);
      }

      default:
        return errorResponse(
          `Unknown action: ${action}. Valid: sync_fixture, sync_league_recent, sync_standings, sync_upcoming, sync_all, sync_player_stats, sync_all_player_stats, sync_player_profiles, sync_transfers, sync_injuries, sync_trophies, sync_coaches, sync_team_stats, sync_full_league, sync_historical, sync_season_fixtures`,
          corsHeaders,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("football-data-sync error:", msg);
    return errorResponse(msg, corsHeaders, 500);
  }
});
