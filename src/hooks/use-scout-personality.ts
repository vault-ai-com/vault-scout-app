import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PersonalityResponseSchema, safeObject } from "@/types/scout";
import type { PersonalityResponse } from "@/types/scout";

export function usePersonalityAnalysis() {
  return useMutation<PersonalityResponse, Error, { player_id: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke(
        "scout-personality-analysis",
        { body: vars }
      );
      if (error) throw new Error(error.message || "Personality analysis failed");
      if (data && !data.success) throw new Error(data.error || "Analysis returned error");
      const parsed = safeObject(PersonalityResponseSchema, data);
      if (!parsed) throw new Error("scout-personality-analysis: unexpected response shape");
      return parsed;
    },
  });
}
