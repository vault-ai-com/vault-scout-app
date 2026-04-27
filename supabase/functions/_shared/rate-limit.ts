// ---------------------------------------------------------------------------
// Shared rate limiter — DB-backed persistent (Supabase scout_rate_limit_store)
// P1-1 fix: Fails CLOSED on DB error (blocks requests when DB unavailable)
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
  limit: number;
}

export function createRateLimiter(
  maxRequests: number,
  windowMs: number = 15 * 60 * 1000
): { check: (key: string, sb: SupabaseClient) => Promise<RateLimitResult> } {
  return {
    async check(key: string, sb: SupabaseClient): Promise<RateLimitResult> {
      try {
        const { data, error } = await sb.rpc("check_scout_rate_limit", {
          p_key: key,
          p_max_requests: maxRequests,
          p_window_ms: windowMs,
        });

        if (error || !data) {
          console.error("[rate-limit] DB error, failing closed:", error?.message ?? "no data");
          return { allowed: false, retryAfterMs: 60_000, remaining: 0, limit: maxRequests };
        }

        const row = data as { allowed: boolean; retry_after_ms: number; remaining: number; limit: number };
        return {
          allowed: row.allowed,
          retryAfterMs: row.retry_after_ms ?? 0,
          remaining: row.remaining ?? 0,
          limit: row.limit ?? maxRequests,
        };
      } catch (err) {
        console.error("[rate-limit] Exception, failing closed:", err instanceof Error ? err.message : String(err));
        return { allowed: false, retryAfterMs: 60_000, remaining: 0, limit: maxRequests };
      }
    },
  };
}

export function getRateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rl.retryAfterMs / 1000)),
  };
}
