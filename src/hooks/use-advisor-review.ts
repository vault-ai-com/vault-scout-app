import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { AdvisorReviewResponseSchema, safeObject } from "@/types/scout";
import type { AdvisorReviewResponse } from "@/types/scout";

export function useAdvisorReview() {
  return useMutation<AdvisorReviewResponse, Error, { analysis_id: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("scout-advisor-review", { body: vars });
      if (error) throw new Error(await extractEdgeFunctionError(error, "Advisor review failed"));
      if (data && !data.success) throw new Error(data.error || "Advisor review returned error");
      const parsed = safeObject(AdvisorReviewResponseSchema, data);
      if (!parsed) throw new Error("scout-advisor-review: unexpected response shape");
      return parsed;
    },
    retry: 1,
  });
}
