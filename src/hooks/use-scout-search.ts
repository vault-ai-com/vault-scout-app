import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  SearchResponseSchema,
  DiscoverResponseSchema,
  DashboardStatsSchema,
  safeObject,
} from "@/types/scout";
import type { SearchResponse, DiscoverResponse, DashboardStats } from "@/types/scout";

async function invokeScout(functionName: string, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || "Edge function call failed");
  return data;
}

export interface SearchParams {
  query?: string;
  position?: string;
  league?: string;
  tier?: string;
  phase?: string;
  min_age?: number;
  max_age?: number;
  limit?: number;
}

export function useScoutSearch(params: SearchParams, enabled = true) {
  return useQuery<SearchResponse>({
    queryKey: ["scout-search", params],
    queryFn: async () => {
      const raw = await invokeScout("scout-search", { action: "search", ...params });
      const parsed = safeObject(SearchResponseSchema, raw);
      if (!parsed) throw new Error("scout-search: unexpected response shape");
      return parsed;
    },
    enabled: enabled && Object.values(params).some(v => v != null && v !== ""),
  });
}

export function useScoutDiscover() {
  return useMutation<DiscoverResponse, Error, { criteria: string; position?: string; max_age?: number }>({
    mutationFn: async (vars) => {
      const raw = await invokeScout("scout-search", { action: "discover", ...vars });
      const parsed = safeObject(DiscoverResponseSchema, raw);
      if (!parsed) throw new Error("scout-search discover: unexpected response shape");
      return parsed;
    },
  });
}

export function useScoutDashboard() {
  return useQuery<DashboardStats>({
    queryKey: ["scout-dashboard"],
    queryFn: async () => {
      const raw = await invokeScout("scout-search", { action: "dashboard" });
      const parsed = safeObject(DashboardStatsSchema, raw);
      if (!parsed) throw new Error("scout-search dashboard: unexpected response shape");
      return parsed;
    },
    staleTime: 60_000,
  });
}
