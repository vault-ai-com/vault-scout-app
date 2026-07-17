/**
 * Shared motion constants for Framer Motion.
 * Single source of truth — import from here, never hardcode.
 * Ported from ISP (sport-sponsorship-spark) — premium interaction system.
 */

// ---------------------------------------------------------------------------
// Easing curves
// ---------------------------------------------------------------------------

/** Fast deceleration — primary UI easing (expo out) */
export const EASE_OUT_EXPO = [0.23, 1, 0.32, 1] as const;

/** Smooth deceleration — secondary UI easing (quart out) */
export const EASE_OUT_QUART = [0.25, 0.46, 0.45, 0.94] as const;

// ---------------------------------------------------------------------------
// Spring presets (type: "spring")
// ---------------------------------------------------------------------------

/** Snappy spring — buttons, toggles, cards (most common) */
export const SPRING_SNAPPY = { type: "spring" as const, stiffness: 400, damping: 25 };

/** Gentle spring — counters, progress bars, slow reveals */
export const SPRING_GENTLE = { type: "spring" as const, stiffness: 200, damping: 20 };

/** Bouncy spring — FABs, nav indicators, celebrations */
export const SPRING_BOUNCY = { type: "spring" as const, stiffness: 500, damping: 35 };

// ---------------------------------------------------------------------------
// Duration scale (seconds)
// ---------------------------------------------------------------------------

export const DURATION_FAST = 0.15;
export const DURATION_NORMAL = 0.25;
export const DURATION_SLOW = 0.4;
export const DURATION_SLOWER = 0.6;

// ---------------------------------------------------------------------------
// prefers-reduced-motion (SSR-safe)
// ---------------------------------------------------------------------------

/**
 * Returns true if the user has requested reduced motion.
 * SSR-safe: returns false when window is undefined.
 *
 * Note: Framer Motion animations are already handled globally via
 * <MotionConfig reducedMotion="user"> in App.tsx. Use this utility
 * for non-Framer contexts (CSS transitions, custom JS animations).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// Reduced-motion presets (instant transition — single frame)
// ---------------------------------------------------------------------------

export const SPRING_SNAPPY_REDUCED = { type: "tween" as const, duration: 0.001 };
export const SPRING_GENTLE_REDUCED = { type: "tween" as const, duration: 0.001 };
export const SPRING_BOUNCY_REDUCED = { type: "tween" as const, duration: 0.001 };

export const DURATION_FAST_REDUCED = 0;
export const DURATION_NORMAL_REDUCED = 0;
export const DURATION_SLOW_REDUCED = 0;
export const DURATION_SLOWER_REDUCED = 0;

// ---------------------------------------------------------------------------
// Convenience getters — return correct preset based on current preference
// ---------------------------------------------------------------------------

export function getSpringSnappy() {
  return prefersReducedMotion() ? SPRING_SNAPPY_REDUCED : SPRING_SNAPPY;
}
export function getSpringGentle() {
  return prefersReducedMotion() ? SPRING_GENTLE_REDUCED : SPRING_GENTLE;
}
export function getSpringBouncy() {
  return prefersReducedMotion() ? SPRING_BOUNCY_REDUCED : SPRING_BOUNCY;
}
export function getDuration(base: number): number {
  return prefersReducedMotion() ? 0 : base;
}
