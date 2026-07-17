import { motion } from "framer-motion";
import { EASE_OUT_QUART } from "@/lib/motion";

/**
 * Editorial section wrapper — eyebrow number, title, gold rule, whileInView
 * reveal. Shared by MatchReport and PlayerDetail (scroll-spy sections).
 */
export interface SectionShellProps {
  id: string;
  index: number;
  title: string;
  sub?: string | null;
  registerRef: (id: string, el: HTMLElement | null) => void;
  children: React.ReactNode;
}

export function SectionShell({ id, index, title, sub, registerRef, children }: SectionShellProps) {
  return (
    <motion.section
      id={`sec-${id}`}
      ref={(el: HTMLElement | null) => registerRef(id, el)}
      data-section={id}
      aria-labelledby={`sec-${id}-title`}
      className="scroll-mt-28 md:scroll-mt-16"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ duration: 0.45, ease: EASE_OUT_QUART }}
    >
      <div className="mb-5">
        <span className="eyebrow">{`Sektion ${String(index).padStart(2, "0")}`}</span>
        <h2 id={`sec-${id}-title`} className="mt-2 text-[22px] font-extrabold tracking-tight text-foreground md:text-2xl">
          {title}
        </h2>
        {sub && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{sub}</p>}
        <div className="rule-gold mt-4" />
      </div>
      {children}
    </motion.section>
  );
}
