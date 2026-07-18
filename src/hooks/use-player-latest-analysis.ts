import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

// Explicit column lists — DB ground truth verified against
// information_schema.columns for scout_analyses / scout_scores. Never select("*").
const SCOUT_ANALYSIS_COLUMNS =
  "id, player_id, analysis_type, status, overall_score, confidence, recommendation, summary, strengths, weaknesses, risk_factors, analysis_data, created_at";

const SCOUT_SCORE_COLUMNS =
  "id, analysis_id, dimension_id, dimension_name, score, confidence, evidence, percentile";

const ScoutAnalysisSchema = z.object({
  id: z.string(),
  player_id: z.string().nullable(),
  analysis_type: z.string(),
  status: z.string().nullable(),
  overall_score: z.number().nullable(),
  confidence: z.number().nullable(),
  recommendation: z.string().nullable(),
  summary: z.string().nullable(),
  strengths: z.array(z.string()).nullable(),
  weaknesses: z.array(z.string()).nullable(),
  risk_factors: z.array(z.string()).nullable(),
  analysis_data: z.record(z.unknown()).nullable(),
  created_at: z.string().nullable(),
});
type ScoutAnalysis = z.infer<typeof ScoutAnalysisSchema>;

const ScoutScoreSchema = z.object({
  id: z.string(),
  analysis_id: z.string(),
  dimension_id: z.string(),
  dimension_name: z.string(),
  score: z.number(),
  confidence: z.number().nullable(),
  evidence: z.unknown().nullable(),
  percentile: z.number().nullable(),
});
type ScoutScore = z.infer<typeof ScoutScoreSchema>;

interface PlayerLatestAnalysisResult {
  analysis: ScoutAnalysis;
  scores: ScoutScore[];
}

async function fetchPlayerLatestAnalysis(
  playerId: string
): Promise<PlayerLatestAnalysisResult | null> {
  const { data: analysisRow, error: analysisError } = await supabase
    .from("scout_analyses")
    .select(SCOUT_ANALYSIS_COLUMNS)
    .eq("player_id", playerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisError) {
    throw new Error(analysisError.message);
  }

  if (!analysisRow) {
    return null;
  }

  // Fail-closed: a shape mismatch (schema drift, malformed row, etc.) MUST
  // surface as an error — never silently cast/drop like the old `as ScoutAnalysis` did.
  const analysisParsed = ScoutAnalysisSchema.safeParse(analysisRow);
  if (!analysisParsed.success) {
    throw new Error(
      `Invalid scout_analyses row for player ${playerId}: ${analysisParsed.error.message}`
    );
  }

  const { data: scoreRows, error: scoresError } = await supabase
    .from("scout_scores")
    .select(SCOUT_SCORE_COLUMNS)
    .eq("analysis_id", analysisParsed.data.id)
    .order("dimension_id");

  if (scoresError) {
    throw new Error(scoresError.message);
  }

  const scoresParsed = z.array(ScoutScoreSchema).safeParse(scoreRows ?? []);
  if (!scoresParsed.success) {
    throw new Error(
      `Invalid scout_scores rows for analysis ${analysisParsed.data.id}: ${scoresParsed.error.message}`
    );
  }

  return {
    analysis: analysisParsed.data,
    scores: scoresParsed.data,
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
