import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { audit } from "@/server/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  descriptionAr: z.string().max(5000).nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  basePrice: z.number().int().min(0).max(100000000).optional(),
  active: z.boolean().optional(),
});

/** PUT /api/products/:id — edit product fields or toggle active. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const product = await prisma.product.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!product) return Errors.notFound(requestId, "Product");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());

  const updated = await prisma.product.update({
    where: { id: params.id },
    data: { ...parsed.data },
  });
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "product.updated", resource: "product", resourceId: updated.id, newValue: { name: updated.name, active: updated.active } });
  return ok({ product: updated }, { requestId });
}

/** DELETE /api/products/:id — soft-archive (product + variants off). Hard
 *  delete is unsafe: variants are referenced by order items (FK restrict). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const product = await prisma.product.findFirst({ where: { id: params.id, tenantId: s.tenantId } });
  if (!product) return Errors.notFound(requestId, "Product");

  await prisma.$transaction([
    prisma.productVariant.updateMany({ where: { productId: product.id, tenantId: s.tenantId }, data: { active: false } }),
    prisma.product.update({ where: { id: product.id }, data: { active: false } }),
  ]);
  await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "product.archived", resource: "product", resourceId: product.id, newValue: { archived: true } });
  return ok({ archived: true }, { requestId });
}