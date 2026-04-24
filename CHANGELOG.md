# Changelog

## Sprint 151 — Data Completeness Gate + Provenance Schema (2026-04-24)
- **Data Completeness Gate:** Deterministic check blocks EMPTY player analyses before LLM runs (422 response). Saves ~$0.40/analysis on empty profiles.
- **Provenance Schema:** 4 new columns on scout_analyses: input_completeness, provenance_tier, input_snapshot, source_count.
- **Cache filter:** Excludes EMPTY and NULL analyses from cache hits.
- **Quality validation:** Input completeness check integrated into validateAnalysis() with -40 penalty for EMPTY.
- **Backfill:** 131 existing analyses classified (33 EMPTY, 65 MINIMAL, 24 PARTIAL, 9 MINIMAL+TIER_3).

## Hotfix — TIER_0 → TIER_UNKNOWN (2026-04-24)
- **P0 fix:** Changed ProvenanceTier `TIER_0` to `TIER_UNKNOWN` in quality-validation.ts to match DB CHECK constraint. Previous value caused constraint violation → 500 on every analysis with 0 sources.
- **Found by:** 6-phase cluster audit (V64 Blind Critic BLOCK verdict).

## Sprint 152 — Completeness Model Alignment (2026-04-24)
- **SQL function rewrite:** `compute_input_completeness` changed from semantic model (has_stats/has_match_history) to field-count model matching TS. Flat-key profiles (allsvenskan_2025_saves, height_cm) now correctly classified.
- **Tier direction aligned:** SQL tier now ascending (TIER_1=1 source, TIER_3=4+ sources) matching TS.
- **Re-backfill:** 141 rows reclassified. 24 impossible combos (PARTIAL+TIER_3+source_count=0) eliminated. 12 players upgraded MINIMAL→FULL (had 9+ profile keys).
- **Orphaned analyses:** 10 rows with player_id=NULL set to EMPTY/TIER_UNKNOWN.
