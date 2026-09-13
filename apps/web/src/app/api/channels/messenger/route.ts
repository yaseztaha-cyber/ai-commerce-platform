import { prisma } from "@ai-commerce/database";
import { NextResponse } from "next/server";
import { Errors, fail } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { messengerProvider } from "@/server/messaging/messenger";
import { ingestInbound } from "@/server/webhooks";
import { ensureInit } from "@/server/init";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";

/** GET: official webhook verification (hub.mode=subscribe). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const challenge = messengerProvider.verifySubscribe(
    url.searchParams.get("hub.mode"),
    url.searchParams.get("hub.verify_token"),
    url.searchParams.get("hub.challenge")
  );
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return fail("VERIFY_FAILED", "Verification failed", { status: 403, requestId: newRequestId() });
}

/** POST: receive messages. Tenant resolved from ?tenant=<slug> in webhook URL. */
export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const rl = rateLimit(`webhook:${clientKey(req)}`, config.rateLimit.maxWebhook, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);

  if (process.env.NODE_ENV === "production" && !config.messenger.appSecret) {
    logger.error("messenger webhook called without APP_SECRET in production", { requestId });
    return fail("WEBHOOK_NOT_SECURED", "Webhook receiver is not configured", { status: 503, requestId });
  }

  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!messengerProvider.verifySignature(raw, sig)) {
    logger.warn("messenger signature mismatch", { requestId });
    return fail("BAD_SIGNATURE", "Invalid signature", { status: 401, requestId });
  }
  const url = new URL(req.url);
  const slug = url.searchParams.get("tenant") ?? "";
  if (!slug) return fail("NO_TENANT", "Missing ?tenant=<slug>", { status: 400, requestId });
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return Errors.notFound(requestId, "Tenant");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Errors.validation(requestId);
  }
  const inbounds = messengerProvider.normalize(payload);
  const results = [];
  for (const inbound of inbounds) {
    results.push(await ingestInbound({ tenantId: tenant.id, inbound }));
  }
  logger.info("messenger webhook processed", { requestId, tenantId: tenant.id, count: inbounds.length });
  return NextResponse.json({ ok: true, data: { received: inbounds.length, results }, requestId });
}