import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pausgård-autoscroll (ISP-pattern, ported to Scout).
 *
 * Auto-scrolls a chat container to the bottom ONLY while the user is anchored
 * near the bottom (~60px). If the user scrolls up, auto-scroll pauses and the
 * caller can show a "new messages" indicator via `hasNewBelow`.
 *
 * Programmatic scrolls set a 150ms lock so the scroll listener does not
 * mistake them for user scrolls — the lock is broken immediately on any
 * upward delta (user always wins). Streaming should scroll with
 * behavior "instant" to avoid smooth-scroll fighting per-frame updates.
 */

const BOTTOM_THRESHOLD_PX = 60;
const PROGRAMMATIC_LOCK_MS = 150;

export type ScrollAnchorBehavior = "smooth" | "instant" | "auto";

export interface UseScrollAnchorReturn {
  /** Attach to the scrollable messages container. */
  containerRef: React.RefObject<HTMLDivElement>;
  /** True while the user is anchored near the bottom. */
  isAnchored: boolean;
  /** True when new content arrived while the user was scrolled up. */
  hasNewBelow: boolean;
  /** Scroll to the bottom (re-anchors + clears the indicator). */
  scrollToBottom: (behavior?: ScrollAnchorBehavior) => void;
  /** Report new content: scrolls if anchored, otherwise flags `hasNewBelow`. */
  notifyNewContent: (opts?: { streaming?: boolean }) => void;
}

export function useScrollAnchor(): UseScrollAnchorReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const anchoredRef = useRef(true);
  const lockUntilRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const [isAnchored, setIsAnchored] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  const setAnchored = useCallback((next: boolean) => {
    if (anchoredRef.current !== next) {
      anchoredRef.current = next;
      setIsAnchored(next);
    }
    if (next) setHasNewBelow(false);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollAnchorBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el) return;
      lockUntilRef.current = Date.now() + PROGRAMMATIC_LOCK_MS;
      lastScrollTopRef.current = el.scrollTop;
      el.scrollTo({ top: el.scrollHeight, behavior: behavior as ScrollBehavior });
      setAnchored(true);
    },
    [setAnchored],
  );

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const delta = el.scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;

    const locked = Date.now() < lockUntilRef.current;
    if (locked) {
      if (delta >= 0) return; // programmatic downward scroll — ignore
      lockUntilRef.current = 0; // upward delta = the user broke the lock
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAnchored(distanceFromBottom <= BOTTOM_THRESHOLD_PX);
  }, [setAnchored]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const notifyNewContent = useCallback(
    (opts?: { streaming?: boolean }) => {
      if (anchoredRef.current) {
        scrollToBottom(opts?.streaming ? "instant" : "smooth");
      } else {
        setHasNewBelow(true);
      }
    },
    [scrollToBottom],
  );

  return { containerRef, isAnchored, hasNewBelow, scrollToBottom, notifyNewContent };
}
