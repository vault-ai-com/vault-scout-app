import { useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Filter, Users, Sparkles, Loader2, X, ArrowLeft, Star } from "lucide-react";
import { useScoutSearch, useScoutDiscover } from "@/hooks/use-scout-search";
import { useWatchlist } from "@/hooks/use-scout-watchlist";
import { PlayerCard } from "@/components/PlayerCard";
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

const Players = () => {
  const [searchParams] = useSearchParams();
  const isWatchlistMode = searchParams.get("watchlist") === "true";
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [position, setPosition] = useState("");
  const [tier, setTier] = useState("");

  // Structured search
  const { data: searchData, isLoading: searching } = useScoutSearch(
    { query: activeQuery, position: position || undefined, tier: tier || undefined },
    activeQuery.length > 0,
  );

  // AI discover
  const discover = useScoutDiscover();

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(query.trim());
    discover.reset();
  }, [query, discover]);

  const handleDiscover = useCallback(() => {
    if (!query.trim()) return;
    discover.mutate({ criteria: query.trim(), position: position || undefined });
    setActiveQuery("");
  }, [query, position, discover]);

  // Watchlist data
  const { data: watchlistEntries = [], isLoading: loadingWatchlist } = useWatchlist();
  const watchlistPlayers = watchlistEntries.flatMap((e) => {
    const p = watchlistToPlayer(e);
    return p ? [p] : [];
  });

  // Watchlist mode — early return
  if (isWatchlistMode) {
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
  }

  const players: ScoutPlayer[] = discover.data?.players ?? searchData?.players ?? [];
  const loading = searching || discover.isPending;
  const hasResults = players.length > 0;
  const noResults = !loading && (activeQuery || discover.data) && !hasResults;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <span className="section-tag">Spelare</span>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mt-1 tracking-tight">Sök och analysera</h1>
        <p className="text-sm text-muted-foreground mt-1">Hitta spelare med AI-driven sökning</p>
      </motion.div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Sök spelare, position, klubb..." aria-label="Sök spelare"
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent/30 transition-all glass-premium text-foreground placeholder:text-muted-foreground/60" />
        </div>
        <button type="submit" disabled={!query.trim() || loading}
          className="px-5 py-3 rounded-xl text-sm font-semibold bg-accent text-accent-foreground btn-premium disabled:opacity-50 shadow-lg shadow-accent/20">
          Sök
        </button>
        <button type="button" onClick={handleDiscover} disabled={!query.trim() || loading}
          className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 btn-premium disabled:opacity-50"
          title="AI-sökning: beskriv vad du letar efter">
          <Sparkles className="w-3.5 h-3.5" />
          AI
        </button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-card/50 transition-all">
          <Filter className="w-4 h-4" />
        </button>
      </form>

      {/* Filters */}
      {showFilters && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          className="flex flex-wrap gap-3 p-4 rounded-xl glass-premium">
          <div>
            <label htmlFor="filter-position" className="block text-[10px] font-medium text-muted-foreground mb-1">Position</label>
            <select id="filter-position" value={position} onChange={e => setPosition(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-input border border-border text-foreground">
              <option value="">Alla</option>
              <option value="Goalkeeper">Målvakt</option>
              <option value="Defender">Försvarare</option>
              <option value="Midfielder">Mittfältare</option>
              <option value="Forward">Anfallare</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-tier" className="block text-[10px] font-medium text-muted-foreground mb-1">Nivå</label>
            <select id="filter-tier" value={tier} onChange={e => setTier(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-input border border-border text-foreground">
              <option value="">Alla</option>
              <option value="world_class">Världsklass</option>
              <option value="elite">Elit</option>
              <option value="top_league">Topliga</option>
              <option value="allsvenskan">Allsvenskan</option>
              <option value="development">Talang</option>
            </select>
          </div>
          {(position || tier) && (
            <button type="button" onClick={() => { setPosition(""); setTier(""); }}
              className="self-end flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3 h-3" /> Rensa
            </button>
          )}
        </motion.div>
      )}

      {/* AI reasoning */}
      {discover.data?.reasoning && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-accent/5 border border-accent/10 text-xs text-accent/80">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-accent" />
          <span>{discover.data.reasoning}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <span className="sr-only">Söker spelare...</span>
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
          <p className="text-xs text-muted-foreground">{players.length} spelare hittade</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {players.map((player, i) => (
              <motion.div key={player.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3), ease: [0.25, 0.46, 0.45, 0.94] }}>
                <PlayerCard player={player} />
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-muted-foreground">Inga spelare matchade din sökning.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Prova ett bredare sökord eller använd AI-sökning.</p>
        </div>
      )}

      {/* Empty state */}
      {!activeQuery && !discover.data && !loading && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="rounded-xl glass-premium">
          <div className="flex flex-col items-center justify-center py-16 md:py-20 text-center">
            <div className="w-16 h-16 rounded-2xl icon-premium flex items-center justify-center mb-5">
              <Users className="w-7 h-7 text-accent" />
            </div>
            <p className="text-base font-semibold text-foreground mb-2">Sök efter spelare</p>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
              Använd sökfältet ovan eller klicka AI för en intelligent sökning.
            </p>
          </div>
        </motion.div>
      )}

      {/* Error */}
      {discover.error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {discover.error.message}
        </div>
      )}
    </div>
  );
};

export default Players;
