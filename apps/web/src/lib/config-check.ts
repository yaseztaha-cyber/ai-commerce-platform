import { isJwtSecretStrong } from "./env";

export interface RuntimeConfigInput {
  nodeEnv: string;
  jwtSecret: string;
  databaseUrl: string;
  appUrl: string;
  redisUrl: string;
  llmProvider: string;
  openrouterKey: string;
  opencodeKey: string;
  legacyLlmKey: string;
  whatsappVerifyToken: string;
  whatsappAppSecret: string;
  whatsappAccessToken: string;
  storageProvider: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  sentryDsn: string;
  emailProvider: string;
  smsWebhookUrl: string;
  twilioAccountSid: string;
}

export interface ConfigIssue {
  level: "error" | "warn";
  code: string;
  message: string;
}

/**
 * Pure production-readiness validation (unit-testable; no process access).
 * Production REFUSES to boot on errors; development only warns.
 */
export function validateRuntimeConfig(c: RuntimeConfigInput): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const prod = c.nodeEnv === "production";

  if (!isJwtSecretStrong(c.jwtSecret)) {
    issues.push({
      level: prod ? "error" : "warn",
      code: "WEAK_JWT_SECRET",
      message: "JWT_SECRET is missing or a weak default (must be ≥32 chars, non-default).",
    });
  }
  if (!c.databaseUrl) {
    issues.push({ level: prod ? "error" : "warn", code: "MISSING_DATABASE_URL", message: "DATABASE_URL is not set." });
  } else if (!/^postgres(ql)?:\/\//.test(c.databaseUrl)) {
    issues.push({ level: "error", code: "INVALID_DATABASE_URL", message: "DATABASE_URL must be a postgres:// URL." });
  }
  try {
    const u = new URL(c.appUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
    if (prod && u.protocol !== "https:") {
      issues.push({ level: "warn", code: "INSECURE_APP_URL", message: "NEXT_PUBLIC_APP_URL is not https in production (cookies lose Secure)." });
    }
  } catch {
    issues.push({ level: "error", code: "INVALID_APP_URL", message: "NEXT_PUBLIC_APP_URL is not a valid URL." });
  }

  const knownProviders = new Set(["rulebased", "openrouter", "opencode", "composite", "openai"]);
  if (!knownProviders.has(c.llmProvider)) {
    issues.push({ level: "error", code: "UNKNOWN_LLM_PROVIDER", message: `LLM_PROVIDER '${c.llmProvider}' is unknown.` });
  }
  const wantsNetwork =
    c.llmProvider === "openrouter" || c.llmProvider === "opencode" || c.llmProvider === "composite" || c.llmProvider === "openai";
  const hasAnyKey = Boolean(c.openrouterKey || c.opencodeKey || c.legacyLlmKey);
  if (wantsNetwork && !hasAnyKey) {
    issues.push({
      level: prod ? "error" : "warn",
      code: "IMPOSSIBLE_PROVIDER_CONFIG",
      message: `LLM_PROVIDER='${c.llmProvider}' but no provider key (OPENROUTER_API_KEY/OPENCODE_API_KEY/LLM_API_KEY) is set.`,
    });
  }
  if (c.llmProvider === "rulebased" && prod) {
    issues.push({ level: "warn", code: "RULEBASED_IN_PROD", message: "Running the deterministic engine in production (safe but degraded AI)." });
  }
  // WhatsApp half-configuration: a sender without signature verification
  // accepts forged webhooks (the route refuses to serve in prod, but flag it).
  const waAny = Boolean(c.whatsappVerifyToken || c.whatsappAppSecret || c.whatsappAccessToken);
  if (waAny && !c.whatsappAppSecret) {
    issues.push({
      level: prod ? "error" : "warn",
      code: "WHATSAPP_UNSIGNED",
      message: "WhatsApp is partially configured without WHATSAPP_APP_SECRET — signatures cannot be verified.",
    });
  }
  if (!c.redisUrl) {
    issues.push({
      level: "warn",
      code: "REDIS_MEMORY_FALLBACK",
      message: "REDIS_URL is not set — in-process queue (single-instance only; use Redis + a dedicated worker in production).",
    });
  }
  if (c.storageProvider !== "local" && c.storageProvider !== "s3") {
    issues.push({ level: "error", code: "UNKNOWN_STORAGE_PROVIDER", message: `STORAGE_PROVIDER '${c.storageProvider}' is unknown (local|s3).` });
  } else if (c.storageProvider === "s3" && (!c.s3Endpoint || !c.s3Bucket || !c.s3AccessKey || !c.s3SecretKey)) {
    issues.push({
      level: prod ? "error" : "warn",
      code: "STORAGE_S3_INCOMPLETE",
      message: "STORAGE_PROVIDER='s3' but S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are incomplete — uploads fall back to local disk.",
    });
  }
  if (c.sentryDsn && !/^(https?):\/\/[^@/]+@[^/]+\/\d+\/?$/.test(c.sentryDsn.trim())) {
    issues.push({ level: "warn", code: "INVALID_SENTRY_DSN", message: "SENTRY_DSN is malformed (expected https://key@host/projectid) — errors stay in logs only." });
  }
  // Password resets are emailed: with the log driver, users cannot recover
  // accounts. OTP verification codes are SMSed: without a gateway they only
  // print to the console. Warn loudly in prod instead of failing closed —
  // single-tenant launches may intentionally run without them.
  if (prod && c.emailProvider !== "smtp" && c.emailProvider !== "resend") {
    issues.push({
      level: "warn",
      code: "EMAIL_LOG_IN_PROD",
      message: `EMAIL_PROVIDER='${c.emailProvider || "log"}' in production — password-reset emails only print to the console; users cannot recover accounts.`,
    });
  }
  if (prod && !c.smsWebhookUrl && !c.twilioAccountSid) {
    issues.push({
      level: "warn",
      code: "SMS_LOG_IN_PROD",
      message: "No SMS gateway configured (SMS_WEBHOOK_URL/TWILIO_ACCOUNT_SID) — order verification codes only print to the console.",
    });
  }
  return issues;
}
