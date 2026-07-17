import { useCoachSearch, useCoachDiscover } from "@/hooks/use-coach-search";
import { CoachCard } from "@/components/CoachCard";
import { SearchScaffold, type SearchScaffoldConfig } from "@/components/scaffolds/SearchScaffold";
import type { ScoutCoach } from "@/types/scout";

// Coaches search surface — thin config consumer of the shared SearchScaffold.
// Data source unchanged (edge fn via use-coach-search); only the duplicated
// UI + query/filter boilerplate moved into the scaffold.

type CoachFilters = { tier: string };

const TIER_OPTIONS = [
  { value: "", label: "Alla" },
  { value: "world_class", label: "Världsklass" },
  { value: "elite", label: "Elit" },
  { value: "top_league", label: "Topliga" },
  { value: "allsvenskan", label: "Allsvenskan" },
  { value: "development", label: "Talang" },
];

const coachesConfig: SearchScaffoldConfig<ScoutCoach, CoachFilters> = {
  eyebrow: "Tränare",
  title: "Sök och analysera",
  subtitle: "Hitta tränare med AI-driven sökning",
  searchPlaceholder: "Sök tränare, klubb, liga...",
  searchAriaLabel: "Sök tränare",
  filters: [{ key: "tier", label: "Nivå", options: TIER_OPTIONS }],
  emptyFilters: { tier: "" },
  useResults: ({ activeQuery, filters }) => {
    const { data, isLoading } = useCoachSearch({
      query: activeQuery || undefined,
      tier: filters.tier || undefined,
    });
    const discover = useCoachDiscover();
    return {
      items: discover.data?.coaches ?? data?.coaches ?? [],
      loading: isLoading || discover.isPending,
      error: discover.error?.message ?? null,
      reasoning: null,
      discover: (criteria, f) => discover.mutate({ criteria, tier: f.tier || undefined }),
      resetDiscover: () => discover.reset(),
    };
  },
  getItemKey: (c) => c.id,
  renderCard: (c) => <CoachCard coach={c} />,
  resultCountLabel: (n) => `${n} tränare hittade`,
  noResultsPrimary: "Inga tränare matchade din sökning.",
  noResultsSecondary: "Prova ett bredare sökord eller använd AI-sökning.",
};

const Coaches = () => <SearchScaffold config={coachesConfig} />;

export default Coaches;
