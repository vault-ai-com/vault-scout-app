// Scout API types — matching edge function contracts
import { z } from "zod";

// --- Zod helpers (ISP-mönster) ---
function safeArray<T>(schema: z.ZodType<T>, data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function safeObject<T>(schema: z.ZodType<T>, data: unknown): T | null {
  if (data == null) return null;
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

// --- Enums matching DB values ---
export const ScoutTierSchema = z.enum([
  "world_class",
  "elite",
  "top_league",
  "allsvenskan",
  "development",
]);
export type ScoutTier = z.infer<typeof ScoutTierSchema>;

export const CareerPhaseSchema = z.enum([
  "EMERGENCE",
  "DEVELOPMENT",
  "PRIME_EARLY",
  "PEAK",
  "MATURITY",
  "TWILIGHT",
]);
export type CareerPhase = z.infer<typeof CareerPhaseSchema>;

// --- ScoutPlayer Zod schema (DB column names) ---
export const ScoutPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  position_primary: z.string(),
  age: z.number(),
  nationality: z.string(),
  current_club: z.string(),
  current_league: z.string(),
  tier: ScoutTierSchema,
  career_phase: CareerPhaseSchema,
  date_of_birth: z.string().optional().nullable(),
  market_value: z.number().optional().nullable(),
  preferred_foot: z.string().optional().nullable(),
  height_cm: z.number().optional().nullable(),
  weight_kg: z.number().optional().nullable(),
});

export type ScoutPlayer = z.infer<typeof ScoutPlayerSchema>;

export { safeArray, safeObject };

// --- DimensionScore + Analysis schemas ---
export const DimensionScoreSchema = z.object({
  dimension_id: z.string(),
  dimension_name: z.string(),
  score: z.number().nullable(),
  evidence: z.string(),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

export type AnalysisType = "full_scout" | "quick_scan" | "match_review" | "transfer_assessment";
export type Recommendation = "SIGN" | "MONITOR" | "PASS" | "INSUFFICIENT_DATA";

export const AnalysisResultSchema = z.object({
  overall_score: z.number(),
  confidence: z.number(),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  risk_factors: z.array(z.string()),
  recommendation: z.enum(["SIGN", "MONITOR", "PASS", "INSUFFICIENT_DATA"]),
  dimension_scores: z.array(DimensionScoreSchema),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const AnalysisResponseSchema = z.object({
  success: z.boolean(),
  analysis_id: z.string(),
  duration_ms: z.number(),
  result: AnalysisResultSchema,
});
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

// --- Search + Discover schemas ---
export const SearchResponseSchema = z.object({
  action: z.string(),
  count: z.number(),
  players: z.array(ScoutPlayerSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const DiscoverResponseSchema = z.object({
  action: z.string(),
  criteria: z.string(),
  interpreted_params: z.record(z.unknown()),
  reasoning: z.string().nullable(),
  count: z.number(),
  players: z.array(ScoutPlayerSchema),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

export interface DashboardStats {
  action: string;
  data: Record<string, unknown>;
}

// --- Report schemas ---
export const ReportPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  position_primary: z.string(),
});

export const ReportResponseSchema = z.object({
  success: z.boolean(),
  player: ReportPlayerSchema.optional(),
  analysis_id: z.string().optional(),
  report: z.union([z.string(), z.record(z.unknown())]),
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

// --- Labels & colors ---
export const DIMENSION_LABELS: Record<string, string> = {
  "DIM-01": "Positionsmedvetenhet",
  "DIM-02": "Taktisk flexibilitet",
  "DIM-03": "Beslutfattande",
  "DIM-04": "Bollkontroll",
  "DIM-05": "Passningsregister",
  "DIM-06": "Avslut & kreativitet",
  "DIM-07": "Atletisk profil",
  "DIM-08": "Duellstyrka",
  "DIM-09": "Skaderesistens",
  "DIM-10": "Lugn under press",
  "DIM-11": "Ledarskap & mentalitet",
  "DIM-12": "Lagpassning",
  "DIM-13": "Utvecklingskurva",
  "DIM-14": "Marknad & kontrakt",
};

export const TIER_LABELS: Record<string, string> = {
  world_class: "Världsklass",
  elite: "Elit",
  top_league: "Topliga",
  allsvenskan: "Allsvenskan",
  development: "Talang",
};

export const RECOMMENDATION_COLORS: Record<Recommendation, string> = {
  SIGN: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  MONITOR: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  PASS: "text-red-400 bg-red-500/10 border-red-500/20",
  INSUFFICIENT_DATA: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};
