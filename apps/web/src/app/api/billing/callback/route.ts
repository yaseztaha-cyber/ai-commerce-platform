import { ok, fail } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { handleFawryCallback } from "@/server/billing/payments";

export async function POST(req: Request) {
  const requestId = newRequestId();
  if (!rateLimit(`billing-cb:${clientKey(req)}`, 300, 60_000).allowed) {
    return fail("RATE_LIMITED", "Too many requests", { status: 429, requestId });
  }
  try {
    const raw = await req.json().catch(() => ({})) as Record<string, unknown>;
    const bodyMap = Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k), String(v ?? "")]));
    const signature = bodyMap.signature ?? "";
    delete bodyMap.signature;
    const result = await handleFawryCallback(bodyMap, signature);
    if (!result.ok) {
      logger.warn("Fawry callback rejected", { requestId, reason: result.reason });
    }
    return ok(true, { requestId });
  } catch (err) {
    logger.error("Fawry callback error", { requestId, error: String(err) });
    return ok(true, { requestId });
  }
}

export async function GET(req: Request) {
  const requestId = newRequestId();
  if (!rateLimit(`billing-cb:${clientKey(req)}`, 300, 60_000).allowed) {
    return fail("RATE_LIMITED", "Too many requests", { status: 429, requestId });
  }
  try {
    const { searchParams } = new URL(req.url);
    const bodyMap: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) bodyMap[k] = v;
    const signature = bodyMap.signature ?? "";
    delete bodyMap.signature;
    const result = await handleFawryCallback(bodyMap, signature);
    if (!result.ok) {
      logger.warn("Fawry callback rejected (GET)", { requestId, reason: result.reason });
    }
    return ok(true, { requestId });
  } catch (err) {
    logger.error("Fawry callback error (GET)", { requestId, error: String(err) });
    return ok(true, { requestId });
  }
}