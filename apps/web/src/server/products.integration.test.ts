import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { upsertVariantWithStock } from "./products";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("variants with quantity", () => {
  let tenantId = "";
  let productId = "";
  const skus: string[] = [];

  afterAll(async () => {
    if (!tenantId) return;
    const variants = await prisma.productVariant.findMany({ where: { tenantId, sku: { in: skus } }, select: { id: true } });
    for (const v of variants) {
      await prisma.inventoryMovement.deleteMany({ where: { variantId: v.id } });
      await prisma.inventory.deleteMany({ where: { variantId: v.id } });
      await prisma.productVariant.delete({ where: { id: v.id } }).catch(() => {});
    }
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it("creates a variant with initial stock + traced movement", async () => {
    const t = await prisma.tenant.create({ data: { slug: `var-${Date.now()}`, name: "Variant Fixture" } });
    tenantId = t.id;
    const p = await prisma.product.create({ data: { tenantId, name: "Qty Tee", basePrice: 100 } });
    productId = p.id;
    const sku = `QTY-${Date.now()}`;
    skus.push(sku);
    const r = await upsertVariantWithStock(tenantId, { productId, sku, attributes: { Color: "Black", Size: "L" }, quantity: 7 }, "test");
    expect(r.quantity).toBe(7);
    expect(r.stockAdjusted).toBe(true);
    const moves = await prisma.inventoryMovement.findMany({ where: { variantId: r.variant.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "RESTOCK", delta: 7, before: 0, after: 7, actor: "test" });
  });

  it("adjusts existing stock with a delta movement, never silently", async () => {
    const sku = skus[0];
    const r = await upsertVariantWithStock(tenantId, { productId, sku, attributes: { Color: "Black", Size: "L" }, quantity: 3 }, "test");
    expect(r.quantity).toBe(3);
    const moves = await prisma.inventoryMovement.findMany({ where: { variantId: r.variant.id }, orderBy: { createdAt: "asc" } });
    expect(moves.map((m) => m.delta)).toEqual([7, -4]);
  });

  it("rejects products from another tenant", async () => {
    const other = await prisma.tenant.create({ data: { slug: `var-other-${Date.now()}`, name: "Other" } });
    try {
      const op = await prisma.product.create({ data: { tenantId: other.id, name: "Foreign", basePrice: 1 } });
      await expect(
        upsertVariantWithStock(tenantId, { productId: op.id, sku: `X-${Date.now()}`, attributes: {}, quantity: 1 }, "test")
      ).rejects.toThrow("PRODUCT_NOT_FOUND");
      await prisma.product.delete({ where: { id: op.id } });
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it("edits price/active and rejects foreign variants", async () => {
    const { updateVariant } = await import("./products");
    const v = await prisma.productVariant.findFirst({ where: { tenantId, sku: skus[0] } });
    const updated = await updateVariant(tenantId, v!.id, { price: 555, active: false });
    expect(updated.price).toBe(555);
    expect(updated.active).toBe(false);
    await updateVariant(tenantId, v!.id, { active: true });
    await expect(updateVariant(`nope-${Date.now()}`, v!.id, { price: 1 })).rejects.toThrow("VARIANT_NOT_FOUND");
  });
});
