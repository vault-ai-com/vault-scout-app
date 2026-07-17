-- Kolumn-vitlistade läs-ytor (aldrig SELECT *), tenant-scopade, fail-closed. GRANT endast authenticated.

-- 1) Tenant-scopad spelarsök
CREATE OR REPLACE FUNCTION public.search_scout_entities(p_query text DEFAULT NULL, p_limit int DEFAULT 20)
 RETURNS TABLE(id uuid, name text, position_primary text, current_club text, current_league text, nationality text, tier text, archetype text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.name, p.position_primary, p.current_club, p.current_league, p.nationality, p.tier, p.archetype
  FROM public.scout_players p
  WHERE p.tenant_id = public.get_scout_tenant_id()
    AND (p_query IS NULL OR p_query = '' OR p.name ILIKE '%'||p_query||'%' OR p.current_club ILIKE '%'||p_query||'%')
  ORDER BY p.name
  LIMIT LEAST(COALESCE(p_limit, 20), 100);
$$;
REVOKE ALL ON FUNCTION public.search_scout_entities(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_scout_entities(text, int) TO authenticated;

-- 2) Tenant-scopad spelarjämförelse (fail-closed: bara egna tenants spelare)
CREATE OR REPLACE FUNCTION public.compare_scout_players(p_player_ids uuid[])
 RETURNS TABLE(player_id uuid, name text, position_primary text, current_club text, tier text,
               dimension_id text, dimension_name text, score numeric, percentile int, confidence numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.name, p.position_primary, p.current_club, p.tier,
         s.dimension_id, s.dimension_name, s.score, s.percentile, s.confidence
  FROM public.scout_players p
  LEFT JOIN public.scout_scores s
    ON s.player_id = p.id AND s.tenant_id = public.get_scout_tenant_id()
  WHERE p.id = ANY(p_player_ids)
    AND p.tenant_id = public.get_scout_tenant_id()
  ORDER BY p.name, s.dimension_id;
$$;
REVOKE ALL ON FUNCTION public.compare_scout_players(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compare_scout_players(uuid[]) TO authenticated;

-- 3) Coach-läsyta: vitlistade kolumner, security_invoker → underliggande RLS på scout_analyses gäller (tenant-scopad)
CREATE OR REPLACE VIEW public.v_scout_coach_public
  WITH (security_invoker = true) AS
  SELECT a.id, a.coach_id, a.entity_type, a.overall_score, a.confidence, a.summary,
         a.recommendation, a.provenance_tier, a.tenant_id, a.created_at
  FROM public.scout_analyses a
  WHERE a.entity_type = 'coach';
GRANT SELECT ON public.v_scout_coach_public TO authenticated;
