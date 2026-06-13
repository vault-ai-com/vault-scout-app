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

/**
 * Sanitize large text payloads (analysis JSON, full prompts).
 * Same injection stripping as sanitizePromptInput but with a higher
 * length cap (20K) for legitimate large payloads.
 */
export function sanitizeLargePayload(text: unknown, maxLen = 20_000): string {
  if (text == null) return "";
  let s = String(text);
  s = s.replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "");
  s = s.replace(/you\s+are\s+(now|actually|really)\s+/gi, "");
  s = s.replace(/system\s*:\s*/gi, "");
  s = s.replace(/\bassistant\s*:\s*/gi, "");
  s = s.replace(/\bhuman\s*:\s*/gi, "");
  s = s.replace(/\buser\s*:\s*/gi, "");
  s = s.replace(/<\/?(?:system|instruction|prompt|role|context|command|override|secret|inject)[^>]*>/gi, "");
  s = s.replace(/(?:do\s+not|don'?t|never)\s+follow\s+(your\s+)?(original|previous|system)\s+/gi, "");
  s = s.replace(/\bDAN\b|\bjailbreak\b|\bprompt\s*inject/gi, "");
  if (s.length > maxLen) s = s.slice(0, maxLen) + "\u2026";
  return s.trim();
}

/**
 * Sanitize a JSONB object/array before injecting into LLM prompts.
 * Recursively walks all string values through sanitizePromptInput().
 * Use instead of raw JSON.stringify(pd.*) for DB-sourced JSONB data.
 */
export function sanitizeJsonForPrompt(data: unknown, indent = 2): string {
  if (data == null) return "";
  return JSON.stringify(sanitizeValue(data), null, indent);
}

function sanitizeValue(val: unknown): unknown {
  if (val == null) return val;
  if (typeof val === "string") return sanitizePromptInput(val);
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return val;
}
