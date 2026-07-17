import { useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Star } from "lucide-react";
import { useScoutSearch, useScoutDiscover } from "@/hooks/use-scout-search";
import { useWatchlist } from "@/hooks/use-scout-watchlist";
import { PlayerCard } from "@/components/PlayerCard";
import { SearchScaffold, type SearchScaffoldConfig } from "@/components/scaffolds/SearchScaffold";
import type { ScoutPlayer, WatchlistEntry, ScoutTier, CareerPhase } from "@/types/scout";

const VALID_TIERS = new Set<string>(["world_class", "elite", "top_league", "allsvenskan", "development"]);
const VALID_PHASES = new Set<string>(["EMERGENCE", "DEVELOPMENT", "PRIME_EARLY", "PEAK", "MATURITY", "TWILIGHT"]);

function watchlistToPlayer(entry: WatchlistEntry): ScoutPlayer | null {
  const p = entry.scout_players;
  if (!p) return null;
  const age = p.date_of_birth
    ? Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 0;
  return {
    id: p.id,
    name: p.name,
    position_primary: p.position_primary,
    tier: (VALID_TIERS.has(p.tier) ? p.tier : "development") as ScoutTier,
    current_club: p.current_club,
    nationality: p.nationality ?? "",
    current_league: p.current_league ?? "",
    career_phase: (VALID_PHASES.has(p.career_phase ?? "") ? p.career_phase : "DEVELOPMENT") as CareerPhase,
    age,
    market_value: p.market_value_eur ?? null,
  };
}

// --- Search surface: thin config consumer of the shared SearchScaffold ---
type PlayerFilters = { position: string; tier: string };

const POSITION_OPTIONS = [
  { value: "", label: "Alla" },
  { value: "Goalkeeper", label: "Målvakt" },
  { value: "Defender", label: "Försvarare" },
  { value: "Midfielder", label: "Mittfältare" },
  { value: "Forward", label: "Anfallare" },
];
const TIER_OPTIONS = [
  { value: "", label: "Alla" },
  { value: "world_class", label: "Världsklass" },
  { value: "elite", label: "Elit" },
  { value: "top_league", label: "Topliga" },
  { value: "allsvenskan", label: "Allsvenskan" },
  { value: "development", label: "Talang" },
];

const playersConfig: SearchScaffoldConfig<ScoutPlayer, PlayerFilters> = {
  eyebrow: "Spelare",
  title: "Sök och analysera",
  subtitle: "Hitta spelare med AI-driven sökning",
  searchPlaceholder: "Sök spelare, position, klubb...",
  searchAriaLabel: "Sök spelare",
  filters: [
    { key: "position", label: "Position", options: POSITION_OPTIONS },
    { key: "tier", label: "Nivå", options: TIER_OPTIONS },
  ],
  emptyFilters: { position: "", tier: "" },
  useResults: ({ activeQuery, filters }) => {
    const { data, isLoading } = useScoutSearch({
      query: activeQuery || undefined,
      position: filters.position || undefined,
      tier: filters.tier || undefined,
    });
    const discover = useScoutDiscover();
    return {
      items: discover.data?.players ?? data?.players ?? [],
      loading: isLoading || discover.isPending,
      error: discover.error?.message ?? null,
      reasoning: discover.data?.reasoning ?? null,
      discover: (criteria, f) => discover.mutate({ criteria, position: f.position || undefined }),
      resetDiscover: () => discover.reset(),
    };
  },
  getItemKey: (p) => p.id,
  renderCard: (p) => <PlayerCard player={p} />,
  resultCountLabel: (n) => `${n} spelare hittade`,
  noResultsPrimary: "Inga spelare matchade din sökning.",
  noResultsSecondary: "Prova ett bredare sökord eller använd AI-sökning.",
};

const Players = () => {
  const [searchParams] = useSearchParams();
  const isWatchlistMode = searchParams.get("watchlist") === "true";

  // Watchlist data (only used in watchlist mode, but hook must be unconditional)
  const { data: watchlistEntries = [], isLoading: loadingWatchlist } = useWatchlist();

  if (!isWatchlistMode) {
    return <SearchScaffold config={playersConfig} />;
  }

  const watchlistPlayers = watchlistEntries.flatMap((e) => {
    const p = watchlistToPlayer(e);
    return p ? [p] : [];
  });

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <div className="flex items-center gap-3 mb-1">
          <Link to="/players" className="p-1.5 rounded-lg hover:bg-card/50 transition-colors" aria-label="Tillbaka till sök">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
          <div>
            <span className="section-tag">Spelare</span>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mt-1 tracking-tight">Bevakningslista</h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{watchlistPlayers.length} bevakade spelare</p>
      </motion.div>

      {loadingWatchlist && (
        <div className="flex items-center justify-center py-12" role="status">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
        </div>
      )}

      {!loadingWatchlist && watchlistPlayers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {watchlistPlayers.map((player, i) => (
            <motion.div key={player.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3), ease: [0.25, 0.46, 0.45, 0.94] }}>
              <PlayerCard player={player} />
            </motion.div>
          ))}
        </div>
      )}

      {!loadingWatchlist && watchlistPlayers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl icon-premium flex items-center justify-center mb-5">
            <Star className="w-7 h-7 text-muted-foreground/40" />
          </div>
          <p className="text-base font-semibold text-foreground mb-2">Ingen spelare bevakad</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Markera spelare med stjärnan för att lägga till dem här.
          </p>
        </div>
      )}
    </div>
  );
};

export default Players;
