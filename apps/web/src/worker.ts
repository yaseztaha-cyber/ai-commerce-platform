/**
 * Standalone worker process: drains the Redis job queue without serving HTTP.
 * Run: npm run worker --workspace=apps/web
 * Requires REDIS_URL. Exits non-zero when Redis is unreachable at boot.
 */
import { registerQueueHandlers } from "./server/processor";
import { isConsumerRunning, startRedisConsumer, stopRedisConsumer } from "./server/queue";
import { validateRuntimeConfig } from "./lib/config-check";
import { config } from "./lib/env";
import { logger } from "./lib/logger";

async function main() {
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
  const errors = issues.filter((x) => x.level === "error");
  if (errors.length > 0) {
    console.error(`worker refusing to start: ${errors.map((e) => e.message).join(" ")}`);
    process.exit(1);
  }
  if (!config.redisUrl) {
    console.error("worker requires REDIS_URL (in-process queue stays inside the web process)");
    process.exit(1);
  }
  registerQueueHandlers();
  await startRedisConsumer();
  if (!isConsumerRunning()) {
    console.error("worker could not connect to Redis");
    process.exit(1);
  }
  logger.info("worker started, draining Redis queues", {});
  const shutdown = (signal: string) => {
    logger.info("worker shutting down", { signal });
    stopRedisConsumer();
    // Let the in-flight iteration finish its sleep, then exit.
    setTimeout(() => process.exit(0), 1500).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  setInterval(() => logger.info("worker heartbeat", { running: isConsumerRunning() }), 60_000).unref?.();
}

main().catch((err) => {
  console.error(`worker fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
