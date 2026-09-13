import { registerQueueHandlers } from "@/server/processor";
import { startRedisConsumer } from "@/server/queue";
import { config } from "@/lib/env";
import { validateRuntimeConfig } from "@/lib/config-check";
import { logger } from "@/lib/logger";

let done = false;

/**
 * Fail fast on insecure production config. Called on first API request
 * (NOT at build time — `next build` runs with placeholder env).
 */
function assertRuntimeConfig() {
  // Never fail the production BUILD (placeholder env); only live requests.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const issues = validateRuntimeConfig({
    nodeEnv: process.env.NODE_ENV ?? "development",
    jwtSecret: config.jwtSecret,
    databaseUrl: config.databaseUrl,
    appUrl: config.appUrl,
    redisUrl: config.redisUrl,
    llmProvider: config.llm.provider,
    openrouterKey: config.llm.openrouter.apiKey,
    opencodeKey: config.llm.opencode.apiKey,
    legacyLlmKey: config.llm.apiKey,
    whatsappVerifyToken: config.whatsapp.verifyToken,
    whatsappAppSecret: config.whatsapp.appSecret,
    whatsappAccessToken: config.whatsapp.accessToken,
    storageProvider: config.storage.provider,
    s3Endpoint: config.storage.s3.endpoint,
    s3Bucket: config.storage.s3.bucket,
    s3AccessKey: config.storage.s3.accessKey,
    s3SecretKey: config.storage.s3.secretKey,
    sentryDsn: config.sentry.dsn,
    emailProvider: config.email.provider,
    smsWebhookUrl: config.sms.webhookUrl,
    twilioAccountSid: config.sms.twilioAccountSid,
  });
  for (const i of issues.filter((x) => x.level === "warn")) logger.warn(`config: ${i.message}`, { code: i.code });
  const errors = issues.filter((x) => x.level === "error");
  if (errors.length > 0) {
    throw new Error(`Refusing to start: ${errors.map((e) => e.message).join(" ")}`);
  }
}

export function ensureInit() {
  if (!done) {
    done = true;
    assertRuntimeConfig();
    registerQueueHandlers();
    // Redis-backed worker when configured; safe no-op otherwise (and during build).
    // WORKER_ONLY=1 (shared .env, production compose): the dedicated worker
    // drains the queue, so the web process stays HTTP-only.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      if (config.workerOnly) {
        logger.info("queue consumer disabled in web process (WORKER_ONLY=1)", {});
      } else {
        void startRedisConsumer().catch(() => {});
      }
    }
  }
}
