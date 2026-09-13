import { prisma } from "@ai-commerce/database";
import { z } from "zod";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, hashPassword, verifyPassword } from "@/server/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { ensureInit } from "@/server/init";
import { audit } from "@/server/audit";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);

  const rl = rateLimit(`auth:${clientKey(req)}`, config.rateLimit.maxAuth, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const user = await prisma.user.findUnique({ where: { id: s.userId } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return fail("CURRENT_PASSWORD_WRONG", "Current password is incorrect", { status: 400, requestId });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "auth.password_changed", resource: "user", resourceId: user.id });
  return ok({ changed: true }, { requestId });
}