-- Sprint 205: Data quality infrastructure for Vault Scout football data
-- 1. Data quality log table + check function
-- 2. Three materialized views for agent consumption
-- 3. Updated get_match_football_data() with _meta layer
-- NOTE: football_injuries + football_coaches lack league_id/season columns — queries use global counts.

-- ============================================================================
-- 1. DATA QUALITY LOG + MONITORING
-- ============================================================================

CREATE TABLE IF NOT EXISTS football_data_quality_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  check_type text NOT NULL,
  league_id integer,
  season integer,
  metric_name text NOT NULL,
  metric_value numeric,
  threshold numeric,
  status text NOT NULL DEFAULT 'OK',
  detail jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_football_dq_log_checked
  ON football_data_quality_log (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_football_dq_log_status
  ON football_data_quality_log (status) WHERE status != 'OK';

COMMENT ON TABLE football_data_quality_log IS 'Sprint 205: Tracks football data quality metrics over time';

-- check_data_quality(): Comprehensive quality check with logging
CREATE OR REPLACE FUNCTION check_data_quality(
  p_league_id integer DEFAULT 113,
  p_season integer DEFAULT 2026
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_fixtures int;
  v_finished_fixtures int;
  v_xg_count int;
  v_xg_pct numeric;
  v_injuries_count int;
  v_player_stats_count int;
  v_lineups_count int;
  v_latest_fixture_date date;
  v_freshness_days int;
  v_coaches_count int;
  v_standings_count int;
  v_results jsonb := '[]'::jsonb;
  v_overall_status text := 'OK';
  v_check_status text;
  v_check_value numeric;
BEGIN
  SELECT count(*) INTO v_total_fixtures
  FROM football_fixtures WHERE league_id = p_league_id AND season = p_season;
  SELECT count(*) INTO v_finished_fixtures
  FROM football_fixtures WHERE league_id = p_league_id AND season = p_season AND status_short = 'FT';

  -- xG coverage
  SELECT count(*) INTO v_xg_count
  FROM football_xg x JOIN football_fixtures f ON f.id = x.fixture_id
  WHERE f.league_id = p_league_id AND f.season = p_season AND f.status_short = 'FT';
  v_xg_pct := CASE WHEN v_finished_fixtures > 0
    THEN round((v_xg_count::numeric / v_finished_fixtures * 100)::numeric, 1) ELSE 0 END;
  v_check_status := CASE WHEN v_xg_pct >= 80 THEN 'OK' WHEN v_xg_pct >= 50 THEN 'WARN' ELSE 'CRITICAL' END;
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status, detail)
  VALUES ('completeness', p_league_id, p_season, 'xg_coverage_pct', v_xg_pct, 80, v_check_status,
    jsonb_build_object('xg_rows', v_xg_count, 'finished_fixtures', v_finished_fixtures));
  v_results := v_results || jsonb_build_object('metric', 'xg_coverage_pct', 'value', v_xg_pct, 'threshold', 80, 'status', v_check_status);
  IF v_check_status = 'CRITICAL' THEN v_overall_status := 'CRITICAL';
  ELSIF v_check_status = 'WARN' AND v_overall_status = 'OK' THEN v_overall_status := 'WARN'; END IF;

  -- Injuries (global count — table lacks league_id/season)
  SELECT count(*) INTO v_injuries_count FROM football_injuries;
  v_check_status := CASE WHEN v_injuries_count > 0 THEN 'OK' ELSE 'CRITICAL' END;
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status, detail)
  VALUES ('completeness', p_league_id, p_season, 'injuries_count', v_injuries_count, 1, v_check_status,
    jsonb_build_object('note', 'Global count — table lacks league_id/season'));
  v_results := v_results || jsonb_build_object('metric', 'injuries_count', 'value', v_injuries_count, 'threshold', 1, 'status', v_check_status);
  IF v_check_status = 'CRITICAL' THEN v_overall_status := 'CRITICAL';
  ELSIF v_check_status = 'WARN' AND v_overall_status = 'OK' THEN v_overall_status := 'WARN'; END IF;

  -- Player stats coverage
  SELECT count(DISTINCT ps.fixture_id) INTO v_player_stats_count
  FROM football_player_stats ps JOIN football_fixtures f ON f.id = ps.fixture_id
  WHERE f.league_id = p_league_id AND f.season = p_season;
  v_check_value := CASE WHEN v_finished_fixtures > 0
    THEN round((v_player_stats_count::numeric / v_finished_fixtures * 100)::numeric, 1) ELSE 0 END;
  v_check_status := CASE WHEN v_check_value >= 80 THEN 'OK' WHEN v_check_value >= 50 THEN 'WARN' ELSE 'CRITICAL' END;
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status)
  VALUES ('completeness', p_league_id, p_season, 'player_stats_coverage_pct', v_check_value, 80, v_check_status);
  v_results := v_results || jsonb_build_object('metric', 'player_stats_coverage_pct', 'value', v_check_value, 'threshold', 80, 'status', v_check_status);
  IF v_check_status = 'CRITICAL' THEN v_overall_status := 'CRITICAL';
  ELSIF v_check_status = 'WARN' AND v_overall_status = 'OK' THEN v_overall_status := 'WARN'; END IF;

  -- Lineups coverage
  SELECT count(DISTINCT l.fixture_id) INTO v_lineups_count
  FROM football_lineups l JOIN football_fixtures f ON f.id = l.fixture_id
  WHERE f.league_id = p_league_id AND f.season = p_season;
  v_check_value := CASE WHEN v_finished_fixtures > 0
    THEN round((v_lineups_count::numeric / v_finished_fixtures * 100)::numeric, 1) ELSE 0 END;
  v_check_status := CASE WHEN v_check_value >= 80 THEN 'OK' WHEN v_check_value >= 50 THEN 'WARN' ELSE 'CRITICAL' END;
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status)
  VALUES ('completeness', p_league_id, p_season, 'lineups_coverage_pct', v_check_value, 80, v_check_status);
  v_results := v_results || jsonb_build_object('metric', 'lineups_coverage_pct', 'value', v_check_value, 'threshold', 80, 'status', v_check_status);
  IF v_check_status = 'CRITICAL' THEN v_overall_status := 'CRITICAL';
  ELSIF v_check_status = 'WARN' AND v_overall_status = 'OK' THEN v_overall_status := 'WARN'; END IF;

  -- Freshness
  SELECT max(match_date::date) INTO v_latest_fixture_date
  FROM football_fixtures WHERE league_id = p_league_id AND season = p_season;
  v_freshness_days := CASE WHEN v_latest_fixture_date IS NOT NULL
    THEN (current_date - v_latest_fixture_date) ELSE 999 END;
  v_check_status := CASE WHEN v_freshness_days <= 3 THEN 'OK' WHEN v_freshness_days <= 7 THEN 'WARN' ELSE 'CRITICAL' END;
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status, detail)
  VALUES ('freshness', p_league_id, p_season, 'latest_fixture_age_days', v_freshness_days, 3, v_check_status,
    jsonb_build_object('latest_fixture_date', v_latest_fixture_date));
  v_results := v_results || jsonb_build_object('metric', 'latest_fixture_age_days', 'value', v_freshness_days, 'threshold', 3, 'status', v_check_status);
  IF v_check_status = 'CRITICAL' THEN v_overall_status := 'CRITICAL';
  ELSIF v_check_status = 'WARN' AND v_overall_status = 'OK' THEN v_overall_status := 'WARN'; END IF;

  -- Coaches (global — no league_id/season) + Standings (global)
  SELECT count(*) INTO v_coaches_count FROM football_coaches;
  SELECT count(*) INTO v_standings_count FROM football_standings;
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status)
  VALUES ('completeness', p_league_id, p_season, 'coaches_count', v_coaches_count, 1,
    CASE WHEN v_coaches_count > 0 THEN 'OK' ELSE 'WARN' END);
  INSERT INTO football_data_quality_log (check_type, league_id, season, metric_name, metric_value, threshold, status)
  VALUES ('completeness', p_league_id, p_season, 'standings_count', v_standings_count, 1,
    CASE WHEN v_standings_count > 0 THEN 'OK' ELSE 'WARN' END);

  RETURN jsonb_build_object(
    'overall_status', v_overall_status,
    'league_id', p_league_id, 'season', p_season,
    'total_fixtures', v_total_fixtures, 'finished_fixtures', v_finished_fixtures,
    'checked_at', now(), 'checks', v_results
  );
END;
$$;

COMMENT ON FUNCTION check_data_quality IS 'Sprint 205: Comprehensive data quality check with logging';

-- ============================================================================
-- 2. MATERIALIZED VIEWS (Agent-optimized, refresh via pg_cron)
-- ============================================================================

-- 2a. Team form: last 5 matches per team (deduplicated team_mapping)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_team_form AS
WITH team_map AS (
  SELECT DISTINCT ON (api_football_id) api_football_id, team_name
  FROM football_team_mapping WHERE is_active = true
  ORDER BY api_football_id, created_at DESC
),
ranked_matches AS (
  SELECT
    f.league_id, f.season, f.match_date, t.team_name, t.api_football_id AS team_id,
    CASE WHEN f.home_team_id = t.api_football_id THEN f.home_goals ELSE f.away_goals END AS goals_for,
    CASE WHEN f.home_team_id = t.api_football_id THEN f.away_goals ELSE f.home_goals END AS goals_against,
    CASE
      WHEN f.home_team_id = t.api_football_id AND f.home_goals > f.away_goals THEN 'W'
      WHEN f.away_team_id = t.api_football_id AND f.away_goals > f.home_goals THEN 'W'
      WHEN f.home_goals = f.away_goals THEN 'D' ELSE 'L'
    END AS result,
    ROW_NUMBER() OVER (PARTITION BY t.api_football_id, f.league_id, f.season ORDER BY f.match_date DESC) AS match_rank
  FROM football_fixtures f
  JOIN team_map t ON t.api_football_id IN (f.home_team_id, f.away_team_id)
  WHERE f.status_short = 'FT'
)
SELECT team_name, team_id, league_id, season,
  count(*) FILTER (WHERE match_rank <= 5) AS matches_last_5,
  count(*) FILTER (WHERE match_rank <= 5 AND result = 'W') AS wins_last_5,
  count(*) FILTER (WHERE match_rank <= 5 AND result = 'D') AS draws_last_5,
  count(*) FILTER (WHERE match_rank <= 5 AND result = 'L') AS losses_last_5,
  sum(goals_for) FILTER (WHERE match_rank <= 5) AS goals_for_last_5,
  sum(goals_against) FILTER (WHERE match_rank <= 5) AS goals_against_last_5,
  count(*) FILTER (WHERE match_rank <= 5 AND result = 'W') * 3
    + count(*) FILTER (WHERE match_rank <= 5 AND result = 'D') AS points_last_5,
  string_agg(result, '' ORDER BY match_rank) FILTER (WHERE match_rank <= 5) AS form_string,
  max(match_date) FILTER (WHERE match_rank = 1) AS last_match_date
FROM ranked_matches WHERE match_rank <= 5
GROUP BY team_name, team_id, league_id, season;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_team_form_pk ON mv_team_form (team_id, league_id, season);

-- 2b. Player season stats (non-unique index: player can play for 2 teams in same season)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_season_stats AS
SELECT
  ps.player_name, ps.player_id, ps.team_name, f.league_id, f.season,
  count(*) AS appearances,
  count(*) FILTER (WHERE NOT ps.is_substitute) AS starts,
  sum(ps.minutes_played) AS total_minutes,
  round(avg(ps.rating)::numeric, 2) AS avg_rating,
  sum(ps.goals) AS total_goals, sum(ps.assists) AS total_assists,
  sum(ps.yellow_cards) AS total_yellows, sum(ps.red_cards) AS total_reds,
  round(avg(ps.passes_accuracy)::numeric, 1) AS avg_pass_accuracy,
  round((sum(ps.goals)::numeric / NULLIF(sum(ps.minutes_played), 0) * 90)::numeric, 2) AS goals_per_90,
  round((sum(ps.assists)::numeric / NULLIF(sum(ps.minutes_played), 0) * 90)::numeric, 2) AS assists_per_90,
  round((sum(ps.duels_won)::numeric / NULLIF(sum(ps.duels_total), 0) * 100)::numeric, 1) AS duel_win_pct,
  round((sum(ps.dribbles_succeeded)::numeric / NULLIF(sum(ps.dribbles_attempted), 0) * 100)::numeric, 1) AS dribble_success_pct,
  max(f.match_date) AS last_played
FROM football_player_stats ps
JOIN football_fixtures f ON f.id = ps.fixture_id
WHERE f.status_short = 'FT'
GROUP BY ps.player_name, ps.player_id, ps.team_name, f.league_id, f.season;

CREATE INDEX IF NOT EXISTS idx_mv_player_season_lookup ON mv_player_season_stats (player_id, league_id, season);

-- 2c. Head-to-head records
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_head_to_head AS
SELECT
  LEAST(f.home_team_id, f.away_team_id) AS team_a_id,
  GREATEST(f.home_team_id, f.away_team_id) AS team_b_id,
  LEAST(f.home_team_name, f.away_team_name) AS team_a_name,
  GREATEST(f.home_team_name, f.away_team_name) AS team_b_name,
  f.league_id,
  count(*) AS total_matches,
  count(*) FILTER (WHERE
    (f.home_team_id = LEAST(f.home_team_id, f.away_team_id) AND f.home_goals > f.away_goals)
    OR (f.away_team_id = LEAST(f.home_team_id, f.away_team_id) AND f.away_goals > f.home_goals)
  ) AS team_a_wins,
  count(*) FILTER (WHERE f.home_goals = f.away_goals) AS draws,
  count(*) FILTER (WHERE
    (f.home_team_id = GREATEST(f.home_team_id, f.away_team_id) AND f.home_goals > f.away_goals)
    OR (f.away_team_id = GREATEST(f.home_team_id, f.away_team_id) AND f.away_goals > f.home_goals)
  ) AS team_b_wins,
  sum(f.home_goals + f.away_goals) AS total_goals,
  round(avg(f.home_goals + f.away_goals)::numeric, 1) AS avg_goals_per_match,
  max(f.match_date) AS last_meeting
FROM football_fixtures f WHERE f.status_short = 'FT'
GROUP BY LEAST(f.home_team_id, f.away_team_id), GREATEST(f.home_team_id, f.away_team_id),
  LEAST(f.home_team_name, f.away_team_name), GREATEST(f.home_team_name, f.away_team_name), f.league_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_h2h_pk ON mv_head_to_head (team_a_id, team_b_id, league_id);

-- 2d. pg_cron for MV refresh (daily 06:45-47 UTC, after fixture sync)
SELECT cron.schedule('refresh-mv-team-form', '45 6 * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_team_form$$);
SELECT cron.schedule('refresh-mv-player-season-stats', '46 6 * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_season_stats$$);
SELECT cron.schedule('refresh-mv-head-to-head', '47 6 * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_head_to_head$$);

-- 2e. Weekly data quality check (Mondays 08:00 UTC)
SELECT cron.schedule('football-data-quality-check', '0 8 * * 1', $$SELECT check_data_quality(113, 2026)$$);

-- ============================================================================
-- 3. UPDATED get_match_football_data() v2.0 with _meta layer
-- ============================================================================

CREATE OR REPLACE FUNCTION get_match_football_data(
  p_home_team text, p_away_team text,
  p_match_date date DEFAULT NULL, p_league_id integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_home_api_id integer; v_away_api_id integer;
  v_fixture record; v_result jsonb;
  v_lineups_count int; v_events_count int; v_stats_count int;
  v_xg_count int; v_player_stats_count int;
  v_derived_exists boolean; v_context_exists boolean;
  v_injuries_count int; v_total_xg_count int; v_total_fixtures_count int;
  v_coverage_warnings jsonb := '[]'::jsonb;
  v_injuries_data jsonb;
  v_home_form jsonb; v_away_form jsonb; v_h2h jsonb;
BEGIN
  -- Resolve team names
  SELECT api_football_id INTO v_home_api_id
  FROM football_team_mapping WHERE LOWER(team_name) = LOWER(p_home_team) AND is_active = true LIMIT 1;
  SELECT api_football_id INTO v_away_api_id
  FROM football_team_mapping WHERE LOWER(team_name) = LOWER(p_away_team) AND is_active = true LIMIT 1;

  -- Find fixture (deterministic first, fuzzy fallback)
  IF v_home_api_id IS NOT NULL AND v_away_api_id IS NOT NULL THEN
    SELECT * INTO v_fixture FROM football_fixtures
    WHERE ((home_team_id = v_home_api_id AND away_team_id = v_away_api_id)
      OR (home_team_id = v_away_api_id AND away_team_id = v_home_api_id))
    AND (p_match_date IS NULL OR ABS((match_date::date - p_match_date)::int) <= 3)
    AND (p_league_id IS NULL OR league_id = p_league_id)
    ORDER BY match_date DESC LIMIT 1;
  END IF;

  IF v_fixture IS NULL THEN
    SELECT * INTO v_fixture FROM football_fixtures
    WHERE ( -- Fuzzy Swedish char normalization for ILIKE (not function body manipulation)
      (REPLACE(REPLACE(REPLACE(LOWER(home_team_name),'ö','o'),'ä','a'),'å','a') -- migration-safety:ignore
        ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER(p_home_team),'ö','o'),'ä','a'),'å','a') || '%' -- migration-safety:ignore
       AND REPLACE(REPLACE(REPLACE(LOWER(away_team_name),'ö','o'),'ä','a'),'å','a') -- migration-safety:ignore
        ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER(p_away_team),'ö','o'),'ä','a'),'å','a') || '%') -- migration-safety:ignore
      OR
      (REPLACE(REPLACE(REPLACE(LOWER(home_team_name),'ö','o'),'ä','a'),'å','a') -- migration-safety:ignore
        ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER(p_away_team),'ö','o'),'ä','a'),'å','a') || '%' -- migration-safety:ignore
       AND REPLACE(REPLACE(REPLACE(LOWER(away_team_name),'ö','o'),'ä','a'),'å','a') -- migration-safety:ignore
        ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER(p_home_team),'ö','o'),'ä','a'),'å','a') || '%')) -- migration-safety:ignore
    AND (p_match_date IS NULL OR ABS((match_date::date - p_match_date)::int) <= 3)
    AND (p_league_id IS NULL OR league_id = p_league_id)
    ORDER BY match_date DESC LIMIT 1;
  END IF;

  IF v_fixture IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'No matching fixture found');
  END IF;

  -- Data availability
  SELECT count(*) INTO v_lineups_count FROM football_lineups WHERE fixture_id = v_fixture.id;
  SELECT count(*) INTO v_events_count FROM football_events WHERE fixture_id = v_fixture.id;
  SELECT count(*) INTO v_stats_count FROM football_statistics WHERE fixture_id = v_fixture.id;
  SELECT count(*) INTO v_xg_count FROM football_xg WHERE fixture_id = v_fixture.id;
  SELECT count(*) INTO v_player_stats_count FROM football_player_stats WHERE fixture_id = v_fixture.id;
  SELECT EXISTS(SELECT 1 FROM football_match_derived WHERE fixture_id = v_fixture.id) INTO v_derived_exists;
  SELECT EXISTS(SELECT 1 FROM football_match_context WHERE fixture_id = v_fixture.id) INTO v_context_exists;
  SELECT count(*) INTO v_injuries_count FROM football_injuries;
  SELECT count(*) INTO v_total_xg_count FROM football_xg;
  SELECT count(*) INTO v_total_fixtures_count FROM football_fixtures;

  -- MV data for _meta
  SELECT jsonb_build_object('form', form_string, 'points_last_5', points_last_5,
    'goals_for', goals_for_last_5, 'goals_against', goals_against_last_5) INTO v_home_form
  FROM mv_team_form WHERE team_id = v_fixture.home_team_id AND league_id = v_fixture.league_id AND season = v_fixture.season;
  SELECT jsonb_build_object('form', form_string, 'points_last_5', points_last_5,
    'goals_for', goals_for_last_5, 'goals_against', goals_against_last_5) INTO v_away_form
  FROM mv_team_form WHERE team_id = v_fixture.away_team_id AND league_id = v_fixture.league_id AND season = v_fixture.season;
  SELECT jsonb_build_object('total_matches', total_matches, 'team_a_name', team_a_name,
    'team_a_wins', team_a_wins, 'draws', draws, 'team_b_name', team_b_name,
    'team_b_wins', team_b_wins, 'avg_goals', avg_goals_per_match, 'last_meeting', last_meeting) INTO v_h2h
  FROM mv_head_to_head
  WHERE team_a_id = LEAST(v_fixture.home_team_id, v_fixture.away_team_id)
    AND team_b_id = GREATEST(v_fixture.home_team_id, v_fixture.away_team_id)
    AND league_id = v_fixture.league_id;

  -- Coverage warnings
  IF v_lineups_count = 0 THEN v_coverage_warnings := v_coverage_warnings || '["VARNING: Inga lineups. FABRICERA ALDRIG uppställningar."]'::jsonb; END IF;
  IF v_xg_count = 0 THEN v_coverage_warnings := v_coverage_warnings || '["VARNING: xG saknas. FABRICERA ALDRIG xG-värden."]'::jsonb; END IF;
  IF v_injuries_count = 0 THEN v_coverage_warnings := v_coverage_warnings || '["HALT: Skadedata saknas globalt. FABRICERA ALDRIG skadeinformation."]'::jsonb; END IF;
  IF v_player_stats_count = 0 THEN v_coverage_warnings := v_coverage_warnings || '["VARNING: Spelarstatistik saknas."]'::jsonb; END IF;
  IF NOT v_derived_exists THEN v_coverage_warnings := v_coverage_warnings || '["VARNING: Derived metrics saknas."]'::jsonb; END IF;
  IF NOT v_context_exists THEN v_coverage_warnings := v_coverage_warnings || '["VARNING: Matchkontext saknas."]'::jsonb; END IF;

  -- Injuries
  IF v_injuries_count > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'player_name', i.player_name, 'api_player_id', i.api_player_id,
      'injury_type', i.injury_type, 'injury_reason', i.injury_reason,
      'start_date', i.start_date, 'end_date', i.end_date
    )), '[]'::jsonb) INTO v_injuries_data
    FROM football_injuries i
    WHERE i.api_player_id IN (
      SELECT (jsonb_array_elements(l.starting_xi)->>'id')::int FROM football_lineups l WHERE l.fixture_id = v_fixture.id
      UNION
      SELECT (jsonb_array_elements(l.substitutes)->>'id')::int FROM football_lineups l WHERE l.fixture_id = v_fixture.id
    ) AND (i.end_date IS NULL OR i.end_date >= v_fixture.match_date - interval '7 days');
  ELSE
    v_injuries_data := jsonb_build_object('status', 'NO_DATA', 'instruction', 'FABRICERA ALDRIG skadeinformation.');
  END IF;

  -- 10-layer result
  v_result := jsonb_build_object(
    'found', true,
    '_meta', jsonb_build_object(
      'generated_at', now(), 'rpc_version', '2.0', 'sprint', 205, 'xg_source', 'footystats',
      'data_availability', jsonb_build_object(
        'fixture', 'AVAILABLE',
        'lineups', CASE WHEN v_lineups_count > 0 THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'events', CASE WHEN v_events_count > 0 THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'statistics', CASE WHEN v_stats_count > 0 THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'xg', CASE WHEN v_xg_count > 0 THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'player_stats', CASE WHEN v_player_stats_count > 0 THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'derived', CASE WHEN v_derived_exists THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'context', CASE WHEN v_context_exists THEN 'AVAILABLE' ELSE 'NO_DATA' END,
        'injuries', CASE WHEN v_injuries_count > 0 THEN 'AVAILABLE' ELSE 'NO_DATA' END
      ),
      'xg_global_coverage_pct', CASE WHEN v_total_fixtures_count > 0
        THEN round((v_total_xg_count::numeric / v_total_fixtures_count * 100)::numeric, 1) ELSE 0 END,
      'coverage_warnings', v_coverage_warnings,
      'team_form', jsonb_build_object('home', v_home_form, 'away', v_away_form),
      'head_to_head', v_h2h
    ),
    'fixture', jsonb_build_object(
      'id', v_fixture.id, 'api_fixture_id', v_fixture.api_fixture_id,
      'home_team', v_fixture.home_team_name, 'away_team', v_fixture.away_team_name,
      'home_goals', v_fixture.home_goals, 'away_goals', v_fixture.away_goals,
      'home_goals_ht', v_fixture.home_goals_ht, 'away_goals_ht', v_fixture.away_goals_ht,
      'match_date', v_fixture.match_date, 'venue', v_fixture.venue_name,
      'referee', v_fixture.referee, 'status', v_fixture.status_long
    ),
    'lineups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'team', l.team_name, 'formation', l.formation, 'coach', l.coach_name,
      'starting_xi', l.starting_xi, 'substitutes', l.substitutes
    )) FROM football_lineups l WHERE l.fixture_id = v_fixture.id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'minute', e.elapsed, 'extra_time', e.extra_time, 'team', e.team_name,
      'player', e.player_name, 'assist', e.assist_name, 'type', e.event_type, 'detail', e.event_detail
    ) ORDER BY e.elapsed, e.extra_time) FROM football_events e WHERE e.fixture_id = v_fixture.id), '[]'::jsonb),
    'statistics', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'team', s.team_name, 'possession', s.possession, 'shots_total', s.shots_total,
      'shots_on_goal', s.shots_on_goal, 'shots_off_goal', s.shots_off_goal,
      'corner_kicks', s.corner_kicks, 'fouls', s.fouls, 'offsides', s.offsides,
      'total_passes', s.total_passes, 'passes_accurate', s.passes_accurate, 'passes_pct', s.passes_pct,
      'yellow_cards', s.yellow_cards, 'red_cards', s.red_cards, 'expected_goals', s.expected_goals
    )) FROM football_statistics s WHERE s.fixture_id = v_fixture.id), '[]'::jsonb),
    'xg', COALESCE((SELECT jsonb_build_object(
      'home_xg', x.home_xg, 'away_xg', x.away_xg, 'source', x.source, 'shot_xg_data', x.shot_xg_data
    ) FROM football_xg x WHERE x.fixture_id = v_fixture.id LIMIT 1), 'null'::jsonb),
    'player_stats', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'player_name', ps.player_name, 'player_id', ps.player_id, 'team', ps.team_name,
      'position', ps.position, 'rating', ps.rating, 'minutes', ps.minutes_played,
      'is_substitute', ps.is_substitute, 'is_captain', ps.is_captain,
      'goals', ps.goals, 'assists', ps.assists, 'saves', ps.saves,
      'shots_total', ps.shots_total, 'shots_on_target', ps.shots_on_target,
      'passes_total', ps.passes_total, 'passes_key', ps.passes_key, 'passes_accuracy', ps.passes_accuracy,
      'tackles', ps.tackles, 'blocks', ps.blocks, 'interceptions', ps.interceptions,
      'duels_total', ps.duels_total, 'duels_won', ps.duels_won,
      'dribbles_attempted', ps.dribbles_attempted, 'dribbles_succeeded', ps.dribbles_succeeded,
      'fouls_drawn', ps.fouls_drawn, 'fouls_committed', ps.fouls_committed,
      'yellow_cards', ps.yellow_cards, 'red_cards', ps.red_cards,
      'penalty_scored', ps.penalty_scored, 'penalty_missed', ps.penalty_missed
    ) ORDER BY ps.team_name, ps.is_substitute, ps.position)
    FROM football_player_stats ps WHERE ps.fixture_id = v_fixture.id), '[]'::jsonb),
    'injuries', v_injuries_data,
    'derived', COALESCE((SELECT jsonb_build_object(
      'momentum_shifts', d.momentum_shifts, 'home_first_goal_min', d.home_first_goal_min,
      'away_first_goal_min', d.away_first_goal_min, 'biggest_cluster_goals', d.biggest_cluster_goals,
      'biggest_cluster_start_min', d.biggest_cluster_start_min, 'biggest_cluster_team', d.biggest_cluster_team,
      'home_possession_h1', d.home_possession_h1, 'possession_delta', d.possession_delta,
      'collapse_team', d.collapse_team, 'collapse_start_min', d.collapse_start_min,
      'comeback_team', d.comeback_team, 'comeback_start_min', d.comeback_start_min,
      'late_goals_home', d.late_goals_home, 'late_goals_away', d.late_goals_away,
      'cards_before_60', d.cards_before_60, 'cards_after_60', d.cards_after_60
    ) FROM football_match_derived d WHERE d.fixture_id = v_fixture.id), 'null'::jsonb),
    'context', COALESCE((SELECT jsonb_build_object(
      'is_derby', c.is_derby, 'derby_name', c.derby_name, 'rivalry_level', c.rivalry_level,
      'table_consequence', c.table_consequence, 'home_table_position', c.home_table_position,
      'away_table_position', c.away_table_position, 'points_gap_to_leader', c.points_gap_to_leader,
      'points_gap_to_relegation', c.points_gap_to_relegation, 'round_number', c.round_number,
      'is_last_5_rounds', c.is_last_5_rounds, 'home_form', c.home_form, 'away_form', c.away_form,
      'home_unbeaten_streak', c.home_unbeaten_streak, 'away_unbeaten_streak', c.away_unbeaten_streak,
      'home_winless_streak', c.home_winless_streak, 'away_winless_streak', c.away_winless_streak
    ) FROM football_match_context c WHERE c.fixture_id = v_fixture.id), 'null'::jsonb),
    'player_progression', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'player_name', pd.player_name, 'api_player_id', pd.api_player_id, 'team', pd.team_name,
      'matches_played', pd.matches_played, 'avg_rating', pd.avg_rating, 'rating_stddev', pd.rating_stddev,
      'goals_per_90', pd.goals_per_90, 'assists_per_90', pd.assists_per_90,
      'duels_won_pct', pd.duels_won_pct, 'dribble_success_pct', pd.dribble_success_pct,
      'rating_trend', pd.rating_trend, 'duels_trend', pd.duels_trend, 'passes_accuracy_trend', pd.passes_accuracy_trend
    ) ORDER BY pd.team_name, pd.avg_rating DESC NULLS LAST)
    FROM football_player_derived pd
    WHERE pd.season = v_fixture.season
      AND (pd.team_name ILIKE '%' || v_fixture.home_team_name || '%'
           OR pd.team_name ILIKE '%' || v_fixture.away_team_name || '%')
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_match_football_data IS 'v2.0 Sprint 205: 10-layer match data with _meta (form, H2H, quality). xG: FootyStats only.';
