import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";

export interface CoachPersonalityResponse {
  success: boolean;
  coach_id: string;
  profile: {
    decision_tempo: { score: number; evidence: string };
    risk_appetite: { score: number; evidence: string };
    structure_need: { score: number; evidence: string };
    team_orientation: { score: number; evidence: string };
    tactical_innovation: { score: number; evidence: string };
    ambition_level: { score: number; evidence: string };
    career_motivation: { score: number; evidence: string };
    ego: { score: number; evidence: string };
    resilience: { score: number; evidence: string };
    learning_orientation: { score: number; evidence: string };
    x_factor: { score: number; evidence: string };
    contradiction_score: { score: number; evidence: string };
    stress_archetype: string;
    coaching_approach: string[];
    integration_risks: string[];
    confidence_score: number;
    composite_archetype: string;
    data_source_quality: string;
  };
  recommendation: string;
  _v: string;
}

export function useCoachPersonality() {
  return useMutation<CoachPersonalityResponse, Error, { coach_id: string }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("scout-coach-personality", { body: vars });
      if (error) throw new Error(await extractEdgeFunctionError(error, "Coach personality analysis failed"));
      return data as CoachPersonalityResponse;
    },
  });
}
