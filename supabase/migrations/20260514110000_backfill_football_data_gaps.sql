-- Sprint 205: Backfill documentation + football_suspensions table
-- Documents known data gaps and provides backfill commands.
-- Run backfill commands manually via edge function calls after deployment.

-- 1. Suspensions table (missing from original schema)
CREATE TABLE IF NOT EXISTS football_suspensions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_fixture_id integer,
  player_id integer,
  player_name text NOT NULL,
  team_id integer,
  team_name text,
  league_id integer NOT NULL DEFAULT 113,
  season integer NOT NULL DEFAULT 2026,
  suspension_type text NOT NULL, -- 'yellow_accumulation', 'red_card', 'direct_red'
  card_count integer,
  suspended_from date,
  suspended_until date,
  matches_missed integer DEFAULT 1,
  source text DEFAULT 'api_football',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_football_suspensions_player
  ON football_suspensions (player_id, season);
CREATE INDEX IF NOT EXISTS idx_football_suspensions_team
  ON football_suspensions (team_id, season);
CREATE INDEX IF NOT EXISTS idx_football_suspensions_league_season
  ON football_suspensions (league_id, season);

COMMENT ON TABLE football_suspensions IS 'Sprint 205: Player suspensions derived from card accumulation + direct reds';

-- 2. Data gap documentation (as system_documentation)
INSERT INTO system_documentation (doc_type, doc_key, title, content, metadata)
VALUES (
  'data_ops',
  'football_backfill_sprint_205',
  'Football Data Backfill Plan — Sprint 205',
  E'## Known Data Gaps (identified 2026-05-14)\n\n'
  '### CRITICAL (P0):\n'
  '1. **xG coverage: ~2%** — Only 2 of 92 finished fixtures have xG data.\n'
  '   Backfill: POST football-xg-sync {action: "resync_all_xg"}\n'
  '   Expected: FootyStats covers all Allsvenskan 2026 fixtures.\n\n'
  '2. **Injuries: 0 rows for 2026** — Never synced for current season.\n'
  '   Backfill: POST football-data-sync {action: "sync_injuries", league_id: 113, season: 2026}\n'
  '   Then: POST football-data-sync {action: "sync_injuries", league_id: 114, season: 2026}\n\n'
  '3. **Superettan 2025: 0 fixtures** — League ID was wrong (570=Ghana, 114=correct).\n'
  '   Fixed in constants.ts Sprint 181. Backfill:\n'
  '   POST football-data-sync {action: "sync_full_league", league_id: 114, season: 2025}\n\n'
  '### IMPORTANT (P1):\n'
  '4. **Coaches: 0 rows** — Never synced.\n'
  '   Backfill: POST football-data-sync {action: "sync_coaches", league_id: 113, season: 2026}\n\n'
  '5. **Trophies: 0 rows** — Never synced.\n'
  '   Backfill: POST football-data-sync {action: "sync_trophies", league_id: 113}\n\n'
  '6. **Player profiles: partial** — Only some players have profiles.\n'
  '   Backfill: POST football-data-sync {action: "sync_player_profiles", league_id: 113, season: 2026}\n\n'
  '### NICE TO HAVE (P2):\n'
  '7. **Historical seasons** — Only 2026 fully synced.\n'
  '   POST football-data-sync {action: "sync_historical", league_id: 113, seasons: [2024,2025]}\n\n'
  '## Automated After Sprint 205:\n'
  'pg_cron handles daily Allsvenskan+Superettan fixtures, daily xG, weekly injuries/standings/coaches.\n'
  'Manual backfill needed ONCE for historical gaps above.',
  jsonb_build_object(
    'sprint', 205,
    'priority_order', ARRAY['xg_backfill', 'injuries_2026', 'superettan_2025', 'coaches', 'trophies', 'player_profiles', 'historical'],
    'estimated_api_calls', 150,
    'created_by', 'V57'
  )
)
ON CONFLICT (doc_key) DO UPDATE SET
  content = EXCLUDED.content,
  metadata = EXCLUDED.metadata,
  updated_at = now();
