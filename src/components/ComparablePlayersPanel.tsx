import { motion } from "framer-motion";
import { Users, Loader2 } from "lucide-react";
import { PlayerCard } from "@/components/PlayerCard";
import { useComparablePlayers } from "@/hooks/use-scout-comparable-players";
import type { ScoutPlayer } from "@/types/scout";

interface ComparablePlayersPanelProps {
  player: ScoutPlayer | null;
}

export function ComparablePlayersPanel({ player }: ComparablePlayersPanelProps) {
  const { players, isLoading, error } = useComparablePlayers(player);

  if (!player) return null;

  return (
    <div className="rounded-xl p-6 md:p-8 glass-premium card-accent-left space-y-4">
      <h3 className="section-tag flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" />
        Liknande spelare
      </h3>

      {isLoading && (
        <div className="flex items-center gap-2 py-4" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Söker liknande spelare...</span>
        </div>
      )}

      {error && (
        <p className="text-xs text-muted-foreground">Kunde inte hämta liknande spelare.</p>
      )}

      {!isLoading && players.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">Inga liknande spelare hittades.</p>
      )}

      {players.length > 0 && (
        <motion.div
          className="space-y-2"
          initial="hidden"
          animate="visible"
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
        >
          {players.map((p) => (
            <motion.div
              key={p.id}
              variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
            >
              <PlayerCard player={p} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
