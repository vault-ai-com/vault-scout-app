import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import {
  MatchReportRowSchema,
  parseMatchReport,
  parseMatchReportRows,
  type MatchReport,
} from "@/types/match-report";

/** All match reports for the active tenant, upcoming match first. */
export function useMatchReports() {
  const { currentTenant, isLoading: tenantLoading } = useTenant();
  return useQuery<MatchReport[]>({
    queryKey: ["match-reports", currentTenant?.tenantId ?? "none"],
    queryFn: async () => {
      let query = supabase
        .from("match_reports")
        .select("id, tenant_id, home_team, away_team, match_date, competition, venue, status, report_data, created_at, updated_at")
        .order("match_date", { ascending: true, nullsFirst: false });
      if (currentTenant) {
        query = query.eq("tenant_id", currentTenant.tenantId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return parseMatchReportRows(data);
    },
    enabled: !tenantLoading,
    staleTime: 60_000,
  });
}

/** A single match report by id (null when not found / not accessible). */
export function useMatchReport(id: string | undefined) {
  return useQuery<MatchReport | null>({
    queryKey: ["match-report", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_reports")
        .select("id, tenant_id, home_team, away_team, match_date, competition, venue, status, report_data, created_at, updated_at")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const parsed = MatchReportRowSchema.safeParse(data);
      if (!parsed.success) throw new Error("Ogiltigt matchunderlag i databasen");
      return parseMatchReport(parsed.data);
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}
