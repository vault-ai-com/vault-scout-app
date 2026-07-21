import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, GitCompare, Loader2, Plus, Save } from "lucide-react";
import { useComparisonSlots } from "@/hooks/use-comparison-slots";
import { useComparisons, useCreateComparison } from "@/hooks/use-scout-comparison";
import { ComparisonSlots } from "@/components/comparison/ComparisonSlots";
import { ComparisonMatrix } from "@/components/comparison/ComparisonMatrix";
import { ComparisonRadar } from "@/components/comparison/ComparisonRadar";
import { ComparisonVerdictBar } from "@/components/comparison/ComparisonVerdictBar";
import { SectionShell } from "@/components/report";
import { EmptyState } from "@/components/EmptyState";
import { EASE_OUT_QUART } from "@/lib/motion";

// SectionShell requires a registerRef callback (shared contract with
// PlayerDetail's scroll-spy). This page has no scroll-spy (V55: over-
// engineering for a short page) — a stable no-op keeps the same primitive.
function noopRegisterRef(): void {
  // intentionally empty
}

function parsePlayerIds(idsParam: string): string[] {
  return idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

const Comparison = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const playerIds = useMemo(() => parsePlayerIds(searchParams.get("ids") ?? ""), [searchParams]);

  const [saveTitle, setSaveTitle] = useState("");
  const [saved, setSaved] = useState(false);

  const { entries, playerNames } = useComparisonSlots(playerIds);

  const {
    data: savedComparisons = [],
    isLoading: loadingComparisons,
    isError: savedComparisonsIsError,
    error: savedComparisonsError,
    refetch: refetchSavedComparisons,
  } = useComparisons();
  const createComparison = useCreateComparison();

  const handleRemove = useCallback(
    (playerId: string) => {
      const next = playerIds.filter((id) => id !== playerId);
      setSaved(false);
      if (next.length > 0) {
        setSearchParams({ ids: next.join(",") });
      } else {
        setSearchParams({});
      }
    },
    [playerIds, setSearchParams],
  );

  const handleSave = () => {
    const title = saveTitle.trim() || `Jämförelse ${new Date().toLocaleDateString("sv-SE")}`;
    createComparison.mutate(
      { title, player_ids: playerIds },
      { onSuccess: () => setSaved(true) },
    );
  };

  const scoredCount = entries.filter((e) => e.analysis?.overall_score != null).length;

  let sectionNo = 0;
  const nextNo = () => ++sectionNo;

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-12">
      {/* Breadcrumb */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
        aria-label="Brödsmulor"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link to="/" className="min-h-[44px] inline-flex items-center transition-colors hover:text-accent md:min-h-0">
          Dashboard
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link to="/players" className="min-h-[44px] inline-flex items-center transition-colors hover:text-accent md:min-h-0">
          Spelare
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="font-medium text-foreground">Jämförelse</span>
      </motion.nav>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05, ease: EASE_OUT_QUART }}
        className="mt-5 flex items-center gap-2.5"
      >
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg icon-premium">
          <GitCompare className="h-4 w-4 text-accent" aria-hidden="true" />
        </div>
        <div>
          <span className="eyebrow">Jämförelse</span>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Jämför spelare</h1>
        </div>
      </motion.div>

      <div className="mt-10 space-y-14">
        {playerIds.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
            className="card-editorial mx-auto max-w-xl p-8 text-center"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full icon-premium">
              <GitCompare className="h-5 w-5 text-accent" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-tight text-foreground">Inga spelare valda</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Jämför upp till 3 spelare sida vid sida — betyg, dimensioner och rekommendationer i en och samma vy.
            </p>
            <Link
              to="/players"
              data-testid="comparison-empty-cta"
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-accent px-4 text-[13px] font-bold text-accent-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Hitta spelare
            </Link>
          </motion.div>
        ) : (
          <>
            {/* Spelare */}
            <SectionShell
              id="players"
              index={nextNo()}
              title="Spelare"
              sub={
                playerIds.length < 3
                  ? "Välj upp till 3 spelare att jämföra sida vid sida."
                  : "3 av 3 platser fyllda — ta bort en spelare för att byta."
              }
              registerRef={noopRegisterRef}
            >
              <ComparisonSlots entries={entries} onRemove={handleRemove} />
              {playerIds.length === 1 && (
                <p className="mt-3 text-[12px] text-muted-foreground/70">
                  Lägg till minst en spelare till för att se jämförelse och helhetsbetyg.
                </p>
              )}
            </SectionShell>

            {/* Helhetsbetyg (VerdictBar) — bara vid ≥2 spelare med score */}
            {scoredCount >= 2 && (
              <SectionShell
                id="verdict"
                index={nextNo()}
                title="Helhetsbetyg"
                sub="Rådata bakom rekommendationen — högst betyg markeras, men avgör inte ensamt vem som passar bäst."
                registerRef={noopRegisterRef}
              >
                <ComparisonVerdictBar entries={entries} />
              </SectionShell>
            )}

            {/* Dimensioner */}
            <SectionShell
              id="dims"
              index={nextNo()}
              title="Dimensioner"
              sub={
                playerIds.length >= 2
                  ? "16 dimensioner i 5 viktade grupper. Bäst i varje dimension markeras grönt — saknad data betygsätts aldrig."
                  : "16 dimensioner i 5 viktade grupper — saknad data betygsätts aldrig."
              }
              registerRef={noopRegisterRef}
            >
              <div className="space-y-4">
                <ComparisonRadar entries={entries} playerNames={playerNames} />
                <ComparisonMatrix entries={entries} playerNames={playerNames} />
              </div>
            </SectionShell>

            {/* Spara — bara vid ≥2 spelare */}
            {playerIds.length >= 2 && (
              <SectionShell
                id="save"
                index={nextNo()}
                title="Spara jämförelse"
                sub="Spara den här uppställningen för att snabbt öppna den igen senare."
                registerRef={noopRegisterRef}
              >
                <div className="card-editorial card-accent-left p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      placeholder="Titel (valfritt)"
                      value={saveTitle}
                      onChange={(e) => {
                        setSaveTitle(e.target.value);
                        setSaved(false);
                      }}
                      data-testid="comparison-save-title"
                      className="min-h-[44px] flex-1 rounded-lg border border-border/40 bg-card/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={createComparison.isPending || saved}
                      data-testid="comparison-save-button"
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-50"
                    >
                      {createComparison.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {saved ? "Sparad" : "Spara"}
                    </button>
                  </div>
                  {createComparison.error && (
                    <p className="mt-2 text-[12px] text-destructive">{createComparison.error.message}</p>
                  )}
                </div>
              </SectionShell>
            )}
          </>
        )}

        {/* Sparade jämförelser — alltid tillgänglig, oavsett aktuellt urval */}
        <SectionShell
          id="saved"
          index={nextNo()}
          title="Sparade jämförelser"
          sub="Öppna en tidigare sparad uppställning igen."
          registerRef={noopRegisterRef}
        >
          {loadingComparisons ? (
            <div className="card-editorial space-y-2.5 p-6" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 rounded-sm skeleton-shimmer" />
              ))}
            </div>
          ) : savedComparisonsIsError ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 rounded-sm border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                Kunde inte ladda sparade jämförelser
                {savedComparisonsError instanceof Error ? `: ${savedComparisonsError.message}` : "."}
              </div>
              <button
                type="button"
                onClick={() => void refetchSavedComparisons()}
                data-testid="comparison-saved-retry"
                className="inline-flex min-h-[28px] items-center gap-1 text-xs font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Försök igen
              </button>
            </div>
          ) : savedComparisons.length === 0 ? (
            <EmptyState>Inga sparade jämförelser ännu.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {savedComparisons.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-card/50 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
                    <p className="text-xs text-muted-foreground/60">
                      {c.player_ids.length} spelare ·{" "}
                      {c.created_at ? new Date(c.created_at).toLocaleDateString("sv-SE") : "—"}
                    </p>
                  </div>
                  <Link
                    to={`/comparison?ids=${c.player_ids.join(",")}`}
                    data-testid={`comparison-open-${c.id}`}
                    className="inline-flex min-h-[44px] flex-none items-center text-xs font-semibold text-accent hover:underline"
                  >
                    Öppna
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionShell>
      </div>
    </div>
  );
};

export default Comparison;
