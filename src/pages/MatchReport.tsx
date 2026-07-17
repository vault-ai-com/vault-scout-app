import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Film,
  Play,
  X,
} from "lucide-react";
import { useMatchReport } from "@/hooks/use-match-reports";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { ProvenanceBadge, ProvenanceLegend } from "@/components/Provenance";
import {
  AVAILABILITY_LABELS,
  formatTimecode,
  type Availability,
  type ClipRef,
  type Duel,
  type MatchReportData,
  type SetPieceSide,
  type XiPlayer,
} from "@/types/match-report";
import { EASE_OUT_QUART, SPRING_SNAPPY, prefersReducedMotion } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Chart tokens — all colors come from the design system CSS variables
// ---------------------------------------------------------------------------

const TOKEN = {
  us: "hsl(var(--success))",
  them: "hsl(var(--destructive))",
  gold: "hsl(var(--accent))",
  goldText: "hsl(var(--gold-text))",
  info: "hsl(var(--info))",
  warn: "hsl(var(--warning))",
  ink: "hsl(var(--foreground))",
  muted: "hsl(var(--muted-foreground))",
  line: "hsl(var(--border))",
  surface: "hsl(var(--secondary))",
  card: "hsl(var(--card))",
} as const;

const fmtNum = (n: number): string =>
  n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });

const fmtSigned = (n: number): string => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

// ---------------------------------------------------------------------------
// Section registry — secnav + numbering
// ---------------------------------------------------------------------------

interface SectionDef {
  id: string;
  label: string;
  group: string;
  present: (r: MatchReportData) => boolean;
}

const SECTION_DEFS: SectionDef[] = [
  { id: "coach", label: "Tränarsida", group: "Tränare", present: (r) => !!r.matchbild || r.three_messages.length > 0 },
  { id: "air", label: "Luftspelet", group: "Tränare", present: (r) => !!r.aerial },
  { id: "idea", label: "Spelidé", group: "Analys", present: (r) => !!r.opponent_idea },
  { id: "threats", label: "Vad vi fruktar", group: "Analys", present: (r) => r.threats.length > 0 },
  { id: "weak", label: "Svagheter", group: "Analys", present: (r) => r.weaknesses.length > 0 },
  { id: "season", label: "Säsongsmönster", group: "Analys", present: (r) => !!r.season_pattern },
  { id: "set", label: "Fasta situationer", group: "Analys", present: (r) => !!r.set_pieces },
  { id: "trans", label: "Omställning", group: "Analys", present: (r) => r.transition_phases.length > 0 },
  { id: "form", label: "Formation & XI", group: "Analys", present: (r) => !!r.formation },
  { id: "duel", label: "Duellkarta", group: "Analys", present: (r) => r.duels.length > 0 },
  { id: "code", label: "Kodningsschema", group: "Video", present: (r) => r.coding_scheme.length > 0 },
  { id: "method", label: "Metod & källa", group: "Video", present: (r) => !!r.method },
];

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface SectionShellProps {
  id: string;
  index: number;
  title: string;
  sub?: string | null;
  registerRef: (id: string, el: HTMLElement | null) => void;
  children: React.ReactNode;
}

function SectionShell({ id, index, title, sub, registerRef, children }: SectionShellProps) {
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

function ClipChip({ clip, onOpen }: { clip: ClipRef; onOpen: (c: ClipRef) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(clip)}
      aria-haspopup="dialog"
      aria-label={`Öppna klipp: ${clip.label}`}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border border-border bg-background/50 px-2.5 font-mono text-[11px] font-medium text-muted-foreground transition-all duration-150 hover:-translate-y-px hover:border-accent/60 hover:text-foreground md:min-h-0 md:py-1.5"
    >
      <Play className="h-3 w-3 text-accent" aria-hidden="true" />
      {clip.label}
    </button>
  );
}

function NoteBox({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "act" }) {
  if (tone === "warn") {
    return (
      <div className="rounded-sm border-l-[3px] border-destructive bg-destructive/[0.07] px-4 py-3 text-[13px] leading-relaxed text-foreground/90">
        {children}
      </div>
    );
  }
  if (tone === "act") {
    return (
      <div className="rounded-sm border-l-[3px] border-accent bg-accent/[0.07] px-4 py-3 text-[13px] leading-relaxed text-foreground/90">
        {children}
      </div>
    );
  }
  return (
    <div className="rounded-sm border border-dashed border-border bg-secondary/40 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts (SVG, token-driven)
// ---------------------------------------------------------------------------

function AerialChart({ bars, unit }: { bars: Array<{ label: string; value: number; side: "us" | "them" }>; unit?: string | null }) {
  const max = Math.max(...bars.map((b) => b.value), 0.1);
  const W = 560;
  const rowH = 30;
  const H = 10 + bars.length * rowH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Stapeldiagram: ${unit ?? "värde"} per aktör`}>
      {bars.map((b, i) => {
        const y = 8 + i * rowH;
        const bw = Math.max(6, (b.value / max) * (W - 190));
        const col = b.side === "us" ? TOKEN.us : TOKEN.them;
        return (
          <g key={b.label}>
            <text x={120} y={y + 15} fontSize={12} fill={TOKEN.ink} textAnchor="end">
              {b.label}
            </text>
            <motion.rect
              x={130}
              y={y + 3}
              width={bw}
              height={16}
              rx={1.5}
              fill={col}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.07, ease: EASE_OUT_QUART }}
              style={{ transformBox: "fill-box", transformOrigin: "left" }}
            >
              <title>{`${b.label}: ${fmtNum(b.value)} ${unit ?? ""}`.trim()}</title>
            </motion.rect>
            <text x={130 + bw + 8} y={y + 15} fontSize={11} fontWeight={700} fill={col}>
              {fmtNum(b.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function XgDiffChart({ series }: { series: number[] }) {
  const W = 560;
  const H = 150;
  const pad = 28;
  const zero = H / 2;
  const maxAbs = Math.max(0.9, ...series.map((v) => Math.abs(v)));
  const step = (W - pad * 2) / Math.max(series.length - 1, 1);
  const pts = series.map((v, i) => [pad + i * step, zero - (v / maxAbs) * (H / 2 - 18)] as const);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="xG-differens per match över säsongen">
      <line x1={pad - 6} y1={zero} x2={W - pad + 6} y2={zero} stroke={TOKEN.line} strokeDasharray="3 3" />
      <text x={W - pad + 10} y={zero + 4} fontSize={10} fill={TOKEN.muted}>0</text>
      <motion.polyline
        fill="none"
        stroke={TOKEN.info}
        strokeWidth={2}
        points={pts.map((p) => p.join(",")).join(" ")}
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.1, ease: EASE_OUT_QUART }}
      />
      {pts.map((p, i) => {
        const v = series[i];
        const col = v < -0.6 ? TOKEN.them : v > 0.2 ? TOKEN.us : TOKEN.info;
        return (
          <motion.circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={3.6}
            fill={col}
            initial={{ opacity: 0, scale: 0 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.5 + i * 0.04 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <title>{`Match ${i + 1}: ${fmtSigned(v)} xG-diff`}</title>
          </motion.circle>
        );
      })}
    </svg>
  );
}

function IntervalChart({ intervals }: { intervals: Array<{ label: string; value: number }> }) {
  const W = 560;
  const H = 150;
  const bw = 64;
  const gap = (W - intervals.length * bw) / (intervals.length + 1);
  const base = H - 24;
  const max = Math.max(...intervals.map((d) => d.value), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Insläppta mål per 15-minutersintervall">
      <line x1={8} y1={base} x2={W - 8} y2={base} stroke={TOKEN.line} />
      {intervals.map((d, i) => {
        const x = gap + i * (bw + gap);
        const h = (d.value / max) * (base - 20);
        const peak = d.value === max;
        return (
          <g key={d.label}>
            <motion.rect
              x={x}
              y={base - h}
              width={bw}
              height={h}
              rx={1.5}
              fill={peak ? TOKEN.gold : TOKEN.surface}
              stroke={peak ? "none" : TOKEN.line}
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: i * 0.06, ease: EASE_OUT_QUART }}
              style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
            >
              <title>{`${d.label}: ${d.value} insläppta mål`}</title>
            </motion.rect>
            <text x={x + bw / 2} y={base - h - 7} fontSize={11} fontWeight={700} textAnchor="middle" fill={peak ? TOKEN.goldText : TOKEN.ink}>
              {d.value}
            </text>
            <text x={x + bw / 2} y={base + 15} fontSize={10} textAnchor="middle" fill={TOKEN.muted}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pitch diagrams (token-driven, editorial)
// ---------------------------------------------------------------------------

function PitchXI({ shape, xi }: { shape: string; xi: XiPlayer[] }) {
  const W = 620;
  const H = 250;
  const lines = useMemo(() => {
    const parsed = shape.split("-").map((n) => Number.parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0);
    return [1, ...parsed];
  }, [shape]);

  // Assign players to line slots in order (GK first).
  const placed: Array<{ p: XiPlayer; x: number; y: number }> = [];
  let cursor = 0;
  lines.forEach((count, li) => {
    const x = li === 0 ? 46 : 130 + ((W - 260) / Math.max(lines.length - 2, 1)) * (li - 1) + (lines.length === 2 ? (W - 260) / 2 : 0);
    for (let j = 0; j < count; j++) {
      const p = xi[cursor];
      if (!p) break;
      const y = (H * (j + 1)) / (count + 1);
      placed.push({ p, x, y });
      cursor++;
    }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Förväntad startelva i ${shape}`}>
      <rect width={W} height={H} rx={2} fill={TOKEN.surface} />
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={2} fill="none" stroke={TOKEN.line} />
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke={TOKEN.line} strokeDasharray="4 4" />
      <circle cx={W / 2} cy={H / 2} r={34} fill="none" stroke={TOKEN.line} />
      <rect x={0} y={H / 2 - 62} width={54} height={124} fill="none" stroke={TOKEN.line} />
      {placed.map(({ p, x, y }, i) => {
        const out = p.availability === "out";
        const doubt = p.availability === "doubt" || p.availability === "unknown";
        return (
          <motion.g
            key={`${p.no}-${i}`}
            initial={{ opacity: 0, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ ...SPRING_SNAPPY, delay: 0.1 + i * 0.045 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <circle
              cx={x}
              cy={y}
              r={15}
              fill={out ? TOKEN.card : "hsl(var(--info) / 0.25)"}
              stroke={doubt ? TOKEN.warn : out ? TOKEN.line : "hsl(var(--info) / 0.6)"}
              strokeWidth={1.4}
              strokeDasharray={doubt ? "3 3" : undefined}
            />
            <text x={x} y={y + 4} fontSize={11} fontWeight={700} textAnchor="middle" fill={out ? TOKEN.muted : TOKEN.ink}>
              {p.no}
            </text>
            {p.name && (
              <text x={x} y={y + 28} fontSize={8.5} textAnchor="middle" fill={TOKEN.muted}>
                {p.name}
              </text>
            )}
            <title>{`#${p.no} ${p.name ?? ""} · ${p.pos} · ${AVAILABILITY_LABELS[p.availability]}${p.note ? ` · ${p.note}` : ""}`}</title>
          </motion.g>
        );
      })}
    </svg>
  );
}

function SetPieceDiagram({ side, variant }: { side: SetPieceSide; variant: "against" | "for" }) {
  const W = 300;
  const H = 168;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={side.title}>
      <rect width={W} height={H} rx={2} fill={TOKEN.surface} />
      <rect x={60} y={0} width={180} height={62} fill="none" stroke={TOKEN.line} />
      <rect x={110} y={0} width={80} height={26} fill="none" stroke={TOKEN.line} />
      <line x1={0} y1={0} x2={W} y2={0} stroke={TOKEN.line} strokeWidth={3} />
      {variant === "against" ? (
        <>
          <circle cx={150} cy={8} r={4} fill={TOKEN.gold} />
          {side.markers.map((no, i) => {
            const cx = 120 + i * 45;
            const cy = 45 - i * 5;
            return (
              <g key={no} fontSize={9}>
                <circle cx={cx} cy={cy} r={9} fill={TOKEN.them} />
                <text x={cx} y={cy + 3} fill="hsl(var(--destructive-foreground))" textAnchor="middle" fontWeight={700}>
                  {no}
                </text>
                <circle cx={cx} cy={cy} r={13.5} fill="none" stroke={TOKEN.us} strokeDasharray="3 3" />
              </g>
            );
          })}
          <circle cx={210} cy={94} r={9} fill={TOKEN.us} />
          <text x={210} y={97} fontSize={9} fontWeight={700} textAnchor="middle" fill="hsl(var(--primary-foreground))">R</text>
          <text x={150} y={132} fontSize={9.5} textAnchor="middle" fill={TOKEN.muted}>
            ring = dedikerad markör · R = returzon
          </text>
        </>
      ) : (
        <>
          <circle cx={12} cy={12} r={4} fill={TOKEN.gold} />
          <path d="M16 14 Q120 55 200 20" fill="none" stroke={TOKEN.gold} strokeWidth={2} strokeDasharray="4 4" />
          <g fontSize={9} fontWeight={700} textAnchor="middle">
            <circle cx={205} cy={24} r={9} fill={TOKEN.us} />
            <text x={205} y={27} fill="hsl(var(--primary-foreground))">1</text>
            <circle cx={150} cy={44} r={9} fill={TOKEN.us} />
            <text x={150} y={47} fill="hsl(var(--primary-foreground))">2</text>
            <circle cx={150} cy={100} r={9} fill={TOKEN.info} />
            <text x={150} y={103} fill="hsl(var(--primary-foreground))">R</text>
            <circle cx={185} cy={100} r={9} fill={TOKEN.info} />
            <text x={185} y={103} fill="hsl(var(--primary-foreground))">R</text>
          </g>
          <text x={150} y={132} fontSize={9.5} textAnchor="middle" fill={TOKEN.muted}>
            höjdhot bortre stolpe · R = returzon
          </text>
        </>
      )}
    </svg>
  );
}

function TransitionDiagram({ zoneLabel, contextLabel }: { zoneLabel?: string | null; contextLabel?: string | null }) {
  const W = 620;
  const H = 190;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label="Central omställningsyta">
      <rect width={W} height={H} rx={2} fill={TOKEN.surface} />
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke={TOKEN.line} />
      <circle cx={W / 2} cy={H / 2} r={26} fill="none" stroke={TOKEN.line} />
      <g fontSize={9} textAnchor="middle" fontWeight={700}>
        <circle cx={200} cy={36} r={9} fill={TOKEN.them} />
        <text x={200} y={39} fill="hsl(var(--destructive-foreground))">24</text>
        <circle cx={200} cy={154} r={9} fill={TOKEN.them} />
        <text x={200} y={157} fill="hsl(var(--destructive-foreground))">3</text>
      </g>
      <motion.rect
        x={330}
        y={62}
        width={180}
        height={64}
        rx={2}
        fill="hsl(var(--destructive) / 0.14)"
        stroke={TOKEN.them}
        strokeDasharray="5 5"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
      />
      <text x={420} y={98} fontSize={12} fontWeight={800} textAnchor="middle" fill={TOKEN.them}>
        {zoneLabel ?? "ÖPPEN KORRIDOR"}
      </text>
      <defs>
        <marker id="mr-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill={TOKEN.us} />
        </marker>
      </defs>
      <motion.path
        d="M330 95 L556 95"
        stroke={TOKEN.us}
        strokeWidth={3}
        fill="none"
        markerEnd="url(#mr-arrow)"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.4, ease: EASE_OUT_QUART }}
      />
      <text x={150} y={20} fontSize={11} fill={TOKEN.muted}>
        {contextLabel ?? "Motståndarens backar högt (fas 1) →"}
      </text>
    </svg>
  );
}

function OverloadDiagram({ zoneLabel }: { zoneLabel?: string | null }) {
  const W = 300;
  const H = 200;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label="Övertal centralt">
      <rect width={W} height={H} rx={2} fill={TOKEN.surface} />
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke={TOKEN.line} strokeDasharray="3 3" />
      <motion.rect
        x={95}
        y={62}
        width={110}
        height={76}
        rx={2}
        fill="hsl(var(--success) / 0.14)"
        stroke={TOKEN.us}
        strokeDasharray="4 4"
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.15 }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      />
      <text x={150} y={104} fontSize={11} fontWeight={700} textAnchor="middle" fill={TOKEN.us}>
        {zoneLabel ?? "Fri mellan linjerna"}
      </text>
      <g>
        <circle cx={120} cy={50} r={8} fill={TOKEN.them} />
        <circle cx={180} cy={50} r={8} fill={TOKEN.them} />
        <circle cx={110} cy={150} r={8} fill={TOKEN.us} />
        <circle cx={150} cy={150} r={8} fill={TOKEN.us} />
        <circle cx={190} cy={150} r={8} fill={TOKEN.us} />
      </g>
      <text x={150} y={186} fontSize={9.5} textAnchor="middle" fill={TOKEN.muted}>
        grön = vi · röd = deras dubbelsexa
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Duel scale row — qualitative 0–1, never a fake percentage
// ---------------------------------------------------------------------------

function duelColor(scale: number): string {
  if (scale < 0.35) return TOKEN.them;
  if (scale < 0.65) return TOKEN.warn;
  return TOKEN.us;
}

function DuelScaleRow({ duel }: { duel: Duel }) {
  const col = duelColor(duel.scale);
  return (
    <div className="py-3 first:pt-1 last:pb-1">
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 md:grid-cols-[160px_1fr_190px]">
        <span className="text-[12.5px] font-semibold text-foreground">{duel.label}</span>
        <div
          className="relative h-2.5 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--destructive) / 0.5), hsl(var(--warning) / 0.45) 50%, hsl(var(--success) / 0.5))",
          }}
          role="img"
          aria-label={`${duel.label}: ${duel.scale_label}`}
        >
          <motion.span
            className="absolute -top-1 h-[18px] w-[5px] rounded-[2px]"
            style={{ background: col, boxShadow: `0 0 10px ${col}`, left: `${duel.scale * 100}%`, x: "-50%" }}
            initial={{ opacity: 0, scaleY: 0 }}
            whileInView={{ opacity: 1, scaleY: 1 }}
            viewport={{ once: true }}
            transition={{ ...SPRING_SNAPPY, delay: 0.15 }}
          />
        </div>
        <span className="inline-flex items-center gap-2 text-[11.5px] font-bold md:justify-end" style={{ color: col }}>
          {duel.scale_label}
          {duel.provenance && <ProvenanceBadge kind={duel.provenance} />}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground md:pl-[176px]">{duel.note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clip drawer — timecode + video placeholder (B1 wires real playback)
// ---------------------------------------------------------------------------

function ClipDrawer({ clip, onClose }: { clip: ClipRef | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, !!clip);

  useEffect(() => {
    if (!clip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevOverflow;
    };
  }, [clip, onClose]);

  const tc = clip ? formatTimecode(clip) : null;

  return (
    <AnimatePresence>
      {clip && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Klipp: ${clip.label}`}
            className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[94vw] flex-col border-l border-border bg-card shadow-elevated"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
              <Film className="h-4 w-4 text-accent" aria-hidden="true" />
              <span className="text-sm font-bold text-foreground">Klipp</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Stäng klippanel"
                className="ml-auto grid h-11 w-11 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:h-8 md:w-8"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              <div className="relative grid aspect-video place-items-center overflow-hidden rounded-sm border border-border surface-hero">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-accent/40 bg-accent/15">
                  <Play className="ml-0.5 h-5 w-5" style={{ color: "hsl(var(--gold-text))" }} aria-hidden="true" />
                </div>
                {tc && (
                  <span className="absolute bottom-2.5 left-3 rounded-sm bg-background/80 px-2 py-0.5 font-mono text-[11px]" style={{ color: "hsl(var(--gold-text))" }}>
                    {tc}
                  </span>
                )}
                <span className="absolute right-3 top-2.5 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em]" style={{ color: "hsl(var(--gold-text))" }}>
                  Videobevis · B1 kommer
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              <div className="text-sm font-bold text-foreground">{clip.label}</div>
              {clip.anchor && <div className="mt-1 text-xs text-muted-foreground">Hör till: {clip.anchor}</div>}
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                {clip.task ?? "Koda momentet på film — fynden skrivs tillbaka till rätt kort i underlaget (KLIPP → FILM)."}
              </p>
              <div className="mt-4 flex items-center gap-2.5">
                <ProvenanceBadge kind="KLIPP" />
                <span className="text-xs text-muted-foreground">markera fynd → skrivs tillbaka till underlaget</span>
              </div>
              <div className="mt-5 rounded-sm border border-dashed border-border bg-secondary/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Videouppspelning kopplas in när klippbanken (B1) är live. Timecoden pekar på rätt moment i källmatchen.
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------------

function ReportSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-12" aria-busy="true" aria-label="Laddar matchunderlag">
      <div className="h-3 w-32 rounded-sm skeleton-shimmer" />
      <div className="mt-4 h-9 w-2/3 max-w-md rounded-sm skeleton-shimmer" />
      <div className="mt-3 h-4 w-1/2 max-w-sm rounded-sm skeleton-shimmer" />
      <div className="mt-10 grid gap-8 lg:grid-cols-[200px_1fr]">
        <div className="hidden space-y-2.5 lg:block">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-3.5 rounded-sm skeleton-shimmer" style={{ width: `${60 + (i % 3) * 14}%` }} />
          ))}
        </div>
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-editorial p-6 skeleton-reveal" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="h-3 w-28 rounded-sm skeleton-shimmer" />
              <div className="mt-3 h-6 w-56 rounded-sm skeleton-shimmer" />
              <div className="mt-5 space-y-2.5">
                <div className="h-3.5 w-full rounded-sm skeleton-shimmer" />
                <div className="h-3.5 w-11/12 rounded-sm skeleton-shimmer" />
                <div className="h-3.5 w-4/5 rounded-sm skeleton-shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const MatchReport = () => {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useMatchReport(id);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [clip, setClip] = useState<ClipRef | null>(null);
  const [xiConfirmed, setXiConfirmed] = useState(false);
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map());

  const report = data?.report ?? null;

  const sections = useMemo(
    () => (report ? SECTION_DEFS.filter((s) => s.present(report)) : []),
    [report],
  );

  const registerRef = useCallback((sectionId: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(sectionId, el);
    else sectionEls.current.delete(sectionId);
  }, []);

  // Scroll spy — highlight active section in the secnav
  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const sid = (entry.target as HTMLElement).dataset.section;
            if (sid) setActiveSection(sid);
          }
        }
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    sectionEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = sectionEls.current.get(sectionId);
    if (!el) return;
    setActiveSection(sectionId);
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);

  const openClip = useCallback((c: ClipRef) => setClip(c), []);
  const closeClip = useCallback(() => setClip(null), []);

  if (isLoading) return <ReportSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <div role="alert" className="card-editorial flex items-center gap-3 p-5 text-left text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error instanceof Error ? error.message : "Kunde inte ladda matchunderlaget"}
        </div>
        <Link to="/opponents" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-accent">
          <ArrowLeft className="h-4 w-4" /> Tillbaka till Motståndare
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <span className="eyebrow justify-center">Hittades inte</span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">Underlaget finns inte</h1>
        <p className="mt-2 text-sm text-muted-foreground">Det kan ha tagits bort, eller så saknar du behörighet i den här arbetsytan.</p>
        <Link to="/opponents" className="mt-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-accent">
          <ArrowLeft className="h-4 w-4" /> Tillbaka till Motståndare
        </Link>
      </div>
    );
  }

  const opponent = report?.opponent_name ?? data.away_team ?? "Motståndare";
  const matchDate = data.match_date
    ? new Date(`${data.match_date}T00:00:00`).toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : null;
  const metaLine = [data.competition, data.venue, matchDate && `${matchDate}${report?.kickoff_label ? `, ${report.kickoff_label}` : ""}`]
    .filter(Boolean)
    .join(" · ");

  let sectionNo = 0;
  const nextNo = () => ++sectionNo;

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-12">
      {/* Header */}
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT_QUART }}>
        <Link
          to="/opponents"
          className="group inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-accent md:min-h-0"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Motståndare
        </Link>
        <div className="mt-3">
          <span className="eyebrow">Motståndaranalys</span>
          <h1 className="mt-3 text-3xl font-extrabold leading-[1.05] text-foreground md:text-[40px]" style={{ letterSpacing: "-0.03em" }}>
            {data.home_team ?? ""}{data.home_team && " – "}
            <span style={{ color: "hsl(var(--gold-text))" }}>{opponent}</span>
          </h1>
          {metaLine && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground">
              <CalendarDays className="h-4 w-4 text-accent/60" aria-hidden="true" />
              {metaLine}
              {report?.audience_label && <span className="font-semibold text-foreground">· {report.audience_label}</span>}
            </p>
          )}
        </div>
        <ProvenanceLegend className="mt-5" />
        <div className="rule-gold mt-5" />
      </motion.header>

      {!report && (
        <div className="mt-10">
          <NoteBox>Underlaget saknar innehåll ännu — sektionerna dyker upp här när analysen är byggd.</NoteBox>
        </div>
      )}

      {report && (
        <>
          {/* Mobile section nav — sticky horizontal strip */}
          <nav
            aria-label="Sektioner"
            className="scrollbar-hide sticky top-14 z-20 -mx-5 mt-6 flex gap-1.5 overflow-x-auto border-b border-border/60 bg-background/90 px-5 py-2.5 backdrop-blur-xl md:top-0 lg:hidden"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                aria-current={activeSection === s.id ? "true" : undefined}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  activeSection === s.id
                    ? "border-accent/50 bg-accent/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                style={activeSection === s.id ? { color: "hsl(var(--gold-text))" } : undefined}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="mt-8 grid gap-10 lg:grid-cols-[200px_1fr]">
            {/* Desktop sticky secnav */}
            <nav aria-label="Sektioner" className="sticky top-8 hidden max-h-[calc(100vh-64px)] self-start overflow-y-auto lg:block">
              {(["Tränare", "Analys", "Video"] as const).map((group) => {
                const items = sections.filter((s) => s.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="px-3 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60 first:pt-0">
                      {group}
                    </div>
                    {items.map((s) => {
                      const active = activeSection === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => scrollToSection(s.id)}
                          aria-current={active ? "true" : undefined}
                          className={`relative block w-full rounded-sm px-3 py-2 text-left text-[12.5px] transition-colors duration-150 ${
                            active ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="secnav-indicator"
                              className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-accent"
                              style={{ boxShadow: "0 0 10px hsl(var(--accent) / 0.55)" }}
                              transition={SPRING_SNAPPY}
                            />
                          )}
                          <span className={active ? "pl-2.5" : ""}>{s.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>

            {/* Report body */}
            <div className="min-w-0 space-y-14">
              {/* ── Tränarsida ─────────────────────────────────────────── */}
              {(report.matchbild || report.three_messages.length > 0) && (
                <SectionShell id="coach" index={nextNo()} title="Tränarsida — det viktigaste på en sida" registerRef={registerRef}>
                  {report.matchbild && (
                    <div className="card-editorial p-5 md:p-6">
                      <p className="text-[15px] leading-relaxed text-foreground md:text-base">
                        <span className="font-bold">Matchbild: </span>
                        {report.matchbild.text}{" "}
                        {report.matchbild.provenance && (
                          <ProvenanceBadge kind={report.matchbild.provenance} label={report.matchbild.provenance_label} />
                        )}
                      </p>
                    </div>
                  )}

                  {report.three_messages.length > 0 && (
                    <>
                      <div className="mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                        Tränarläge · de tre budskapen
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        {report.three_messages.map((m, i) => (
                          <motion.div
                            key={m.title}
                            className="card-editorial relative overflow-hidden p-4"
                            initial={{ opacity: 0, y: 10 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.35, delay: i * 0.08, ease: EASE_OUT_QUART }}
                          >
                            <span aria-hidden="true" className="absolute right-3 top-1 text-[34px] font-black leading-none text-accent/15">
                              {i + 1}
                            </span>
                            <div className="text-[11px] font-extrabold uppercase tracking-[0.08em]" style={{ color: "hsl(var(--gold-text))" }}>
                              {m.title}
                            </div>
                            <p className="mt-1.5 text-[13px] leading-snug text-foreground/90">{m.body}</p>
                          </motion.div>
                        ))}
                      </div>
                    </>
                  )}

                  {report.focus_cards.length > 0 && (
                    <>
                      <div className="mt-7 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                        Fördjupning & bänk
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        {report.focus_cards.map((card) => (
                          <div key={card.title} className="card-editorial p-4">
                            <h3 className="text-[13px] font-bold" style={{ color: "hsl(var(--gold-text))" }}>{card.title}</h3>
                            <ul className="mt-2.5 space-y-2">
                              {card.bullets.map((b) => (
                                <li key={b} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {report.scenarios.length > 0 && (
                    <div className="card-editorial mt-4 overflow-hidden">
                      <div className="border-b border-border px-5 py-3 text-[13px] font-bold" style={{ color: "hsl(var(--gold-text))" }}>
                        Om–då på bänken
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                          <caption className="sr-only">Matchlägen och förberedda svar</caption>
                          <thead>
                            <tr className="border-b border-border text-left">
                              <th scope="col" className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Läge</th>
                              <th scope="col" className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Vårt svar</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.scenarios.map((s) => (
                              <tr key={s.situation} className="transition-colors hover:bg-secondary/40">
                                <td className="whitespace-nowrap px-5 py-2.5 font-semibold text-foreground">{s.situation}</td>
                                <td className="px-5 py-2.5 text-foreground/85">{s.response}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </SectionShell>
              )}

              {/* ── Luftspelet ─────────────────────────────────────────── */}
              {report.aerial && (
                <SectionShell
                  id="air"
                  index={nextNo()}
                  title="Luftspelet — vår hävstång"
                  sub="Deras svaga länkar vägda mot vår trupp."
                  registerRef={registerRef}
                >
                  <div className="card-editorial p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13.5px] font-bold text-foreground">{report.aerial.chart_title}</h3>
                      {report.aerial.provenance && <ProvenanceBadge kind={report.aerial.provenance} />}
                    </div>
                    {report.aerial.chart_caption && (
                      <p className="mb-3 mt-1 text-[11.5px] text-muted-foreground">{report.aerial.chart_caption}</p>
                    )}
                    <AerialChart bars={report.aerial.bars} unit={report.aerial.unit} />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="card-editorial p-5">
                      <h3 className="text-[13px] font-bold" style={{ color: "hsl(var(--gold-text))" }}>{report.aerial.plan.title}</h3>
                      <ul className="mt-2.5 space-y-2">
                        {report.aerial.plan.bullets.map((b) => (
                          <li key={b} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                            <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="card-editorial p-5">
                      <h3 className="text-[13px] font-bold" style={{ color: "hsl(var(--gold-text))" }}>{report.aerial.mirror.title}</h3>
                      <p className="mt-2.5 text-[13.5px] leading-relaxed text-foreground/90">
                        {report.aerial.mirror.text}{" "}
                        {report.aerial.mirror.provenance && <ProvenanceBadge kind={report.aerial.mirror.provenance} />}
                      </p>
                    </div>
                  </div>
                </SectionShell>
              )}

              {/* ── Spelidé ────────────────────────────────────────────── */}
              {report.opponent_idea && (
                <SectionShell id="idea" index={nextNo()} title={`${opponent}s spelidé`} registerRef={registerRef}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {(
                      [
                        { title: "Utan boll", items: report.opponent_idea.without_ball },
                        { title: "Med boll", items: report.opponent_idea.with_ball },
                      ] as const
                    ).map((col) => (
                      <div key={col.title} className="card-editorial p-5">
                        <h3 className="text-[13px] font-bold" style={{ color: "hsl(var(--gold-text))" }}>{col.title}</h3>
                        <ul className="mt-2.5 space-y-2.5">
                          {col.items.map((item) => (
                            <li key={item.text} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                              <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
                              <span>
                                {item.text} {item.provenance && <ProvenanceBadge kind={item.provenance} label={item.provenance_label} />}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </SectionShell>
              )}

              {/* ── Vad vi fruktar ─────────────────────────────────────── */}
              {report.threats.length > 0 && (
                <SectionShell
                  id="threats"
                  index={nextNo()}
                  title="Vad vi fruktar — deras vapen"
                  sub="Scouting är symmetriskt: inte bara var vi attackerar, utan vad vi måste stoppa."
                  registerRef={registerRef}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {report.threats.map((t, i) => (
                      <motion.div
                        key={t.number + t.name}
                        className="card-editorial p-5"
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.35, delay: i * 0.08, ease: EASE_OUT_QUART }}
                      >
                        <div className="flex items-start gap-3">
                          <span className="grid h-11 w-11 flex-none place-items-center rounded-sm border border-destructive/30 bg-destructive/10 font-mono text-[15px] font-black text-destructive">
                            {t.number}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-foreground">{t.name}</div>
                            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{t.role}</div>
                            {t.provenance && <ProvenanceBadge kind={t.provenance} className="mt-1.5" />}
                          </div>
                        </div>
                        <ul className="mt-3.5 space-y-2">
                          {t.points.map((p) => (
                            <li key={p} className="flex gap-2 text-[12.5px] leading-snug text-foreground/90">
                              <span aria-hidden="true" className="mt-[6px] h-1 w-1 flex-none rounded-full bg-destructive/70" />
                              {p}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    ))}
                  </div>
                  {report.threats_note && (
                    <div className="mt-4">
                      <NoteBox>
                        {report.threats_note}{" "}
                        {report.set_pieces && (
                          <button
                            type="button"
                            onClick={() => scrollToSection("set")}
                            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
                            style={{ color: "hsl(var(--gold-text))" }}
                          >
                            Fasta situationer <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </button>
                        )}
                      </NoteBox>
                    </div>
                  )}
                </SectionShell>
              )}

              {/* ── Svagheter ──────────────────────────────────────────── */}
              {report.weaknesses.length > 0 && (
                <SectionShell
                  id="weak"
                  index={nextNo()}
                  title={`${report.weaknesses.length === 3 ? "Tre" : report.weaknesses.length} exploaterbara svagheter`}
                  sub="Rangordnade efter datastyrka · rot → mekanism → åtgärd → klipp"
                  registerRef={registerRef}
                >
                  <div className="space-y-6">
                    {report.weaknesses.map((w, i) => (
                      <motion.article
                        key={w.rank}
                        className="card-editorial relative p-5 pt-6 md:p-6"
                        initial={{ opacity: 0, y: 14 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.06, ease: EASE_OUT_QUART }}
                        aria-label={`Svaghet ${w.rank}: ${w.title}`}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute -left-2.5 -top-2.5 grid h-8 w-8 place-items-center rounded-full bg-accent font-mono text-sm font-black text-accent-foreground"
                          style={{ boxShadow: "0 6px 16px -6px hsl(var(--accent) / 0.7)" }}
                        >
                          {w.rank}
                        </span>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="text-[15px] font-bold text-foreground">{w.title}</h3>
                          <ProvenanceBadge kind={w.provenance} label={w.provenance_label} />
                        </div>
                        <dl className="mt-4 grid grid-cols-[76px_1fr] gap-x-4 gap-y-2.5 text-[13.5px] leading-relaxed">
                          {(
                            [
                              ["Rot", w.layers.rot],
                              ["Mekanism", w.layers.mekanism],
                              ["Åtgärd", w.layers.atgard],
                            ] as const
                          ).map(([label, text]) => (
                            <div key={label} className="contents">
                              <dt className="pt-px text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: "hsl(var(--gold-text))" }}>
                                {label}
                              </dt>
                              <dd className="text-foreground/90">{text}</dd>
                            </div>
                          ))}
                        </dl>
                        {w.clips.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {w.clips.map((c) => (
                              <ClipChip key={c.id} clip={c} onOpen={openClip} />
                            ))}
                          </div>
                        )}
                      </motion.article>
                    ))}
                  </div>
                </SectionShell>
              )}

              {/* ── Säsongsmönster ─────────────────────────────────────── */}
              {report.season_pattern && (
                <SectionShell
                  id="season"
                  index={nextNo()}
                  title="Säsongsmönster"
                  sub={report.season_pattern.sub}
                  registerRef={registerRef}
                >
                  {report.season_pattern.sample_label && (
                    <div className="mb-4">
                      <ProvenanceBadge kind="MATT" label={report.season_pattern.sample_label} />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="card-editorial p-5">
                      <h3 className="text-[13.5px] font-bold text-foreground">{report.season_pattern.xg_title}</h3>
                      {report.season_pattern.xg_caption && (
                        <p className="mb-3 mt-1 text-[11.5px] text-muted-foreground">{report.season_pattern.xg_caption}</p>
                      )}
                      <XgDiffChart series={report.season_pattern.xg_diff_series} />
                    </div>
                    <div className="card-editorial p-5">
                      <h3 className="text-[13.5px] font-bold text-foreground">{report.season_pattern.intervals_title}</h3>
                      {report.season_pattern.intervals_caption && (
                        <p className="mb-3 mt-1 text-[11.5px] text-muted-foreground">{report.season_pattern.intervals_caption}</p>
                      )}
                      <IntervalChart intervals={report.season_pattern.conceded_intervals} />
                    </div>
                  </div>
                  {report.season_pattern.summary && (
                    <div className="mt-4">
                      <NoteBox>
                        {report.season_pattern.summary.text}{" "}
                        {report.season_pattern.summary.provenance && (
                          <ProvenanceBadge
                            kind={report.season_pattern.summary.provenance}
                            label={report.season_pattern.summary.provenance_label}
                          />
                        )}
                      </NoteBox>
                    </div>
                  )}
                </SectionShell>
              )}

              {/* ── Fasta situationer ──────────────────────────────────── */}
              {report.set_pieces && (
                <SectionShell id="set" index={nextNo()} title="Fasta situationer — båda riktningarna" registerRef={registerRef}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {(
                      [
                        { side: report.set_pieces.against, variant: "against" as const },
                        { side: report.set_pieces.for, variant: "for" as const },
                      ] as const
                    ).map(({ side, variant }) => (
                      <div key={variant} className="card-editorial p-5">
                        <h3 className="text-[13.5px] font-bold text-foreground">{side.title}</h3>
                        {side.caption && <p className="mt-1 text-[11.5px] text-muted-foreground">{side.caption}</p>}
                        <SetPieceDiagram side={side} variant={variant} />
                        {side.note && <p className="mt-2 text-[11.5px] text-muted-foreground">{side.note}</p>}
                      </div>
                    ))}
                  </div>
                  {(report.set_pieces.verify_note || report.set_pieces.clips.length > 0) && (
                    <div className="mt-4">
                      <NoteBox tone="warn">
                        {report.set_pieces.verify_note && <span className="font-semibold">{report.set_pieces.verify_note} </span>}
                        {report.set_pieces.clips.length > 0 && (
                          <span className="mt-2.5 flex flex-wrap gap-1.5">
                            {report.set_pieces.clips.map((c) => (
                              <ClipChip key={c.id} clip={c} onOpen={openClip} />
                            ))}
                          </span>
                        )}
                      </NoteBox>
                    </div>
                  )}
                </SectionShell>
              )}

              {/* ── Omställning ────────────────────────────────────────── */}
              {report.transition_phases.length > 0 && (
                <SectionShell
                  id="trans"
                  index={nextNo()}
                  title={`Omställning i ${report.transition_phases.length} faser`}
                  registerRef={registerRef}
                >
                  {report.transition_viz && (
                    <div className="card-editorial p-5">
                      <h3 className="text-[13.5px] font-bold text-foreground">{report.transition_viz.title}</h3>
                      {report.transition_viz.caption && (
                        <p className="mt-1 text-[11.5px] text-muted-foreground">{report.transition_viz.caption}</p>
                      )}
                      <TransitionDiagram zoneLabel={report.transition_viz.zone_label} contextLabel={report.transition_viz.context_label} />
                    </div>
                  )}
                  <div className="card-editorial mt-4 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <caption className="sr-only">Omställningens faser med klipp</caption>
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th scope="col" className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Fas</th>
                            <th scope="col" className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Vad som syns</th>
                            <th scope="col" className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Klipp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.transition_phases.map((phase) => (
                            <tr key={phase.phase} className="transition-colors hover:bg-secondary/40">
                              <td className="whitespace-nowrap px-5 py-3 font-mono font-bold" style={{ color: "hsl(var(--gold-text))" }}>
                                {phase.phase} · {phase.name}
                              </td>
                              <td className="px-5 py-3 text-foreground/85">{phase.description}</td>
                              <td className="px-5 py-3">
                                <span className="flex flex-wrap gap-1.5">
                                  {phase.clips.map((c) => (
                                    <ClipChip key={c.id} clip={c} onOpen={openClip} />
                                  ))}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionShell>
              )}

              {/* ── Formation & XI ─────────────────────────────────────── */}
              {report.formation && (
                <SectionShell
                  id="form"
                  index={nextNo()}
                  title="Formation & förväntad XI"
                  sub="Från senaste uppställning + skador."
                  registerRef={registerRef}
                >
                  {report.formation.verify_note && (
                    <div
                      className={`flex flex-wrap items-center gap-3 rounded-sm border px-4 py-3 text-[12.5px] transition-colors ${
                        xiConfirmed ? "border-success/35 bg-success/[0.07]" : "border-warning/35 bg-warning/[0.07]"
                      }`}
                    >
                      {xiConfirmed ? (
                        <Check className="h-4 w-4 flex-none text-success" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 flex-none text-warning" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 text-foreground/90">
                        {xiConfirmed
                          ? report.formation.verify_done_note ?? "Bekräftad startelva — markeringar och matchups är låsta för matchdag."
                          : report.formation.verify_note}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={xiConfirmed}
                        aria-label="Växla mellan preliminär och bekräftad startelva"
                        onClick={() => setXiConfirmed((v) => !v)}
                        className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-background/60 p-1 md:min-h-0"
                      >
                        <span
                          className={`rounded-full px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide transition-colors ${
                            !xiConfirmed ? "bg-warning text-background" : "text-muted-foreground"
                          }`}
                        >
                          Preliminär
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide transition-colors ${
                            xiConfirmed ? "bg-success text-background" : "text-muted-foreground"
                          }`}
                        >
                          Bekräftad
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="card-editorial mt-4 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13.5px] font-bold text-foreground">
                        Förväntad XI ({report.formation.shape}) {xiConfirmed ? "— bekräftad" : "— preliminär"}
                      </h3>
                      {report.formation.provenance && <ProvenanceBadge kind={report.formation.provenance} />}
                    </div>
                    <div className="mt-3">
                      <PitchXI shape={report.formation.shape} xi={report.formation.xi} />
                    </div>
                    {report.formation.availability_chips.length > 0 && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Tillgänglighet:</span>
                        {report.formation.availability_chips.map((chip) => {
                          const cls: Record<Availability, string> = {
                            fit: "text-success bg-success/10 border-success/25",
                            doubt: "text-warning bg-warning/10 border-warning/25",
                            out: "text-muted-foreground bg-secondary/70 border-border",
                            unknown: "text-muted-foreground bg-secondary/70 border-border",
                          };
                          return (
                            <span
                              key={chip.label}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10.5px] font-bold ${cls[chip.status]}`}
                            >
                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                              {chip.label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {report.formation.basis_note && (
                      <p className="mt-3 text-[11px] text-muted-foreground/80">{report.formation.basis_note}</p>
                    )}
                  </div>

                  {(report.formation.overload || report.formation.press) && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      {report.formation.overload && (
                        <div className="card-editorial p-5">
                          <h3 className="text-[13.5px] font-bold text-foreground">{report.formation.overload.title}</h3>
                          {report.formation.overload.caption && (
                            <p className="mt-1 text-[11.5px] text-muted-foreground">{report.formation.overload.caption}</p>
                          )}
                          <OverloadDiagram zoneLabel={report.formation.overload.zone_label} />
                        </div>
                      )}
                      {report.formation.press && (
                        <div className="card-editorial p-5">
                          <h3 className="text-[13px] font-bold" style={{ color: "hsl(var(--gold-text))" }}>Press — två skilda faser</h3>
                          <p className="mt-3 text-[13px] leading-relaxed text-foreground/90">
                            <span className="font-bold text-success">Fas A — vi har initiativet: </span>
                            {report.formation.press.fas_a}
                          </p>
                          <p className="mt-3 text-[13px] leading-relaxed text-foreground/90">
                            <span className="font-bold text-destructive">Fas B — vi tappade precis bollen: </span>
                            {report.formation.press.fas_b}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </SectionShell>
              )}

              {/* ── Duellkarta ─────────────────────────────────────────── */}
              {report.duels.length > 0 && (
                <SectionShell
                  id="duel"
                  index={nextNo()}
                  title="Duellkarta & individprofiler"
                  sub="Rollbaserad — håller vid rotation. Verifiera motståndarens XI innan markeringar låses."
                  registerRef={registerRef}
                >
                  <div className="card-editorial p-5">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Duellövertag — vem styr matchningen (grön = vår kontroll, röd = deras hot)
                    </p>
                    <div className="divide-y divide-border/60">
                      {report.duels.map((d) => (
                        <DuelScaleRow key={d.id} duel={d} />
                      ))}
                    </div>
                    <div className="mt-3 flex justify-between text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 md:pr-[190px] md:pl-[176px]">
                      <span>Deras övertag</span>
                      <span>Jämnt</span>
                      <span>Vårt övertag</span>
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground/80">
                      Kvalitativ bedömning (rollbaserad, härkomst per rad). Ingen mätt vinstprocent — volym ≠ vinst%.
                    </p>
                  </div>

                  {report.duels.some((d) => d.opponent || d.owner || d.key) && (
                    <div className="card-editorial mt-4 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                          <caption className="sr-only">Dueller: hot, ansvar och vad som avgör</caption>
                          <thead>
                            <tr className="border-b border-border text-left">
                              {["Duell", "Deras hot", "Vi äger", "Vad som avgör", "Prio"].map((h) => (
                                <th key={h} scope="col" className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.duels.map((d) => (
                              <tr key={d.id} className="transition-colors hover:bg-secondary/40">
                                <td className="whitespace-nowrap px-4 py-3 font-mono font-bold" style={{ color: "hsl(var(--gold-text))" }}>{d.id}</td>
                                <td className="px-4 py-3 text-foreground/85">{d.opponent ?? "—"}</td>
                                <td className="px-4 py-3 text-foreground/85">{d.owner ?? "—"}</td>
                                <td className="px-4 py-3 text-foreground/85">{d.key ?? "—"}</td>
                                <td className="px-4 py-3">
                                  {d.priority && (
                                    <span className={`font-mono text-[12px] font-black ${d.priority === "P0" ? "text-destructive" : "text-warning"}`}>
                                      {d.priority}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {report.duels_note && (
                    <div className="mt-4">
                      <NoteBox>
                        <span className="font-semibold text-foreground/90">Noteringar: </span>
                        {report.duels_note}
                      </NoteBox>
                    </div>
                  )}
                </SectionShell>
              )}

              {/* ── Kodningsschema ─────────────────────────────────────── */}
              {report.coding_scheme.length > 0 && (
                <SectionShell
                  id="code"
                  index={nextNo()}
                  title="Kodningsschema för videoanalys"
                  sub="Momenten att verifiera på film — så du slipper gå igenom två hela matcher."
                  registerRef={registerRef}
                >
                  <div className="card-editorial overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <caption className="sr-only">Kodningsuppgifter med klipp och mål</caption>
                        <thead>
                          <tr className="border-b border-border text-left">
                            {["Uppgift", "Klipp", "Vad som ska fastställas"].map((h) => (
                              <th key={h} scope="col" className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.coding_scheme.map((task) => (
                            <tr key={task.task} className="transition-colors hover:bg-secondary/40">
                              <td className="whitespace-nowrap px-5 py-3 font-semibold text-foreground">{task.task}</td>
                              <td className="px-5 py-3">
                                {task.clips.length > 0 ? (
                                  <span className="flex flex-wrap gap-1.5">
                                    {task.clips.map((c) => (
                                      <ClipChip key={c.id} clip={c} onOpen={openClip} />
                                    ))}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">{task.clips_label ?? "—"}</span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-foreground/85">{task.goal}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionShell>
              )}

              {/* ── Metod & källa ──────────────────────────────────────── */}
              {report.method && (
                <SectionShell id="method" index={nextNo()} title="Metod & källa" registerRef={registerRef}>
                  <NoteBox>
                    <span className="font-semibold text-foreground/90">Underlag: </span>
                    {report.method.basis}
                    <br />
                    <br />
                    <span className="font-semibold text-foreground/90">Ärliga gränser: </span>
                    {report.method.limits}
                  </NoteBox>
                  {report.method.footer && (
                    <p className="mt-6 border-t border-border pt-4 text-center text-[11px] tracking-[0.02em] text-muted-foreground/70">
                      {report.method.footer}
                    </p>
                  )}
                </SectionShell>
              )}
            </div>
          </div>
        </>
      )}

      <ClipDrawer clip={clip} onClose={closeClip} />
    </div>
  );
};

export default MatchReport;
