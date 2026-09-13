import { NextResponse } from "next/server";
import { Errors } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { sweepAbandonedCarts } from "@/server/carts";
import { cronAuthReason } from "@/server/cron";
import { ensureInit } from "@/server/init";

export const dynamic = "force-dynamic";

/**
 * Cron entrypoint for abandoned-cart nudges (call every ~15 min).
 * Secured by shared secret — never expose the result details publicly.
 */
export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const auth = cronAuthReason(req);
  if (auth !== "ok") {
    logger.warn("unauthorized cron attempt", { requestId, route: "cart-nudge", reason: auth });
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden" }, requestId }, { status: 403 });
  }
  if (!rateLimit("cron:cart-nudge", 6, 60_000).allowed) {
    return Errors.rateLimited(requestId);
  }
  try {
    const result = await sweepAbandonedCarts();
    logger.info("cart sweep completed", { requestId, ...result });
    return NextResponse.json({ ok: true, data: result, requestId });
  } catch (err) {
    logger.error("cart sweep failed", { requestId, error: String(err) });
    return Errors.internal(requestId);
  }
}
