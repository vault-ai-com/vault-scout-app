// ---------------------------------------------------------------------------
// football-data-sync — Synkar matchdata från API-Football till Supabase
// Actions: sync_fixture, sync_league_recent, sync_standings, sync_player_stats, sync_all_player_stats
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

  return { synced: results.filter((r) => r.score !== "error").length, fixtures: results };
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

// --- Main handler ---
Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return errorResponse(auth.error, corsHeaders, auth.status);
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

      default:
        return errorResponse(
          `Unknown action: ${action}. Valid: sync_fixture, sync_league_recent, sync_standings, sync_upcoming, sync_all, sync_player_stats, sync_all_player_stats`,
          corsHeaders,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("football-data-sync error:", msg);
    return errorResponse(msg, corsHeaders, 500);
  }
});
