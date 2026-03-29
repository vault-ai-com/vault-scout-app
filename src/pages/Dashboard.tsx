import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Search, TrendingUp, Users, AlertTriangle } from "lucide-react";
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
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Överblick av din scoutingaktivitet</p>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statConfig.map((stat, i) => (
          <motion.div key={stat.key}
            initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="rounded-2xl p-5 bg-card border border-border hover:border-primary/20 card-interactive">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-muted-foreground/50" />
            </div>
            {isLoading ? (
              <div className="h-8 w-24 rounded-lg skeleton-shimmer" />
            ) : (
              <div className="text-2xl font-bold text-foreground tabular-nums">
                <AnimatedNumber value={Number(stats[stat.key]) || 0} />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4" />
          {error instanceof Error ? error.message : "Kunde inte ladda dashboard"}
        </div>
      )}

      {/* Recent activity */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}
        className="rounded-2xl p-5 bg-card border border-border">
        <h2 className="text-sm font-semibold text-foreground mb-4">Senaste aktivitet</h2>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Search className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">Börja scouta</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Sök efter spelare, analysera prestationer och generera rapporter med AI-driven scouting.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Dashboard;
