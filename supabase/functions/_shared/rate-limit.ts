// ---------------------------------------------------------------------------
// Shared rate limiter — DB-backed persistent (Supabase scout_rate_limit_store)
// Falls back to allowed:true on DB error (rate limiting is not security-critical)
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
          console.warn("[rate-limit] DB error, failing open:", error?.message ?? "no data");
          return { allowed: true, retryAfterMs: 0, remaining: maxRequests, limit: maxRequests };
        }

        const row = data as { allowed: boolean; retry_after_ms: number; remaining: number; limit: number };
        return {
          allowed: row.allowed,
          retryAfterMs: row.retry_after_ms ?? 0,
          remaining: row.remaining ?? 0,
          limit: row.limit ?? maxRequests,
        };
      } catch (err) {
        console.warn("[rate-limit] Exception, failing open:", err instanceof Error ? err.message : String(err));
        return { allowed: true, retryAfterMs: 0, remaining: maxRequests, limit: maxRequests };
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
