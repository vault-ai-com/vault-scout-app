import { Play } from "lucide-react";
import type { ClipRef } from "@/types/match-report";

/** Inline clip reference chip — opens the shared ClipDrawer. */
export function ClipChip({ clip, onOpen }: { clip: ClipRef; onOpen: (c: ClipRef) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(clip)}
      aria-haspopup="dialog"
      aria-label={`Öppna klipp: ${clip.label}`}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border border-border bg-background/50 px-2.5 font-mono text-[11px] font-medium text-muted-foreground transition-all duration-150 hover:-translate-y-px hover:border-accent/60 hover:text-foreground md:min-h-0 md:py-1.5"
    >
      <Play className="h-3 w-3 text-accent" aria-hidden="true" />
      {clip.label}
    </button>
  );
}
