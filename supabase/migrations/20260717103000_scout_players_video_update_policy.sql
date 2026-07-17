-- ============================================================================
-- Migration: allow tenant-scoped UPDATE on scout_players (video attachments)
-- Follows: 20260717101500_scout_multitenant_foundation.sql
-- ----------------------------------------------------------------------------
-- VideoSection.tsx attaches video_urls via a client-side UPDATE on scout_players.
-- The multi-tenant foundation made scout_players SELECT-only for authenticated
-- (VCE09 hardening — AI/import data). This restores the legitimate analyst write
-- as a tenant-scoped UPDATE, while INSERT/DELETE remain service_role-only
-- (players are created by the import pipeline, not by clients).
-- ============================================================================
CREATE POLICY scout_players_tenant_update ON public.scout_players
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_scout_tenant_id())
  WITH CHECK (tenant_id = public.get_scout_tenant_id());
