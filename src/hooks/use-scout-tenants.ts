import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ScoutTenant } from "@/providers/tenant-context";

interface RpcTenantRow {
  tenant_id: string;
  slug: string;
  company_name: string;
  logo_url: string | null;
  role: string;
}

/** Lists tenants the current user is an active member of (list_scout_tenants_for_user RPC). */
export function useScoutTenants(enabled: boolean) {
  return useQuery<ScoutTenant[]>({
    queryKey: ["scout-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_scout_tenants_for_user");
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as RpcTenantRow[];
      return rows.map((r) => ({
        tenantId: r.tenant_id,
        slug: r.slug,
        companyName: r.company_name,
        logoUrl: r.logo_url,
        role: r.role,
      }));
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
