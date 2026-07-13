/**
 * Simple in-memory rate limiter (per server instance).
 * Good enough for SIT on Vercel cold starts; not a global distributed limiter.
 * Rollback: stop importing checkRateLimit.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= opts.limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  b.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/** Best-effort client IP from request headers (Vercel / proxies). */
export function clientIpFromHeaders(h: Headers | { get(name: string): string | null }): string {
  const xf = h.get("x-forwarded-for") || h.get("x-real-ip") || "";
  const first = xf.split(",")[0]?.trim();
  return first || "unknown";
}
