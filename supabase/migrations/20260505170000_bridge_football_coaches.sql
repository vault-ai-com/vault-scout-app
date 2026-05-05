-- ============================================================
-- Migration: bridge_football_coaches
-- Sprint 201 | Pipeline 6a036221-834d-4248-9c5e-efee27ba884d
-- Syfte: Bridga football_coaches (189 API-synced) →
--        scout_coaches (21 manuella) så att
--        match_coaches_to_club() och search_scout_coaches()
--        ser ALLA tränare.
-- Idempotent: Kan köras om utan sidoeffekter.
-- ============================================================

-- ============================================================
-- STEG 1: Lägg till api_coach_id på scout_coaches
-- Nullable UNIQUE kolumn — FK-referens till football_coaches.api_coach_id
-- Manuella poster behåller api_coach_id = NULL
-- ============================================================

ALTER TABLE scout_coaches
  ADD COLUMN IF NOT EXISTS api_coach_id INTEGER;

-- Lägg till UNIQUE constraint om den inte redan finns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scout_coaches_api_coach_id_key'
      AND conrelid = 'scout_coaches'::regclass
  ) THEN
    ALTER TABLE scout_coaches
      ADD CONSTRAINT scout_coaches_api_coach_id_key UNIQUE (api_coach_id);
  END IF;
END;
$$;

-- ============================================================
-- STEG 2: Hjälpfunktion — härled tier från liga/team-kontext
-- Returnerar 'elite' | 'professional' | 'semi-professional' | 'unknown'
-- Baserat på team_name-mönster (enkla heuristiker — kan förbättras)
-- ============================================================

CREATE OR REPLACE FUNCTION _derive_coach_tier(
  p_team_name TEXT,
  p_career_history JSONB DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE  -- STABLE, inte IMMUTABLE — gör lookup mot football_standings
AS $$
DECLARE
  v_tier TEXT := 'unknown';
  v_team_lower TEXT;
  v_league_id INTEGER;
BEGIN
  IF p_team_name IS NULL OR trim(p_team_name) = '' THEN
    RETURN 'development';
  END IF;

  v_team_lower := lower(trim(p_team_name));

  -- Strategi 1: Sök i football_standings via league_id (kolumnen league_name finns ej)
  SELECT fs.league_id INTO v_league_id
  FROM football_standings fs
  WHERE lower(fs.team_name) = v_team_lower
     OR lower(fs.team_name) LIKE '%' || v_team_lower || '%'
  ORDER BY fs.season DESC
  LIMIT 1;

  -- Mappa league_id till ScoutTierSchema Zod-enum
  -- 113=Allsvenskan, 114=Superettan, 39=PL, 140=La Liga, 78=Bundesliga, 135=Serie A, 61=Ligue 1, 88=Eredivisie
  -- 40=Championship, 79=2.Bundesliga, 136=Serie B, 62=Ligue 2
  IF v_league_id IS NOT NULL THEN
    IF v_league_id = 113 THEN
      v_tier := 'allsvenskan';
    ELSIF v_league_id IN (39, 140, 78, 135, 61, 88) THEN
      v_tier := 'elite';
    ELSIF v_league_id IN (114, 40, 79, 136, 62) THEN
      v_tier := 'top_league';
    ELSE
      v_tier := 'development';
    END IF;
  END IF;

  -- Strategi 2 (fallback): Kända svenska lag-namn
  IF v_tier = 'unknown' THEN
    IF v_team_lower ~ '(aik|djurgarden|malmo|ifk goteborg|hammarby|hacken|norrkoping|elfsborg|sirius|kalmar|mjallby|halmstad|varnamo|degerfors|brommapojkarna|gais|goteborg)' THEN
      v_tier := 'allsvenskan';
    ELSIF v_team_lower ~ '(helsingborg|orebro|trelleborg|jonkoping|orgryte|landskrona|sundsvall|osters|akropolis|brage|utsikten|vasteras)' THEN
      v_tier := 'top_league';
    END IF;
  END IF;

  -- Fallback: unknown → development (ScoutTierSchema kräver ett giltigt värde)
  IF v_tier = 'unknown' THEN
    v_tier := 'development';
  END IF;

  -- Assertion: tier MÅSTE matcha ScoutTierSchema Zod-enum
  IF v_tier NOT IN ('world_class', 'elite', 'top_league', 'allsvenskan', 'development') THEN
    RAISE EXCEPTION '_derive_coach_tier: ogiltigt tier-värde: % — matchar inte ScoutTierSchema', v_tier;
  END IF;

  RETURN v_tier;
END;
$$;

-- ============================================================
-- STEG 3: Hjälpfunktion — härled career_phase från career_history
-- Returnerar 'emerging' | 'developing' | 'established' | 'veteran'
-- ============================================================

CREATE OR REPLACE FUNCTION _derive_coach_career_phase(
  p_career_history JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_career_count INT;
  v_phase TEXT;
BEGIN
  IF p_career_history IS NULL OR jsonb_array_length(p_career_history) = 0 THEN
    RETURN 'EMERGING';
  END IF;

  v_career_count := jsonb_array_length(p_career_history);

  -- UPPERCASE för att matcha CoachCareerPhaseSchema Zod-enum
  IF v_career_count <= 1 THEN
    v_phase := 'EMERGING';
  ELSIF v_career_count <= 3 THEN
    v_phase := 'DEVELOPING';
  ELSIF v_career_count <= 7 THEN
    v_phase := 'ESTABLISHED';
  ELSE
    v_phase := 'VETERAN';
  END IF;

  -- Assertion: phase MÅSTE matcha CoachCareerPhaseSchema Zod-enum
  IF v_phase NOT IN ('EMERGING', 'DEVELOPING', 'ESTABLISHED', 'ELITE', 'VETERAN', 'LEGENDARY') THEN
    RAISE EXCEPTION '_derive_coach_career_phase: ogiltigt fas-värde: % — matchar inte CoachCareerPhaseSchema', v_phase;
  END IF;

  RETURN v_phase;
END;
$$;

-- ============================================================
-- STEG 4: Huvud-sync-funktion
-- sync_football_coaches_to_scout()
-- Upsertar football_coaches → scout_coaches
-- ALDRIG överskriver: coaching_style, formation_preference,
--   latest_score, latest_recommendation, latest_analysis_date
--   (manuellt kurerade fält)
-- Returnerar antal synkade poster
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
  LOOP

    -- Härled current_club: football_coaches.current_team_name direkt,
    -- annars raw_profile->'team'->>'name' som fallback
    IF v_coach.current_team_name IS NOT NULL AND trim(v_coach.current_team_name) <> '' THEN
      v_club_name := trim(v_coach.current_team_name);
    ELSIF v_coach.raw_profile IS NOT NULL AND v_coach.raw_profile->'team'->>'name' IS NOT NULL THEN
      v_club_name := trim(v_coach.raw_profile->'team'->>'name');
    ELSE
      v_club_name := '';
    END IF;

    -- Härled tier från club/team-kontext
    v_tier := _derive_coach_tier(v_club_name, v_coach.career_history);

    -- Härled career_phase från career_history-längd
    v_career_phase := _derive_coach_career_phase(v_coach.career_history);

    -- UPSERT: ON CONFLICT api_coach_id
    -- Manuellt kurerade fält (coaching_style, formation_preference,
    -- latest_score, latest_recommendation, latest_analysis_date)
    -- berörs ALDRIG vid UPDATE — bara vid INSERT sätts de till NULL
    INSERT INTO scout_coaches (
      name,
      nationality,
      date_of_birth,
      current_club,
      tier,
      career_phase,
      career_history,
      profile_data,
      api_coach_id,
      created_at,
      updated_at
    )
    VALUES (
      coalesce(v_coach.name, concat_ws(' ', v_coach.firstname, v_coach.lastname)),
      v_coach.nationality,
      v_coach.birth_date,
      v_club_name,
      v_tier,
      v_career_phase,
      coalesce(v_coach.career_history, '[]'::jsonb),
      -- profile_data: samla API-metadata
      jsonb_build_object(
        'api_coach_id',   v_coach.api_coach_id,
        'photo_url',      v_coach.photo_url,
        'age',            v_coach.age,
        'raw_profile',    v_coach.raw_profile,
        'synced_at',      v_coach.synced_at
      ),
      v_coach.api_coach_id,
      now(),
      now()
    )
    ON CONFLICT (api_coach_id) DO UPDATE SET
      -- API-fält uppdateras alltid vid re-sync
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
                         ELSE scout_coaches.tier   -- behåll manuellt satt tier
                       END,
      career_phase   = CASE
                         WHEN scout_coaches.career_phase IS NULL
                         THEN EXCLUDED.career_phase
                         ELSE scout_coaches.career_phase  -- behåll manuellt satt
                       END,
      career_history = CASE
                         WHEN scout_coaches.career_history IS NULL
                           OR scout_coaches.career_history = '[]'::jsonb
                         THEN EXCLUDED.career_history
                         ELSE scout_coaches.career_history  -- behåll om manuellt berikat
                       END,
      profile_data   = scout_coaches.profile_data ||
                       jsonb_build_object(
                         'api_coach_id', EXCLUDED.api_coach_id,
                         'photo_url',    (EXCLUDED.profile_data->>'photo_url'),
                         'age',          (EXCLUDED.profile_data->>'age')::int,
                         'synced_at',    (EXCLUDED.profile_data->>'synced_at')
                       ),
      updated_at     = now()
      -- ALDRIG uppdateras vid ON CONFLICT:
      --   coaching_style, formation_preference, titles,
      --   latest_score, latest_recommendation, latest_analysis_date,
      --   current_league   (alla manuellt kurerade)
    ;

    v_synced_count := v_synced_count + 1;

  END LOOP;

  -- Assertion: sanity check — vi ska ha synkat >0 om football_coaches är populerad
  -- (soft assertion — loggar men kastar inte exception för att tillåta tom körning vid test)
  IF v_synced_count = 0 THEN
    RAISE WARNING 'sync_football_coaches_to_scout: 0 poster synkade — är football_coaches tom?';
  END IF;

  RETURN v_synced_count;

END;
$$;

-- ============================================================
-- STEG 5: search_all_coaches()
-- Samma signatur som search_scout_coaches (fuzzy pg_trgm-sökning)
-- Söker i scout_coaches — efter sync inkluderar den ALLA tränare
-- (både API-synkade och manuella)
-- ============================================================

CREATE OR REPLACE FUNCTION search_all_coaches(
  p_query TEXT,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  nationality TEXT,
  current_club TEXT,
  current_league TEXT,
  tier TEXT,
  career_phase TEXT,
  coaching_style TEXT,
  formation_preference TEXT,
  latest_score NUMERIC,
  latest_recommendation TEXT,
  latest_analysis_date TIMESTAMPTZ,
  api_coach_id INTEGER,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN

  -- Guard: NULL eller tom query → returnera tomt
  IF p_query IS NULL OR trim(p_query) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.nationality,
    c.current_club,
    c.current_league,
    c.tier,
    c.career_phase,
    c.coaching_style,
    c.formation_preference,
    c.latest_score,
    c.latest_recommendation,
    c.latest_analysis_date,
    c.api_coach_id,
    -- Kombinerad score: max av namn-similarity och klubb-boost (0.8)
    GREATEST(
      similarity(c.name, p_query),
      CASE WHEN c.current_club ILIKE '%' || p_query || '%' THEN 0.8 ELSE 0 END
    )::FLOAT AS similarity
  FROM scout_coaches c
  WHERE
    similarity(c.name, p_query) > 0.1
    OR c.name ILIKE '%' || p_query || '%'
    OR c.current_club ILIKE '%' || p_query || '%'
  ORDER BY
    GREATEST(
      similarity(c.name, p_query),
      CASE WHEN c.current_club ILIKE '%' || p_query || '%' THEN 0.8 ELSE 0 END
    ) DESC,
    c.latest_score DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;

END;
$$;

-- ============================================================
-- STEG 6: Index för sökning och join-prestanda
-- Idempotenta (IF NOT EXISTS)
-- ============================================================

-- Index för fuzzy-sökning (pg_trgm)
CREATE INDEX IF NOT EXISTS idx_scout_coaches_name_trgm
  ON scout_coaches USING gin (name gin_trgm_ops);

-- Index för api_coach_id lookup (sync + join)
CREATE INDEX IF NOT EXISTS idx_scout_coaches_api_coach_id
  ON scout_coaches (api_coach_id)
  WHERE api_coach_id IS NOT NULL;

-- Index för current_club-sökning (match_coaches_to_club)
CREATE INDEX IF NOT EXISTS idx_scout_coaches_current_club
  ON scout_coaches (current_club);

-- ============================================================
-- STEG 7: Kommentar-metadata
-- ============================================================

COMMENT ON COLUMN scout_coaches.api_coach_id IS
  'FK till football_coaches.api_coach_id. NULL = manuellt kurerad post utan API-koppling.';

COMMENT ON FUNCTION sync_football_coaches_to_scout() IS
  'Synkar football_coaches → scout_coaches via upsert på api_coach_id. '
  'Manuellt kurerade fält (coaching_style, formation_preference, latest_score, '
  'latest_recommendation, latest_analysis_date, titles) berörs ALDRIG vid update. '
  'Returnerar antal synkade poster.';

COMMENT ON FUNCTION search_all_coaches(TEXT, INTEGER, INTEGER) IS
  'Fuzzy-sökning i scout_coaches (pg_trgm). Täcker ALLA tränare efter sync: '
  'både API-synkade (api_coach_id IS NOT NULL) och manuella (api_coach_id IS NULL). '
  'Samma signatur som search_scout_coaches men med api_coach_id i output.';

-- ============================================================
-- VERIFIERINGSBLOCK (körs som en transaktion)
-- ============================================================

DO $$
DECLARE
  v_col_exists BOOLEAN;
  v_fn_exists BOOLEAN;
BEGIN

  -- Verifiera att api_coach_id-kolumn existerar på scout_coaches
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scout_coaches'
      AND column_name = 'api_coach_id'
  ) INTO v_col_exists;

  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'Migration assertion failed: api_coach_id saknas på scout_coaches';
  END IF;

  -- Verifiera att sync-funktionen skapades
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'sync_football_coaches_to_scout'
  ) INTO v_fn_exists;

  IF NOT v_fn_exists THEN
    RAISE EXCEPTION 'Migration assertion failed: sync_football_coaches_to_scout skapades inte';
  END IF;

  -- Verifiera att search_all_coaches skapades
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'search_all_coaches'
  ) INTO v_fn_exists;

  IF NOT v_fn_exists THEN
    RAISE EXCEPTION 'Migration assertion failed: search_all_coaches skapades inte';
  END IF;

  RAISE NOTICE 'Migration 20260505170000_bridge_football_coaches: ALLA assertions OK';

END;
$$;
