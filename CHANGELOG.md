# Changelog

## Sprint 156 — Violations Feedback RPCs (2026-04-24)
- **get_violations_for_analysis(uuid):** Returns all violations for a specific analysis. SECURITY INVOKER, search_path public.
- **get_violations_for_player(uuid):** Returns violations across all analyses for a player (JOIN scout_analyses). SECURITY INVOKER, search_path public.
- **V64 GO.** VCE09 WARN (W1 NULL-guard acceptabelt, W4 resolve_violation utanför scope). V50+V53+VET09 alla körda.

## Sprint 155 — Scout DB Hardening Phase 2 + P0 Fix (2026-04-24)
- **updated_at column:** New `updated_at` timestamptz on scout_analyses with auto-update trigger. Backfilled 141 rows.
- **HALT expansion:** Check 7 (SIGN + >3 dims <5) and Check 8 (uniform dims ±1) added to `complete_scout_analysis` RPC as RAISE EXCEPTION gates. Mirrors quality-validation.ts.
- **DB completeness gate:** EMPTY input_completeness → RAISE EXCEPTION in RPC. VCE09 W2 guard: allows INSUFFICIENT_DATA only if score=0 AND confidence=0.
- **P0 fix:** Edge fn EMPTY+INSUFFICIENT_DATA path (rad 1119) was blocked by original gate. Fixed with score/confidence guard.
- **V64 GO 17/18.** VCE09 WARN (W2 adopterad). V50+V53+VET09 alla körda.

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

## Sprint 153 — Scout DB Integrity Hardening (2026-04-24)
- **DROP duplicate overload:** Removed old `complete_scout_analysis` (without provenance params). 1 overload remains.
- **Quality trigger BLOCK:** `trg_scout_analysis_quality_check` Check 5 (score>8 + confidence<0.5) now RAISE EXCEPTION instead of WARN-only. Guard: only on INSERT or score/confidence change.
- **Backfill:** 59 completed analyses got `completed_at = created_at`. 23 got `agents_used = ARRAY['unknown_backfill']`. 0 completed with NULL completed_at or agents_used.
- **search_path fix:** `batch_update_scout_nivel2` SET search_path = 'public' (was MISSING).
- **Constraint validated:** `chk_analyses_entity_ref` promoted from NOT VALID to VALID.

## Audit Note — vault_scout_report (2026-04-24)
- **Status: ARKIVERAD (korrekt).** Alla 13 agenter markerade `[ARKIVERAD 2026-04-11 — ersatt av vault_player_report]` i purpose. is_active=false är avsiktligt.
- **Ersatt av:** vault_player_report (PR00-PR09, 10 aktiva agenter).
