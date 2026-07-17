import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Search, LayoutDashboard, Users, GraduationCap, MessageCircle,
  Star, CornerDownLeft, User, type LucideIcon,
} from "lucide-react";
import { useScoutSearch } from "@/hooks/use-scout-search";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { SPRING_SNAPPY, EASE_OUT_QUART } from "@/lib/motion";

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: LucideIcon;
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, open);

  // Reset on open
  useEffect(() => {
    if (open) { setQuery(""); setDebounced(""); setSelected(0); }
  }, [open]);

  // Debounce query (180ms)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const search = useScoutSearch(
    { query: debounced, limit: 6 },
    open && debounced.length >= 2,
  );

  const go = (path: string) => { onClose(); navigate(path); };

  const items = useMemo<CommandItem[]>(() => {
    const q = debounced.toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);

    const nav: CommandItem[] = [
      { id: "nav-dash", label: "Dashboard", icon: LayoutDashboard, group: "Navigation", run: () => go("/") },
      { id: "nav-players", label: "Spelare", icon: Users, group: "Navigation", run: () => go("/players") },
      { id: "nav-coaches", label: "Tränare", icon: GraduationCap, group: "Navigation", run: () => go("/coaches") },
      { id: "nav-chat", label: "Bosse AI", icon: MessageCircle, group: "Navigation", run: () => go("/chat") },
    ].filter((i) => match(i.label));

    const actions: CommandItem[] = [
      { id: "act-search", label: "Sök spelare", sublabel: "Hitta och analysera", icon: Search, group: "Åtgärder", run: () => go("/players") },
      { id: "act-watch", label: "Bevakningslista", sublabel: "Dina bevakade spelare", icon: Star, group: "Åtgärder", run: () => go("/players?watchlist=true") },
      { id: "act-bosse", label: "Prata med Bosse", sublabel: "Fråga AI-scouten", icon: MessageCircle, group: "Åtgärder", run: () => go("/chat") },
    ].filter((i) => match(i.label) || match(i.sublabel ?? ""));

    const players: CommandItem[] = (search.data?.players ?? []).map((p) => ({
      id: `player-${p.id}`,
      label: p.name,
      sublabel: [p.position_primary, p.current_club].filter(Boolean).join(" · "),
      icon: User,
      group: "Spelare",
      run: () => go(`/players/${p.id}`),
    }));

    // When actively searching, players lead; otherwise nav + actions.
    return debounced.length >= 2 ? [...players, ...nav, ...actions] : [...nav, ...actions];
  }, [debounced, search.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp selection when the list changes
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); items[selected]?.run(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, items, selected, onClose]);

  // Keep selected item in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Grouped rendering while keeping a flat index for keyboard nav
  let flatIndex = -1;
  const groups = ["Spelare", "Navigation", "Åtgärder"].filter((g) => items.some((i) => i.group === g));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-background/70"
            style={{ backdropFilter: "blur(4px)" }}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog" aria-modal="true" aria-label="Kommandopalett"
            initial={{ opacity: 0, scale: 0.97, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={SPRING_SNAPPY}
            className="fixed left-1/2 top-[14%] z-[101] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sök spelare, sidor, åtgärder…"
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                data-testid="command-palette-input"
              />
              <kbd className="hidden shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60 sm:inline">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[340px] overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {search.isFetching ? "Söker…" : "Inga träffar."}
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group} className="mb-1">
                    <div className="eyebrow px-3 py-2 !text-[10px]">{group}</div>
                    {items.filter((i) => i.group === group).map((item) => {
                      flatIndex += 1;
                      const idx = flatIndex;
                      const active = idx === selected;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-index={idx}
                          onClick={item.run}
                          onMouseMove={() => setSelected(idx)}
                          className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors ${
                            active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"
                          }`}
                        >
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-sm ${active ? "bg-accent/15 text-accent" : "bg-secondary/60"}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{item.label}</span>
                            {item.sublabel && <span className="block truncate text-xs text-muted-foreground">{item.sublabel}</span>}
                          </span>
                          {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
