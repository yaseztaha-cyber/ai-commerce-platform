import { NextResponse } from "next/server";
import { Errors, ok } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { cronAuthReason } from "@/server/cron";
import { runRenewals } from "@/server/billing/payments";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = newRequestId();
  const auth = cronAuthReason(req);
  if (auth !== "ok") {
    logger.warn("unauthorized renew cron attempt", { requestId, reason: auth });
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden" }, requestId }, { status: 403 });
  }
  if (!rateLimit("cron:renew-subscriptions", 6, 60_000).allowed) {
    return Errors.rateLimited(requestId);
  }
  try {
    const processed = await runRenewals();
    logger.info("renewal sweep completed", { requestId, processed });
    return ok({ processed }, { requestId });
  } catch (err) {
    logger.error("renewal sweep failed", { requestId, error: String(err) });
    return Errors.internal(requestId);
  }
}