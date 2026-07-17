import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, CalendarDays, MapPin } from "lucide-react";
import { useMatchReports } from "@/hooks/use-match-reports";
import { reportStatusMeta, type MatchReport, type ReportStatusTone } from "@/types/match-report";
import { EASE_OUT_QUART } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMatchDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function opponentTitle(r: MatchReport): string {
  return r.report?.opponent_name ?? r.away_team ?? r.home_team ?? "Motståndare";
}

function opponentCode(r: MatchReport): string {
  if (r.report?.opponent_code) return r.report.opponent_code;
  const name = opponentTitle(r);
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

const STATUS_TONE_CLASSES: Record<ReportStatusTone, string> = {
  success: "text-success border-success/30 bg-success/10",
  warning: "text-warning border-warning/30 bg-warning/10",
  muted: "text-muted-foreground border-border bg-secondary/60",
};

function StatusPill({ status }: { status: string }) {
  const meta = reportStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] ${STATUS_TONE_CLASSES[meta.tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function OpponentCard({ report, index }: { report: MatchReport; index: number }) {
  const date = formatMatchDate(report.match_date);
  const stats = (report.report?.key_stats ?? []).slice(0, 3);
  const meta = [report.competition, report.venue].filter(Boolean).join(" · ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 + index * 0.06, ease: EASE_OUT_QUART }}
    >
      <Link
        to={`/opponents/${report.id}`}
        className="group relative flex h-full min-h-[44px] flex-col card-editorial card-interactive p-5"
        aria-label={`Öppna matchunderlag: ${report.home_team ?? ""} – ${report.away_team ?? ""}`}
      >
        <div className="flex items-start gap-3.5">
          <span
            className="grid h-11 w-11 flex-none place-items-center rounded-sm icon-premium font-mono text-[13px] font-bold tracking-tight"
            style={{ color: "hsl(var(--gold-text))" }}
          >
            {opponentCode(report)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-foreground">
              {opponentTitle(report)}
            </h3>
            {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
          </div>
          <StatusPill status={report.status} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {date && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-accent/60" strokeWidth={1.8} />
              {date}
              {report.report?.kickoff_label ? `, ${report.report.kickoff_label}` : ""}
            </span>
          )}
          {report.venue && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-accent/60" strokeWidth={1.8} />
              {report.venue}
            </span>
          )}
        </div>

        {stats.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border">
            {stats.map((s) => (
              <div key={s.label} className="bg-background/60 px-3 py-2.5">
                <div className="stat-gold text-[17px] leading-none">{s.value}</div>
                <div className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-4 text-xs font-medium text-muted-foreground">
          <span className="transition-colors group-hover:text-accent">Öppna underlag</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
        </div>
      </Link>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card-editorial p-5 skeleton-reveal" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="flex items-start gap-3.5">
            <div className="h-11 w-11 rounded-sm skeleton-shimmer" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded-sm skeleton-shimmer" />
              <div className="h-3 w-1/2 rounded-sm skeleton-shimmer" />
            </div>
          </div>
          <div className="mt-4 h-3 w-3/4 rounded-sm skeleton-shimmer" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-14 rounded-sm skeleton-shimmer" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const EMPTY_STEPS = [
  "Välj motståndare och match — Vault hämtar hela säsongens data.",
  "Analysteamet väger uppmätta värden mot detaljerad filmanalys.",
  "Underlaget landar här — härkomst-taggat och klart att briefa staben.",
];

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
      className="card-editorial mx-auto max-w-xl p-8 text-center"
    >
      <span className="eyebrow justify-center">Inga underlag ännu</span>
      <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">
        Ditt första matchunderlag byggs härifrån
      </h2>
      <ol className="mx-auto mt-6 max-w-md space-y-4 text-left">
        {EMPTY_STEPS.map((step, i) => (
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const Opponents = () => {
  const { data: reports, isLoading, error } = useMatchReports();

  return (
    <div className="mx-auto max-w-[1160px] space-y-8 px-5 py-8 md:px-8 md:py-12">
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
      >
        <span className="eyebrow">Motståndare</span>
        <h1
          className="mt-3 text-3xl font-extrabold leading-[1.05] text-foreground md:text-[40px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Motståndaranalyser
        </h1>
        <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
          Dina underlag inför kommande matcher. Filmankrat, härkomst-taggat, klart att briefa staben.
        </p>
      </motion.header>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-sm border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error instanceof Error ? error.message : "Kunde inte ladda motståndaranalyser"}
        </div>
      )}

      {isLoading ? (
        <LoadingGrid />
      ) : !error && (reports?.length ?? 0) === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(reports ?? []).map((report, i) => (
            <OpponentCard key={report.id} report={report} index={i} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Opponents;
