import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Film, Play, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { ProvenanceBadge } from "@/components/Provenance";
import { formatTimecode, type ClipRef } from "@/types/match-report";

/**
 * Clip drawer — timecode + video placeholder (B1 wires real playback).
 * Shared by MatchReport and PlayerDetail.
 */
export function ClipDrawer({ clip, onClose }: { clip: ClipRef | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, !!clip);

  useEffect(() => {
    if (!clip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevOverflow;
    };
  }, [clip, onClose]);

  const tc = clip ? formatTimecode(clip) : null;

  return (
    <AnimatePresence>
      {clip && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Klipp: ${clip.label}`}
            className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[94vw] flex-col border-l border-border bg-card shadow-elevated"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
              <Film className="h-4 w-4 text-accent" aria-hidden="true" />
              <span className="text-sm font-bold text-foreground">Klipp</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Stäng klippanel"
                className="ml-auto grid h-11 w-11 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:h-8 md:w-8"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              <div className="relative grid aspect-video place-items-center overflow-hidden rounded-sm border border-border surface-hero">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-accent/40 bg-accent/15">
                  <Play className="ml-0.5 h-5 w-5" style={{ color: "hsl(var(--gold-text))" }} aria-hidden="true" />
                </div>
                {tc && (
                  <span className="absolute bottom-2.5 left-3 rounded-sm bg-background/80 px-2 py-0.5 font-mono text-[11px]" style={{ color: "hsl(var(--gold-text))" }}>
                    {tc}
                  </span>
                )}
                <span className="absolute right-3 top-2.5 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em]" style={{ color: "hsl(var(--gold-text))" }}>
                  Videobevis · B1 kommer
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              <div className="text-sm font-bold text-foreground">{clip.label}</div>
              {clip.anchor && <div className="mt-1 text-xs text-muted-foreground">Hör till: {clip.anchor}</div>}
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                {clip.task ?? "Koda momentet på film — fynden skrivs tillbaka till rätt kort i underlaget (KLIPP → FILM)."}
              </p>
              <div className="mt-4 flex items-center gap-2.5">
                <ProvenanceBadge kind="KLIPP" />
                <span className="text-xs text-muted-foreground">markera fynd → skrivs tillbaka till underlaget</span>
              </div>
              <div className="mt-5 rounded-sm border border-dashed border-border bg-secondary/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Videouppspelning kopplas in när klippbanken (B1) är live. Timecoden pekar på rätt moment i källmatchen.
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
