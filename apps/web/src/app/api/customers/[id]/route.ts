import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { audit } from "@/server/audit";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const customer = await prisma.customer.findFirst({
    where: { id: params.id, tenantId: s.tenantId },
    include: {
      addresses: true,
      orders: { orderBy: { createdAt: "desc" }, take: 50, include: { items: true } },
      conversations: { orderBy: { lastMessageAt: "desc" }, take: 20, select: { id: true, channel: true, status: true, orderState: true, lastMessageAt: true } },
    },
  });
  if (!customer) return Errors.notFound(requestId, "Customer");
  return ok({ customer }, { requestId });
}

const updateSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  preferredLanguage: z.string().max(20).nullable().optional(),
  marketingConsent: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "AGENT");
  } catch {
    return Errors.forbidden(requestId);
  }
  const customer = await prisma.customer.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!customer) return Errors.notFound(requestId, "Customer");
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const updated = await prisma.customer.update({ where: { id: customer.id }, data: parsed.data });
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "customer.updated", resource: "customer", resourceId: customer.id, newValue: parsed.data });
  return ok({ customer: updated }, { requestId });
}

/**
 * Customer data erasure (privacy): anonymizes PII, deletes addresses,
 * detaches (but preserves) orders for audit/finance integrity.
 * AuditLog entries are retained by design (documented in docs/PRIVACY.md).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const customer = await prisma.customer.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!customer) return Errors.notFound(requestId, "Customer");
  await prisma.$transaction([
    prisma.customerAddress.deleteMany({ where: { customerId: customer.id } }),
    prisma.order.updateMany({ where: { customerId: customer.id }, data: { customerId: null } }),
    prisma.conversation.updateMany({ where: { customerId: customer.id }, data: { customerId: null } }),
    prisma.customer.update({
      where: { id: customer.id },
      data: {
        name: "Deleted customer",
        phone: `deleted-${customer.id.slice(-8)}`,
        email: null,
        notes: null,
        tags: [],
        marketingConsent: false,
        preferredSize: null,
      },
    }),
  ]);
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "customer.erased", resource: "customer", resourceId: customer.id });
  return ok({ erased: true }, { requestId });
}
