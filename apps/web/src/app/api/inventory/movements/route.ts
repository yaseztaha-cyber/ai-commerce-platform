import { prisma } from "@ai-commerce/database";
import { Errors, ok } from "@/lib/api";
import { newRequestId } from "@/lib/logger";
import { getSession } from "@/server/auth";

/** Traceable stock history: every manual adjustment already writes a movement. */
export async function GET(req: Request) {
  const requestId = newRequestId();
  const s = await getSession();
  if (!s) return Errors.unauthorized(requestId);
  const url = new URL(req.url);
  const take = Math.max(1, Math.min(200, Number(url.searchParams.get("take") ?? "50") || 50));
  const movements = await prisma.inventoryMovement.findMany({
    where: { tenantId: s.tenantId },
    orderBy: { createdAt: "desc" },
    take,
  });
  const variantIds = [...new Set(movements.map((m) => m.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  const label = new Map(variants.map((v) => [v.id, `${v.product.name} (${v.sku})`]));
  return ok({ movements: movements.map((m) => ({ ...m, variantLabel: label.get(m.variantId) ?? m.variantId })) }, { requestId });
}
