import crypto from "crypto";

/**
 * Shared guard for operator cron entrypoints (cart nudges, renewals).
 * Timing-safe shared-secret compare; fail-closed on missing secret.
 * Callers map the reason to a generic 403 without leaking which check failed.
 */
export function verifyCronSecret(given: string, secret = process.env.CRON_SECRET ?? ""): boolean {
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cronAuthReason(req: Request): "ok" | "missing" | "invalid" {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return "missing";
  return verifyCronSecret(req.headers.get("x-cron-secret") ?? "", secret) ? "ok" : "invalid";
}
