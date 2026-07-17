-- C79 Sprint 1: Härda tenant-id trust boundary
-- 1) get_scout_tenant_id: ta bort client-forgeable top-level jwt-claim, lita BARA på app_metadata (server-kontrollerad via admin-API)
CREATE OR REPLACE FUNCTION public.get_scout_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid;
$function$;

-- migration-safety assertion: bekräfta att top-level-grenen är borta
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.get_scout_tenant_id()'::regprocedure);
  IF d LIKE '%jwt() ->> ''tenant_id''%' THEN
    RAISE EXCEPTION 'get_scout_tenant_id refererar fortfarande top-level tenant_id-claim — manuell fix krävs';
  END IF;
  IF d NOT LIKE '%app_metadata%' THEN
    RAISE EXCEPTION 'get_scout_tenant_id saknar app_metadata-branch — manuell fix krävs';
  END IF;
END $$;

-- 2) DB-enforced tenant_id-derivation (service_role bypassar RLS → tenant_id-korrekthet får ej vila på app-kod)
CREATE OR REPLACE FUNCTION public.scout_scores_derive_tenant()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.analysis_id IS NOT NULL THEN
    SELECT a.tenant_id INTO NEW.tenant_id FROM public.scout_analyses a WHERE a.id = NEW.analysis_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scout_scores_derive_tenant ON public.scout_scores;
CREATE TRIGGER trg_scout_scores_derive_tenant
  BEFORE INSERT OR UPDATE ON public.scout_scores
  FOR EACH ROW EXECUTE FUNCTION public.scout_scores_derive_tenant();

CREATE OR REPLACE FUNCTION public.scout_chat_messages_derive_tenant()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT s.tenant_id INTO NEW.tenant_id FROM public.scout_chat_sessions s WHERE s.id = NEW.session_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scout_chat_messages_derive_tenant ON public.scout_chat_messages;
CREATE TRIGGER trg_scout_chat_messages_derive_tenant
  BEFORE INSERT OR UPDATE ON public.scout_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.scout_chat_messages_derive_tenant();
