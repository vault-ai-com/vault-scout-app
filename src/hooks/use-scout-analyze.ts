import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AnalysisResponseSchema, safeObject } from "@/types/scout";
import type { AnalysisResponse, AnalysisType } from "@/types/scout";

export function useAnalyzePlayer() {
  return useMutation<AnalysisResponse, Error, { player_id: string; analysis_type: AnalysisType }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("scout-analyze-player", { body: vars });
      if (error) throw new Error(error.message || "Analysis failed");
      if (data && !data.success) throw new Error(data.error || "Analysis returned error");
      const parsed = safeObject(AnalysisResponseSchema, data);
      if (!parsed) throw new Error("scout-analyze-player: unexpected response shape");
      return parsed;
    },
  });
}
