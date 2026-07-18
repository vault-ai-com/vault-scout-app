# Changelog

## Sprint 219 — Världsklass-lyft: färgsystem + Comparison + Zod-härdning (2026-07-18)
- **Färgsystem enhetliggjort:** migrerade hårdkodat `emerald/amber/red` → semantiska designtokens (`text-success`/`warning`/`destructive`) i 6 komponenter (AdvisorReviewPanel, DimensionChart, PersonalityPanel, CoachCard, CoachAnalysisPanel, CoachPersonalityPanel) + delade konstanter `VERDICT_COLORS`/`RECOMMENDATION_COLORS` i types/scout.ts. Röd → `--destructive` (dual-theme-tunat) ej föräldralösa `--danger`. VCE09-prosecutor fångade att migreringen läckte via delade konstanter — remedierat.
- **Kategoriska paletter medvetet kvar:** `ARCHETYPE_COLORS`/`TIER_COLORS`/`COACH_ARCHETYPE_COLORS` är multi-hue identitetsfärger (nominella, ej status-semantiska) → kommenterade som separat concern. C94 Brad Frost bekräftade beslutet (att tvinga dem på status-tokens = kategorifel).
- **Comparison-sidan → dossier-paritet:** omskriven 400→270 rader + 4 nya filer. `use-comparison-slots` (fixed-arity `useGetPlayer`×3/`usePlayerLatestAnalysis`×3 → Rules-of-Hooks-säker), `ComparisonSlots` (1-3 platser + lägg-till-CTA + X på ej-laddad plats = ingen dead-end), `ComparisonMatrix` (StatGrid-stil grupperad, bäst-i-grupp via `--success`, delta-chips, fel≠tomt via ErrorBanner), `ComparisonVerdictBar` (overall-mini-bars + gold vinnar-badge). Breadcrumb + SectionShell (delad m PlayerDetail).
- **Fail-closed Zod-härdning:** `use-player-latest-analysis` fick `safeParse`-med-throw + explicita kolumner (as-cast borttaget), 4 hooks payload-narrowing (`select("*")` → explicita kolumner), `chat.ts`/`scout.ts` nullability mot live-DB. VQA04 fastställde 9/10 kontrakt redan Zod-validerade.
- **18 filer, +1024/−443.** tsc 0/vite 0 (byggt ~11s). Touch-target-fix: Comparison remove-X 36→44px.
- **Gates:** V61 0 fel, VCE09 GO (fångade färgläcka), V64 Blind Critic 8.29/10 (22/23), VCE01 dataflöde 10/10 intakt, VQA03 designtokens 100%, VFE04 UX-gate GO (efter dead-end/error-masking-fix). Advisor C94 Brad Frost GO/LOW. Pipeline 1906064b.
- **Fast-follow:** promota kategoriska paletter till token-scale `--cat-1..8` (Brad Frost-rek); separat dep-uppgraderingssprint (vitest/vite dev-vulns).

## Sprint 218 — App-wide editorial-token migrering (2026-07-17)
- **`glass-premium` → `card-editorial`:** Migrerade kvarvarande legacy-kort till editorial-systemet i 7 filer (CoachCard, PlayerCard, CoachAnalysisPanel, CoachPersonalityPanel, AppLayout-skeleton, Comparison, Players watchlist-header). `card-editorial` ger egen radie + guld-hårlinje (::before) — släppte redundant `gradient-accent-top`.
- **`section-tag` → `eyebrow`:** Designsystemets föredragna etikett. `icon-premium` behållet (current token, matchar Dashboard/Opponents — ej legacy). Semantiska `card-accent-left-green/red/gold`-kanter bevarade.
- **Arkitektur:** Comparison INTE tvingat in i SearchScaffold — det är ett jämförelseverktyg (spelarkolumner + dimensionstabell + spara), inte en sökyta. Fel abstraktion, medvetet avstått.
- **V64-fix:** CoachPersonalityPanel tappade nu-redundant Brain-ikon så eyebrow-guld-dashen blir enda ledande markör (matchar kanoniskt idiom).
- **Ren className-migrering, noll funktionsändring** (28/31 rader). Kvarvarande dead-CSS `.glass-premium`/`.section-tag`-defs i index.css → separat städsprint.
- **Gates:** V61 tsc 0/vite 0. V64 Blind Critic WARN→löst 8.4/10 (21/23 premium, 100% pattern-coverage, 0 blockers). Pipeline 3399b718.

## Sprint 217 — Delade scaffolds: SearchScaffold + DossierScaffold (2026-07-17)
- **`SearchScaffold`:** Extraherade en config-driven, delad sök/filter/AI-discover-yta ur ~90% dubblerad markup i Players + Coaches. Datakälla ägs per sida via render-hook (`config.useResults`) → rules-of-hooks-säkert, varje sida behåller sin egen RPC/edge-fn-källa. Coaches 136→53 rader.
- **`DossierScaffold`:** Delat dossier-skal (breadcrumb → hero → scroll-spy secnav → sektioner) ovanpå befintliga `report/`-primitiver med noll ändringar där. Hero via ReactNode-slot, sektionsinnehåll via `(spy) => children` render-prop. CoachDetail migrerad.
- **Players watchlist-läge bevarat verbatim.** Editorial-klasser (eyebrow/card-editorial) ersatte legacy inom migrerade ytor.
- **Net −417/+215 rader på sidorna.** tsc 0, vite build 0.
- **Gates:** V61 tsc 0/vite 0. V64 Blind Critic GO 8.57/10 (21/23 premium, 0 blockers, 0 any/dead-code, rules-of-hooks verifierat). Pipeline 69710bba.

## Sprint 216 — Delade primitiver + auth-yta (2026-07-17)
- **Delat komponentbibliotek:** extraherade `EmptyState` (message/onboarding-varianter) + `Skeleton` (composable SkeletonLine/Hero/SecNav/Card + PageSkeleton) ur dubblerad inline-markup i PlayerDetail/Opponents/MatchReport — en källa, byte-identisk output (0 visuell regression, JIT-grid-literaler bevarade). `PlayerHero` exporterar nu `ScoreDial`/`FactItem`/`LabeledPill` för S3-återanvändning.
- **Auth-yta till editorial:** `Login` + `TenantSwitcher` restylade till design-systemet (rounded-sm, card-editorial, bg-accent-token; inline gradient/hsl-stilar bort). Glow-blobbar behållna.
- **Stale-JWT re-auth:** `TenantProvider.hasStaleTenantClaim` (authReady && hasSession && tenant_id saknas) + `AppLayout` re-auth-interstitial — inloggad-utan-tenant ger tydlig "logga in igen" istället för tom app/evig spinner. Gated på authReady (ingen falsk-positiv under laddning), hooks-regel-kompatibel.
- **YAGNI-disciplin:** DossierScaffold/SearchScaffold uppskjutna till S3 (extraheras vid faktisk 2:a konsument, ej spekulativt).
- **Gates:** VCE09 GO, V61 tsc 0/vite grön, V64 Blind Critic 8.5/10, C94 Frost GO(LOW). Pipeline c9cc443b.
- **Fast-follow:** differentierad "kontakta admin"-copy för genuint tenant-lösa konton; cn()-helper vid 3:e primitiv.

## Sprint 215 — Säkerhet + backend-kontrakt: IP-läcka, C79, provenance (2026-07-17)
- **IP-läcka stängd (LLM07):** Raderade `src/pages/ScoutAgents.tsx` (renderade agent_id/kluster/llm_model), samt transitivt döda `AnalysisPanel.tsx` + `lib/format-content.tsx`. `ClipDrawer.tsx` "Wyscout-bank" → "videobank" (kundvänd källneutralitet). `index.css` källkommentar borttagen. Grep-verifierat: 0 kundvända datakälle-/arkitektur-strängar i `src/`.
- **C79 tenant-härdning:** `get_scout_tenant_id()` läser BARA `app_metadata` (borttagen client-forgeable top-level jwt-claim) + regression-assertion. BEFORE INS/UPD-triggers härleder `tenant_id` DB-sidigt på `scout_scores` (via `analysis_id`) + `scout_chat_messages` (via `session_id`) — stänger gapet att `service_role` bypassar RLS.
- **Chatt-säkerhet:** `scout-bosse-chat` — cluster-allowlist på `agent_id` (förhindrar att godtyckliga agent_id laddar system_prompt från M&A/KYC/build) + `redactSensitive()` live på SSE-strömmen (carry-buffert HOLD=48, ingen split-läcka) OCH på persisterat svar.
- **Provenance-datakontrakt:** enum `scout_provenance_tier` (MATT/FILM/TOLK/KLIPP) + tabell `scout_claims` + tenant-scopad RLS + derive-trigger. Vitlistade fail-closed RPC:er `search_scout_entities` / `compare_scout_players` (SECURITY DEFINER, GRANT authenticated, REVOKE anon) + vy `v_scout_coach_public` (security_invoker).
- **Isolation intakt:** IFK 117/117 spelare har `tenant_id` (0 NULL). RPC:er dubbelt fail-closed (ingen anon-EXECUTE + NULL-tenant-filter).
- **Migrationer:** `scout_tenant_claim_hardening` + `scout_claims_provenance` + `scout_public_read_rpcs` (repo-filer matchar applicerad DB).
- **VCE09 GO** (blockade först på migration-drift + live-stream-redaction-gap — båda fixade). **V61 tsc 0/vite grön. V64 Blind Critic GO 8.5/10. V65 Migration Guardian GO. C79 Miessler GO(MEDIUM).**
- **Fast-follow:** `ao@isp-sport.se` saknar scout `app_metadata.tenant_id` (fail-closed → 0 rader); runtime SSE-test; redaction-denylist som test-vaktad artefakt.

## Sprint 213 — P0 RLS-fix: passthrough SELECT-policyer (2026-07-17)
- **P0 säkerhet (DBH-audit 2026-06-08):** Tre passthrough SELECT-policyer med `qual=true` gav cross-tenant läsning. Droppade: `hooks_read_scout_pipelines` (anon) + `pipelines_select_authenticated` (authenticated) på `scout_analysis_pipelines`; `violations_select_authenticated` (authenticated) på `scout_analysis_violations`.
- **Behållna:** `pipelines_all_service_role` + `violations_all_service_role` (service_role ALL). RLS förblir enabled → default-deny för anon/authenticated.
- **Åtkomst opåverkad:** Alla scout-enforcement-RPC:er är SECURITY DEFINER (immuna mot RLS). 0 klientkonsumenter över alla 5 repon (verifierat).
- **Känd regression (accepterad):** `session-end-unpushed.py` läste `scout_analysis_pipelines` via anon → fail-openar nu (ingen krash), tappar scout-unpushed-varning. P1 loggad: migrera hooken till SECURITY DEFINER-RPC.
- **Least-privilege-härdning (V64 P2):** `REVOKE ALL ... FROM authenticated` på båda tabellerna — tog bort oanvända Supabase-default table-grants. Tabellerna är nu låsta till `service_role` + SECURITY DEFINER-RPC:er (RLS + grants i samklang, inte RLS som enda spärr).
- **Migrationer:** `sprint213_scout_rls_drop_passthrough_select_policies` + `sprint213_scout_rls_revoke_authenticated_table_grants`. Reversibla via `CREATE POLICY` / `GRANT`.
- **VCE09 ACQUITTED/GO** (24 tool calls, 5 attacker). **V64 GO 9.33/10.** **V65 Migration Guardian GO** (0 nya issues). **C91 Kerstiens GO LOW.**

## Sprint 211 — Football Coaches Data Quality (2026-06-13)
- **`is_active` lifecycle:** Deactivate-then-upsert pattern i `syncCoaches()` — coaches som API-Football inte längre returnerar markeras automatiskt inaktiva.
- **3 nya kolumner på `football_coaches`:** `is_active` (boolean), `last_confirmed_at` (timestamptz), `role` (text). Index på `(current_team_id, is_active)`.
- **Bridge-fix:** `sync_football_coaches_to_scout()` filtrerar nu på `is_active = true` — inaktiva coaches propageras INTE till `scout_coaches`.
- **IFK Göteborg cleanup:** 3 stale coaches (Nilsson, Tjelmeland, Westerberg) markerade inaktiva. Billborn bevarad som aktiv huvudtränare.
- **V64 GO 8.3/10.** VCE09 PASS (bridge-fix identifierad). C66 GO LOW.

## Sprint 209 — Scout DB Enforcement Hardening (2026-06-07)
- **`enforce_match_prediction_gates()` GATE 4:** array_position ordering — MP10 måste köra FÖRE MP09. INSERT bypass fixat med ny INSERT-trigger.
- **`complete_scout_analysis()` RPC:** Auto-extraherar quality_gate/quality_flag från analysis_data->quality_pipeline->gate.
- **`trg_auto_extract_quality` (NY trigger):** BEFORE INSERT OR UPDATE på scout_analyses — edge functions som gör direkt INSERT (scout-personality-analysis) får nu quality_flag automatiskt.
- **`trg_validate_coaching_learnings` (NY trigger):** Validerar source_type enum (API/TACTICAL/PREDICTION/PSYCHOLOGICAL) + confidence 0-0.85 ceiling på match_coaching_learnings.
- **`scout_analyses.quality_flag`:** DEFAULT satt till 'unverified' (backfill 60 rader).
- **MP09 NO-GO LOCK:** gate_mp09 BLOCK + pipeline status='completed' → EXCEPTION.
- **Dead code:** match-prediction-validation.ts borttagen (0 imports, 561 rader).
- **V64 GO 8.0/10.** VCE09 WARN (3/4 addressed). C66 GO LOW.

## Sprint 194 — Scout Data Infrastructure: Team Mapping + Match RPC (2026-05-04)
- **`football_team_mapping` (NY tabell):** 16 Allsvenskan-lag med verifierade API-Football IDs. Deterministisk name resolution ersätter fuzzy matching. RLS aktiverad.
- **`get_match_football_data()` (NY RPC):** 9-lager JSON (fixture, lineups, events, statistics, xg, player_stats, injuries, derived, context, player_progression). Mapping-table lookup + Swedish char normalization fallback. Coverage warnings med anti-hallucination ("FABRICERA ALDRIG").
- **constants.ts:** SUPERETTAN_LEAGUE_ID=570, SWEDISH_LEAGUE_IDS array. Advisory Board rekommendation.
- **Backfill:** 6 scout_players mappade till football_players (DIF: Hegland/Manojlovic/Zugelj, IFK: Mucolli/Thordarson/Fenger).
- **Säkerhet:** SECURITY DEFINER + SET search_path, anon EXECUTE revokad, RLS + policies.
- **V64 GO 7.8/10.** VCE09 GO (ACQUITTED). V65 GO (efter RLS-fix).

## Sprint 188 — Integrera football_player_stats i scout-pipeline (2026-04-27)
- **`get_player_football_stats()` (RPC uppgraderad):** 3-stegs namnmatchning: exact match först, unaccent fallback med COUNT(DISTINCT player_name)=1 ambiguity guard (VCE09 CRITICAL fix), NULL/tom input guard. Förhindrar cross-player datakontaminering vid svenska tecken (å/ä/ö).
- **Batch-match scout_players→football_players:** 3 nya matchningar via unaccent(lower(trim(name))) med HAVING COUNT(*)=1. 56→59 scout_players med api_player_id.
- **Auth:** LEGACY_SERVICE_ROLE_KEY satt — terminal→edge fn 401 fixat. auth.ts stödjer redan dubbelnyckel (sb_secret_ + legacy JWT).
- **xG:** 40/55 Allsvenskan-matcher har xG. Externa källor saknar data för resterande 15.
- **V64 GO 8.0/10.** VCE09 WARN (ambiguity CRITICAL → fixat). C66 GO LOW.

## Sprint 183 — Scout Report Quality Gate System (2026-04-27)
- **`scout_report_routing_rules` (NY tabell):** 7 report_type → cluster routing-regler. Enforcar att terminalen använder rätt rapport-kluster (vault_player_report, vault_team_report, etc.) istället för inline HTML. `get_report_cluster_routing()` RPC med fallback till adhoc_report.
- **`vault_report_quality_gate` (NYTT kluster, 3 agenter):** qg01_data_renderer (Sonnet), qg02_tripwire (Haiku, deterministisk), qg03_blind_critic (Opus). För ad-hoc rapporter utan eget kluster. Pipeline requirements i `scout_pipeline_agent_requirements`.
- **`scout_report_quality_audit` (NY tabell):** Audit trail för quality chain (tripwire + blind critic). `quality_chain_complete` GENERATED column. `check_report_quality_chain()` RPC med A/B/C/F compliance grading. `log_quality_chain_step()` UPSERT RPC.
- **`ha04_rule_compliance_auditor`:** System_prompt utökat med SCOUT RAPPORT COMPLIANCE sektion. Anropar `check_report_quality_chain()` vid audit. Grade F = AUTO-HALT.
- **RLS:** Enabled på båda nya tabeller med authenticated SELECT + service_role CRUD policies.
- **11 migrationer totalt** (9 sprint + 2 fixes: RLS + tripwire WARN constraint).
- **V64 GO 8.6/10.** VCE09 ACQUITTED (5 attacker). VET09 12/12 VERIFIED. V65 WARN→fixad. C91 GO LOW.

## Sprint 182 — Utöka buildSeasonContext till alla scout edge functions (2026-04-27)
- **`scout-personality-analysis/index.ts`:** Injicerar `checkInputCompleteness()` + `buildInputCompletenessWarning()` + `buildSeasonContext()` i LLM-prompt. Samma mönster som scout-analyze-player.
- **`scout-coach-analyze/index.ts`:** Samma injection. Coach CDIM-analys får nu input completeness warnings + season context.
- **`scout-coach-personality/index.ts`:** Samma injection. Coach BPA får nu input completeness warnings + season context.
- **Netto:** 3 filer, +33 rader, -3 rader. Alla 6 scout edge fn med LLM-prompts nu konsistenta.
- **V64 GO 4.8/5.** VCE09 PASS (8 attacker ACQUITTED). C66 GO LOW.

## Sprint 181 — Input Completeness Warnings + Season Context (2026-04-27)
- **`_shared/constants.ts` (NY):** Centraliserar `CURRENT_SEASON` (2026) + `ALLSVENSKAN_LEAGUE_ID` (113). `buildSeasonContext()` detekterar mixed-season data i top-level profile keys och varnar LLM.
- **`buildInputCompletenessWarning()` (NY i quality-validation.ts):** Genererar LLM-prompt-varningar vid MINIMAL (score low, confidence 0.1-0.3) och PARTIAL (confidence 0.3-0.6) input data. EMPTY blockeras redan upstream.
- **`scout-analyze-player/index.ts`:** Injicerar completeness- och season-varningar i alla LLM-prompts (multi-agent + fallback). Beräknas en gång i main handler.
- **`football-data-sync/index.ts`:** Lokala consts ersatta med import från `_shared/constants.ts`.
- **V64 GO 7.9/10.** VCE09 PASS (P0: regex begränsad till top-level keys). C66 GO LOW.

## Sprint 164 — quality_pipeline Rename + K2/K3 Fixar (2026-04-25)
- **`quality_report` → `quality_pipeline`:** Rename i scout-personality-analysis, scout-coach-analyze, scout-coach-personality. Alla 6 edge fn nu konsistenta.
- **K2 temporal threshold:** log_scout_pipeline_agent() threshold höjd 3.0x → 5.0x. Minskar false positives för sekventiella Opus-agenter. RAISE EXCEPTION behålls.
- **K3 analysis_type NULL guard:** start_scout_pipeline_phase() kastar RAISE EXCEPTION vid NULL analysis_type istället för tyst COALESCE till full_scout.
- **V64 GO 16/18.** VCE09 WARN (cache-asymmetri accepterad). C91 GO LOW.

## Sprint 163 — Scout Pipeline Enforcement (2026-04-25)
- **`complete_scout_pipeline()` ENFORCEMENT BLOCK:** RAISE EXCEPTION om required agents saknas vs logged_agents. DISTINCT unnest hanterar dubbletter i required_agents.
- **`start_scout_pipeline_phase()` (NY RPC):** Fas-gate enforcement. Blockerar bakåtrörelse + hopp >2 steg. Kollar required agents per analysis_type (JOIN scout_analyses).
- **`log_scout_pipeline_agent()` UTÖKAD:** 3 nya params (duration_ms, llm_model, tool_use_count). Temporal sanity check (>3x ratio = EXCEPTION). LLM model soft warning vid mismatch.
- **V64 K1 fix:** Gamla overloaden (utan temporal/LLM enforcement) droppad. Alla anropare tvingas till nya signaturen.
- **V64 WARN 14/18.** VCE09 WARN (4 findings fixade). V65 GO. C91 GO LOW.

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
