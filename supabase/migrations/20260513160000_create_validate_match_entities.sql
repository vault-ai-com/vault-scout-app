-- Migration: Create validate_match_entities() — ENTITY_VALIDATOR
-- Sprint 202: Match Prediction Anti-Hallucination Pipeline
-- Cross-validates team names against football_fixtures and player coverage
-- against football_player_stats. Used by MP00 F0 LOAD (Steg 0.5).
-- HALT: fixture_not_found OR both teams have 0 players.
-- WARN: either team has < 5 players.

CREATE OR REPLACE FUNCTION validate_match_entities(
  p_home_team       text,
  p_away_team       text,
  p_fixture_api_id  int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home_players_found   int := 0;
  v_away_players_found   int := 0;
  v_fixture_found        boolean := false;
  v_fixture_api_id_match int;
  v_halt_reason          text := NULL;
  v_warnings             text[] := ARRAY[]::text[];
  v_valid                boolean;
  v_fuzzy_used           boolean := false;
BEGIN
  -- 1. FIXTURE VALIDATION
  IF p_fixture_api_id IS NOT NULL THEN
    SELECT api_fixture_id INTO v_fixture_api_id_match
    FROM football_fixtures
    WHERE api_fixture_id = p_fixture_api_id
    LIMIT 1;
    IF v_fixture_api_id_match IS NOT NULL THEN
      v_fixture_found := true;
    END IF;
  END IF;

  IF NOT v_fixture_found THEN
    SELECT EXISTS(
      SELECT 1 FROM football_fixtures
      WHERE LOWER(TRIM(home_team_name)) = LOWER(TRIM(p_home_team))
        AND LOWER(TRIM(away_team_name)) = LOWER(TRIM(p_away_team))
    ) INTO v_fixture_found;
  END IF;

  IF NOT v_fixture_found THEN
    SELECT EXISTS(
      SELECT 1 FROM football_fixtures
      WHERE (LOWER(TRIM(home_team_name)) LIKE '%' || LOWER(TRIM(p_home_team)) || '%'
        OR LOWER(TRIM(p_home_team)) LIKE '%' || LOWER(TRIM(home_team_name)) || '%')
      AND (LOWER(TRIM(away_team_name)) LIKE '%' || LOWER(TRIM(p_away_team)) || '%'
        OR LOWER(TRIM(p_away_team)) LIKE '%' || LOWER(TRIM(away_team_name)) || '%')
    ) INTO v_fixture_found;
    IF v_fixture_found THEN v_fuzzy_used := true; END IF;
  END IF;

  -- 2. PLAYER STATS VALIDATION
  SELECT COUNT(DISTINCT player_name) INTO v_home_players_found
  FROM football_player_stats
  WHERE LOWER(TRIM(team_name)) = LOWER(TRIM(p_home_team)) AND minutes_played > 0;

  IF v_home_players_found = 0 THEN
    SELECT COUNT(DISTINCT player_name) INTO v_home_players_found
    FROM football_player_stats
    WHERE (LOWER(TRIM(team_name)) LIKE '%' || LOWER(TRIM(p_home_team)) || '%'
      OR LOWER(TRIM(p_home_team)) LIKE '%' || LOWER(TRIM(team_name)) || '%')
      AND minutes_played > 0;
    IF v_home_players_found > 0 THEN v_fuzzy_used := true; END IF;
  END IF;

  SELECT COUNT(DISTINCT player_name) INTO v_away_players_found
  FROM football_player_stats
  WHERE LOWER(TRIM(team_name)) = LOWER(TRIM(p_away_team)) AND minutes_played > 0;

  IF v_away_players_found = 0 THEN
    SELECT COUNT(DISTINCT player_name) INTO v_away_players_found
    FROM football_player_stats
    WHERE (LOWER(TRIM(team_name)) LIKE '%' || LOWER(TRIM(p_away_team)) || '%'
      OR LOWER(TRIM(p_away_team)) LIKE '%' || LOWER(TRIM(team_name)) || '%')
      AND minutes_played > 0;
    IF v_away_players_found > 0 THEN v_fuzzy_used := true; END IF;
  END IF;

  -- 3. HALT CONDITIONS
  IF NOT v_fixture_found THEN
    v_halt_reason := 'fixture_not_found: No matching fixture for '
      || p_home_team || ' vs ' || p_away_team;
  END IF;

  IF v_home_players_found = 0 AND v_away_players_found = 0 THEN
    v_halt_reason := COALESCE(v_halt_reason || ' | ', '')
      || 'no_player_data: 0 players for both teams';
  END IF;

  -- 4. WARN CONDITIONS
  IF v_home_players_found > 0 AND v_home_players_found < 5 THEN
    v_warnings := array_append(v_warnings,
      'sparse_home_squad: ' || v_home_players_found || ' players for ' || p_home_team);
  END IF;
  IF v_away_players_found > 0 AND v_away_players_found < 5 THEN
    v_warnings := array_append(v_warnings,
      'sparse_away_squad: ' || v_away_players_found || ' players for ' || p_away_team);
  END IF;

  v_valid := (v_halt_reason IS NULL);

  RETURN jsonb_build_object(
    'valid', v_valid,
    'halt_reason', v_halt_reason,
    'home_team', p_home_team,
    'away_team', p_away_team,
    'fixture_found', v_fixture_found,
    'home_players_found', v_home_players_found,
    'away_players_found', v_away_players_found,
    'warnings', to_jsonb(v_warnings),
    'fuzzy_match_used', v_fuzzy_used
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'valid', false, 'halt_reason', 'unexpected_error: ' || SQLERRM,
    'home_team', p_home_team, 'away_team', p_away_team,
    'fixture_found', false, 'home_players_found', 0,
    'away_players_found', 0, 'warnings', '[]'::jsonb, 'fuzzy_match_used', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_match_entities(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION validate_match_entities(text, text, int) TO authenticated;
