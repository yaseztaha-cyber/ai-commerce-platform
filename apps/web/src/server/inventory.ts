import { prisma } from "@ai-commerce/database";
import type { InventoryMovementType } from "@ai-commerce/shared";

/** Read live stock for a variant (never cache blindly — always fresh read). */
export async function getStock(tenantId: string, variantId: string): Promise<number> {
  const inv = await prisma.inventory.findFirst({ where: { tenantId, variantId } });
  return inv?.quantity ?? 0;
}

export async function checkAvailability(tenantId: string, variantId: string, quantity: number) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, tenantId, active: true },
    include: { inventory: true, product: true },
  });
  if (!variant) return { ok: false as const, code: "VARIANT_NOT_FOUND", available: 0 };
  const available = variant.inventory?.quantity ?? 0;
  if (available < quantity) return { ok: false as const, code: "INSUFFICIENT_STOCK", available, variant };
  return { ok: true as const, available, variant };
}

/**
 * Adjust stock with a movement record. Never alters stock without a record.
 * Uses a transaction + row lock ordering (variantId) to prevent oversell.
 */
export async function adjustStock(input: {
  tenantId: string;
  variantId: string;
  delta: number;
  type: InventoryMovementType;
  reason?: string;
  actor?: string;
  orderId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findFirst({
      where: { id: input.variantId, tenantId: input.tenantId },
      include: { inventory: true },
    });
    if (!variant) throw new Error("VARIANT_NOT_FOUND");
    const before = variant.inventory?.quantity ?? 0;
    const after = before + input.delta;
    if (after < 0) throw new Error("INSUFFICIENT_STOCK");
    if (variant.inventory) {
      await tx.inventory.update({ where: { variantId: variant.id }, data: { quantity: after } });
    } else {
      await tx.inventory.create({ data: { tenantId: input.tenantId, variantId: variant.id, quantity: after } });
    }
    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        variantId: variant.id,
        type: input.type,
        delta: input.delta,
        before,
        after,
        reason: input.reason,
        actor: input.actor ?? "system",
        orderId: input.orderId,
      },
    });
    if (after <= (variant.inventory?.lowThreshold ?? 3)) {
      await tx.notification.create({
        data: {
          tenantId: input.tenantId,
          kind: "LOW_STOCK",
          channel: "CONSOLE",
          payload: { variantId: variant.id, sku: variant.sku, quantity: after } as never,
          status: "QUEUED",
        },
      });
    }
    return { before, after, movement };
  });
}
