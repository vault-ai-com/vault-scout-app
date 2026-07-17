import type { CSSProperties, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared loading-skeleton primitives — one source of truth.
// Extracted verbatim from PlayerDetailSkeleton + ReportSkeleton (identical
// secnav+cards block). gridClassName is passed as a literal Tailwind class
// string so the JIT scanner still generates the arbitrary grid-cols value.
// ---------------------------------------------------------------------------

export function SkeletonLine({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={`rounded-sm skeleton-shimmer${className ? ` ${className}` : ""}`} style={style} />;
}

/** Hero-card skeleton (identity lines + 3 pill chips + circular avatar). */
export function SkeletonHero() {
  return (
    <div className="mt-6 rounded-sm border border-border p-6 md:p-8">
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 space-y-4">
          <div className="h-3 w-28 rounded-sm skeleton-shimmer" />
          <div className="h-10 w-2/3 max-w-md rounded-sm skeleton-shimmer" />
          <div className="h-4 w-1/2 max-w-sm rounded-sm skeleton-shimmer" />
          <div className="flex gap-2 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 w-28 rounded-full skeleton-shimmer" />
            ))}
          </div>
        </div>
        <div className="hidden h-[120px] w-[120px] flex-none rounded-full skeleton-shimmer md:block" />
      </div>
    </div>
  );
}

/** Sticky section-nav column skeleton (9 staggered-width lines). */
export function SkeletonSecNav() {
  return (
    <div className="hidden space-y-2.5 lg:block">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="h-3.5 rounded-sm skeleton-shimmer" style={{ width: `${60 + (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

/** One editorial content-card skeleton (staggered reveal by index). */
export function SkeletonCard({ index = 0 }: { index?: number }) {
  return (
    <div className="card-editorial p-6 skeleton-reveal" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="h-3 w-28 rounded-sm skeleton-shimmer" />
      <div className="mt-3 h-6 w-56 rounded-sm skeleton-shimmer" />
      <div className="mt-5 space-y-2.5">
        <div className="h-3.5 w-full rounded-sm skeleton-shimmer" />
        <div className="h-3.5 w-11/12 rounded-sm skeleton-shimmer" />
        <div className="h-3.5 w-4/5 rounded-sm skeleton-shimmer" />
      </div>
    </div>
  );
}

/**
 * Full editorial page skeleton: hero/header slot + secnav column + N cards.
 * @param gridClassName literal Tailwind class, e.g. "lg:grid-cols-[210px_1fr]"
 */
export function PageSkeleton({
  ariaLabel,
  gridClassName,
  header,
  cardCount = 3,
}: {
  ariaLabel: string;
  gridClassName: string;
  header?: ReactNode;
  cardCount?: number;
}) {
  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-12" aria-busy="true" aria-label={ariaLabel}>
      {header}
      <div className={`mt-10 grid gap-8 ${gridClassName}`}>
        <SkeletonSecNav />
        <div className="space-y-6">
          {Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonCard key={i} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
