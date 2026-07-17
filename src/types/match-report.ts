// Match report (motståndaranalys) types — Zod-validated report_data contract.
// Mirrors the Vault Scout prototype: 12 sections, provenance-tagged content, clip refs.
import { z } from "zod";
import { safeArray } from "@/types/scout";

// ---------------------------------------------------------------------------
// Provenance — every claim carries its origin
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.enum(["MATT", "FILM", "TOLKAT", "KLIPP"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  MATT: "MÄTT",
  FILM: "FILM",
  TOLKAT: "TOLKAT",
  KLIPP: "KLIPP",
};

export const PROVENANCE_TITLES: Record<Provenance, string> = {
  MATT: "MÄTT — uppmätt över hela säsongen (stabil signal)",
  FILM: "FILM — observerat på film",
  TOLKAT: "TOLKAT — slutsats, ofta litet sampel (behandla som tendens)",
  KLIPP: "KLIPP — ska verifieras på film",
};

// ---------------------------------------------------------------------------
// Clip references — video evidence anchors (B1 wires real playback)
// ---------------------------------------------------------------------------

export const ClipRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Start minute in source match video. */
  timecode_start: z.number().nullable().optional(),
  /** End minute (optional range). */
  timecode_end: z.number().nullable().optional(),
  /** Where in the report the clip belongs, e.g. "Svaghet 1" / "Duell D1". */
  anchor: z.string().nullable().optional(),
  /** Coding task shown in the drawer. */
  task: z.string().nullable().optional(),
  /** Playable video URL (B1 — real clip from the club's bank). When present, the drawer plays it. */
  video_url: z.string().nullable().optional(),
});
export type ClipRef = z.infer<typeof ClipRefSchema>;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export const TaggedTextSchema = z.object({
  text: z.string(),
  provenance: ProvenanceSchema.nullable().optional(),
  /** Override badge text, e.g. "MÄTT · 12 matcher". */
  provenance_label: z.string().nullable().optional(),
});
export type TaggedText = z.infer<typeof TaggedTextSchema>;

export const KeyStatSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type KeyStat = z.infer<typeof KeyStatSchema>;

// ---------------------------------------------------------------------------
// Section: Tränarsida
// ---------------------------------------------------------------------------

export const ThreeMessageSchema = z.object({
  title: z.string(),
  body: z.string(),
});
export type ThreeMessage = z.infer<typeof ThreeMessageSchema>;

export const FocusCardSchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()),
});
export type FocusCard = z.infer<typeof FocusCardSchema>;

export const ScenarioSchema = z.object({
  situation: z.string(),
  response: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ---------------------------------------------------------------------------
// Section: Luftspelet
// ---------------------------------------------------------------------------

export const AerialBarSchema = z.object({
  label: z.string(),
  value: z.number(),
  side: z.enum(["us", "them"]),
});
export type AerialBar = z.infer<typeof AerialBarSchema>;

export const AerialSchema = z.object({
  chart_title: z.string(),
  chart_caption: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  bars: z.array(AerialBarSchema),
  plan: z.object({ title: z.string(), bullets: z.array(z.string()) }),
  mirror: z.object({
    title: z.string(),
    text: z.string(),
    provenance: ProvenanceSchema.nullable().optional(),
  }),
  provenance: ProvenanceSchema.nullable().optional(),
});
export type Aerial = z.infer<typeof AerialSchema>;

// ---------------------------------------------------------------------------
// Section: Spelidé + Vad vi fruktar
// ---------------------------------------------------------------------------

export const OpponentIdeaSchema = z.object({
  without_ball: z.array(TaggedTextSchema),
  with_ball: z.array(TaggedTextSchema),
});
export type OpponentIdea = z.infer<typeof OpponentIdeaSchema>;

export const ThreatSchema = z.object({
  number: z.string(),
  name: z.string(),
  role: z.string(),
  provenance: ProvenanceSchema.nullable().optional(),
  points: z.array(z.string()),
});
export type Threat = z.infer<typeof ThreatSchema>;

// ---------------------------------------------------------------------------
// Section: Tre svagheter
// ---------------------------------------------------------------------------

export const WeaknessSchema = z.object({
  rank: z.number(),
  title: z.string(),
  provenance: ProvenanceSchema,
  provenance_label: z.string().nullable().optional(),
  layers: z.object({
    rot: z.string(),
    mekanism: z.string(),
    atgard: z.string(),
  }),
  clips: z.array(ClipRefSchema).default([]),
});
export type Weakness = z.infer<typeof WeaknessSchema>;

// ---------------------------------------------------------------------------
// Section: Säsongsmönster
// ---------------------------------------------------------------------------

export const ConcededIntervalSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const SeasonPatternSchema = z.object({
  sample_label: z.string().nullable().optional(),
  sub: z.string().nullable().optional(),
  xg_title: z.string(),
  xg_caption: z.string().nullable().optional(),
  /** Skapad − insläppt xG per match, kronologiskt. */
  xg_diff_series: z.array(z.number()),
  intervals_title: z.string(),
  intervals_caption: z.string().nullable().optional(),
  conceded_intervals: z.array(ConcededIntervalSchema),
  summary: TaggedTextSchema.nullable().optional(),
});
export type SeasonPattern = z.infer<typeof SeasonPatternSchema>;

// ---------------------------------------------------------------------------
// Section: Fasta situationer
// ---------------------------------------------------------------------------

export const SetPieceSideSchema = z.object({
  title: z.string(),
  caption: z.string().nullable().optional(),
  /** Shirt numbers to mark in the diagram (defensive side). */
  markers: z.array(z.string()).default([]),
  note: z.string().nullable().optional(),
});
export type SetPieceSide = z.infer<typeof SetPieceSideSchema>;

export const SetPiecesSchema = z.object({
  /** Våra fasta (offensivt). */
  for: SetPieceSideSchema,
  /** Deras fasta mot oss (defensivt). */
  against: SetPieceSideSchema,
  verify_note: z.string().nullable().optional(),
  clips: z.array(ClipRefSchema).default([]),
});
export type SetPieces = z.infer<typeof SetPiecesSchema>;

// ---------------------------------------------------------------------------
// Section: Omställning i 5 faser
// ---------------------------------------------------------------------------

export const TransitionPhaseSchema = z.object({
  phase: z.number(),
  name: z.string(),
  description: z.string(),
  clips: z.array(ClipRefSchema).default([]),
});
export type TransitionPhase = z.infer<typeof TransitionPhaseSchema>;

export const TransitionVizSchema = z.object({
  title: z.string(),
  caption: z.string().nullable().optional(),
  zone_label: z.string().nullable().optional(),
  context_label: z.string().nullable().optional(),
});
export type TransitionViz = z.infer<typeof TransitionVizSchema>;

// ---------------------------------------------------------------------------
// Section: Formation & XI
// ---------------------------------------------------------------------------

export const AvailabilitySchema = z.enum(["fit", "doubt", "out", "unknown"]);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  fit: "Spelklar",
  doubt: "Osäker",
  out: "Borta",
  unknown: "Okänd",
};

export const XiPlayerSchema = z.object({
  no: z.string(),
  name: z.string().nullable().optional(),
  pos: z.string(),
  availability: AvailabilitySchema.default("fit"),
  note: z.string().nullable().optional(),
});
export type XiPlayer = z.infer<typeof XiPlayerSchema>;

export const AvailabilityChipSchema = z.object({
  label: z.string(),
  status: AvailabilitySchema,
});
export type AvailabilityChip = z.infer<typeof AvailabilityChipSchema>;

export const FormationSchema = z.object({
  shape: z.string(),
  provenance: ProvenanceSchema.nullable().optional(),
  verify_note: z.string().nullable().optional(),
  verify_done_note: z.string().nullable().optional(),
  basis_note: z.string().nullable().optional(),
  /** Order: GK first, then line by line (defence → attack). */
  xi: z.array(XiPlayerSchema),
  availability_chips: z.array(AvailabilityChipSchema).default([]),
  overload: z
    .object({
      title: z.string(),
      caption: z.string().nullable().optional(),
      zone_label: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  press: z
    .object({ fas_a: z.string(), fas_b: z.string() })
    .nullable()
    .optional(),
});
export type Formation = z.infer<typeof FormationSchema>;

// ---------------------------------------------------------------------------
// Section: Duellkarta
// ---------------------------------------------------------------------------

export const DuelPrioritySchema = z.enum(["P0", "P1", "P2"]);
export type DuelPriority = z.infer<typeof DuelPrioritySchema>;

export const DuelSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Kvalitativ skala 0–1: 0 = motståndarövertag, 1 = vårt övertag. */
  scale: z.number().min(0).max(1),
  scale_label: z.string(),
  note: z.string(),
  opponent: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  key: z.string().nullable().optional(),
  priority: DuelPrioritySchema.nullable().optional(),
  provenance: ProvenanceSchema.nullable().optional(),
});
export type Duel = z.infer<typeof DuelSchema>;

// ---------------------------------------------------------------------------
// Section: Kodningsschema + Metod
// ---------------------------------------------------------------------------

export const CodingTaskSchema = z.object({
  task: z.string(),
  goal: z.string(),
  clips: z.array(ClipRefSchema).default([]),
  /** Fallback text when no concrete clips exist yet. */
  clips_label: z.string().nullable().optional(),
});
export type CodingTask = z.infer<typeof CodingTaskSchema>;

export const MethodSchema = z.object({
  basis: z.string(),
  limits: z.string(),
  footer: z.string().nullable().optional(),
});
export type Method = z.infer<typeof MethodSchema>;

// ---------------------------------------------------------------------------
// Root report_data contract
// ---------------------------------------------------------------------------

export const MatchReportDataSchema = z.object({
  /** Short opponent code shown in list chips, e.g. "BP". */
  opponent_code: z.string().nullable().optional(),
  /** Display name of the opponent, e.g. "Brommapojkarna". */
  opponent_name: z.string().nullable().optional(),
  kickoff_label: z.string().nullable().optional(),
  audience_label: z.string().nullable().optional(),
  key_stats: z.array(KeyStatSchema).default([]),

  matchbild: TaggedTextSchema.nullable().optional(),
  three_messages: z.array(ThreeMessageSchema).default([]),
  focus_cards: z.array(FocusCardSchema).default([]),
  scenarios: z.array(ScenarioSchema).default([]),

  aerial: AerialSchema.nullable().optional(),
  opponent_idea: OpponentIdeaSchema.nullable().optional(),

  threats: z.array(ThreatSchema).default([]),
  threats_note: z.string().nullable().optional(),

  weaknesses: z.array(WeaknessSchema).default([]),

  season_pattern: SeasonPatternSchema.nullable().optional(),
  set_pieces: SetPiecesSchema.nullable().optional(),

  transition_viz: TransitionVizSchema.nullable().optional(),
  transition_phases: z.array(TransitionPhaseSchema).default([]),

  formation: FormationSchema.nullable().optional(),

  duels: z.array(DuelSchema).default([]),
  duels_note: z.string().nullable().optional(),

  coding_scheme: z.array(CodingTaskSchema).default([]),
  method: MethodSchema.nullable().optional(),
});
export type MatchReportData = z.infer<typeof MatchReportDataSchema>;

// ---------------------------------------------------------------------------
// DB row (public.match_reports)
// ---------------------------------------------------------------------------

export const MatchReportRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  home_team: z.string().nullable(),
  away_team: z.string().nullable(),
  match_date: z.string().nullable(),
  competition: z.string().nullable(),
  venue: z.string().nullable(),
  status: z.string(),
  report_data: z.unknown().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MatchReportRow = z.infer<typeof MatchReportRowSchema>;

/** Row with report_data parsed against the contract (null when missing/invalid). */
export interface MatchReport extends Omit<MatchReportRow, "report_data"> {
  report: MatchReportData | null;
}

export function parseMatchReport(row: MatchReportRow): MatchReport {
  const parsed = MatchReportDataSchema.safeParse(row.report_data);
  const { report_data: _reportData, ...rest } = row;
  return { ...rest, report: parsed.success ? parsed.data : null };
}

export function parseMatchReportRows(data: unknown): MatchReport[] {
  return safeArray(MatchReportRowSchema, data).map(parseMatchReport);
}

// ---------------------------------------------------------------------------
// Status presentation
// ---------------------------------------------------------------------------

export type ReportStatusTone = "success" | "warning" | "muted";

export const REPORT_STATUS_META: Record<string, { label: string; tone: ReportStatusTone }> = {
  complete: { label: "Klart underlag", tone: "success" },
  ready: { label: "Klart underlag", tone: "success" },
  published: { label: "Klart underlag", tone: "success" },
  in_progress: { label: "Byggs", tone: "warning" },
  building: { label: "Byggs", tone: "warning" },
  draft: { label: "Utkast", tone: "muted" },
};

export function reportStatusMeta(status: string): { label: string; tone: ReportStatusTone } {
  return REPORT_STATUS_META[status] ?? { label: status, tone: "muted" };
}

/** "min 44–46" / "min 44" / null */
export function formatTimecode(clip: ClipRef): string | null {
  if (clip.timecode_start == null) return null;
  if (clip.timecode_end != null && clip.timecode_end !== clip.timecode_start) {
    return `min ${clip.timecode_start}–${clip.timecode_end}`;
  }
  return `min ${clip.timecode_start}`;
}
