# Changelog

## Sprint 151 — Data Completeness Gate + Provenance Schema (2026-04-24)
- **Data Completeness Gate:** Deterministic check blocks EMPTY player analyses before LLM runs (422 response). Saves ~$0.40/analysis on empty profiles.
- **Provenance Schema:** 4 new columns on scout_analyses: input_completeness, provenance_tier, input_snapshot, source_count.
- **Cache filter:** Excludes EMPTY and NULL analyses from cache hits.
- **Quality validation:** Input completeness check integrated into validateAnalysis() with -40 penalty for EMPTY.
- **Backfill:** 131 existing analyses classified (33 EMPTY, 65 MINIMAL, 24 PARTIAL, 9 MINIMAL+TIER_3).
