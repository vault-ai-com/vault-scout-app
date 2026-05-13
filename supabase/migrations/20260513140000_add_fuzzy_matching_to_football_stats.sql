-- Migration: Add pg_trgm fuzzy name matching fallback to get_player_football_stats
-- When exact match returns 0 results, tries trigram similarity to find closest name.
-- Prevents silent 0-match returns due to minor spelling differences (API vs DB names).
-- Requires: pg_trgm extension (already enabled).

CREATE OR REPLACE FUNCTION get_player_football_stats(p_player_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_name text;
  v_matches_found integer;
  v_aggregated jsonb;
  v_recent jsonb;
  v_fuzzy_match boolean := false;
  v_similarity float;
BEGIN
  -- Step 1: Try exact match (case-insensitive)
  SELECT count(*)
  INTO v_matches_found
  FROM football_player_stats
  WHERE lower(player_name) = lower(p_player_name)
    AND minutes_played > 0;

  IF v_matches_found > 0 THEN
    v_resolved_name := p_player_name;
  ELSE
    -- Step 2: Fuzzy fallback — find best trigram match (threshold 0.35)
    SELECT ps.player_name, similarity(lower(ps.player_name), lower(p_player_name))
    INTO v_resolved_name, v_similarity
    FROM football_player_stats ps
    WHERE ps.minutes_played > 0
      AND similarity(lower(ps.player_name), lower(p_player_name)) > 0.35
    GROUP BY ps.player_name
    ORDER BY similarity(lower(ps.player_name), lower(p_player_name)) DESC
    LIMIT 1;

    IF v_resolved_name IS NULL THEN
      RETURN jsonb_build_object(
        'matches_found', 0,
        'aggregated_stats', null,
        'recent_matches', '[]'::jsonb,
        'fuzzy_match', false
      );
    END IF;

    v_fuzzy_match := true;

    SELECT count(*)
    INTO v_matches_found
    FROM football_player_stats
    WHERE lower(player_name) = lower(v_resolved_name)
      AND minutes_played > 0;
  END IF;

  -- Aggregated stats (uses resolved name)
  SELECT jsonb_build_object(
    'matches_analyzed', count(*),
    'avg_rating', round(avg(ps.rating)::numeric, 2),
    'total_goals', coalesce(sum(ps.goals), 0),
    'total_assists', coalesce(sum(ps.assists), 0),
    'total_minutes', coalesce(sum(ps.minutes_played), 0),
    'avg_minutes_per_match', round(avg(ps.minutes_played)::numeric, 0),
    'avg_pass_accuracy', round(avg(ps.passes_accuracy)::numeric, 1),
    'total_tackles', coalesce(sum(ps.tackles), 0),
    'total_interceptions', coalesce(sum(ps.interceptions), 0),
    'total_duels_won', coalesce(sum(ps.duels_won), 0),
    'total_dribbles_succeeded', coalesce(sum(ps.dribbles_succeeded), 0),
    'total_yellow_cards', coalesce(sum(ps.yellow_cards), 0),
    'total_red_cards', coalesce(sum(ps.red_cards), 0),
    'total_shots_total', coalesce(sum(ps.shots_total), 0),
    'total_shots_on_target', coalesce(sum(ps.shots_on_target), 0),
    'total_passes_key', coalesce(sum(ps.passes_key), 0)
  )
  INTO v_aggregated
  FROM football_player_stats ps
  WHERE lower(ps.player_name) = lower(v_resolved_name)
    AND ps.minutes_played > 0;

  -- Recent matches (last 10 by match date)
  SELECT coalesce(jsonb_agg(row_data ORDER BY match_date DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'match_date', f.match_date,
      'home_team', f.home_team_name,
      'away_team', f.away_team_name,
      'score_home', f.home_goals,
      'score_away', f.away_goals,
      'rating', ps.rating,
      'goals', ps.goals,
      'assists', ps.assists,
      'minutes_played', ps.minutes_played,
      'position', ps.position,
      'league', f.league_name
    ) AS row_data,
    f.match_date
    FROM football_player_stats ps
    JOIN football_fixtures f ON f.id = ps.fixture_id
    WHERE lower(ps.player_name) = lower(v_resolved_name)
      AND ps.minutes_played > 0
    ORDER BY f.match_date DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'matches_found', v_matches_found,
    'aggregated_stats', v_aggregated,
    'recent_matches', v_recent,
    'fuzzy_match', v_fuzzy_match,
    'resolved_name', CASE WHEN v_fuzzy_match THEN v_resolved_name ELSE null END,
    'similarity_score', CASE WHEN v_fuzzy_match THEN round(v_similarity::numeric, 3) ELSE null END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_player_football_stats(text) TO service_role;
GRANT EXECUTE ON FUNCTION get_player_football_stats(text) TO anon;
GRANT EXECUTE ON FUNCTION get_player_football_stats(text) TO authenticated;
