import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession, requireRole } from "@/server/auth";
import { upsertVariantSchema } from "@ai-commerce/shared";
import { upsertVariantWithStock } from "@/server/products";
import { audit } from "@/server/audit";

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
  const parsed = upsertVariantSchema.safeParse(body);
  if (!parsed.success) return Errors.validation(requestId, parsed.error.flatten());
  const v = parsed.data;
  try {
    const { variant, quantity, stockAdjusted } = await upsertVariantWithStock(
      s.tenantId,
      {
        productId: v.productId,
        sku: v.sku,
        price: v.price,
        attributes: v.attributes,
        active: v.active,
        quantity: v.quantity,
      },
      `user:${s.userId}`
    );
    await audit({ tenantId: s.tenantId, actor: `user:${s.userId}`, action: "variant.upserted", resource: "variant", resourceId: variant.id, newValue: { sku: variant.sku, quantity, stockAdjusted } });
    return ok({ variant, quantity, stockAdjusted }, { requestId, status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upsert failed";
    if (msg === "PRODUCT_NOT_FOUND") return Errors.notFound(requestId, "Product");
    return Errors.validation(requestId, msg);
  }
}
