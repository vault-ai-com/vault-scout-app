import { createContext } from "react";

/** A scout tenant (club/organization) the user has access to. Scout-owned — no CRM coupling. */
export interface ScoutTenant {
  tenantId: string;
  slug: string;
  companyName: string;
  logoUrl: string | null;
  role: string;
}

export interface TenantContextValue {
  /** Active tenant resolved from JWT app_metadata.tenant_id, enriched from the member list. */
  currentTenant: ScoutTenant | null;
  /** All tenants the user is an active member of. */
  availableTenants: ScoutTenant[];
  /** Raw active tenant id from the JWT (source of truth for RLS). */
  activeTenantId: string | null;
  /** Switch active tenant: server-side app_metadata update + JWT refresh + cache clear. */
  switchTenant: (tenantId: string) => Promise<void>;
  isSwitching: boolean;
  isLoading: boolean;
}

export const TenantContext = createContext<TenantContextValue | undefined>(undefined);
