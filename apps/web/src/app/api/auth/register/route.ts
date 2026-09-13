import { prisma } from "@ai-commerce/database";
import { z } from "zod";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId, logger } from "@/lib/logger";
import { hashPassword, signSession, sessionCookieHeader } from "@/server/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { config } from "@/lib/env";
import { ensureInit } from "@/server/init";

const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  businessName: z.string().min(1).max(200),
  industry: z.string().default("CLOTHING"),
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || `shop-${Date.now().toString(36)}`;
}

export async function POST(req: Request) {
  ensureInit();
  const requestId = newRequestId();
  const rl = rateLimit(`auth:${clientKey(req)}`, config.rateLimit.maxAuth, config.rateLimit.windowMs);
  if (!rl.allowed) return Errors.rateLimited(requestId);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Errors.validation(requestId);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const { name, email, password, businessName, industry } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return fail("EMAIL_TAKEN", "Email already registered", { status: 409, requestId });

  const passwordHash = await hashPassword(password);
  let slug = slugify(businessName);
  if (await prisma.tenant.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;

  const user = await prisma.user.create({ data: { email: email.toLowerCase(), name, passwordHash } });
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: businessName,
      industry,
      aiGreeting: `أهلاً بيك في ${businessName} ❤️ أقدر أساعدك إزاي؟`,
      deliveryZones: { create: [{ name: "Cairo", nameAr: "القاهرة", fee: 60, eta: "2-4 days" }] },
    },
  });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });

  const token = await signSession({ userId: user.id, email: user.email, tenantId: tenant.id, role: "OWNER", isPlatformAdmin: false });
  logger.info("user registered", { requestId, tenantId: tenant.id });
  const res = ok({ tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, user: { id: user.id, email: user.email, name } }, { requestId, status: 201 });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
