const REDACT = [/password/i, /secret/i, /token/i, /authorization/i, /card/i, /cvv/i, /key/i];
// Payment-card numbers that sneak in as bare values under non-secret keys
// (e.g. a raw webhook body). 13-19 digits matches all major PAN formats.
const PAN_PATTERN = /\b\d{13,19}\b/g;

export type LogFields = Record<string, unknown> & {
  requestId?: string;
  tenantId?: string;
  conversationId?: string;
  customerId?: string;
  orderId?: string;
  messageId?: string;
  aiRunId?: string;
};

export function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT.some((re) => re.test(k))) out[k] = "[redacted]";
    else out[k] = typeof v === "string" ? v.replace(PAN_PATTERN, "[redacted]") : v;
  }
  return out;
}

function emit(level: string, msg: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...sanitize(fields),
  });
  if (level === "error") {
    console.error(line);
    // Forward server errors to the configured tracker (Sentry when set).
    // Fire-and-forget, browser no-op, never throws — logging must not fail.
    try {
      if (typeof window === "undefined") {
        void import("@/server/error-tracking").then((m) => m.captureError(new Error(msg), fields)).catch(() => {});
      }
    } catch {
      /* logging must not fail */
    }
  } else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
