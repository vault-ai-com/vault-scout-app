# Changelog

## Sprint 162 — Quality Pipeline Key Rename + INSUFFICIENT_DATA Guard (2026-04-25)
- **`quality_report` → `quality_pipeline`:** Key rename i DB save (line 1273) och HTTP response (line 1293) i scout-analyze-player. Matchar quality-validation.ts `validateAnalysis()` expectations.
- **INSUFFICIENT_DATA guard:** Kastar Error i `mergeAgentResults()` om alla dimension scores = null istället för silent overall_score: 0. Förhindrar meningslösa analyser.
- **Re-throw past fallback:** INSUFFICIENT_DATA propageras förbi single-agent fallback (V64 P1-fix). Analys markeras som failed via `fail_scout_analysis` RPC.
- **V64 GO 4.25/5.** VCE09 WARN (2 issues fixade). C91 GO LOW.

## Sprint 161 — Persistent Rate Limiting (2026-04-25)
- **`scout_rate_limit_store` (NY tabell):** DB-backed sliding window. `check_scout_rate_limit()` RPC med FOR UPDATE-lock. `cleanup_scout_rate_limits()` för stale rows.
- **`_shared/rate-limit.ts` omskriven:** `check()` nu async, tar SupabaseClient. Fail-open vid DB-fel. `RateLimitResult` + `getRateLimitHeaders` oförändrade.
- **9 edge functions migrerade:** Alla scout-fn använder nu persistent rate limiting. Key-format: `{fn_name}:{userId}`. In-memory Map ersatt.
- **V64 GO 16/18.** VCE09 PASS. C91 GO LOW.

## Sprint 160 — Anthropic Model-ID 404 Hardening (2026-04-25)
- **`_shared/anthropic-client.ts` (NY):** Delad Anthropic API-klient. Exporterar `MODELS`, `resolveModel()`, `callAnthropic()`, `getAnthropicHeaders()`, `AnthropicError`.
- **7 edge functions migrerade:** scout-analyze-player, scout-personality-analysis, scout-advisor-review, scout-bosse-chat, scout-report, scout-coach-analyze, scout-coach-personality. Netto -135 rader duplicerad kod.
- **`resolveModel()`:** Strippar datumsuffix (`-20250514`) och validerar mot `MODELS` constant. Förhindrar återupprepning av 404-buggen (root cause: `claude-sonnet-4-6-20250514`).
- **VCE09 3 CRITICAL fixade:** never-throw contract i runSingleAgent, temperature:0 bevarad, anthropicKey i bosse-chat bevarad.
- **V64 GO 4.75/5.** VCE09 WARN (alla 3 CRITICAL + 4 WARN adresserade). C66 GO LOW.

## Sprint 157 — Scout Pipeline Alignment (2026-04-25)
- **phase_gates 3-nivå:** DEFAULT ändrat från 11 faser (inkl .5-sub-faser) till 6 faser (F0-F5). Matchar 3-nivå-arkitekturen.
- **complete_scout_pipeline() SKIP-logik:** Detekterar 3-level pipelines (`? 'F0.5'`). Saknade .5-faser → max score. Legacy-pipelines oförändrade.
- **Orphan fix:** Pipeline 20c48551 (running 13+ dagar, 0 agenter) → cancelled. CHECK constraint utökad med 'cancelled'.
- **link_violations_to_pipeline(uuid, uuid):** Ny RPC kopplar violations till pipeline. SECURITY INVOKER, search_path public.
- **V64 GO 15/18.** VCE09 WARN (W1 SKIP=100 acceptabelt). V50+V53+VET09 alla körda.

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
