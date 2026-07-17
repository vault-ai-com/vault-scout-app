import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronRight } from "lucide-react";
import {
  SecNavDesktop,
  SecNavMobile,
  useScrollSpy,
  type SecNavItem,
} from "@/components/report";
import { PageSkeleton } from "@/components/Skeleton";

// ---------------------------------------------------------------------------
// DossierScaffold — one shared editorial dossier shell (breadcrumb → hero →
// sticky scroll-spy secnav → sections). PlayerDetail is the proven template;
// this extracts the SHELL so CoachDetail (and future dossiers) inherit the
// structure — hero + section CONTENT stay entity-specific via a ReactNode
// hero slot and a render-prop that hands the page the scroll-spy wiring.
//
// Wires directly onto the already-shared report/ primitives (SecNav,
// useScrollSpy) + Skeleton — ZERO changes to components/report/*.
// ---------------------------------------------------------------------------

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const GRID = "lg:grid-cols-[210px_minmax(0,1fr)]";

export interface DossierScrollSpy {
  activeSection: string | null;
  registerRef: (id: string, el: HTMLElement | null) => void;
  scrollToSection: (id: string) => void;
}

export interface DossierScaffoldProps {
  loading: boolean;
  loadingAriaLabel: string;
  notFound: boolean;
  notFoundTitle: string;
  notFoundBody: string;
  backHref: string;
  backLabel: string;
  breadcrumb: { label: string; href?: string }[];
  hero: ReactNode;
  sections: SecNavItem[];
  sectionGroups: readonly string[];
  /** Unique per page — framer layoutId for the active secnav indicator. */
  layoutId: string;
  children: (spy: DossierScrollSpy) => ReactNode;
}

export function DossierScaffold({
  loading,
  loadingAriaLabel,
  notFound,
  notFoundTitle,
  notFoundBody,
  backHref,
  backLabel,
  breadcrumb,
  hero,
  sections,
  sectionGroups,
  layoutId,
  children,
}: DossierScaffoldProps) {
  // Unconditional (rules-of-hooks) — sections list is stable per page.
  const spy = useScrollSpy(sections.map((s) => s.id));

  if (loading) {
    return <PageSkeleton ariaLabel={loadingAriaLabel} gridClassName={GRID} />;
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center md:py-24">
        <Link to={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        <div className="card-editorial mt-8 p-8">
          <h1 className="text-xl font-bold tracking-tight text-foreground">{notFoundTitle}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{notFoundBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-12">
      {/* Breadcrumb */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        aria-label="Brödsmulor"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        {breadcrumb.map((b, i) => (
          <span key={`${b.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3 h-3" aria-hidden="true" />}
            {b.href ? (
              <Link to={b.href} className="hover:text-accent transition-colors">{b.label}</Link>
            ) : (
              <span className="text-foreground font-medium truncate max-w-[220px]">{b.label}</span>
            )}
          </span>
        ))}
      </motion.nav>

      {/* Back */}
      <div className="mt-4">
        <Link to={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>
      </div>

      {/* Mobile secnav */}
      <SecNavMobile items={sections} activeId={spy.activeSection} onSelect={spy.scrollToSection} />

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="mt-6"
      >
        {hero}
      </motion.div>

      {/* Content grid: sticky secnav + sections */}
      <div className={`mt-10 grid gap-8 ${GRID}`}>
        <SecNavDesktop
          items={sections}
          groups={sectionGroups}
          activeId={spy.activeSection}
          onSelect={spy.scrollToSection}
          layoutId={layoutId}
        />
        <div className="space-y-10">{children(spy)}</div>
      </div>
    </div>
  );
}
