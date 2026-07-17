import { motion } from "framer-motion";
import { SPRING_SNAPPY } from "@/lib/motion";

/**
 * Sticky scroll-spy section navigation — desktop grouped rail (layoutId
 * gold indicator) + mobile horizontal strip. Shared by MatchReport and
 * PlayerDetail. Pair with useScrollSpy().
 */
export interface SecNavItem {
  id: string;
  label: string;
  group: string;
}

interface SecNavDesktopProps {
  items: SecNavItem[];
  groups: readonly string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Unique per page — framer layoutId for the active indicator. */
  layoutId?: string;
}

export function SecNavDesktop({ items, groups, activeId, onSelect, layoutId = "secnav-indicator" }: SecNavDesktopProps) {
  return (
    <nav aria-label="Sektioner" className="sticky top-8 hidden max-h-[calc(100vh-64px)] self-start overflow-y-auto lg:block">
      {groups.map((group) => {
        const groupItems = items.filter((s) => s.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <div className="px-3 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60 first:pt-0">
              {group}
            </div>
            {groupItems.map((s) => {
              const active = activeId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={active ? "true" : undefined}
                  className={`relative block w-full rounded-sm px-3 py-2 text-left text-[12.5px] transition-colors duration-150 ${
                    active ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={layoutId}
                      className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-accent"
                      style={{ boxShadow: "0 0 10px hsl(var(--accent) / 0.55)" }}
                      transition={SPRING_SNAPPY}
                    />
                  )}
                  <span className={active ? "pl-2.5" : ""}>{s.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

interface SecNavMobileProps {
  items: SecNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function SecNavMobile({ items, activeId, onSelect }: SecNavMobileProps) {
  return (
    <nav
      aria-label="Sektioner"
      className="scrollbar-hide sticky top-14 z-20 -mx-5 mt-6 flex gap-1.5 overflow-x-auto border-b border-border/60 bg-background/90 px-5 py-2.5 backdrop-blur-xl md:top-0 lg:hidden"
    >
      {items.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          aria-current={activeId === s.id ? "true" : undefined}
          className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            activeId === s.id
              ? "border-accent/50 bg-accent/10"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
          style={activeId === s.id ? { color: "hsl(var(--gold-text))" } : undefined}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
