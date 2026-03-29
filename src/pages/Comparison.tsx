import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, GitCompare, Plus, Loader2, Save } from "lucide-react";
import { useGetPlayer } from "@/hooks/use-scout-search";
import { useComparisons, useCreateComparison } from "@/hooks/use-scout-comparison";
import { TIER_LABELS, TIER_COLORS, DIMENSION_LABELS } from "@/types/scout";

function PlayerColumn({ playerId }: { playerId: string }) {
  const { data: playerData, isLoading } = useGetPlayer(playerId);
  const player = playerData?.player ?? null;

  if (isLoading) {
    return (
      <div className="flex-1 rounded-xl glass-premium p-5 space-y-3">
        <div className="h-5 w-32 rounded skeleton-shimmer" />
        <div className="h-4 w-24 rounded skeleton-shimmer" />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="flex-1 rounded-xl glass-premium p-5">
        <p className="text-sm text-muted-foreground/60">Spelare hittades inte.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-xl glass-premium p-5">
      <div className="mb-3">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border mb-1.5 ${TIER_COLORS[player.tier] ?? TIER_COLORS.development}`}>
          {TIER_LABELS[player.tier] ?? player.tier}
        </span>
        <h3 className="text-base font-bold text-foreground">{player.name}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{player.position_primary} · {player.current_club}</p>
        <p className="text-xs text-muted-foreground/70">{player.age} år · {player.nationality}</p>
      </div>
      {player.market_value != null && (
        <p className="text-xs text-primary font-semibold">€{(player.market_value / 1_000_000).toFixed(1)}M</p>
      )}
    </div>
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

  const { data: savedComparisons = [], isLoading: loadingComparisons } = useComparisons();
  const createComparison = useCreateComparison();

  const handleSave = () => {
    const title = saveTitle.trim() || `Jämförelse ${new Date().toLocaleDateString("sv-SE")}`;
    createComparison.mutate(
      { title, player_ids: playerIds },
      { onSuccess: () => setSaved(true) },
    );
  };

  const dimensionIds = Object.keys(DIMENSION_LABELS);

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
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex gap-3 flex-wrap md:flex-nowrap"
          >
            {playerIds.map((pid) => (
              <PlayerColumn key={pid} playerId={pid} />
            ))}
          </motion.div>

          {/* Dimension reference table */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-xl glass-premium p-6"
          >
            <span className="section-tag block mb-4">Dimensioner</span>
            <p className="text-xs text-muted-foreground/70 mb-4">
              Kör en AI-analys på spelarprofilsidan för att se dimensionspoäng här.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {dimensionIds.map((dimId) => (
                <div key={dimId} className="flex items-center gap-2 p-2 rounded-lg bg-card/40 border border-border/20">
                  <span className="text-[10px] font-mono text-primary/70 shrink-0">{dimId}</span>
                  <span className="text-xs text-muted-foreground truncate">{DIMENSION_LABELS[dimId]}</span>
                </div>
              ))}
            </div>
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
