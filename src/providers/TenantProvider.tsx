import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TenantContext, type ScoutTenant, type TenantContextValue } from "@/providers/tenant-context";
import { useScoutTenants } from "@/hooks/use-scout-tenants";

function readTenantId(appMeta: unknown): string | null {
  if (appMeta && typeof appMeta === "object" && "tenant_id" in appMeta) {
    const v = (appMeta as Record<string, unknown>).tenant_id;
    return typeof v === "string" ? v : null;
  }
  return null;
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setHasSession(!!session?.user);
      setActiveTenantId(readTenantId(session?.user?.app_metadata));
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setHasSession(!!session?.user);
      setActiveTenantId(readTenantId(session?.user?.app_metadata));
      setAuthReady(true);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const { data: availableTenants = [], isLoading: tenantsLoading } = useScoutTenants(authReady);

  const currentTenant = useMemo<ScoutTenant | null>(() => {
    if (!activeTenantId) return null;
    return (
      availableTenants.find((t) => t.tenantId === activeTenantId) ?? {
        tenantId: activeTenantId,
        slug: "",
        companyName: "",
        logoUrl: null,
        role: "member",
      }
    );
  }, [activeTenantId, availableTenants]);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      if (tenantId === activeTenantId) return;
      setIsSwitching(true);
      try {
        // Edge fn validates membership + writes app_metadata.tenant_id via admin API
        // (app_metadata is server-controlled — a plain RPC cannot change the JWT source).
        const { error } = await supabase.functions.invoke("scout-set-tenant", {
          body: { tenant_id: tenantId },
        });
        if (error) throw new Error(error.message);
        // Refresh JWT so app_metadata.tenant_id (and thus RLS) reflects the new tenant.
        await supabase.auth.refreshSession();
        // Clear ALL cached data so no previous tenant's rows linger in memory (cross-tenant guard).
        qc.clear();
      } finally {
        setIsSwitching(false);
      }
    },
    [activeTenantId, qc],
  );

  const value = useMemo<TenantContextValue>(
    () => ({
      currentTenant,
      availableTenants,
      activeTenantId,
      switchTenant,
      isSwitching,
      isLoading: !authReady || tenantsLoading,
      hasStaleTenantClaim: authReady && hasSession && activeTenantId === null,
    }),
    [currentTenant, availableTenants, activeTenantId, switchTenant, isSwitching, authReady, tenantsLoading, hasSession],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
