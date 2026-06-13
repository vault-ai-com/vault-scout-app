-- ============================================================
-- Migration: bridge_coaches_is_active_filter
-- Sprint 211 | Pipeline f2ef1a54-8d45-44c5-8f08-54a93841fd7a
-- Syfte: Lägg till is_active-filter i sync_football_coaches_to_scout()
--        så att inaktiva coaches INTE propageras till scout_coaches.
-- VCE09 finding: SELECT-loop saknade WHERE fc.is_active = true.
-- Idempotent: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_football_coaches_to_scout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_coach RECORD;
  v_synced_count INTEGER := 0;
  v_club_name TEXT;
  v_tier TEXT;
  v_career_phase TEXT;
BEGIN

  FOR v_coach IN
    SELECT
      fc.id,
      fc.api_coach_id,
      fc.name,
      fc.firstname,
      fc.lastname,
      fc.nationality,
      fc.birth_date,
      fc.age,
      fc.photo_url,
      fc.current_team_id,
      fc.current_team_name,
      fc.career_history,
      fc.raw_profile,
      fc.synced_at
    FROM football_coaches fc
    WHERE fc.api_coach_id IS NOT NULL
      AND fc.is_active = true  -- Sprint 211: filtrerar bort inaktiva coaches
  LOOP

    IF v_coach.current_team_name IS NOT NULL AND trim(v_coach.current_team_name) <> '' THEN
      v_club_name := trim(v_coach.current_team_name);
    ELSIF v_coach.raw_profile IS NOT NULL AND v_coach.raw_profile->'team'->>'name' IS NOT NULL THEN
      v_club_name := trim(v_coach.raw_profile->'team'->>'name');
    ELSE
      v_club_name := '';
    END IF;

    v_tier := _derive_coach_tier(v_club_name, v_coach.career_history);
    v_career_phase := _derive_coach_career_phase(v_coach.career_history);

    INSERT INTO scout_coaches (
      name, nationality, date_of_birth, current_club, tier, career_phase,
      career_history, profile_data, api_coach_id, created_at, updated_at
    )
    VALUES (
      coalesce(v_coach.name, concat_ws(' ', v_coach.firstname, v_coach.lastname)),
      v_coach.nationality,
      v_coach.birth_date,
      v_club_name,
      v_tier,
      v_career_phase,
      coalesce(v_coach.career_history, '[]'::jsonb),
      jsonb_build_object(
        'api_coach_id', v_coach.api_coach_id,
        'photo_url',    v_coach.photo_url,
        'age',          v_coach.age,
        'raw_profile',  v_coach.raw_profile,
        'synced_at',    v_coach.synced_at
      ),
      v_coach.api_coach_id,
      now(),
      now()
    )
    ON CONFLICT (api_coach_id) DO UPDATE SET
      name           = coalesce(EXCLUDED.name, scout_coaches.name),
      nationality    = coalesce(EXCLUDED.nationality, scout_coaches.nationality),
      date_of_birth  = coalesce(EXCLUDED.date_of_birth, scout_coaches.date_of_birth),
      current_club   = CASE
                         WHEN EXCLUDED.current_club <> '' THEN EXCLUDED.current_club
                         ELSE scout_coaches.current_club
                       END,
      tier           = CASE
                         WHEN scout_coaches.tier IS NULL OR scout_coaches.tier = 'unknown'
                         THEN EXCLUDED.tier
                         ELSE scout_coaches.tier
                       END,
      career_phase   = CASE
                         WHEN scout_coaches.career_phase IS NULL
                         THEN EXCLUDED.career_phase
                         ELSE scout_coaches.career_phase
                       END,
      career_history = CASE
                         WHEN scout_coaches.career_history IS NULL
                           OR scout_coaches.career_history = '[]'::jsonb
                         THEN EXCLUDED.career_history
                         ELSE scout_coaches.career_history
                       END,
      profile_data   = scout_coaches.profile_data ||
                       jsonb_build_object(
                         'api_coach_id', EXCLUDED.api_coach_id,
                         'photo_url',    (EXCLUDED.profile_data->>'photo_url'),
                         'age',          (EXCLUDED.profile_data->>'age')::int,
                         'synced_at',    (EXCLUDED.profile_data->>'synced_at')
                       ),
      updated_at     = now()
    ;

    v_synced_count := v_synced_count + 1;

  END LOOP;

  IF v_synced_count = 0 THEN
    RAISE WARNING 'sync_football_coaches_to_scout: 0 poster synkade';
  END IF;

  RETURN v_synced_count;

END;
$$;

COMMENT ON FUNCTION sync_football_coaches_to_scout() IS
  'Synkar football_coaches → scout_coaches via upsert på api_coach_id. '
  'Sprint 211: filtrerar på is_active = true — inaktiva coaches propageras INTE.';

-- Verifiering
DO $$
DECLARE
  v_fn_body TEXT;
BEGIN
  SELECT prosrc INTO v_fn_body
  FROM pg_proc WHERE proname = 'sync_football_coaches_to_scout';

  IF v_fn_body NOT LIKE '%is_active = true%' THEN
    RAISE EXCEPTION 'is_active-filter saknas i sync_football_coaches_to_scout';
  END IF;

  RAISE NOTICE 'Migration 20260613100001: assertions OK';
END;
$$;
