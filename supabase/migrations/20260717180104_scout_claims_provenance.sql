-- Provenance-datakontrakt: påståendet som atomär enhet med explicit evidenstier
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='scout_provenance_tier') THEN
    CREATE TYPE public.scout_provenance_tier AS ENUM ('MATT','FILM','TOLK','KLIPP');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.scout_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.scout_tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'player',
  player_id uuid REFERENCES public.scout_players(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES public.scout_analyses(id) ON DELETE SET NULL,
  claim_text text NOT NULL,
  provenance_tier public.scout_provenance_tier NOT NULL,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_scout_claims_tenant ON public.scout_claims(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scout_claims_player ON public.scout_claims(player_id);
CREATE INDEX IF NOT EXISTS idx_scout_claims_analysis ON public.scout_claims(analysis_id);

-- RLS: 9a-mönster (authenticated SELECT tenant-scopad, service_role ALL) från foundation-migrationen
ALTER TABLE public.scout_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scout_claims_tenant_read ON public.scout_claims;
CREATE POLICY scout_claims_tenant_read ON public.scout_claims
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_scout_tenant_id());
DROP POLICY IF EXISTS scout_claims_service_all ON public.scout_claims;
CREATE POLICY scout_claims_service_all ON public.scout_claims
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- tenant_id fail-closed: härled från parent-analys om analysis_id anges
CREATE OR REPLACE FUNCTION public.scout_claims_derive_tenant()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.analysis_id IS NOT NULL THEN
    SELECT a.tenant_id INTO NEW.tenant_id FROM public.scout_analyses a WHERE a.id = NEW.analysis_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_scout_claims_derive_tenant ON public.scout_claims;
CREATE TRIGGER trg_scout_claims_derive_tenant
  BEFORE INSERT OR UPDATE ON public.scout_claims
  FOR EACH ROW EXECUTE FUNCTION public.scout_claims_derive_tenant();
