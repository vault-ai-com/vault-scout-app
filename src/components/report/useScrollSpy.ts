import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Sticky scroll-spy for editorial report pages (MatchReport, PlayerDetail).
 * Sections register themselves via `registerRef`; an IntersectionObserver
 * tracks which section is in the reading zone and `scrollToSection`
 * performs (reduced-motion-aware) smooth navigation.
 *
 * Pass a memoized list of section ids — the observer re-binds when it changes.
 */
export function useScrollSpy(sectionIds: readonly string[]) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map());

  const registerRef = useCallback((sectionId: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(sectionId, el);
    else sectionEls.current.delete(sectionId);
  }, []);

  // Stable dependency — re-observe only when the set of sections changes.
  const idsKey = sectionIds.join("|");

  useEffect(() => {
    if (!idsKey) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const sid = (entry.target as HTMLElement).dataset.section;
            if (sid) setActiveSection(sid);
          }
        }
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    sectionEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [idsKey]);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = sectionEls.current.get(sectionId);
    if (!el) return;
    setActiveSection(sectionId);
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);

  return { activeSection, registerRef, scrollToSection };
}
