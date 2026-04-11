import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import {
  CoachSearchResponseSchema,
  CoachDashboardStatsSchema,
  GetCoachResponseSchema,
  safeObject,
} from "@/types/scout";
import type { CoachSearchResponse, CoachDashboardStats, GetCoachResponse } from "@/types/scout";

async function invokeCoach(functionName: string, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(await extractEdgeFunctionError(error, "Edge function call failed"));
  return data;
}

export interface CoachSearchParams {
  query?: string;
  tier?: string;
  career_phase?: string;
  limit?: number;
}

export function useCoachSearch(params: CoachSearchParams, enabled = true) {
  return useQuery<CoachSearchResponse>({
    queryKey: ["coach-search", params],
    queryFn: async () => {
      const raw = await invokeCoach("scout-coach-search", { action: "search", ...params });
      const parsed = safeObject(CoachSearchResponseSchema, raw);
      if (!parsed) throw new Error("scout-coach-search: unexpected response shape");
      return parsed;
    },
    enabled: enabled && !!params.query,
  });
}

export function useCoachDiscover() {
  return useMutation<CoachSearchResponse, Error, { criteria: string; tier?: string }>({
    mutationFn: async (vars) => {
      const raw = await invokeCoach("scout-coach-search", { action: "discover", ...vars });
      const parsed = safeObject(CoachSearchResponseSchema, raw);
      if (!parsed) throw new Error("scout-coach-search discover: unexpected response shape");
      return parsed;
    },
  });
}

export function useGetCoach(coachId: string | undefined) {
  return useQuery<GetCoachResponse>({
    queryKey: ["coach-detail", coachId],
    queryFn: async () => {
      const raw = await invokeCoach("scout-coach-search", { action: "get_coach", coach_id: coachId });
      const parsed = safeObject(GetCoachResponseSchema, raw);
      if (!parsed) throw new Error("scout-coach-search get_coach: unexpected response shape");
      return parsed;
    },
    enabled: !!coachId,
    staleTime: 5 * 60_000,
  });
}

export function useCoachDashboard() {
  return useQuery<CoachDashboardStats>({
    queryKey: ["coach-dashboard"],
    queryFn: async () => {
      const raw = await invokeCoach("scout-coach-search", { action: "dashboard" });
      const parsed = safeObject(CoachDashboardStatsSchema, raw);
      if (!parsed) throw new Error("scout-coach-search dashboard: unexpected response shape");
      return parsed;
    },
    staleTime: 60_000,
  });
}
