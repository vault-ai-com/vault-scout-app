import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { ReportResponseSchema, safeObject } from "@/types/scout";
import type { ReportResponse } from "@/types/scout";

export function useGenerateReport() {
  return useMutation<ReportResponse, Error, { player_id: string; format?: "html" | "json"; analysis_id?: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("scout-report", {
        body: { action: "generate", ...vars },
      });
      if (error) throw new Error(await extractEdgeFunctionError(error, "Report generation failed"));
      const parsed = safeObject(ReportResponseSchema, data);
      if (!parsed) throw new Error("scout-report: unexpected response shape");
      return parsed;
    },
  });
}
