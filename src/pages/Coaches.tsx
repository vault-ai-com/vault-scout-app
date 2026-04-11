import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, Filter, Sparkles, Loader2, X } from "lucide-react";
import { useCoachSearch, useCoachDiscover } from "@/hooks/use-coach-search";
import { CoachCard } from "@/components/CoachCard";
import type { ScoutCoach } from "@/types/scout";

const Coaches = () => {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [tier, setTier] = useState("");

  const { data: searchData, isLoading: searching } = useCoachSearch(
    { query: activeQuery || undefined, tier: tier || undefined },
  );

  const discover = useCoachDiscover();

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(query.trim());
    discover.reset();
  }, [query, discover]);

  const handleDiscover = useCallback(() => {
    if (!query.trim()) return;
    discover.mutate({ criteria: query.trim(), tier: tier || undefined });
    setActiveQuery("");
  }, [query, tier, discover]);

  const coaches: ScoutCoach[] = discover.data?.coaches ?? searchData?.coaches ?? [];
  const loading = searching || discover.isPending;
  const hasResults = coaches.length > 0;
  const noResults = !loading && !hasResults;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <span className="section-tag">Tränare</span>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mt-1 tracking-tight">Sök och analysera</h1>
        <p className="text-sm text-muted-foreground mt-1">Hitta tränare med AI-driven sökning</p>
      </motion.div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Sök tränare, klubb, liga..." aria-label="Sök tränare"
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
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className="flex flex-wrap gap-3 p-4 rounded-xl glass-premium">
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
          {tier && (
            <button type="button" onClick={() => setTier("")}
              className="self-end flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3 h-3" /> Rensa
            </button>
          )}
        </motion.div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <span className="sr-only">Söker tränare...</span>
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
          <p className="text-xs text-muted-foreground">{coaches.length} tränare hittade</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {coaches.map((coach, i) => (
              <motion.div key={coach.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3), ease: [0.25, 0.46, 0.45, 0.94] }}>
                <CoachCard coach={coach} />
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-muted-foreground">Inga tränare matchade din sökning.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Prova ett bredare sökord eller använd AI-sökning.</p>
        </div>
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

export default Coaches;
