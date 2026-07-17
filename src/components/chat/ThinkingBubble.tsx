import { BosseAvatar } from "./ChatAvatar";
import { ASSISTANT_BUBBLE, BUBBLE_MAX_WIDTH, MICRO_LABEL } from "./ChatBubbleStyles";

/**
 * Pre-stream thinking state: 3 staggered gold pulse-dots + phase label +
 * shimmer skeleton. Screen readers get a single status sentence — the
 * parent log region is the live region, so no nested aria-live here.
 */

const DOT_DELAYS_MS = [0, 150, 300] as const;

export function ThinkingBubble() {
  return (
    <div className="flex justify-start gap-3">
      <BosseAvatar size="sm" />
      <div className={`min-w-0 ${BUBBLE_MAX_WIDTH} ${ASSISTANT_BUBBLE}`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1" aria-hidden="true">
            {DOT_DELAYS_MS.map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          <span className={`${MICRO_LABEL} text-accent`} aria-hidden="true">
            Bosse tänker…
          </span>
          <span className="sr-only">Bosse tänker på ett svar.</span>
        </div>
        <div className="mt-2.5 space-y-2" aria-hidden="true">
          <div className="h-3 w-48 max-w-full rounded-sm skeleton-shimmer" />
          <div className="h-3 w-32 max-w-full rounded-sm skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}
