-- ============================================================
-- Migration: ifk_coaches_cleanup
-- Sprint 211 | Pipeline f2ef1a54-8d45-44c5-8f08-54a93841fd7a
-- Syfte: Markera 3 stale IFK Göteborg-coaches som inaktiva.
--   Roland Nilsson (5854) — lämnade 2021
--   Sindre Tjelmeland (14609) — inte i nuvarande stab
--   Alf Westerberg (10349) — inte i nuvarande stab
-- Stefan Billborn (1388) bevaras som aktiv huvudtränare.
-- Depends on: 20260613100000 (is_active kolumn).
-- Idempotent: UPDATE WHERE is_active = true (omkörning = 0 rader).
-- ============================================================

DO $$
DECLARE
  v_affected INTEGER;
  v_billborn_active BOOLEAN;
BEGIN

  -- STEG 1: Markera stale coaches som inaktiva
  UPDATE football_coaches
  SET is_active = false,
      updated_at = now()
  WHERE current_team_id = 366
    AND is_active = true
    AND lastname IN ('Nilsson', 'Tjelmeland', 'Westerberg');

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  -- ASSERTION 1: Max 3 rader (första körning = 3, omkörning = 0)
  IF v_affected > 3 THEN
    RAISE EXCEPTION 'Cleanup påverkade % rader (förväntat max 3)', v_affected;
  END IF;

  -- ASSERTION 2: Stefan Billborn (api_coach_id 1388) fortfarande aktiv
  SELECT is_active INTO v_billborn_active
  FROM football_coaches
  WHERE api_coach_id = 1388;

  IF v_billborn_active IS NULL THEN
    RAISE EXCEPTION 'Stefan Billborn (1388) saknas i football_coaches';
  END IF;

  IF NOT v_billborn_active THEN
    RAISE EXCEPTION 'Stefan Billborn (1388) är INTE aktiv — cleanup har gått fel';
  END IF;

  RAISE NOTICE 'IFK cleanup: % coaches markerade inaktiva. Billborn aktiv: OK.', v_affected;

END;
$$;

-- STEG 2: Propagera till scout_coaches (filtrerar nu på is_active = true)
SELECT sync_football_coaches_to_scout();
