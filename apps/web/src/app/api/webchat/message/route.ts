import { prisma } from "@ai-commerce/database";
import { NextResponse } from "next/server";
import { Errors, fail } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { ingestInbound } from "@/server/webhooks";
import { ensureInit } from "@/server/init";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { z } from "zod";

const schema = z.object({
  tenant: z.string().min(1),
  from: z.string().min(1).max(80),
  text: z.string().min(1).max(4000),
});

/** Website chat + simulator inbound (tenant slug identifies the business). */
export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  // Public endpoint (no auth) — per-IP budget against message flooding.
  const rl = rateLimit(`webchat:${clientKey(req)}`, 60, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const tenant = await prisma.tenant.findUnique({ where: { slug: parsed.data.tenant } });
  if (!tenant) return fail("NO_TENANT", "Unknown shop", { status: 404, requestId });
  const result = await ingestInbound({
    tenantId: tenant.id,
    inbound: {
      provider: "WEBSITE",
      providerMessageId: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channel: "WEBSITE",
      from: parsed.data.from,
      text: parsed.data.text,
      kind: "text",
    },
  });
  return NextResponse.json({ ok: true, data: result, requestId });
}
