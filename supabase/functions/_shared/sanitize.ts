// ---------------------------------------------------------------------------
// P0-2 Shared input sanitization — strip prompt injection patterns from
// DB-sourced data BEFORE injecting into LLM prompts.
// Extracted from scout-report/index.ts (was inline-only).
// ---------------------------------------------------------------------------

/**
 * Sanitize text before injecting into LLM prompts.
 * Strips common prompt injection patterns and limits length.
 * Apply to ALL external/DB-sourced data: player names, club names,
 * notes, profile_data, etc.
 */
export function sanitizePromptInput(text: unknown): string {
  if (text == null) return "";
  let s = String(text);
  // Strip common prompt injection patterns
  s = s.replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "");
  s = s.replace(/you\s+are\s+(now|actually|really)\s+/gi, "");
  s = s.replace(/system\s*:\s*/gi, "");
  s = s.replace(/\bassistant\s*:\s*/gi, "");
  s = s.replace(/\bhuman\s*:\s*/gi, "");
  s = s.replace(/\buser\s*:\s*/gi, "");
  s = s.replace(/<\/?(?:system|instruction|prompt|role|context|command|override|secret|inject)[^>]*>/gi, "");
  s = s.replace(/(?:do\s+not|don'?t|never)\s+follow\s+(your\s+)?(original|previous|system)\s+/gi, "");
  s = s.replace(/\bDAN\b|\bjailbreak\b|\bprompt\s*inject/gi, "");
  // Limit length per field to prevent context stuffing
  if (s.length > 2000) s = s.slice(0, 2000) + "\u2026";
  return s.trim();
}
