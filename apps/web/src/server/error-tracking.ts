import { config } from "@/lib/env";

/**
 * Optional error tracking (Sentry-compatible, no SDK dependency).
 * Unconfigured or malformed DSN = log tracker (errors stay in structured
 * logs). Server-only: never import from client components, and capture is
 * a no-op in the browser so the DSN can never leak into the bundle.
 * Sending is fire-and-forget with a tight timeout; it never throws and
 * never delays the request path. No console import of the app logger here
 * (logger forwards into this module — keep the edge one-directional).
 */

export interface ErrorTracker {
  readonly name: string;
  capture(err: unknown, context: Record<string, unknown>): Promise<void>;
}

export interface SentryDsn {
  protocol: string;
  host: string;
  projectId: string;
  publicKey: string;
}

export function parseSentryDsn(dsn: string): SentryDsn | null {
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(\d+)\/?$/.exec(dsn.trim());
  if (!m) return null;
  return { protocol: m[1], host: m[3], projectId: m[4], publicKey: m[2] };
}

function errorShape(err: unknown): { type: string; value: string } {
  if (err instanceof Error) return { type: err.name || "Error", value: String(err.message || err).slice(0, 2000) };
  return { type: typeof err, value: String(err).slice(0, 2000) };
}

const REDACT = [/password/i, /secret/i, /token/i, /authorization/i, /card/i, /cvv/i, /dsn/i];

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (REDACT.some((re) => re.test(k))) out[k] = "[redacted]";
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) out[k] = v;
  }
  return out;
}

export function sentryEnvelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`;
}

class LogErrorTracker implements ErrorTracker {
  readonly name = "log";
  async capture(): Promise<void> {}
}

export class SentryErrorTracker implements ErrorTracker {
  readonly name = "sentry";
  constructor(
    private dsn: SentryDsn,
    private environment: string
  ) {}

  async capture(err: unknown, context: Record<string, unknown>): Promise<void> {
    const eventId = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const shape = errorShape(err);
    const payload = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      logger: "yasez",
      environment: this.environment,
      exception: { values: [{ type: shape.type, value: shape.value }] },
      extra: sanitizeContext(context),
    };
    const body = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) + "\n" + JSON.stringify({ type: "event" }) + "\n" + JSON.stringify(payload);
    const res = await fetch(sentryEnvelopeUrl(this.dsn), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Sentry ${res.status}`);
  }
}

let cached: ErrorTracker | null = null;

export function errorTracker(): ErrorTracker {
  if (!cached) {
    const dsn = parseSentryDsn(config.sentry.dsn);
    cached = dsn ? new SentryErrorTracker(dsn, config.sentry.environment) : new LogErrorTracker();
  }
  return cached;
}

/** Test hook: drop the cached tracker so config changes take effect. */
export function resetErrorTrackerForTest(): void {
  cached = null;
}

/** Fire-and-forget; safe to call from hot paths (never throws, browser no-op). */
export function captureError(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  try {
    if (typeof window !== "undefined") return Promise.resolve();
    return errorTracker()
      .capture(err, context)
      .catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
