import { motion } from "framer-motion";
import { Search, TrendingUp, Users, BarChart3 } from "lucide-react";

const stats = [
  { label: "Spelare analyserade", value: "0", icon: Users, color: "primary" },
  { label: "Sökningar", value: "0", icon: Search, color: "accent" },
  { label: "Rapporter", value: "0", icon: BarChart3, color: "success" },
  { label: "Toppkandidater", value: "0", icon: TrendingUp, color: "warning" },
];

const Dashboard = () => {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Överblick av din scoutingaktivitet</p>
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat, i) => (
          <motion.div key={stat.label}
            initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            className="rounded-2xl p-5 bg-card border border-border hover:border-primary/20 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-muted-foreground/50" />
            </div>
            <div className="text-2xl font-bold text-foreground">{stat.value}</div>
          </motion.div>
        ))}
      </div>

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
