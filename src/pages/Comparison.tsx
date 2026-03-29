import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, GitCompare, Plus, Loader2, Save } from "lucide-react";
import { useGetPlayer } from "@/hooks/use-scout-search";
import { usePlayerLatestAnalysis } from "@/hooks/use-player-latest-analysis";
import { useComparisons, useCreateComparison } from "@/hooks/use-scout-comparison";
import { TIER_LABELS, TIER_COLORS, DIMENSION_LABELS, RECOMMENDATION_COLORS } from "@/types/scout";
import type { Recommendation } from "@/types/scout";

// --- Score color helper (VCE09 KRAV 1: conditional colors) ---
function scoreColor(score: number): string {
  if (score >= 7) return "text-emerald-400 border-emerald-500/30";
  if (score >= 4) return "text-amber-400 border-amber-500/30";
  return "text-red-400 border-red-500/30";
}

// --- ScoreBar: color-coded bar (VCE09 KRAV 2: nullable, KRAV 3: clamp 0-10) ---
function ScoreBar({ score }: { score: number | null }) {
  if (score == null) {
    return <div className="h-2 rounded-full bg-border/30 w-full" title="Ingen data" />;
  }
  const clamped = Math.min(10, Math.max(0, score));
  const pct = (clamped / 10) * 100;
  const bg = clamped >= 7 ? "bg-emerald-500" : clamped >= 4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-border/30 overflow-hidden">
        <div className={`h-full rounded-full ${bg} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-6 text-right">{clamped.toFixed(1)}</span>
    </div>
  );
}

// --- Analysis result type for props ---
interface AnalysisEntry {
  analysis: {
    id: string;
    overall_score: number | null;
    confidence: number | null;
    recommendation: string | null;
    summary: string | null;
  } | null;
  scores: Array<{
    dimension_id: string;
    dimension_name: string;
    score: number | null;
  }>;
  isLoading: boolean;
}

// --- DimensionTable (VCE09 KRAV 4: iterate DIMENSION_LABELS, KRAV 5: explicit empty-state) ---
// Analysis data passed as props — NO hooks called in this component (V64 P1 fix)
function DimensionTable({ entries, playerNames }: { entries: AnalysisEntry[]; playerNames: string[] }) {
  const dimIds = Object.keys(DIMENSION_LABELS);

  const anyLoading = entries.some((e) => e.isLoading);
  const allEmpty = entries.every((e) => !e.isLoading && e.analysis == null);

  if (anyLoading) {
    return (
      <div className="rounded-xl glass-premium p-6 space-y-2">
        <span className="section-tag block mb-4">Dimensioner</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-6 rounded skeleton-shimmer" />
        ))}
      </div>
    );
  }

  if (allEmpty) {
    return (
      <div className="rounded-xl glass-premium p-6">
        <span className="section-tag block mb-3">Dimensioner</span>
        <p className="text-xs text-muted-foreground/70">
          Ingen analys har körts ännu. Kör en AI-analys på spelarprofilsidan för att se dimensionspoäng här.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl glass-premium gradient-accent-top overflow-hidden">
      <div className="p-5 pb-3">
        <span className="section-tag block mb-1">Dimensioner</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left px-5 py-2 text-muted-foreground/70 font-medium w-44">Dimension</th>
              {entries.map((_, i) => (
                <th key={i} className="text-left px-4 py-2 text-muted-foreground/70 font-medium">
                  {playerNames[i] ?? `Spelare ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dimIds.map((dimId, rowIdx) => (
              <motion.tr
                key={dimId}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(rowIdx * 0.03, 0.4), duration: 0.25 }}
                className="border-b border-border/10 hover:bg-card/30 transition-colors"
              >
                <td className="px-5 py-2.5">
                  <span className="text-[10px] font-mono text-primary/60 mr-1.5">{dimId}</span>
                  <span className="text-muted-foreground">{DIMENSION_LABELS[dimId]}</span>
                </td>
                {entries.map((entry, colIdx) => {
                  if (!entry.analysis) {
                    return (
                      <td key={colIdx} className="px-4 py-2.5 text-muted-foreground/40 italic">
                        Ingen analys
                      </td>
                    );
                  }
                  const dimScore = entry.scores.find((s) => s.dimension_id === dimId);
                  return (
                    <td key={colIdx} className="px-4 py-2.5 min-w-[140px]">
                      <ScoreBar score={dimScore?.score ?? null} />
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- PlayerColumn with analysis summary (VCE09 KRAV 6: separate isLoading/null) ---
// Analysis data passed as props — hooks called in parent Comparison (V64 P1 fix)
function PlayerColumn({ playerId, index, analysisEntry }: { playerId: string; index: number; analysisEntry: AnalysisEntry }) {
  const { data: playerData, isLoading } = useGetPlayer(playerId);
  const player = playerData?.player ?? null;

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.08, duration: 0.3 }}
        className="flex-1 rounded-xl glass-premium p-5 space-y-3"
      >
        <div className="h-5 w-32 rounded skeleton-shimmer" />
        <div className="h-4 w-24 rounded skeleton-shimmer" />
      </motion.div>
    );
  }

  if (!player) {
    return (
      <div className="flex-1 rounded-xl glass-premium p-5">
        <p className="text-sm text-muted-foreground/60">Spelare hittades inte.</p>
      </div>
    );
  }

  const analysis = analysisEntry.analysis;
  const analysisLoading = analysisEntry.isLoading;
  const rec = analysis?.recommendation as Recommendation | null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.3 }}
      className="flex-1 rounded-xl glass-premium p-5"
    >
      <div className="flex items-start gap-3 mb-3">
        {/* Score circle with conditional color (VCE09 KRAV 1) */}
        {analysisLoading ? (
          <div className="w-11 h-11 rounded-full skeleton-shimmer flex-shrink-0" />
        ) : analysis?.overall_score != null ? (
          <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${scoreColor(analysis.overall_score)}`}>
            <span className="text-sm font-bold font-mono tabular-nums">{analysis.overall_score.toFixed(1)}</span>
          </div>
        ) : (
          <div className="w-11 h-11 rounded-full border-2 border-border/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] text-muted-foreground/50">–</span>
          </div>
        )}
        <div className="min-w-0">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border mb-1 ${TIER_COLORS[player.tier] ?? TIER_COLORS.development}`}>
            {TIER_LABELS[player.tier] ?? player.tier}
          </span>
          <h3 className="text-base font-bold text-foreground truncate">{player.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{player.position_primary} · {player.current_club}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mb-2">
        <span>{player.age} år</span>
        <span>·</span>
        <span>{player.nationality}</span>
        {player.market_value != null && (
          <>
            <span>·</span>
            <span className="badge-gold text-[10px]">€{(player.market_value / 1_000_000).toFixed(1)}M</span>
          </>
        )}
      </div>

      {/* Recommendation badge */}
      {analysisLoading ? (
        <div className="h-5 w-20 rounded skeleton-shimmer" />
      ) : rec ? (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${RECOMMENDATION_COLORS[rec] ?? RECOMMENDATION_COLORS.INSUFFICIENT_DATA}`}>
            {rec}
          </span>
          {analysis?.confidence != null && (
            <span className="text-[10px] text-muted-foreground/50">
              {(analysis.confidence * 100).toFixed(0)}% konfidens
            </span>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/40 italic">Ingen analys körd</p>
      )}
    </motion.div>
  );
}

const Comparison = () => {
  const [searchParams] = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  const playerIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const [saveTitle, setSaveTitle] = useState("");
  const [saved, setSaved] = useState(false);

  // --- Fixed hook count: always call 3 (Rules of Hooks safe) ---
  const a0 = usePlayerLatestAnalysis(playerIds[0]);
  const a1 = usePlayerLatestAnalysis(playerIds[1]);
  const a2 = usePlayerLatestAnalysis(playerIds[2]);

  const p0 = useGetPlayer(playerIds[0]);
  const p1 = useGetPlayer(playerIds[1]);
  const p2 = useGetPlayer(playerIds[2]);

  const allAnalyses = [a0, a1, a2];
  const allPlayers = [p0, p1, p2];

  // Build entries sliced to actual player count
  const analysisEntries: AnalysisEntry[] = playerIds.map((_, i) => {
    const a = allAnalyses[i];
    return {
      analysis: a.data ? {
        id: a.data.analysis.id,
        overall_score: a.data.analysis.overall_score,
        confidence: a.data.analysis.confidence,
        recommendation: a.data.analysis.recommendation,
        summary: a.data.analysis.summary,
      } : null,
      scores: a.data?.scores.map((s) => ({
        dimension_id: s.dimension_id,
        dimension_name: s.dimension_name,
        score: s.score,
      })) ?? [],
      isLoading: a.isLoading,
    };
  });

  const playerNames = playerIds.map((_, i) => allPlayers[i].data?.player?.name ?? "");

  const { data: savedComparisons = [], isLoading: loadingComparisons } = useComparisons();
  const createComparison = useCreateComparison();

  const handleSave = () => {
    const title = saveTitle.trim() || `Jämförelse ${new Date().toLocaleDateString("sv-SE")}`;
    createComparison.mutate(
      { title, player_ids: playerIds },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Back + header */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Link to="/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" />
          Tillbaka
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg icon-premium flex items-center justify-center">
            <GitCompare className="w-4 h-4 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Jämförelse</h1>
        </div>
      </motion.div>

      {playerIds.length === 0 ? (
        <div className="rounded-xl glass-premium p-8 text-center">
          <GitCompare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Inga spelare valda. Gå till en spelarprofil och välj Jämför.</p>
          <Link to="/players" className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline">
            <Plus className="w-3.5 h-3.5" />
            Hitta spelare
          </Link>
        </div>
      ) : (
        <>
          {/* Player columns */}
          <div className="flex gap-3 flex-wrap md:flex-nowrap">
            {playerIds.map((pid, i) => (
              <PlayerColumn key={pid} playerId={pid} index={i} analysisEntry={analysisEntries[i]} />
            ))}
          </div>

          {/* Dimension comparison table */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <DimensionTable entries={analysisEntries} playerNames={playerNames} />
          </motion.div>

          {/* Save comparison */}
          {playerIds.length >= 2 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="rounded-xl glass-premium card-accent-left p-5"
            >
              <span className="section-tag block mb-3">Spara jämförelse</span>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Titel (valfritt)"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-card/60 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={createComparison.isPending || saved}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground btn-premium disabled:opacity-50 shadow-md shadow-primary/20"
                >
                  {createComparison.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {saved ? "Sparad" : "Spara"}
                </button>
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Saved comparisons list */}
      {!loadingComparisons && savedComparisons.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-xl glass-premium p-6"
        >
          <span className="section-tag block mb-3">Sparade jämförelser</span>
          <ul className="space-y-2">
            {savedComparisons.map((c) => (
              <li key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border/30">
                <div>
                  <p className="text-sm font-medium text-foreground">{c.title}</p>
                  <p className="text-xs text-muted-foreground/60">
                    {c.player_ids.length} spelare · {new Date(c.created_at).toLocaleDateString("sv-SE")}
                  </p>
                </div>
                <Link
                  to={`/comparison?ids=${c.player_ids.join(",")}`}
                  className="text-xs text-primary hover:underline"
                >
                  Öppna
                </Link>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </div>
  );
};

export default Comparison;
