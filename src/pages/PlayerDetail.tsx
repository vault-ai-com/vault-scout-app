import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, User } from "lucide-react";

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Link to="/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" />
          Tillbaka till spelare
        </Link>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
        className="rounded-2xl p-6 bg-card border border-border">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Spelare #{id}</h1>
            <p className="text-sm text-muted-foreground">Detaljvy — sök eller analysera för att se data</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-12 text-center border-t border-border">
          <p className="text-sm text-muted-foreground max-w-xs">
            Spelardata laddas från Scout AI-analyser. Kör en sökning för att populera profilen.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default PlayerDetail;
