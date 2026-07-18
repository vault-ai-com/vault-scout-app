import { useGetPlayer } from "@/hooks/use-scout-search";
import { usePlayerLatestAnalysis } from "@/hooks/use-player-latest-analysis";
import type { ScoutPlayer } from "@/types/scout";

// ---------------------------------------------------------------------------
// Comparison slot types — trimmed to the actual selection (0-3 players).
// ---------------------------------------------------------------------------

export interface ComparisonAnalysis {
  id: string;
  overall_score: number | null;
  confidence: number | null;
  recommendation: string | null;
  summary: string | null;
}

export interface ComparisonScore {
  dimension_id: string;
  dimension_name: string;
  score: number | null;
  confidence: number | null;
  evidence: string | null;
}

export interface ComparisonEntry {
  playerId: string;
  player: ScoutPlayer | null;
  playerLoading: boolean;
  analysis: ComparisonAnalysis | null;
  scores: ComparisonScore[];
  analysisLoading: boolean;
  /** Non-null when the latest-analysis fetch itself failed — distinct from "no analysis run yet". */
  analysisError: Error | null;
}

export interface ComparisonSlotsResult {
  entries: ComparisonEntry[];
  playerNames: string[];
  players: (ScoutPlayer | null)[];
  playersLoading: boolean;
}

/** Extract human-readable evidence from a jsonb column or plain string (same rule as PlayerDetail). */
function evidenceText(e: unknown): string | null {
  if (e == null) return null;
  if (typeof e === "string") return e.trim() || null;
  if (typeof e === "object") {
    const rec = e as Record<string, unknown>;
    for (const key of ["text", "evidence", "summary", "notes", "reasoning"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * Centralizes the fixed-arity (Rules-of-Hooks-safe) player + latest-analysis
 * lookups for the comparison page. Always calls useGetPlayer /
 * usePlayerLatestAnalysis exactly 3 times regardless of how many player ids
 * are active, then trims the result to the actual selection length (0-3).
 */
export function useComparisonSlots(playerIds: string[]): ComparisonSlotsResult {
  const ids = playerIds.slice(0, 3);

  const p0 = useGetPlayer(ids[0]);
  const p1 = useGetPlayer(ids[1]);
  const p2 = useGetPlayer(ids[2]);

  const a0 = usePlayerLatestAnalysis(ids[0]);
  const a1 = usePlayerLatestAnalysis(ids[1]);
  const a2 = usePlayerLatestAnalysis(ids[2]);

  const allPlayers = [p0, p1, p2];
  const allAnalyses = [a0, a1, a2];

  const entries: ComparisonEntry[] = ids.map((playerId, i) => {
    const pRes = allPlayers[i];
    const aRes = allAnalyses[i];
    const persisted = aRes.data;

    return {
      playerId,
      player: pRes.data?.player ?? null,
      playerLoading: pRes.isLoading,
      analysis: persisted
        ? {
            id: persisted.analysis.id,
            overall_score: persisted.analysis.overall_score,
            confidence: persisted.analysis.confidence,
            recommendation: persisted.analysis.recommendation,
            summary: persisted.analysis.summary,
          }
        : null,
      scores:
        persisted?.scores.map((s) => ({
          dimension_id: s.dimension_id,
          dimension_name: s.dimension_name,
          score: s.score,
          confidence: s.confidence,
          evidence: evidenceText(s.evidence),
        })) ?? [],
      analysisLoading: aRes.isLoading,
      analysisError: aRes.isError
        ? aRes.error instanceof Error
          ? aRes.error
          : new Error("Kunde inte hämta analys")
        : null,
    };
  });

  return {
    entries,
    playerNames: entries.map((e) => e.player?.name ?? ""),
    players: entries.map((e) => e.player),
    playersLoading: entries.some((e) => e.playerLoading),
  };
}
