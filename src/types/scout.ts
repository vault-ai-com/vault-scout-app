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
  latest_score: z.number().optional().nullable(),
  latest_recommendation: z.string().optional().nullable(),
  latest_analysis_date: z.string().optional().nullable(),
});

export type ScoutPlayer = z.infer<typeof ScoutPlayerSchema>;

export { safeArray, safeObject };

// --- GetPlayer response schema ---
export const GetPlayerResponseSchema = z.object({
  action: z.string(),
  player: ScoutPlayerSchema.extend({
    profile_data: z.record(z.unknown()).nullable().optional(),
  }),
});
export type GetPlayerResponse = z.infer<typeof GetPlayerResponseSchema>;

// --- DimensionScore + Analysis schemas ---
export const DimensionScoreSchema = z.object({
  dimension_id: z.string(),
  dimension_name: z.string(),
  score: z.number().min(0).max(10).nullable(),
  evidence: z.string().min(1),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

export type AnalysisType = "full_scout" | "quick_scan" | "match_review" | "transfer_assessment";
export type Recommendation = "SIGN" | "MONITOR" | "PASS" | "INSUFFICIENT_DATA";

export const AnalysisResultSchema = z.object({
  overall_score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1),
  weaknesses: z.array(z.string().min(1)),
  risk_factors: z.array(z.string().min(1)),
  recommendation: z.enum(["SIGN", "MONITOR", "PASS", "INSUFFICIENT_DATA"]),
  dimension_scores: z.array(DimensionScoreSchema).min(1),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const AnalysisResponseSchema = z.object({
  success: z.boolean(),
  analysis_id: z.string(),
  duration_ms: z.number(),
  cache_hit: z.boolean().optional(),
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

export const RecentAnalysisItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  analysis_type: z.string(),
  overall_score: z.number(),
  recommendation: z.string(),
  completed_at: z.string(),
});

export const CriticalWatchlistItemSchema = z.object({
  name: z.string(),
  priority: z.string(),
  status: z.string(),
  deadline: z.string().nullable(),
  notes: z.string().nullable(),
});

export const DashboardDataSchema = z.object({
  total_players: z.number(),
  total_analyses: z.number(),
  watchlist_count: z.number(),
  players_by_tier: z.record(z.number()).nullable(),
  players_by_position: z.record(z.number()).nullable(),
  recent_analyses: z.array(RecentAnalysisItemSchema).nullable(),
  critical_watchlist: z.array(CriticalWatchlistItemSchema).nullable(),
});

export const DashboardStatsSchema = z.object({
  action: z.string(),
  data: DashboardDataSchema,
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

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

// --- Personality Profile schemas (BPA-fotboll, separat från dimension_scores) ---
export const PersonalityDimensionSchema = z.object({
  name: z.string(),
  score: z.number().min(1).max(10),
  evidence: z.string(),
});
export type PersonalityDimension = z.infer<typeof PersonalityDimensionSchema>;

export const CompositeArchetypeSchema = z.enum([
  "COMPLETE_PROFESSIONAL",
  "HIGH_PERFORMING_SOLO",
  "SILENT_LEADER",
  "COACHABLE_RAW_TALENT",
  "TOXIC_HIGH_PERFORMER",
  "MENTALITY_MONSTER",
  "RELIABLE_SOLDIER",
]);
export type CompositeArchetype = z.infer<typeof CompositeArchetypeSchema>;

export const DataSourceQualitySchema = z.enum(["PUBLIC_ONLY", "MIXED", "VERIFIED"]);
export type DataSourceQuality = z.infer<typeof DataSourceQualitySchema>;

export const ARCHETYPE_LABELS: Record<CompositeArchetype, string> = {
  COMPLETE_PROFESSIONAL: "Komplett Proffs",
  HIGH_PERFORMING_SOLO: "Högpresterande Solist",
  SILENT_LEADER: "Tyst Ledare",
  COACHABLE_RAW_TALENT: "Formbar Råtalang",
  TOXIC_HIGH_PERFORMER: "Toxic Stjärna",
  MENTALITY_MONSTER: "Mentalitetsmonster",
  RELIABLE_SOLDIER: "Pålitlig Soldat",
};

export const ARCHETYPE_COLORS: Record<CompositeArchetype, string> = {
  COMPLETE_PROFESSIONAL: "bg-primary/10 text-primary border-primary/20",
  HIGH_PERFORMING_SOLO: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  SILENT_LEADER: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
  COACHABLE_RAW_TALENT: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  TOXIC_HIGH_PERFORMER: "bg-red-500/10 text-red-400 border-red-500/20",
  MENTALITY_MONSTER: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  RELIABLE_SOLDIER: "bg-sky-500/10 text-sky-400 border-sky-500/20",
};

export const DATA_SOURCE_LABELS: Record<DataSourceQuality, string> = {
  PUBLIC_ONLY: "Publika källor",
  MIXED: "Blandade källor",
  VERIFIED: "Verifierade källor",
};

// Contradiction score uses 0-1 range (not 1-10)
export const ContradictionDimensionSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(1),
  evidence: z.string(),
});
export type ContradictionDimension = z.infer<typeof ContradictionDimensionSchema>;

export const PersonalityProfileSchema = z.object({
  decision_tempo: PersonalityDimensionSchema,
  risk_appetite: PersonalityDimensionSchema,
  structure_need: PersonalityDimensionSchema,
  team_orientation: PersonalityDimensionSchema,
  tactical_understanding: PersonalityDimensionSchema,
  ambition_level: PersonalityDimensionSchema,
  career_motivation: PersonalityDimensionSchema,
  // KB-enhanced dimensions (optional for backward compat with cached 7-dim responses)
  ego: PersonalityDimensionSchema.optional(),
  resilience: PersonalityDimensionSchema.optional(),
  coachability: PersonalityDimensionSchema.optional(),
  x_factor: PersonalityDimensionSchema.optional(),
  contradiction_score: ContradictionDimensionSchema.optional(),
  stress_archetype: z.string().min(1),
  coaching_approach: z.array(z.string().min(1)).min(1).max(7),
  integration_risks: z.array(z.string().min(1)).min(1).max(6),
  confidence_score: z.number().min(0).max(1),
  composite_archetype: CompositeArchetypeSchema.optional(),
  confidence_reasoning: z.string().optional(),
  data_source_quality: DataSourceQualitySchema.optional(),
});
export type PersonalityProfile = z.infer<typeof PersonalityProfileSchema>;

export const PersonalityResponseSchema = z.object({
  success: z.boolean(),
  player_id: z.string(),
  profile: PersonalityProfileSchema,
  duration_ms: z.number(),
  cache_hit: z.boolean().optional(),
});
export type PersonalityResponse = z.infer<typeof PersonalityResponseSchema>;

// --- Labels & colors ---
// Canonical 16-dimension framework — SSOT for frontend + edge functions
// Weights: Tactical 22% (01-03), Technical 27% (04-07), Physical 18% (08-10),
//          Mental 23% (11-12, 15-16), Social/Context 10% (13-14)
export const DIMENSION_LABELS: Record<string, string> = {
  "DIM-01": "Positionell medvetenhet",
  "DIM-02": "Taktisk flexibilitet",
  "DIM-03": "Pressing & återerövring",
  "DIM-04": "Bollkontroll & första touch",
  "DIM-05": "Passningskvalitet",
  "DIM-06": "Skotteffektivitet",
  "DIM-07": "Dribbling & 1v1",
  "DIM-08": "Sprint & acceleration",
  "DIM-09": "Uthållighet",
  "DIM-10": "Styrka & duellspel",
  "DIM-11": "Beslutsfattande under press",
  "DIM-12": "Mental motståndskraft",
  "DIM-13": "Ledarskap & kommunikation",
  "DIM-14": "Klubb & ligaanpassning",
  "DIM-15": "Impulskontroll",
  "DIM-16": "Drivkraft",
};

export const TIER_LABELS: Record<string, string> = {
  world_class: "Världsklass",
  elite: "Elit",
  top_league: "Topliga",
  allsvenskan: "Allsvenskan",
  development: "Talang",
};

export const TIER_COLORS: Record<string, string> = {
  world_class: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  elite: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  top_league: "bg-primary/10 text-primary border-primary/20",
  allsvenskan: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  development: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export const RECOMMENDATION_COLORS: Record<Recommendation, string> = {
  SIGN: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  MONITOR: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  PASS: "text-red-400 bg-red-500/10 border-red-500/20",
  INSUFFICIENT_DATA: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};

// --- Scout Notes schema ---
export const ScoutNoteSchema = z.object({
  id: z.string(),
  player_id: z.string(),
  title: z.string().nullable().optional(),
  content: z.string(),
  created_by: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ScoutNote = z.infer<typeof ScoutNoteSchema>;

// --- Watchlist Entry schema (full DB row + optional player join) ---
export const WatchlistEntrySchema = z.object({
  id: z.string(),
  player_id: z.string(),
  priority: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  target_position: z.string().nullable().optional(),
  max_budget_eur: z.number().nullable().optional(),
  deadline: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable().optional(),
  scout_players: z.object({
    id: z.string(),
    name: z.string(),
    position_primary: z.string(),
    tier: z.string(),
    current_club: z.string(),
    nationality: z.string().nullable().optional(),
    current_league: z.string().nullable().optional(),
    career_phase: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    market_value_eur: z.number().nullable().optional(),
  }).nullable().optional(),
});
export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>;

// --- Advisor Review schemas (Sport Advisory Board) ---
export const AdvisorVerdictSchema = z.enum(["AGREE", "CHALLENGE", "FLAG"]);
export type AdvisorVerdict = z.infer<typeof AdvisorVerdictSchema>;

export const AdvisorOpinionSchema = z.object({
  advisor_id: z.string(),
  advisor_name: z.string(),
  domain: z.string(),
  verdict: AdvisorVerdictSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  detail: z.string(),
  risk_flags: z.array(z.string()),
  recommendations: z.array(z.string()),
  evidence_refs: z.array(z.string()),
});
export type AdvisorOpinion = z.infer<typeof AdvisorOpinionSchema>;

export const AdvisorReviewResponseSchema = z.object({
  success: z.boolean(),
  analysis_id: z.string(),
  player_name: z.string(),
  duration_ms: z.number(),
  advisors_consulted: z.number(),
  opinions: z.array(AdvisorOpinionSchema),
  consensus: z.string().nullable(),
});
export type AdvisorReviewResponse = z.infer<typeof AdvisorReviewResponseSchema>;

export const VERDICT_LABELS: Record<AdvisorVerdict, string> = {
  AGREE: "Godkänner",
  CHALLENGE: "Invändning",
  FLAG: "Varning",
};

export const VERDICT_COLORS: Record<AdvisorVerdict, string> = {
  AGREE: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  CHALLENGE: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  FLAG: "text-red-400 bg-red-500/10 border-red-500/20",
};

// --- Comparison Entry schema ---
export const ComparisonEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  player_ids: z.array(z.string()),
  comparison_type: z.string().nullable().optional(),
  result_data: z.record(z.unknown()).nullable().optional(),
  winner_player_id: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
});
export type ComparisonEntry = z.infer<typeof ComparisonEntrySchema>;
