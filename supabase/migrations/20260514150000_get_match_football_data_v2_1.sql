-- Sprint 206 Item 3: get_match_football_data() v2.0 → v2.1
-- Adds to _meta: data_freshness (per-source MAX updated_at),
-- missing_sources (text[] of NO_DATA sources), staleness_warning (bool, any source >48h old).
-- VCE09-005 (WARN) remediation. ADDITIVE ONLY: all existing _meta fields preserved.

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
  -- v2.1 additions
  v_freshness_fixtures timestamptz;
  v_freshness_xg timestamptz;
  v_freshness_injuries timestamptz;
  v_freshness_player_stats timestamptz;
  v_freshness_standings timestamptz;
  v_data_freshness jsonb;
  v_missing_sources text[] := ARRAY[]::text[];
  v_staleness_warning boolean := false;
  v_stale_threshold timestamptz := now() - interval '48 hours';
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
    WHERE (
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

  -- Data availability counts
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

  -- v2.1: data_freshness — correct timestamp column per source table
  SELECT MAX(COALESCE(updated_at, created_at)) INTO v_freshness_fixtures FROM football_fixtures;
  SELECT MAX(created_at) INTO v_freshness_xg FROM football_xg;
  SELECT MAX(created_at) INTO v_freshness_injuries FROM football_injuries;
  SELECT MAX(synced_at) INTO v_freshness_player_stats FROM football_player_stats;
  SELECT MAX(synced_at) INTO v_freshness_standings FROM football_standings;

  v_data_freshness := jsonb_build_object(
    'fixtures',     to_jsonb(v_freshness_fixtures),
    'xg',           to_jsonb(v_freshness_xg),
    'injuries',     to_jsonb(v_freshness_injuries),
    'player_stats', to_jsonb(v_freshness_player_stats),
    'standings',    to_jsonb(v_freshness_standings)
  );

  -- v2.1: missing_sources — collect NO_DATA sources
  IF v_lineups_count = 0 THEN v_missing_sources := v_missing_sources || ARRAY['lineups']; END IF;
  IF v_xg_count = 0 THEN v_missing_sources := v_missing_sources || ARRAY['xg']; END IF;
  IF v_injuries_count = 0 THEN v_missing_sources := v_missing_sources || ARRAY['injuries']; END IF;
  IF v_player_stats_count = 0 THEN v_missing_sources := v_missing_sources || ARRAY['player_stats']; END IF;
  IF NOT v_derived_exists THEN v_missing_sources := v_missing_sources || ARRAY['derived']; END IF;
  IF NOT v_context_exists THEN v_missing_sources := v_missing_sources || ARRAY['context']; END IF;

  -- v2.1: staleness_warning — true if ANY available source has data older than 48h
  IF (v_freshness_fixtures IS NOT NULL AND v_freshness_fixtures < v_stale_threshold)
    OR (v_freshness_xg IS NOT NULL AND v_freshness_xg < v_stale_threshold)
    OR (v_freshness_injuries IS NOT NULL AND v_freshness_injuries < v_stale_threshold)
    OR (v_freshness_player_stats IS NOT NULL AND v_freshness_player_stats < v_stale_threshold)
    OR (v_freshness_standings IS NOT NULL AND v_freshness_standings < v_stale_threshold)
  THEN
    v_staleness_warning := true;
  END IF;

  -- 10-layer result (v2.1: _meta extended)
  v_result := jsonb_build_object(
    'found', true,
    '_meta', jsonb_build_object(
      'generated_at', now(), 'rpc_version', '2.1', 'sprint', 206, 'xg_source', 'footystats',
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
      'head_to_head', v_h2h,
      'data_freshness', v_data_freshness,
      'missing_sources', to_jsonb(v_missing_sources),
      'staleness_warning', v_staleness_warning
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

-- Assertion: verify v2.1 fields exist
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
  FROM pg_proc
  WHERE proname = 'get_match_football_data'
    AND pronamespace = 'public'::regnamespace;

  IF v_body NOT LIKE '%2.1%' THEN
    RAISE EXCEPTION 'Assertion failed: rpc_version 2.1 not found in get_match_football_data';
  END IF;
  IF v_body NOT LIKE '%data_freshness%' THEN
    RAISE EXCEPTION 'Assertion failed: data_freshness not found in get_match_football_data';
  END IF;
  IF v_body NOT LIKE '%missing_sources%' THEN
    RAISE EXCEPTION 'Assertion failed: missing_sources not found in get_match_football_data';
  END IF;
  IF v_body NOT LIKE '%staleness_warning%' THEN
    RAISE EXCEPTION 'Assertion failed: staleness_warning not found in get_match_football_data';
  END IF;
END;
$$;

COMMENT ON FUNCTION get_match_football_data IS
  'v2.1 Sprint 206: 10-layer match data with _meta (form, H2H, quality, data_freshness, missing_sources, staleness_warning). xG: FootyStats only.';
