import { prisma } from "@ai-commerce/database";
import { Errors, fail, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { adjustInventorySchema } from "@ai-commerce/shared";
import { adjustStock, getStock } from "@/server/inventory";
import { audit } from "@/server/audit";

export async function GET() {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const rows = await prisma.productVariant.findMany({
    where: { tenantId: s.tenantId },
    include: { inventory: true, product: { select: { name: true, nameAr: true } } },
    orderBy: { sku: "asc" },
    take: 500,
  });
  return ok({ inventory: rows.map((r) => ({ variantId: r.id, sku: r.sku, product: r.product.name, attributes: r.attributes, quantity: r.inventory?.quantity ?? 0, lowThreshold: r.inventory?.lowThreshold ?? 3 })) }, { requestId });
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  try {
    await requireRole(s.tenantId, "MANAGER");
  } catch {
    return Errors.forbidden(requestId);
  }
  const body = await req.json().catch(() => null);
  const parsed = adjustInventorySchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  try {
    const before = await getStock(s.tenantId, parsed.data.variantId);
    const res = await adjustStock({ tenantId: s.tenantId, variantId: parsed.data.variantId, delta: parsed.data.delta, type: parsed.data.type, reason: parsed.data.reason, actor: `user:${s.userId}` });
    await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "inventory.adjusted", resource: "variant", resourceId: parsed.data.variantId, oldValue: { before }, newValue: { after: res.after } });
    return ok(res, { requestId });
  } catch (err) {
    return fail("ADJUST_FAILED", err instanceof Error ? err.message : "Adjustment failed", { status: 400, requestId });
  }
}
