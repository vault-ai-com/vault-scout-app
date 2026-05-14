-- Sprint 206 Item 2: mv_refresh_log + MV fixes
-- Fixes: VCE09-002 (BLOCK: CONCURRENTLY without UNIQUE INDEX),
--        VCE09-003 (WARN: cron.schedule not idempotent),
--        VCE09-004 (WARN: hardcoded season 2026)

-- ============================================================================
-- 1. mv_refresh_log TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS mv_refresh_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mv_name      text        NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  duration_ms  integer,
  rows_affected integer,
  status       text        NOT NULL DEFAULT 'OK',
  error_detail text
);

CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_mv_name
  ON mv_refresh_log (mv_name, refreshed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_status
  ON mv_refresh_log (status) WHERE status != 'OK';

COMMENT ON TABLE mv_refresh_log IS
  'Sprint 206: Tracks REFRESH MATERIALIZED VIEW CONCURRENTLY executions — duration, row count, errors.';

-- ============================================================================
-- 2. FIX VCE09-002 (BLOCK): UNIQUE INDEX on mv_player_season_stats
--    A player CAN move clubs mid-season (transfer window) so
--    (player_id, team_name, league_id, season) is the narrowest unique key.
--    Without this, REFRESH MATERIALIZED VIEW CONCURRENTLY throws:
--      ERROR: cannot refresh materialized view concurrently without a unique index
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_player_season_stats_pk
  ON mv_player_season_stats (player_id, team_name, league_id, season);

-- Assertion: index must exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'mv_player_season_stats'
      AND indexname  = 'idx_mv_player_season_stats_pk'
  ) THEN
    RAISE EXCEPTION 'VCE09-002 assertion failed: idx_mv_player_season_stats_pk was not created';
  END IF;
END;
$$;

-- ============================================================================
-- 3. refresh_materialized_view() — safe wrapper with logging
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_materialized_view(
  p_mv_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_start    timestamptz := clock_timestamp();
  v_duration integer;
  v_rows     integer;
BEGIN
  -- Validate: only allow known MV names (prevent SQL injection via EXECUTE)
  IF p_mv_name NOT IN ('mv_team_form', 'mv_player_season_stats', 'mv_head_to_head') THEN
    RAISE EXCEPTION 'refresh_materialized_view: unknown MV name: %', p_mv_name;
  END IF;

  EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || p_mv_name;

  v_duration := EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000;

  SELECT reltuples::integer INTO v_rows
  FROM pg_class WHERE relname = p_mv_name;

  INSERT INTO mv_refresh_log (mv_name, refreshed_at, duration_ms, rows_affected, status)
  VALUES (p_mv_name, now(), v_duration, COALESCE(v_rows, 0), 'OK');

  RETURN jsonb_build_object(
    'status', 'OK', 'mv_name', p_mv_name,
    'duration_ms', v_duration, 'rows_approx', COALESCE(v_rows, 0)
  );

EXCEPTION WHEN OTHERS THEN
  v_duration := EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000;

  INSERT INTO mv_refresh_log (mv_name, refreshed_at, duration_ms, rows_affected, status, error_detail)
  VALUES (p_mv_name, now(), v_duration, 0, 'ERROR', SQLERRM);

  RETURN jsonb_build_object(
    'status', 'ERROR', 'mv_name', p_mv_name,
    'error', SQLERRM, 'duration_ms', v_duration
  );
END;
$$;

COMMENT ON FUNCTION refresh_materialized_view IS
  'Sprint 206: Safe REFRESH MATERIALIZED VIEW CONCURRENTLY wrapper — logs to mv_refresh_log, handles errors gracefully.';

-- ============================================================================
-- 4. idempotent_cron_schedule() — safe re-deploy wrapper
--    VCE09-003: cron.schedule() not idempotent
-- ============================================================================

CREATE OR REPLACE FUNCTION idempotent_cron_schedule(
  p_job_name text, p_schedule text, p_command text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM cron.unschedule(p_job_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM cron.schedule(p_job_name, p_schedule, p_command);
END;
$$;

COMMENT ON FUNCTION idempotent_cron_schedule IS
  'Sprint 206: Wrapper for cron.schedule that is safe on re-deploy (unschedules first).';

-- ============================================================================
-- 5. Replace MV refresh cron jobs with wrapper-based versions
-- ============================================================================

SELECT idempotent_cron_schedule(
  'refresh-mv-team-form', '45 6 * * *',
  $$SELECT refresh_materialized_view('mv_team_form')$$
);

SELECT idempotent_cron_schedule(
  'refresh-mv-player-season-stats', '46 6 * * *',
  $$SELECT refresh_materialized_view('mv_player_season_stats')$$
);

SELECT idempotent_cron_schedule(
  'refresh-mv-head-to-head', '47 6 * * *',
  $$SELECT refresh_materialized_view('mv_head_to_head')$$
);

-- V64 fix: xG matchdays + Superettan standings via idempotent wrapper (from migration 130000)
SELECT idempotent_cron_schedule(
  'football-sync-xg-matchdays', '30 6 * * 1,4,0',
  $$SELECT invoke_football_sync('football-xg-sync', 'sync_league_xg')$$
);

SELECT idempotent_cron_schedule(
  'football-sync-superettan-standings-weekly', '20 7 * * 1',
  $$SELECT invoke_football_sync('football-data-sync', 'sync_standings', jsonb_build_object('league_id', 114, 'season', EXTRACT(YEAR FROM now())::integer))$$
);

-- VCE09-004: Remove hardcoded 2026 from quality check
SELECT idempotent_cron_schedule(
  'football-data-quality-check', '0 8 * * 1',
  $$SELECT check_data_quality(113, EXTRACT(YEAR FROM now())::integer)$$
);

-- ============================================================================
-- 6. GRANTs
-- ============================================================================

GRANT SELECT, INSERT ON mv_refresh_log TO service_role;
GRANT EXECUTE ON FUNCTION refresh_materialized_view(text) TO service_role;
GRANT EXECUTE ON FUNCTION idempotent_cron_schedule(text, text, text) TO service_role;
