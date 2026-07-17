-- ============================================================================
-- Migration: Scout multi-tenant foundation + security
-- File: 20260717101500_scout_multitenant_foundation.sql
-- Pipeline: 970b9d4f-abad-4521-b9f5-51fdda6e5425 (Sprint 212, L3, app=scout)
-- ----------------------------------------------------------------------------
-- MAX separation from CRM: own scout_tenants (NOT crm_tenants), JWT-only helper.
-- Safety: single txn, nullable-add -> backfill -> assert -> SET NOT NULL.
-- Backfill target: single existing tenant 'IFK Göteborg' (slug ifk-goteborg).
-- Write-scope (VCE09 GRIND 1 hardening): AI/pipeline-generated tables
--   (players/analyses/scores/video_clips) = authenticated SELECT-only + service_role writes.
--   User-authored tables (notes/watchlist/comparisons/chat) = tenant FOR ALL.
--   notes/watchlist = team model (tenant-shared) per Andreas 2026-07-17.
-- POST-DEPLOY DEPENDENCY: app_metadata.tenant_id must be seeded (admin API) or
--   get_scout_tenant_id() returns NULL and every user sees 0 rows (fail-closed).
-- ============================================================================
BEGIN;

-- 1. INFRA TABLES ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scout_tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  company_name text NOT NULL,
  logo_url     text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scout_tenant_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.scout_tenants(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'analyst',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, auth_user_id)
);
CREATE INDEX IF NOT EXISTS idx_scout_tenant_members_user   ON public.scout_tenant_members(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_scout_tenant_members_tenant ON public.scout_tenant_members(tenant_id);

-- 2. TENANT HELPER (JWT-only; NO crm_users fallback — Scout != CRM) ----------
CREATE OR REPLACE FUNCTION public.get_scout_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'tenant_id', ''),
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')
  )::uuid;
$fn$;

-- 3. SEED SINGLE EXISTING TENANT ---------------------------------------------
INSERT INTO public.scout_tenants (slug, company_name)
VALUES ('ifk-goteborg', 'IFK Göteborg')
ON CONFLICT (slug) DO NOTHING;

-- 4. ADD tenant_id COLUMNS (NULLABLE) + FK -> scout_tenants ------------------
ALTER TABLE public.scout_players       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_analyses      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_scores        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_chat_sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_chat_messages ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_video_clips   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_notes         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_watchlist     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);
ALTER TABLE public.scout_comparisons   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.scout_tenants(id);

-- 5. BACKFILL -> IFK + denormalized joins + member seed ----------------------
DO $backfill$
DECLARE
  v_ifk uuid;
BEGIN
  SELECT id INTO v_ifk FROM public.scout_tenants WHERE slug = 'ifk-goteborg';
  IF v_ifk IS NULL THEN
    RAISE EXCEPTION 'Backfill aborted: IFK tenant not found';
  END IF;

  UPDATE public.scout_players       SET tenant_id = v_ifk WHERE tenant_id IS NULL;
  UPDATE public.scout_analyses      SET tenant_id = v_ifk WHERE tenant_id IS NULL;
  UPDATE public.scout_chat_sessions SET tenant_id = v_ifk WHERE tenant_id IS NULL;
  UPDATE public.scout_video_clips   SET tenant_id = v_ifk WHERE tenant_id IS NULL;
  UPDATE public.scout_notes         SET tenant_id = v_ifk WHERE tenant_id IS NULL;
  UPDATE public.scout_watchlist     SET tenant_id = v_ifk WHERE tenant_id IS NULL;
  UPDATE public.scout_comparisons   SET tenant_id = v_ifk WHERE tenant_id IS NULL;

  -- scout_scores: denormalize via analysis_id -> scout_analyses.tenant_id
  UPDATE public.scout_scores s
     SET tenant_id = a.tenant_id
    FROM public.scout_analyses a
   WHERE s.analysis_id = a.id AND s.tenant_id IS NULL;
  UPDATE public.scout_scores SET tenant_id = v_ifk WHERE tenant_id IS NULL; -- orphan fallback

  -- scout_chat_messages: denormalize via session_id -> scout_chat_sessions.tenant_id
  UPDATE public.scout_chat_messages m
     SET tenant_id = ses.tenant_id
    FROM public.scout_chat_sessions ses
   WHERE m.session_id = ses.id AND m.tenant_id IS NULL;
  UPDATE public.scout_chat_messages SET tenant_id = v_ifk WHERE tenant_id IS NULL; -- orphan/null-session fallback

  -- Seed members from existing distinct owners (all verified present in auth.users)
  INSERT INTO public.scout_tenant_members (tenant_id, auth_user_id, role, is_active)
  SELECT v_ifk, u, 'analyst', true
  FROM (
    SELECT created_by AS u FROM public.scout_players        WHERE created_by IS NOT NULL
    UNION SELECT created_by  FROM public.scout_analyses      WHERE created_by IS NOT NULL
    UNION SELECT user_id     FROM public.scout_chat_sessions WHERE user_id    IS NOT NULL
    UNION SELECT created_by  FROM public.scout_notes         WHERE created_by IS NOT NULL
    UNION SELECT created_by  FROM public.scout_watchlist     WHERE created_by IS NOT NULL
    UNION SELECT created_by  FROM public.scout_comparisons   WHERE created_by IS NOT NULL
  ) owners
  ON CONFLICT (tenant_id, auth_user_id) DO NOTHING;
END;
$backfill$;

-- 6. ASSERTIONS — no NULL tenant_id may remain ------------------------------
DO $assert$
DECLARE
  v_tbl text;
  v_cnt bigint;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'scout_players','scout_analyses','scout_scores','scout_chat_sessions',
    'scout_chat_messages','scout_video_clips','scout_notes','scout_watchlist',
    'scout_comparisons'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', v_tbl) INTO v_cnt;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'Backfill incomplete: % rows with NULL tenant_id in %', v_cnt, v_tbl;
    END IF;
  END LOOP;
END;
$assert$;

-- 7. SET NOT NULL (backfill verified) ---------------------------------------
ALTER TABLE public.scout_players       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_analyses      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_scores        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_chat_sessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_chat_messages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_video_clips   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_notes         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_watchlist     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.scout_comparisons   ALTER COLUMN tenant_id SET NOT NULL;

-- 8. INDEXES ON tenant_id ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_scout_players_tenant       ON public.scout_players(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_analyses_tenant      ON public.scout_analyses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_scores_tenant        ON public.scout_scores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_chat_sessions_tenant ON public.scout_chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_chat_messages_tenant ON public.scout_chat_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_video_clips_tenant   ON public.scout_video_clips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_notes_tenant         ON public.scout_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_watchlist_tenant     ON public.scout_watchlist(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_comparisons_tenant   ON public.scout_comparisons(tenant_id);

-- 9. RLS POLICIES ------------------------------------------------------------
-- 9a. AI/PIPELINE-GENERATED TABLES: authenticated SELECT-only + service_role writes
--     (VCE09 GRIND 1 Case #1/#3/#7 hardening — these are written only by edge functions)

-- scout_players
DROP POLICY IF EXISTS auth_read_scout_players        ON public.scout_players;
DROP POLICY IF EXISTS service_role_all_scout_players ON public.scout_players;
CREATE POLICY scout_players_tenant_read ON public.scout_players
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_players ON public.scout_players
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_analyses
DROP POLICY IF EXISTS auth_read_scout_analyses        ON public.scout_analyses;
DROP POLICY IF EXISTS service_role_all_scout_analyses ON public.scout_analyses;
CREATE POLICY scout_analyses_tenant_read ON public.scout_analyses
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_analyses ON public.scout_analyses
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_scores (denormalized tenant_id; SELECT-only for authenticated)
DROP POLICY IF EXISTS auth_read_scout_scores        ON public.scout_scores;
DROP POLICY IF EXISTS service_role_all_scout_scores ON public.scout_scores;
CREATE POLICY scout_scores_tenant_read ON public.scout_scores
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_scores ON public.scout_scores
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_video_clips (had NO policies -> members read, service_role writes)
CREATE POLICY scout_video_clips_tenant_read ON public.scout_video_clips
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_video_clips ON public.scout_video_clips
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 9b. USER-AUTHORED TABLES: tenant FOR ALL (authenticated may write within tenant)

-- scout_notes (team model per Andreas — tenant-shared read/write)
DROP POLICY IF EXISTS "Users can insert own notes" ON public.scout_notes;
DROP POLICY IF EXISTS "Users can read own notes"   ON public.scout_notes;
DROP POLICY IF EXISTS "Users can update own notes" ON public.scout_notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON public.scout_notes;
CREATE POLICY scout_notes_tenant_all ON public.scout_notes
  FOR ALL TO authenticated
  USING (tenant_id = public.get_scout_tenant_id())
  WITH CHECK (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_notes ON public.scout_notes
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_watchlist (team model per Andreas — tenant-shared read/write)
DROP POLICY IF EXISTS auth_insert_scout_watchlist      ON public.scout_watchlist;
DROP POLICY IF EXISTS auth_read_scout_watchlist        ON public.scout_watchlist;
DROP POLICY IF EXISTS auth_update_scout_watchlist      ON public.scout_watchlist;
DROP POLICY IF EXISTS auth_delete_scout_watchlist      ON public.scout_watchlist;
DROP POLICY IF EXISTS service_role_all_scout_watchlist ON public.scout_watchlist;
CREATE POLICY scout_watchlist_tenant_all ON public.scout_watchlist
  FOR ALL TO authenticated
  USING (tenant_id = public.get_scout_tenant_id())
  WITH CHECK (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_watchlist ON public.scout_watchlist
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_comparisons (user-authored — tenant FOR ALL)
DROP POLICY IF EXISTS auth_insert_scout_comparisons      ON public.scout_comparisons;
DROP POLICY IF EXISTS auth_read_scout_comparisons        ON public.scout_comparisons;
DROP POLICY IF EXISTS service_role_all_scout_comparisons ON public.scout_comparisons;
CREATE POLICY scout_comparisons_tenant_all ON public.scout_comparisons
  FOR ALL TO authenticated
  USING (tenant_id = public.get_scout_tenant_id())
  WITH CHECK (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_scout_comparisons ON public.scout_comparisons
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_chat_sessions (KEEP user-scoping + tenant)
DROP POLICY IF EXISTS users_own_sessions ON public.scout_chat_sessions;
CREATE POLICY scout_chat_sessions_tenant_user ON public.scout_chat_sessions
  FOR ALL TO authenticated
  USING (tenant_id = public.get_scout_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = public.get_scout_tenant_id() AND user_id = auth.uid());
CREATE POLICY service_role_all_scout_chat_sessions ON public.scout_chat_sessions
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- scout_chat_messages (tenant via denormalized column + user-scoping via session ownership)
DROP POLICY IF EXISTS users_own_messages ON public.scout_chat_messages;
CREATE POLICY scout_chat_messages_tenant_user ON public.scout_chat_messages
  FOR ALL TO authenticated
  USING (
    tenant_id = public.get_scout_tenant_id()
    AND EXISTS (SELECT 1 FROM public.scout_chat_sessions s WHERE s.id = scout_chat_messages.session_id AND s.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id = public.get_scout_tenant_id()
    AND EXISTS (SELECT 1 FROM public.scout_chat_sessions s WHERE s.id = scout_chat_messages.session_id AND s.user_id = auth.uid())
  );
CREATE POLICY service_role_all_scout_chat_messages ON public.scout_chat_messages
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 9c. RLS for infra tables ---------------------------------------------------
ALTER TABLE public.scout_tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_tenant_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_tenants_member_read ON public.scout_tenants
  FOR SELECT TO authenticated
  USING (id IN (SELECT tenant_id FROM public.scout_tenant_members WHERE auth_user_id = auth.uid() AND is_active));
CREATE POLICY service_role_all_scout_tenants ON public.scout_tenants
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY scout_members_self_read ON public.scout_tenant_members
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY service_role_all_scout_tenant_members ON public.scout_tenant_members
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 10. RPCs -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_scout_active_tenant(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.scout_tenants%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scout_tenant_members
    WHERE tenant_id = p_tenant_id AND auth_user_id = v_uid AND is_active
  ) THEN
    RAISE EXCEPTION 'Access denied: user is not an active member of tenant %', p_tenant_id;
  END IF;
  SELECT * INTO v_row FROM public.scout_tenants WHERE id = p_tenant_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found or inactive: %', p_tenant_id;
  END IF;
  RETURN jsonb_build_object(
    'tenant_id', v_row.id,
    'slug', v_row.slug,
    'company_name', v_row.company_name,
    'logo_url', v_row.logo_url,
    'note', 'JWT app_metadata.tenant_id must be updated server-side (admin API) + token refresh for RLS to switch.'
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_scout_tenants_for_user()
RETURNS TABLE (tenant_id uuid, slug text, company_name text, logo_url text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT t.id, t.slug, t.company_name, t.logo_url, m.role
  FROM public.scout_tenant_members m
  JOIN public.scout_tenants t ON t.id = m.tenant_id
  WHERE m.auth_user_id = auth.uid() AND m.is_active AND t.is_active
  ORDER BY t.company_name;
$fn$;

CREATE OR REPLACE FUNCTION public.get_scout_tenant_config(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.scout_tenants%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scout_tenant_members
    WHERE tenant_id = p_tenant_id AND auth_user_id = auth.uid() AND is_active
  ) THEN
    RAISE EXCEPTION 'Access denied to tenant %', p_tenant_id;
  END IF;
  SELECT * INTO v_row FROM public.scout_tenants WHERE id = p_tenant_id;
  RETURN jsonb_build_object('slug', v_row.slug, 'company_name', v_row.company_name, 'logo_url', v_row.logo_url);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_scout_tenant_id()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_scout_active_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_scout_tenants_for_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scout_tenant_config(uuid) TO authenticated;

-- 11. match_reports ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.scout_tenants(id),
  home_team   text,
  away_team   text,
  match_date  date,
  competition text,
  venue       text,
  status      text NOT NULL DEFAULT 'draft',
  report_data jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_reports_tenant ON public.match_reports(tenant_id);
ALTER TABLE public.match_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_reports_tenant_all ON public.match_reports
  FOR ALL TO authenticated
  USING (tenant_id = public.get_scout_tenant_id())
  WITH CHECK (tenant_id = public.get_scout_tenant_id());
CREATE POLICY service_role_all_match_reports ON public.match_reports
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMIT;
