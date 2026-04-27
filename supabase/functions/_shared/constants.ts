// ---------------------------------------------------------------------------
// constants.ts — Shared season + context constants for scout edge functions
// Sprint 181: Centralised season management to avoid hardcoded values.
// ---------------------------------------------------------------------------

/** Current active football season for Allsvenskan (Apr-Nov 2026). */
export const CURRENT_SEASON = 2026;

/** Allsvenskan league ID in API-Football. */
export const ALLSVENSKAN_LEAGUE_ID = 113;

/**
 * buildSeasonContext — constructs a season-awareness block for LLM prompts.
 * Detects which seasons appear in profile_data top-level keys and returns
 * a context string + mixed-season warning if multiple seasons are found.
 */
export function buildSeasonContext(profileData: Record<string, unknown> | null | undefined): string {
  // Detect seasons from top-level keys only (VCE09 WARN: avoid value-scanning false positives)
  const seasonKeyPattern = /(?:^|_)(20(?:2[0-9]))(?:_|$)/;
  const detectedSeasons = new Set<string>();

  if (profileData && typeof profileData === 'object') {
    for (const key of Object.keys(profileData)) {
      const match = key.match(seasonKeyPattern);
      if (match) {
        detectedSeasons.add(match[1]);
      }
    }
  }

  const hasMixedSeasons = detectedSeasons.size > 1;
  const seasonList = detectedSeasons.size > 0
    ? Array.from(detectedSeasons).sort().join(', ')
    : 'unknown';

  let block = `\n## Season Context\n` +
    `Current season: ${CURRENT_SEASON} (Allsvenskan ${CURRENT_SEASON} — April to November ${CURRENT_SEASON}).\n` +
    `When evaluating statistics, prioritise data from the ${CURRENT_SEASON} season over historical seasons.\n`;

  if (hasMixedSeasons) {
    block +=
      `\n## MIXED-SEASON DATA WARNING\n` +
      `Profile data spans multiple seasons: ${seasonList}.\n` +
      `Do NOT blend statistics from different seasons into a single narrative. ` +
      `Label each statistic with its season. ` +
      `If a statistic's season is unclear, mark evidence as "season unclear — do not use as primary basis".`;
  } else if (detectedSeasons.size === 1) {
    block += `Data appears to be from season: ${seasonList}.`;
  }

  return block;
}
