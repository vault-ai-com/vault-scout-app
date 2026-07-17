import { useCallback, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, Sparkles, X } from "lucide-react";
import { SkeletonCard } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";

// ---------------------------------------------------------------------------
// SearchScaffold — one shared, config-driven search/list surface.
// Players and Coaches were ~90% duplicated search/filter/AI-discover pages
// (Players.tsx:124-240 ≈ Coaches.tsx:37-134). This is the single source.
//
// Data stays owned by each page via a render-hook (config.useResults), so
// rules-of-hooks hold and each page keeps its own data source (RPC or edge fn).
// The scaffold owns the UI + query/filter state + shared primitives
// (SkeletonCard loading, EmptyState no-results, card-editorial/eyebrow).
// ---------------------------------------------------------------------------

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export interface SearchFilterOption {
  value: string;
  label: string;
}

export interface SearchFilterConfig<TFilters extends Record<string, string>> {
  key: keyof TFilters & string;
  label: string;
  options: SearchFilterOption[]; // first option is typically { value: "", label: "Alla" }
}

export interface SearchResultsState<TItem> {
  items: TItem[];
  loading: boolean;
  error?: string | null;
  reasoning?: string | null;
  /** Trigger AI discover with the current query text + active filters. */
  discover: (criteria: string, filters: Record<string, string>) => void;
  /** Reset any prior discover result (called on a fresh structured search). */
  resetDiscover: () => void;
}

export interface SearchScaffoldConfig<TItem, TFilters extends Record<string, string>> {
  eyebrow: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  filters: SearchFilterConfig<TFilters>[];
  emptyFilters: TFilters;
  /** Render-hook: called unconditionally each render (rules-of-hooks safe). */
  useResults: (args: { activeQuery: string; filters: TFilters }) => SearchResultsState<TItem>;
  getItemKey: (item: TItem) => string;
  renderCard: (item: TItem) => ReactNode;
  resultCountLabel: (n: number) => string;
  noResultsPrimary: string;
  noResultsSecondary: string;
}

export function SearchScaffold<TItem, TFilters extends Record<string, string>>({
  config,
}: {
  config: SearchScaffoldConfig<TItem, TFilters>;
}) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<TFilters>(config.emptyFilters);

  const { items, loading, error, reasoning, discover, resetDiscover } = config.useResults({
    activeQuery,
    filters,
  });

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setActiveQuery(query.trim());
      resetDiscover();
    },
    [query, resetDiscover],
  );

  const handleDiscover = useCallback(() => {
    if (!query.trim()) return;
    discover(query.trim(), filters);
    setActiveQuery("");
  }, [query, filters, discover]);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const anyFilterActive = config.filters.some((f) => filters[f.key]);
  const hasResults = items.length > 0;
  const noResults = !loading && !hasResults;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
        <span className="eyebrow">{config.eyebrow}</span>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mt-1 tracking-tight">{config.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{config.subtitle}</p>
      </motion.div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={config.searchPlaceholder}
            aria-label={config.searchAriaLabel}
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none bg-card/60 border border-border/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent/30 transition-all text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="px-5 py-3 rounded-xl text-sm font-semibold bg-accent text-accent-foreground btn-premium disabled:opacity-50 shadow-lg shadow-accent/20"
        >
          Sök
        </button>
        <button
          type="button"
          onClick={handleDiscover}
          disabled={!query.trim() || loading}
          className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 btn-premium disabled:opacity-50"
          title="AI-sökning: beskriv vad du letar efter"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI
        </button>
        {config.filters.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Visa filter"
            aria-expanded={showFilters}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-card/50 transition-all"
          >
            <Filter className="w-4 h-4" />
          </button>
        )}
      </form>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && config.filters.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-3 p-4 rounded-xl card-editorial"
          >
            {config.filters.map((f) => (
              <div key={f.key}>
                <label htmlFor={`filter-${f.key}`} className="block text-[10px] font-medium text-muted-foreground mb-1">
                  {f.label}
                </label>
                <select
                  id={`filter-${f.key}`}
                  value={filters[f.key]}
                  onChange={(e) => setFilter(f.key, e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-input border border-border text-foreground"
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {anyFilterActive && (
              <button
                type="button"
                onClick={() => setFilters(config.emptyFilters)}
                className="self-end flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" /> Rensa
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI reasoning */}
      {reasoning && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-accent/5 border border-accent/10 text-xs text-accent/80">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-accent" aria-hidden="true" />
          <span>{reasoning}</span>
        </div>
      )}

      {/* Loading — shared SkeletonCard grid */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2" role="status" aria-live="polite" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} index={i} />
          ))}
          <span className="sr-only">Söker…</span>
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
          <p className="text-xs text-muted-foreground">{config.resultCountLabel(items.length)}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map((item, i) => (
              <motion.div
                key={config.getItemKey(item)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3), ease: EASE }}
              >
                {config.renderCard(item)}
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* No results — shared EmptyState */}
      {noResults && (
        <EmptyState>
          <span className="block font-medium text-foreground">{config.noResultsPrimary}</span>
          <span className="block text-muted-foreground/70 mt-1">{config.noResultsSecondary}</span>
        </EmptyState>
      )}

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
