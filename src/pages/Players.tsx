import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Users, Sparkles, Loader2, X } from "lucide-react";
import { useScoutSearch, useScoutDiscover } from "@/hooks/use-scout-search";
import { PlayerCard } from "@/components/PlayerCard";
import type { ScoutPlayer } from "@/types/scout";

const Players = () => {
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

  const players: ScoutPlayer[] = discover.data?.players ?? searchData?.players ?? [];
  const loading = searching || discover.isPending;
  const hasResults = players.length > 0;
  const noResults = !loading && (activeQuery || discover.data) && !hasResults;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-xl font-bold text-foreground">Spelare</h1>
        <p className="text-sm text-muted-foreground mt-1">Sök och analysera spelare</p>
      </motion.div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Sök spelare, position, klubb..." aria-label="Sök spelare"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all bg-card border border-border text-foreground placeholder:text-muted-foreground" />
        </div>
        <button type="submit" disabled={!query.trim() || loading}
          className="px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
          Sök
        </button>
        <button type="button" onClick={handleDiscover} disabled={!query.trim() || loading}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          title="AI-sökning: beskriv vad du letar efter">
          <Sparkles className="w-3.5 h-3.5" />
          AI
        </button>
        <button type="button" onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-card transition-colors">
          <Filter className="w-4 h-4" />
        </button>
      </form>

      {/* Filters */}
      {showFilters && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          className="flex flex-wrap gap-3 p-4 rounded-xl bg-card border border-border">
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
        <div className="flex items-start gap-2 p-3 rounded-xl bg-primary/5 border border-primary/10 text-xs text-primary/80">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{discover.data.reasoning}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="sr-only">Söker spelare...</span>
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
          <p className="text-xs text-muted-foreground">{players.length} spelare hittade</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {players.map((player) => (
              <PlayerCard key={player.id} player={player} />
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
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-2xl p-5 bg-card border border-border">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Sök efter spelare</p>
            <p className="text-xs text-muted-foreground max-w-xs">
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
