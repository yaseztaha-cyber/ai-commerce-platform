import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { audit } from "@/server/audit";
import { z } from "zod";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const tenant = await prisma.tenant.findUnique({ where: { id: s.tenantId }, include: { deliveryZones: true } });
  if (!tenant) return Errors.notFound(requestId, "Tenant");
  return ok({ tenant }, { requestId });
}

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactPhone: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  returnPolicy: z.string().max(5000).optional().nullable(),
  exchangePolicy: z.string().max(5000).optional().nullable(),
  cancelPolicy: z.string().max(5000).optional().nullable(),
  shippingPolicy: z.string().max(5000).optional().nullable(),
  aiPersonality: z.string().max(60).optional(),
  aiTone: z.string().max(60).optional(),
  aiGreeting: z.string().max(1000).optional().nullable(),
  aiInstructions: z.string().max(5000).optional().nullable(),
  minimumOrderAmount: z.number().int().min(0).optional().nullable(),
  freeDeliveryThreshold: z.number().int().min(0).optional().nullable(),
  requirePhoneVerify: z.boolean().optional(),
  cartNudgeHours: z.number().int().min(1).max(168).nullable().optional(),
  notificationConfig: z.object({
    ownerPhone: z.string().max(40).optional(),
    channel: z.enum(["whatsapp", "webhook", "console"]).optional(),
    webhookUrl: z.string().url().max(500).optional().or(z.literal("")),
  }).partial().optional(),
}).partial();

export async function PUT(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "ADMIN");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const before = await prisma.tenant.findUnique({ where: { id: s.tenantId } });
  const tenant = await prisma.tenant.update({ where: { id: s.tenantId }, data: parsed.data });
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "tenant.settings_updated", resource: "tenant", resourceId: tenant.id, oldValue: { name: before?.name }, newValue: parsed.data });
  return ok({ tenant }, { requestId });
}
