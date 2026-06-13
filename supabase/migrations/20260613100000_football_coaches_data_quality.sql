-- ============================================================
-- Migration: football_coaches_data_quality
-- Sprint 211 | Pipeline f2ef1a54-8d45-44c5-8f08-54a93841fd7a
-- Syfte: Lägger till 3 data quality-kolumner på football_coaches:
--   is_active        — markerar om tränaren fortfarande är aktiv i sin nuvarande klubb
--   last_confirmed_at — senaste gången API:et bekräftade att tränaren tillhör klubben
--   role             — tränarens roll (head_coach, assistant, goalkeeping_coach, etc.)
-- Idempotent: Kan köras om utan sidoeffekter (ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- STEG 1: Lägg till kolumnen is_active
-- ============================================================

ALTER TABLE football_coaches
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE football_coaches
  SET is_active = true
  WHERE is_active IS DISTINCT FROM true;

COMMENT ON COLUMN football_coaches.is_active IS
  'Markerar om tränaren fortfarande är aktiv i sin nuvarande klubb. '
  'Sätts till false av sync-funktionen när API:et inte längre returnerar tränaren för klubben. '
  'DEFAULT true vid insert.';

-- ============================================================
-- STEG 2: Lägg till kolumnen last_confirmed_at
-- ============================================================

ALTER TABLE football_coaches
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;

UPDATE football_coaches
  SET last_confirmed_at = synced_at
  WHERE last_confirmed_at IS NULL
    AND synced_at IS NOT NULL;

COMMENT ON COLUMN football_coaches.last_confirmed_at IS
  'Senaste tidpunkt då API:et bekräftade att tränaren tillhör current_team_id. '
  'Backfillad från synced_at för poster som existerade före denna migration.';

-- ============================================================
-- STEG 3: Lägg till kolumnen role
-- ============================================================

ALTER TABLE football_coaches
  ADD COLUMN IF NOT EXISTS role TEXT;

COMMENT ON COLUMN football_coaches.role IS
  'Tränarens roll i klubben. Värden: head_coach, assistant, goalkeeping_coach, etc. '
  'NULL = okänd roll. Populeras av sync-edge-function från career[].role.';

-- ============================================================
-- STEG 4: Index (current_team_id, is_active)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_football_coaches_team_active
  ON football_coaches (current_team_id, is_active)
  WHERE current_team_id IS NOT NULL;

-- ============================================================
-- STEG 5: Verifieringsblock
-- ============================================================

DO $$
DECLARE
  v_col_exists BOOLEAN;
  v_backfill INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'football_coaches' AND column_name = 'is_active'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'is_active saknas på football_coaches';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'football_coaches' AND column_name = 'last_confirmed_at'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'last_confirmed_at saknas på football_coaches';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'football_coaches' AND column_name = 'role'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'role saknas på football_coaches';
  END IF;

  SELECT count(*) INTO v_backfill
  FROM football_coaches
  WHERE last_confirmed_at IS NULL AND synced_at IS NOT NULL;
  IF v_backfill > 0 THEN
    RAISE EXCEPTION '% rader har synced_at men saknar last_confirmed_at efter backfill', v_backfill;
  END IF;

  RAISE NOTICE 'Migration 20260613100000: ALLA assertions OK';
END;
$$;
