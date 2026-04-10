// ---------------------------------------------------------------------------
// Shared rate limiter — in-memory per isolate (Deno Deploy)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
  limit: number;
}

export function createRateLimiter(
  maxRequests: number,
  windowMs: number = 15 * 60 * 1000
): { check: (key: string) => RateLimitResult } {
  const store = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - windowMs;
      const timestamps = (store.get(key) ?? []).filter(ts => ts > windowStart);

      // Periodic cleanup every 100 entries
      if (store.size > 100) {
        for (const [k, v] of store) {
          const valid = v.filter(ts => ts > windowStart);
          if (valid.length === 0) store.delete(k);
          else store.set(k, valid);
        }
      }

      if (timestamps.length >= maxRequests) {
        const retryAfterMs = timestamps[0] + windowMs - now;
        store.set(key, timestamps);
        return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs), remaining: 0, limit: maxRequests };
      }
      timestamps.push(now);
      store.set(key, timestamps);
      return { allowed: true, retryAfterMs: 0, remaining: maxRequests - timestamps.length, limit: maxRequests };
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
