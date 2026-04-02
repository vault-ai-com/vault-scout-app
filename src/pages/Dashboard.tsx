import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Search, TrendingUp, Users, AlertTriangle, MessageCircle } from "lucide-react";
import { useScoutDashboard } from "@/hooks/use-scout-search";

function AnimatedNumber({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * ease));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <>{display}</>;
}

const statConfig = [
  { key: "total_players", label: "Spelare", icon: Users, fallback: "0" },
  { key: "total_analyses", label: "Analyser", icon: Search, fallback: "0" },
  { key: "watchlist_count", label: "Bevakade", icon: TrendingUp, fallback: "0" },
];

const Dashboard = () => {
  const { data, isLoading, error } = useScoutDashboard();
  const stats = (data?.data ?? {}) as Record<string, unknown>;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}>
        <span className="section-tag">Scouting</span>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mt-1 tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Överblick av din scoutingaktivitet</p>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {statConfig.map((stat, i) => (
          <motion.div key={stat.key}
            initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="rounded-xl glass-premium gradient-accent-top card-interactive p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <div className="w-8 h-8 rounded-lg icon-premium flex items-center justify-center">
                <stat.icon className="w-4 h-4 text-accent" />
              </div>
            </div>
            {isLoading ? (
              <div className="h-10 w-28 rounded-lg skeleton-shimmer" />
            ) : (
              <div className="text-3xl md:text-4xl font-extrabold tabular-nums stat-gold">
                <AnimatedNumber value={Number(stats[stat.key]) || 0} />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <motion.div role="alert" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error instanceof Error ? error.message : "Kunde inte ladda dashboard"}
        </motion.div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {[
          { to: "/players", icon: Search, label: "Sök spelare", desc: "Hitta och analysera spelare" },
          { to: "/chat", icon: MessageCircle, label: "Prata med Bosse", desc: "Fråga AI-scouten" },
          { to: "/players?watchlist=true", icon: TrendingUp, label: "Bevakningslista", desc: "Dina bevakade spelare" },
        ].map((action, i) => (
          <motion.div key={action.to + action.label}
            initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 + i * 0.06, ease: [0.25, 0.46, 0.45, 0.94] }}>
            <Link to={action.to}
              className="block rounded-xl glass-premium gradient-accent-top card-interactive p-5 md:p-6 group">
              <div className="w-10 h-10 rounded-xl icon-premium flex items-center justify-center mb-3">
                <action.icon className="w-4 h-4 text-accent" />
              </div>
              <h3 className="text-sm font-semibold text-foreground group-hover:text-accent transition-colors">{action.label}</h3>
              <p className="text-xs text-muted-foreground mt-1">{action.desc}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
