import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReportResponse } from "@/types/scout";

export function useGenerateReport() {
  return useMutation<ReportResponse, Error, { player_id: string; format?: "html" | "json"; analysis_id?: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("scout-report", {
        body: { action: "generate", ...vars },
      });
      if (error) throw new Error(error.message || "Report generation failed");
      return data as ReportResponse;
    },
  });
}
