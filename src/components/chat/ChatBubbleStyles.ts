/**
 * Shared editorial chat-bubble styles — single source of truth for
 * ChatBubble / StreamingBubble / ThinkingBubble so all three surfaces
 * stay pixel-identical.
 */

/** Responsive max-width for every bubble. */
export const BUBBLE_MAX_WIDTH = "max-w-[85%] md:max-w-[75%]";

/**
 * Assistant bubble — flat navy-2 card with thin gold hairline top
 * (card-editorial) + asymmetric bottom-left speech-tail corner.
 */
export const ASSISTANT_BUBBLE = "card-editorial rounded-bl-sm px-4 py-3";

/**
 * User bubble — secondary navy surface, asymmetric bottom-right
 * speech-tail corner. No hairline (only Bosse gets the gold accent).
 */
export const USER_BUBBLE =
  "rounded-2xl rounded-br-sm border border-border/60 bg-secondary px-4 py-3";

/** Micro label (uppercase, tracked) used for phase labels inside bubbles. */
export const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.18em]";
