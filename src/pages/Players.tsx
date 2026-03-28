import { motion } from "framer-motion";
import { Search, Filter, Users } from "lucide-react";

const Players = () => {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-xl font-bold text-foreground">Spelare</h1>
        <p className="text-sm text-muted-foreground mt-1">Sök och analysera spelare</p>
      </motion.div>

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Sök spelare, position, klubb..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all bg-card border border-border text-foreground placeholder:text-muted-foreground" />
        </div>
        <button type="button"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-card transition-colors">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      {/* Empty state */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-2xl p-5 bg-card border border-border">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">Inga spelare ännu</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Använd sökfältet ovan för att hitta spelare eller kör en AI-driven sökning.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Players;
