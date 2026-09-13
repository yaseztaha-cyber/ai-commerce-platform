import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./config-check";
import { isJwtSecretStrong } from "./env";

const base = {
  nodeEnv: "production",
  jwtSecret: "a-very-long-and-random-production-secret-0123456789",
  databaseUrl: "postgresql://u:p@host:5432/db",
  appUrl: "https://shop.example.com",
  redisUrl: "redis://localhost:6379",
  llmProvider: "composite",
  openrouterKey: "k",
  opencodeKey: "",
  legacyLlmKey: "",
  whatsappVerifyToken: "",
  whatsappAppSecret: "",
  whatsappAccessToken: "",
  storageProvider: "local",
  s3Endpoint: "",
  s3Bucket: "",
  s3AccessKey: "",
  s3SecretKey: "",
  sentryDsn: "",
  emailProvider: "smtp",
  smsWebhookUrl: "https://sms.example.com/hook",
  twilioAccountSid: "",
};

describe("runtime config validation", () => {
  it("accepts a healthy production config", () => {
    expect(validateRuntimeConfig(base)).toEqual([]);
  });

  it("refuses weak JWT in production, warns in dev", () => {
    const errs = validateRuntimeConfig({ ...base, jwtSecret: "change-me" });
    expect(errs.some((e) => e.level === "error" && e.code === "WEAK_JWT_SECRET")).toBe(true);
    const warns = validateRuntimeConfig({ ...base, nodeEnv: "development", jwtSecret: "change-me" });
    expect(warns.some((e) => e.level === "warn" && e.code === "WEAK_JWT_SECRET")).toBe(true);
    expect(warns.some((e) => e.level === "error")).toBe(false);
  });

  it("rejects bad URLs and unknown providers", () => {
    expect(validateRuntimeConfig({ ...base, appUrl: "not a url" }).some((e) => e.code === "INVALID_APP_URL")).toBe(true);
    expect(validateRuntimeConfig({ ...base, databaseUrl: "sqlite://x" }).some((e) => e.code === "INVALID_DATABASE_URL")).toBe(true);
    expect(validateRuntimeConfig({ ...base, llmProvider: "mystery" }).some((e) => e.code === "UNKNOWN_LLM_PROVIDER")).toBe(true);
  });

  it("flags impossible provider config (network provider, no key)", () => {
    const issues = validateRuntimeConfig({ ...base, openrouterKey: "", opencodeKey: "", legacyLlmKey: "" });
    expect(issues.some((e) => e.level === "error" && e.code === "IMPOSSIBLE_PROVIDER_CONFIG")).toBe(true);
  });

  it("warns on http app URL and rulebased in production", () => {
    expect(validateRuntimeConfig({ ...base, appUrl: "http://x.com" }).some((e) => e.code === "INSECURE_APP_URL")).toBe(true);
    expect(validateRuntimeConfig({ ...base, llmProvider: "rulebased" }).some((e) => e.code === "RULEBASED_IN_PROD")).toBe(true);
  });

  it("flags unsigned WhatsApp config", () => {
    const issues = validateRuntimeConfig({ ...base, whatsappAccessToken: "tok" });
    expect(issues.some((e) => e.level === "error" && e.code === "WHATSAPP_UNSIGNED")).toBe(true);
    const ok = validateRuntimeConfig({ ...base, whatsappAccessToken: "tok", whatsappAppSecret: "sec" });
    expect(ok.some((e) => e.code === "WHATSAPP_UNSIGNED")).toBe(false);
  });

  it("known weak defaults are rejected", () => {
    for (const s of ["", "changeme", "change-me-to-64-hex-chars-min-32", "dev-secret-change-me-32chars-minimum!!"]) {
      expect(isJwtSecretStrong(s)).toBe(false);
    }
    expect(isJwtSecretStrong("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("warns on memory queue fallback without redis", () => {
    expect(validateRuntimeConfig({ ...base, redisUrl: "" }).some((e) => e.code === "REDIS_MEMORY_FALLBACK")).toBe(true);
    expect(validateRuntimeConfig(base).some((e) => e.code === "REDIS_MEMORY_FALLBACK")).toBe(false);
  });

  it("rejects unknown storage providers and incomplete s3", () => {
    expect(validateRuntimeConfig({ ...base, storageProvider: "ftp" }).some((e) => e.code === "UNKNOWN_STORAGE_PROVIDER")).toBe(true);
    const incomplete = validateRuntimeConfig({ ...base, storageProvider: "s3" });
    expect(incomplete.some((e) => e.level === "error" && e.code === "STORAGE_S3_INCOMPLETE")).toBe(true);
    const devWarn = validateRuntimeConfig({ ...base, nodeEnv: "development", storageProvider: "s3" });
    expect(devWarn.some((e) => e.level === "warn" && e.code === "STORAGE_S3_INCOMPLETE")).toBe(true);
    expect(devWarn.some((e) => e.level === "error")).toBe(false);
    const complete = validateRuntimeConfig({
      ...base,
      storageProvider: "s3",
      s3Endpoint: "https://abc.r2.cloudflarestorage.com",
      s3Bucket: "imgs",
      s3AccessKey: "ak",
      s3SecretKey: "sk",
    });
    expect(complete.some((e) => e.code === "STORAGE_S3_INCOMPLETE")).toBe(false);
  });

  it("warns on malformed Sentry DSN, accepts empty and valid", () => {
    expect(validateRuntimeConfig({ ...base, sentryDsn: "nope" }).some((e) => e.code === "INVALID_SENTRY_DSN")).toBe(true);
    expect(validateRuntimeConfig({ ...base, sentryDsn: "https://abc123@o99.ingest.sentry.io/456" }).some((e) => e.code === "INVALID_SENTRY_DSN")).toBe(false);
    expect(validateRuntimeConfig(base).some((e) => e.code === "INVALID_SENTRY_DSN")).toBe(false);
  });

  it("warns on log-only email/SMS in production, stays quiet in dev", () => {
    const email = validateRuntimeConfig({ ...base, emailProvider: "log" });
    expect(email.some((e) => e.level === "warn" && e.code === "EMAIL_LOG_IN_PROD")).toBe(true);
    expect(validateRuntimeConfig(base).some((e) => e.code === "EMAIL_LOG_IN_PROD")).toBe(false);
    const sms = validateRuntimeConfig({ ...base, smsWebhookUrl: "" });
    expect(sms.some((e) => e.level === "warn" && e.code === "SMS_LOG_IN_PROD")).toBe(true);
    const smsOk = validateRuntimeConfig({ ...base, smsWebhookUrl: "", twilioAccountSid: "AC123" });
    expect(smsOk.some((e) => e.code === "SMS_LOG_IN_PROD")).toBe(false);
    const dev = validateRuntimeConfig({ ...base, nodeEnv: "development", emailProvider: "log", smsWebhookUrl: "" });
    expect(dev.some((e) => e.code === "EMAIL_LOG_IN_PROD" || e.code === "SMS_LOG_IN_PROD")).toBe(false);
  });
});
