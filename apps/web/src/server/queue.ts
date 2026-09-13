import { logger } from "@/lib/logger";
import { config } from "@/lib/env";
import { prisma } from "@ai-commerce/database";

/**
 * Queue abstraction.
 *
 * - REDIS_URL set (recommended production): jobs persist in Redis lists and a
 *   consumer drains them (BRPOPLPUSH with a processing backup list, so a
 *   crashed worker's jobs are requeued on next boot — at-least-once).
 * - REDIS_URL absent: in-process async queue (development/single-instance).
 *
 * Retry semantics (both transports): exponential backoff
 * (min(30s, 1s * 2^attempts)), maxAttempts (default 3), then dead-lettered:
 * logged AND pushed to `q:dead` (Redis) for inspection. Retried jobs can
 * NEVER loop forever — attempts are counted on the job envelope.
 *
 * Duplicate processing across workers is prevented for message jobs by
 * claiming the WebhookEvent (RECEIVED -> PROCESSING wins once); see
 * processMessageJob's claim step.
 *
 * Jobs: process_message | generate_embedding | process_document |
 *       send_message | update_analytics | send_notification
 */
export type JobName =
  | "process_message"
  | "transcribe_message"
  | "sight_message"
  | "generate_embedding"
  | "process_document"
  | "send_message"
  | "update_analytics"
  | "send_notification";

export interface Job<T = Record<string, unknown>> {
  id: string;
  name: JobName;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

type Handler = (job: Job) => Promise<void>;
const handlers = new Map<JobName, Handler>();

export function registerHandler(name: JobName, fn: Handler) {
  handlers.set(name, fn);
}

let redis: import("ioredis").default | null = null;
async function getRedis() {
  if (!config.redisUrl) return null;
  if (redis) return redis;
  const { default: IORedis } = await import("ioredis");
  redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  redis.on("error", (e) => logger.warn("redis error, falling back to memory queue", { error: String(e) }));
  try {
    await redis.connect();
  } catch {
    redis = null;
    return null;
  }
  return redis;
}

const memoryQueue: Job[] = [];
let draining = false;

async function drainMemory() {
  if (draining) return;
  draining = true;
  try {
    while (memoryQueue.length > 0) {
      const job = memoryQueue.shift()!;
      await runWithRetry(job);
    }
  } finally {
    draining = false;
  }
}

async function runWithRetry(job: Job): Promise<"ok" | "retrying" | "dead" | "no-handler"> {
  const handler = handlers.get(job.name);
  if (!handler) {
    logger.warn("no queue handler registered", { job: job.name });
    return "no-handler";
  }
  try {
    await handler(job);
    return "ok";
  } catch (err) {
    job.attempts += 1;
    if (job.attempts < job.maxAttempts) {
      const backoff = Math.min(30_000, 1000 * 2 ** job.attempts);
      logger.warn("job failed, retrying", { job: job.name, attempts: job.attempts, error: String(err) });
      setTimeout(() => {
        memoryQueue.push(job);
        void drainMemory();
      }, backoff);
      return "retrying";
    }
    logger.error("job dead-lettered", { job: job.name, error: String(err) });
    await deadLetter(job);
    return "dead";
  }
}

/** Visible dead-letter tracking: Redis list (or error log when memory-only). */
async function deadLetter(job: Job): Promise<void> {
  const r = await getRedis().catch(() => null);
  if (r) {
    try {
      await r.lpush("q:dead", JSON.stringify({ ...job, deadAt: new Date().toISOString() }));
      await r.ltrim("q:dead", 0, 999);
      return;
    } catch {
      /* fall through to log-only */
    }
  }
}

/** Test hook: exercise retry/dead-letter accounting without timers. */
export async function runJobOnceForTest(job: Job): Promise<string> {
  return runWithRetry(job);
}

export async function enqueue(name: JobName, payload: Record<string, unknown>, opts?: { maxAttempts?: number }) {
  const job: Job = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    payload,
    attempts: 0,
    maxAttempts: opts?.maxAttempts ?? 3,
  };
  const r = await getRedis().catch(() => null);
  if (r) {
    try {
      await r.lpush(`q:${name}`, JSON.stringify(job));
      return job;
    } catch {
      // fall through to memory
    }
  }
  memoryQueue.push(job);
  void drainMemory();
  return job;
}

/** Process one job inline (used by tests + sync webchat path). */
export async function processInline(name: JobName, payload: Record<string, unknown>) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler for ${name}`);
  await handler({ id: "inline", name, payload, attempts: 0, maxAttempts: 1 });
}

const QUEUES: JobName[] = ["process_message", "transcribe_message", "sight_message", "generate_embedding", "process_document", "send_message", "update_analytics", "send_notification"];
let consumerStarted = false;
let consumerShouldRun = true;

/** Graceful shutdown hook for the standalone worker. */
export function stopRedisConsumer(): void {
  consumerShouldRun = false;
}

export function isConsumerRunning(): boolean {
  return consumerStarted && consumerShouldRun;
}

/**
 * Claim a webhook event for processing (RECEIVED -> PROCESSING wins once).
 * Prevents two workers from running the same customer message twice.
 */
export async function claimWebhookEvent(tenantId: string, providerMessageId: string): Promise<boolean> {
  try {
    const res = await prisma.webhookEvent.updateMany({
      where: { tenantId, providerMessageId, status: "RECEIVED" },
      data: { status: "PROCESSING" },
    });
    return res.count === 1;
  } catch {
    return false;
  }
}

/**
 * Redis consumer (started once per process when REDIS_URL is set).
 * Reliable pattern: BRPOPLPUSH to a per-queue processing list; the job is
 * removed only after success. Leftovers from crashed workers are requeued
 * at startup. Runs until the process exits.
 */
export async function startRedisConsumer(): Promise<void> {
  const r = await getRedis().catch(() => null);
  if (!r || consumerStarted) return;
  consumerStarted = true;
  // Requeue jobs orphaned by a previous crashed worker.
  for (const q of QUEUES) {
    try {
      for (;;) {
        const orphan = await r.rpoplpush(`q:${q}:processing`, `q:${q}`);
        if (!orphan) break;
        logger.warn("requeued orphaned job", { queue: q });
      }
    } catch (e) {
      logger.warn("orphan requeue failed", { queue: q, error: String(e) });
    }
  }
  void (async () => {
    for (; consumerShouldRun;) {
      try {
        let idle = true;
        for (const q of QUEUES) {
          const raw = await r.rpoplpush(`q:${q}`, `q:${q}:processing`).catch(() => null);
          if (!raw) continue;
          idle = false;
          let job: Job | null = null;
          try {
            job = JSON.parse(raw) as Job;
          } catch {
            await r.lrem(`q:${q}:processing`, 1, raw).catch(() => {});
            continue;
          }
          const release = () => r.lrem(`q:${q}:processing`, 1, raw).catch(() => {});
          const handler = handlers.get(job.name);
          if (!handler) {
            logger.warn("no queue handler registered", { job: job.name });
            await release(); // poison: drop, do not hot-loop
            continue;
          }
          try {
            await handler(job);
            await release();
          } catch (err) {
            job.attempts += 1;
            if (job.attempts < job.maxAttempts) {
              // Attempts live on the envelope: crash-safe, never infinite.
              const backoff = Math.min(30_000, 1000 * 2 ** job.attempts);
              logger.warn("job failed, retrying", { job: job.name, attempts: job.attempts, error: String(err) });
              await release();
              await new Promise((res) => setTimeout(res, backoff));
              await r.lpush(`q:${q}`, JSON.stringify(job)).catch(() => {
                memoryQueue.push(job);
                void drainMemory();
              });
            } else {
              logger.error("job dead-lettered", { job: job.name, error: String(err) });
              await release();
              await deadLetter(job);
            }
          }
        }
        await new Promise((res) => setTimeout(res, idle ? 500 : 50));
      } catch (e) {
        logger.warn("queue consumer error", { error: String(e) });
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  })();
}
