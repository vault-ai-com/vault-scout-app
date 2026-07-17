/**
 * Bosse avatar — gold-dot / score-circle feel from the editorial design
 * system: mono initial in gold on a subtle gold-tinted circle.
 */

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-16 w-16 text-xl",
} as const;

export type BosseAvatarSize = keyof typeof SIZE_CLASSES;

interface BosseAvatarProps {
  size?: BosseAvatarSize;
  /** Adds the restrained gold glow (hero / header use only). */
  glow?: boolean;
}

export function BosseAvatar({ size = "sm", glow = false }: BosseAvatarProps) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 font-mono font-bold text-accent ${SIZE_CLASSES[size]} ${glow ? "shadow-glow-gold" : ""}`}
    >
      B
    </div>
  );
}
