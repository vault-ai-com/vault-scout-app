import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SearchResponse, DiscoverResponse, DashboardStats } from "@/types/scout";

async function invokeScout<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || "Edge function call failed");
  return data as T;
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
    queryFn: () => invokeScout<SearchResponse>("scout-search", { action: "search", ...params }),
    enabled: enabled && Object.values(params).some(v => v != null && v !== ""),
  });
}

export function useScoutDiscover() {
  return useMutation<DiscoverResponse, Error, { criteria: string; position?: string; max_age?: number }>({
    mutationFn: (vars) => invokeScout<DiscoverResponse>("scout-search", { action: "discover", ...vars }),
  });
}

export function useScoutDashboard() {
  return useQuery<DashboardStats>({
    queryKey: ["scout-dashboard"],
    queryFn: () => invokeScout<DashboardStats>("scout-search", { action: "dashboard" }),
    staleTime: 60_000,
  });
}
