import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import {
  SearchResponseSchema,
  DiscoverResponseSchema,
  DashboardStatsSchema,
  GetPlayerResponseSchema,
  safeObject,
} from "@/types/scout";
import type { SearchResponse, DiscoverResponse, DashboardStats, GetPlayerResponse } from "@/types/scout";

async function invokeScout(functionName: string, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(await extractEdgeFunctionError(error, "Edge function call failed"));
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

export function useGetPlayer(playerId: string | undefined) {
  return useQuery<GetPlayerResponse>({
    queryKey: ["scout-player", playerId],
    queryFn: async () => {
      const raw = await invokeScout("scout-search", { action: "get_player", player_id: playerId });
      const parsed = safeObject(GetPlayerResponseSchema, raw);
      if (!parsed) throw new Error("scout-search get_player: unexpected response shape");
      return parsed;
    },
    enabled: !!playerId,
    staleTime: 5 * 60_000,
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
