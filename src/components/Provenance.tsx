import type { CSSProperties } from "react";
import {
  PROVENANCE_LABELS,
  PROVENANCE_TITLES,
  type Provenance,
} from "@/types/match-report";

/**
 * Provenance badge — every claim in a match report carries its origin.
 * MÄTT = uppmätt (success) · FILM = filmobserverat (info) ·
 * TOLKAT = slutsats (violet) · KLIPP = verifieras på film (gold).
 */

const BADGE_STYLES: Record<Provenance, CSSProperties> = {
  MATT: {
    color: "hsl(var(--success))",
    background: "hsl(var(--success) / 0.10)",
    boxShadow: "inset 0 0 0 1px hsl(var(--success) / 0.38)",
  },
  FILM: {
    color: "hsl(var(--info))",
    background: "hsl(var(--info) / 0.10)",
    boxShadow: "inset 0 0 0 1px hsl(var(--info) / 0.38)",
  },
  TOLKAT: {
    color: "hsl(var(--violet))",
    background: "hsl(var(--violet) / 0.10)",
    boxShadow: "inset 0 0 0 1px hsl(var(--violet) / 0.40)",
  },
  KLIPP: {
    color: "hsl(var(--gold-text))",
    background: "hsl(var(--accent) / 0.10)",
    boxShadow: "inset 0 0 0 1px hsl(var(--accent) / 0.40)",
  },
};

interface ProvenanceBadgeProps {
  kind: Provenance;
  /** Override badge text, e.g. "MÄTT · 12 matcher". */
  label?: string | null;
  className?: string;
}

export function ProvenanceBadge({ kind, label, className = "" }: ProvenanceBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] align-middle text-[10px] font-extrabold uppercase tracking-[0.06em] ${className}`}
      style={BADGE_STYLES[kind]}
      title={PROVENANCE_TITLES[kind]}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
      {label ?? PROVENANCE_LABELS[kind]}
    </span>
  );
}

/** Legend row used in report headers. */
export function ProvenanceLegend({ className = "" }: { className?: string }) {
  const items: Array<{ kind: Provenance; desc: string }> = [
    { kind: "MATT", desc: "uppmätt" },
    { kind: "FILM", desc: "filmobserverat" },
    { kind: "TOLKAT", desc: "slutsats" },
    { kind: "KLIPP", desc: "verifieras på film" },
  ];
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground ${className}`}>
      <span className="font-medium">Härkomst:</span>
      {items.map((item) => (
        <span key={item.kind} className="inline-flex items-center gap-1.5">
          <ProvenanceBadge kind={item.kind} />
          {item.desc}
        </span>
      ))}
    </div>
  );
}
