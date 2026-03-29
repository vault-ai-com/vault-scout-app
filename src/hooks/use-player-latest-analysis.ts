import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ScoutAnalysis {
  id: string;
  player_id: string;
  analysis_type: string;
  status: string;
  overall_score: number | null;
  confidence: number | null;
  recommendation: string | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  risk_factors: string[] | null;
  summary: string | null;
  analysis_data: Record<string, unknown> | null;
  created_at: string;
}

interface ScoutScore {
  id: string;
  analysis_id: string;
  player_id: string;
  dimension_id: string;
  dimension_name: string;
  score: number | null;
  confidence: number | null;
  evidence: Record<string, unknown> | null;
}

interface PlayerLatestAnalysisResult {
  analysis: ScoutAnalysis;
  scores: ScoutScore[];
}

async function fetchPlayerLatestAnalysis(
  playerId: string
): Promise<PlayerLatestAnalysisResult | null> {
  const { data: analysis, error: analysisError } = await supabase
    .from("scout_analyses")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisError) {
    throw new Error(analysisError.message);
  }

  if (!analysis) {
    return null;
  }

  const { data: scores, error: scoresError } = await supabase
    .from("scout_scores")
    .select("*")
    .eq("analysis_id", analysis.id)
    .order("dimension_id");

  if (scoresError) {
    throw new Error(scoresError.message);
  }

  return {
    analysis: analysis as ScoutAnalysis,
    scores: (scores ?? []) as ScoutScore[],
  };
}

export function usePlayerLatestAnalysis(playerId: string | undefined) {
  return useQuery({
    queryKey: ["scout-analysis", playerId],
    queryFn: () => fetchPlayerLatestAnalysis(playerId!),
    enabled: !!playerId,
    staleTime: 5 * 60 * 1000,
  });
}
