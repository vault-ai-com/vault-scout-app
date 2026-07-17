import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/use-tenant";
import { ComparisonEntrySchema, safeArray } from "@/types/scout";
import type { ComparisonEntry } from "@/types/scout";

export function useComparisons() {
  return useQuery<ComparisonEntry[]>({
    queryKey: ["scout-comparisons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_comparisons")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return safeArray(ComparisonEntrySchema, data);
    },
    staleTime: 60_000,
  });
}

interface CreateComparisonArgs {
  title: string;
  player_ids: string[];
}

export function useCreateComparison() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation<ComparisonEntry, Error, CreateComparisonArgs>({
    mutationFn: async ({ title, player_ids }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      if (!currentTenant) throw new Error("Ingen organisation vald");
      const { data, error } = await supabase
        .from("scout_comparisons")
        .insert({ title, player_ids, comparison_type: "manual", created_by: session.user.id, tenant_id: currentTenant.tenantId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const parsed = ComparisonEntrySchema.safeParse(data);
      if (!parsed.success) throw new Error("Invalid comparison response");
      return parsed.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scout-comparisons"] });
    },
  });
}
