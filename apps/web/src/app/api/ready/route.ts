import { NextResponse } from "next/server";
import { prisma } from "@ai-commerce/database";
import { newRequestId } from "@/lib/logger";
import { ensureInit } from "@/server/init";

export const dynamic = "force-dynamic";

/**
 * Readiness: verifies dependencies needed to serve traffic.
 * Liveness stays on GET /api/health (process up). Responses are minimal —
 * no secrets, versions, or internals.
 */
export async function GET() {
  ensureInit();
  const requestId = newRequestId();
  const checks: Record<string, "up" | "down"> = { db: "down", redis: "down" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "up";
  } catch {
    checks.db = "down";
  }
  const redisUrl = process.env.REDIS_URL ?? "";
  if (!redisUrl) {
    checks.redis = "up"; // in-process fallback active (dev/single-instance)
  } else {
    try {
      const { default: IORedis } = await import("ioredis");
      const r = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 3000 });
      await r.connect();
      await r.ping();
      await r.quit();
      checks.redis = "up";
    } catch {
      checks.redis = "down";
    }
  }
  const ready = checks.db === "up" && checks.redis === "up";
  return NextResponse.json({ ok: ready, data: { ready, checks }, requestId }, { status: ready ? 200 : 503 });
}
