-- Sprint 206 Item 1: Fix pg_cron scheduling
-- C91 Craig Kerstiens advisory panel findings:
--   1. football-sync-injuries-weekly fires sync_injuries with league_id — that action
--      requires player_id and returns HTTP 400 every run. Remove broken job.
--      Injuries ARE already synced daily via sync_league_recent best-effort batch
--      (football-data-sync/index.ts lines 391-408).
--   2. xG should sync on match days only (Mon+Thu+Sun) instead of daily — saves API quota.
--   3. Superettan missing standings-sync (weekly, Mondays).

-- ============================================================================
-- 1. Remove broken injury job (sync_injuries requires player_id, not league_id)
-- ============================================================================
DO $$ BEGIN PERFORM cron.unschedule('football-sync-injuries-weekly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================================
-- 2. Replace daily xG sync with match-day-only schedule
-- Old: '30 6 * * *'   (every day)
-- New: '30 6 * * 1,4,0' (Mon=1, Thu=4, Sun=0)
-- 06:30 UTC = 08:30 CET (summer) — after daily fixture sync completes
-- Allsvenskan + Superettan play Thu evenings + Sun afternoons + some Mondays
-- ============================================================================
DO $$ BEGIN PERFORM cron.unschedule('football-sync-xg-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- NOTE: xG-matchdays and Superettan-standings jobs are scheduled in
-- 20260514140000_mv_refresh_log_and_fixes.sql via idempotent_cron_schedule()
-- to ensure idempotent re-deploy and dynamic season year.

-- ============================================================================
-- Final schedule summary (Sprint 206 state)
-- ============================================================================
-- football-sync-allsvenskan-daily            0  6 * * *       daily
-- football-sync-superettan-daily            15  6 * * *       daily
-- football-sync-xg-matchdays               30  6 * * 1,4,0   Mon+Thu+Sun
-- football-sync-standings-weekly            15  7 * * 1       Mondays (Allsvenskan)
-- football-sync-superettan-standings-weekly 20  7 * * 1       Mondays (Superettan)
-- football-sync-coaches-weekly              30  7 * * 1       Mondays
-- REMOVED: football-sync-injuries-weekly (broken: sync_injuries requires player_id)
-- NOTE: Injury coverage via sync_league_recent best-effort batch (both leagues)

COMMENT ON TABLE football_cron_log IS
  'Sprint 205+206: Tracks pg_cron football sync executions. S206: injuries-weekly removed (broken), xG moved to matchdays, Superettan standings added.';
