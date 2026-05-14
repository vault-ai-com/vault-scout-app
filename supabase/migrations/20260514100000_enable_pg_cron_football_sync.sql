-- Sprint 205: Enable pg_cron + pg_net for automated football data sync
-- Replaces manual sync calls with scheduled jobs.
-- pg_cron runs inside Supabase — no external scheduler needed.

-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Grant usage to postgres role (required for pg_cron in Supabase)
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- 3. Helper: invoke edge function via pg_net
-- Reusable for all football sync jobs
CREATE OR REPLACE FUNCTION invoke_football_sync(
  p_function_name text,
  p_action text,
  p_extra_params jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text;
  v_service_key text;
  v_payload jsonb;
  v_request_id bigint;
BEGIN
  v_url := current_setting('app.settings.supabase_url', true)
           || '/functions/v1/' || p_function_name;
  v_service_key := current_setting('app.settings.service_role_key', true);

  v_payload := jsonb_build_object('action', p_action) || p_extra_params;

  SELECT net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_service_key,
      'Authorization', 'Bearer ' || v_service_key
    ),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- 4. Cron jobs — Swedish football sync schedule
-- All times in UTC (Sweden = UTC+2 in summer)

-- 4a. Daily: Sync recent Allsvenskan fixtures + results (06:00 UTC = 08:00 CET)
SELECT cron.schedule(
  'football-sync-allsvenskan-daily',
  '0 6 * * *',
  $$SELECT invoke_football_sync('football-data-sync', 'sync_league_recent', '{"league_id": 113, "season": 2026}'::jsonb)$$
);

-- 4b. Daily: Sync recent Superettan fixtures + results (06:15 UTC)
SELECT cron.schedule(
  'football-sync-superettan-daily',
  '15 6 * * *',
  $$SELECT invoke_football_sync('football-data-sync', 'sync_league_recent', '{"league_id": 114, "season": 2026}'::jsonb)$$
);

-- 4c. Daily: Sync xG from FootyStats (06:30 UTC, after fixtures are synced)
SELECT cron.schedule(
  'football-sync-xg-daily',
  '30 6 * * *',
  $$SELECT invoke_football_sync('football-xg-sync', 'sync_league_xg')$$
);

-- 4d. Weekly: Sync injuries (Mondays 07:00 UTC)
SELECT cron.schedule(
  'football-sync-injuries-weekly',
  '0 7 * * 1',
  $$SELECT invoke_football_sync('football-data-sync', 'sync_injuries', '{"league_id": 113, "season": 2026}'::jsonb)$$
);

-- 4e. Weekly: Sync standings (Mondays 07:15 UTC)
SELECT cron.schedule(
  'football-sync-standings-weekly',
  '15 7 * * 1',
  $$SELECT invoke_football_sync('football-data-sync', 'sync_standings', '{"league_id": 113, "season": 2026}'::jsonb)$$
);

-- 4f. Weekly: Sync coaches (Mondays 07:30 UTC)
SELECT cron.schedule(
  'football-sync-coaches-weekly',
  '30 7 * * 1',
  $$SELECT invoke_football_sync('football-data-sync', 'sync_coaches', '{"league_id": 113, "season": 2026}'::jsonb)$$
);

-- 5. Log table for cron job results (optional but useful for monitoring)
CREATE TABLE IF NOT EXISTS football_cron_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'running',
  result jsonb,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_football_cron_log_job
  ON football_cron_log (job_name, started_at DESC);

COMMENT ON TABLE football_cron_log IS 'Sprint 205: Tracks pg_cron football sync job executions';
