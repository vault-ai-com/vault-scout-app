import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { EASE_OUT_QUART } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Shared EmptyState primitive — two editorial variants, one source of truth.
//   variant="message"    — inline dashed-border note box (children slot)
//   variant="onboarding" — centered card-editorial + numbered steps
// Extracted verbatim from PlayerDetail (message) + Opponents (onboarding).
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  variant?: "message" | "onboarding";
  className?: string;
  /** message variant */
  children?: ReactNode;
  /** onboarding variant */
  eyebrow?: string;
  title?: string;
  steps?: string[];
}

export function EmptyState({
  variant = "message",
  className,
  children,
  eyebrow,
  title,
  steps = [],
}: EmptyStateProps) {
  if (variant === "onboarding") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
        className={`card-editorial mx-auto max-w-xl p-8 text-center${className ? ` ${className}` : ""}`}
      >
        {eyebrow ? <span className="eyebrow justify-center">{eyebrow}</span> : null}
        {title ? (
          <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">{title}</h2>
        ) : null}
        <ol className="mx-auto mt-6 max-w-md space-y-4 text-left">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3.5">
              <span
                className="grid h-7 w-7 flex-none place-items-center rounded-full border border-accent/40 bg-accent/10 font-mono text-xs font-bold"
                style={{ color: "hsl(var(--gold-text))" }}
              >
                {i + 1}
              </span>
              <span className="pt-1 text-sm text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </motion.div>
    );
  }

  return (
    <div
      className={`rounded-sm border border-dashed border-border bg-secondary/40 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
