import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Search, TrendingUp, Users, AlertTriangle, MessageCircle, Clock, ArrowUpRight } from "lucide-react";
import { useScoutDashboard } from "@/hooks/use-scout-search";
import { EASE_OUT_QUART } from "@/lib/motion";

function AnimatedNumber({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * ease));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <>{display.toLocaleString("sv-SE")}</>;
}

const statConfig = [
  { key: "total_players", label: "Spelare", icon: Users, context: "i databasen" },
  { key: "total_analyses", label: "Analyser", icon: Search, context: "genomförda" },
  { key: "watchlist_count", label: "Bevakade", icon: TrendingUp, context: "på din lista" },
];

const recMeta: Record<string, { cls: string; label: string }> = {
  SIGN: { cls: "text-success", label: "Värva" },
  MONITOR: { cls: "text-warning", label: "Bevaka" },
  PASS: { cls: "text-destructive", label: "Avstå" },
};

const Dashboard = () => {
  const { data, isLoading, error } = useScoutDashboard();
  const stats = (data?.data ?? {}) as Record<string, unknown>;
  const recentAnalyses = (Array.isArray(stats.recent_analyses) ? stats.recent_analyses : []) as Array<{
    id: string; name: string; analysis_type: string; overall_score: number | null;
    recommendation: string | null; completed_at: string | null;
  }>;

  return (
    <div className="mx-auto max-w-[1160px] px-5 md:px-8 py-8 md:py-12 space-y-10">
      {/* Editorial hero */}
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT_QUART }}>
        <span className="eyebrow">Scouting</span>
        <h1 className="mt-3 text-3xl md:text-[40px] font-extrabold text-foreground leading-[1.05]" style={{ letterSpacing: "-0.03em" }}>
          Dashboard
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground max-w-xl">Överblick av din scoutingaktivitet.</p>
      </motion.header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-md overflow-hidden border border-border">
        {statConfig.map((stat, i) => (
          <motion.div key={stat.key}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.07, ease: EASE_OUT_QUART }}
            className="relative bg-card px-6 py-7 last:col-span-2 lg:last:col-span-1">
            <div className="absolute inset-x-0 top-0 h-px bg-accent/50" />
            <div className="flex items-center justify-between">
              <span className="eyebrow !text-[10px] !tracking-[0.2em]">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-accent/60" strokeWidth={1.8} />
            </div>
            {isLoading ? (
              <div className="mt-4 h-11 w-24 rounded-sm skeleton-shimmer" />
            ) : (
              <div className="mt-3 stat-gold text-[44px] md:text-[52px] leading-none">
                <AnimatedNumber value={Number(stats[stat.key]) || 0} />
              </div>
            )}
            <div className="mt-2.5 text-xs text-muted-foreground">{stat.context}</div>
          </motion.div>
        ))}
      </section>

      {/* Error */}
      {error && (
        <motion.div role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-3 p-4 rounded-sm bg-destructive/10 border border-destructive/25 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error instanceof Error ? error.message : "Kunde inte ladda dashboard"}
        </motion.div>
      )}

      {/* Recent analyses — editorial list */}
      {!isLoading && recentAnalyses.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: EASE_OUT_QUART }}>
          <div className="flex items-end justify-between mb-4">
            <div>
              <span className="eyebrow">Senaste</span>
              <h2 className="mt-2 text-xl font-bold text-foreground tracking-tight">Analyser</h2>
            </div>
            <Link to="/players" className="group inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-accent transition-colors">
              Visa alla
              <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
          <div className="card-editorial divide-y divide-border">
            {recentAnalyses.slice(0, 6).map((a) => {
              const rec = recMeta[a.recommendation ?? ""] ?? { cls: "text-muted-foreground", label: a.recommendation ?? "—" };
              return (
                <div key={a.id} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/50">
                  <div className="score-circle shrink-0">{a.overall_score?.toFixed(1) ?? "—"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{a.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{a.analysis_type === "full_scout" ? "Full scout" : a.analysis_type === "personality" ? "Personlighet" : a.analysis_type}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{a.completed_at ? new Date(a.completed_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : ""}</span>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${rec.cls}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {rec.label}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* Quick actions */}
      <section>
        <span className="eyebrow">Genvägar</span>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { to: "/players", icon: Search, label: "Sök spelare", desc: "Hitta och analysera spelare" },
            { to: "/chat", icon: MessageCircle, label: "Prata med Bosse", desc: "Fråga AI-scouten" },
            { to: "/players?watchlist=true", icon: TrendingUp, label: "Bevakningslista", desc: "Dina bevakade spelare" },
          ].map((action, i) => (
            <motion.div key={action.to + action.label}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.28 + i * 0.06, ease: EASE_OUT_QUART }}>
              <Link to={action.to}
                className="group relative flex flex-col gap-3 card-editorial card-interactive p-5 h-full">
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-sm icon-premium">
                    <action.icon className="w-4 h-4 text-accent" strokeWidth={2} />
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 transition-all group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">{action.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{action.desc}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
