import { prisma } from "@ai-commerce/database";
import { z } from "zod";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { verifyPassword, signSession, sessionCookieHeader } from "@/server/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { ensureInit } from "@/server/init";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const rl = rateLimit(`auth:${clientKey(req)}`, config.rateLimit.maxAuth, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId);

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return fail("INVALID_CREDENTIALS", "Invalid email or password", { status: 401, requestId });
  }
  const membership = user.memberships[0];
  if (!membership) return fail("NO_TENANT", "Account has no business. Please register.", { status: 403, requestId });

  const token = await signSession({
    userId: user.id,
    email: user.email,
    tenantId: membership.tenantId,
    role: membership.role as never,
    isPlatformAdmin: user.isPlatformAdmin,
  });
  logger.info("user login", { requestId, tenantId: membership.tenantId });
  const res = ok(
    { tenant: { id: membership.tenant.id, slug: membership.tenant.slug, name: membership.tenant.name }, user: { id: user.id, email: user.email, name: user.name } },
    { requestId }
  );
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
