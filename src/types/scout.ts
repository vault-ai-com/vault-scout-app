// Scout API types — matching edge function contracts

export interface ScoutPlayer {
  id: string;
  name: string;
  position: string;
  age: number;
  nationality: string;
  club: string;
  league: string;
  tier: "elite" | "established" | "emerging" | "prospect";
  career_phase: "peak" | "development" | "veteran" | "breakthrough";
  market_value?: number;
  preferred_foot?: string;
  height_cm?: number;
  weight_kg?: number;
}

export interface DimensionScore {
  dimension_id: string;
  dimension_name: string;
  score: number | null;
  evidence: string;
}

export type AnalysisType = "full_scout" | "quick_scan" | "match_review" | "transfer_assessment";
export type Recommendation = "SIGN" | "MONITOR" | "PASS" | "INSUFFICIENT_DATA";

export interface AnalysisResult {
  overall_score: number;
  confidence: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  risk_factors: string[];
  recommendation: Recommendation;
  dimension_scores: DimensionScore[];
}

export interface AnalysisResponse {
  success: boolean;
  analysis_id: string;
  duration_ms: number;
  result: AnalysisResult;
}

export interface SearchResponse {
  action: string;
  count: number;
  players: ScoutPlayer[];
}

export interface DiscoverResponse {
  action: string;
  criteria: string;
  interpreted_params: Record<string, unknown>;
  reasoning: string | null;
  count: number;
  players: ScoutPlayer[];
}

export interface DashboardStats {
  action: string;
  data: Record<string, unknown>;
}

export interface ReportResponse {
  success: boolean;
  player?: { id: string; name: string; position: string };
  analysis_id?: string;
  report: string | Record<string, unknown>;
}

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
  elite: "Elit",
  established: "Etablerad",
  emerging: "Talang",
  prospect: "Prospekt",
};

export const RECOMMENDATION_COLORS: Record<Recommendation, string> = {
  SIGN: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  MONITOR: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  PASS: "text-red-400 bg-red-500/10 border-red-500/20",
  INSUFFICIENT_DATA: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",
};
