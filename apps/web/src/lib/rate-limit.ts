/** Fixed-window in-memory rate limiter (per process). Behind a proxy use real store; fine for MVP. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1 };
  }
  if (b.count >= max) return { allowed: false, remaining: 0 };
  b.count += 1;
  return { allowed: true, remaining: max - b.count };
}

/**
 * Client identity for rate limiting. X-Forwarded-For is only trusted when a
 * proxy marker (X-Forwarded-Proto) is present — reverse proxies set both —
 * which keeps naive header spoofing from bypassing per-IP budgets.
 * NOTE: in-process fixed window — multi-instance deployments need a shared
 * limiter or gateway/WAF (see docs/DEPLOYMENT.md).
 */
export function clientKey(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto");
  const fwd = req.headers.get("x-forwarded-for");
  if (proto && fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "local";
}

/**
 * Standard per-IP budget for authenticated mutating endpoints (abuse guard
 * for compromised sessions / rogue managers). Returns true when the request
 * may proceed; the caller returns Errors.rateLimited(requestId) otherwise.
 * NOTE: in-process fixed window — multi-instance deployments need a shared
 * limiter or gateway/WAF (see docs/DEPLOYMENT.md).
 */
export function enforceApiLimit(req: Request, max = 120, windowMs = 60_000): boolean {
  return rateLimit(`api:${clientKey(req)}`, max, windowMs).allowed;
}
