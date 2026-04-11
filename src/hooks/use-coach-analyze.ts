import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { CoachAnalysisResponseSchema, safeObject } from "@/types/scout";
import type { CoachAnalysisResponse } from "@/types/scout";

export function useAnalyzeCoach() {
  return useMutation<CoachAnalysisResponse, Error, { coach_id: string; analysis_type: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("scout-coach-analyze", { body: vars });
      if (error) throw new Error(await extractEdgeFunctionError(error, "Coach analysis failed"));
      const parsed = safeObject(CoachAnalysisResponseSchema, data);
      if (!parsed) throw new Error("scout-coach-analyze: unexpected response shape");
      return parsed;
    },
  });
}
