import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { createPromotion } from "./promotions";
import { createOrderDraft, confirmOrder } from "./orders";
import { executeTool } from "./ai/tools";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("promotions", () => {
  let tenantId = "";
  let productId = "";
  let variantId = "";
  let convoId = "";

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { slug: `promo-${Date.now()}`, name: "Promo Fixture", requirePhoneVerify: false } });
    tenantId = t.id;
    const p = await prisma.product.create({ data: { tenantId, name: "Promo Tee", basePrice: 500 } });
    productId = p.id;
    const v = await prisma.productVariant.create({
      data: { tenantId, productId, sku: `PROMO-${Date.now()}`, attributes: { Color: "Black", Size: "M" } },
    });
    variantId = v.id;
    await prisma.inventory.create({ data: { tenantId, variantId, quantity: 50 } });
    const convo = await prisma.conversation.create({
      data: { tenantId, channel: "SIMULATOR", externalId: `SIMULATOR:promo-${Date.now()}`, status: "AI_ACTIVE" },
    });
    convoId = convo.id;
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
    await prisma.orderStatusHistory.deleteMany({ where: { order: { tenantId } } });
    await prisma.order.deleteMany({ where: { tenantId } });
    await prisma.promotion.deleteMany({ where: { tenantId } });
    await prisma.inventoryMovement.deleteMany({ where: { tenantId, variantId } });
    await prisma.inventory.deleteMany({ where: { variantId } });
    await prisma.productVariant.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.message.deleteMany({ where: { conversationId: convoId } });
    await prisma.conversation.delete({ where: { id: convoId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  const tctx = () => ({ tenantId, conversationId: convoId, actor: "test" as const });

  it("draft applies percent promo and snapshots it", async () => {
    await createPromotion(tenantId, { name: "Eid 10%", kind: "PERCENT", value: 10 }, "test");
    const d = await createOrderDraft({ tenantId, conversationId: convoId, idempotencyKey: `pd-${Date.now()}`, lines: [{ variantId, quantity: 2 }], actor: "test" });
    expect(d.order.subtotal).toBe(1000);
    expect(d.order.discount).toBe(100);
    expect(d.order.total).toBe(900); // no delivery zone on fixture tenant
    const snap = (d.order.appliedPromos ?? []) as Array<{ name: string; amount: number }>;
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ name: "Eid 10%", amount: 100 });
    await prisma.orderItem.deleteMany({ where: { orderId: d.order.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: d.order.id } });
    await prisma.order.delete({ where: { id: d.order.id } });
  });

  it("confirm increments usage and honors the snapshot", async () => {
    const promo = await prisma.promotion.findFirst({ where: { tenantId, name: "Eid 10%" } });
    const d = await createOrderDraft({ tenantId, conversationId: convoId, idempotencyKey: `pc-${Date.now()}`, lines: [{ variantId, quantity: 1 }], actor: "test" });
    await confirmOrder({ tenantId, orderId: d.order.id, idempotencyKey: `pcc-${Date.now()}`, actor: "test" });
    expect((await prisma.promotion.findUnique({ where: { id: promo!.id } }))?.usedCount).toBe(1);
    const confirmed = await prisma.order.findUnique({ where: { id: d.order.id } });
    expect(confirmed?.discount).toBe(50);
    await prisma.orderItem.deleteMany({ where: { orderId: d.order.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: d.order.id } });
    await prisma.order.delete({ where: { id: d.order.id } });
  });

  it("ignores expired, inactive, capped, and foreign promos", async () => {
    await createPromotion(tenantId, { name: "Old", kind: "PERCENT", value: 50, endAt: new Date(Date.now() - 1000) }, "test");
    await createPromotion(tenantId, { name: "Off", kind: "PERCENT", value: 50, active: false }, "test");
    await createPromotion(tenantId, { name: "Capped", kind: "PERCENT", value: 50, usageLimit: 1 }, "test");
    await prisma.promotion.updateMany({ where: { tenantId, name: "Capped" }, data: { usedCount: 1 } });
    const d = await createOrderDraft({ tenantId, conversationId: convoId, idempotencyKey: `pi-${Date.now()}`, lines: [{ variantId, quantity: 1 }], actor: "test" });
    // Only Eid 10% applies: 50 off 500.
    expect(d.order.discount).toBe(50);
    const snap = (d.order.appliedPromos ?? []) as Array<{ name: string }>;
    expect(snap.map((s) => s.name)).toEqual(["Eid 10%"]);
    await prisma.orderItem.deleteMany({ where: { orderId: d.order.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: d.order.id } });
    await prisma.order.delete({ where: { id: d.order.id } });
  });

  it("buy-2-get-1 discounts exactly one unit per group", async () => {
    await createPromotion(tenantId, { name: "B2G1", kind: "BXGY", value: 0, buyQty: 2, getQty: 1, productIds: [productId] }, "test");
    const d = await createOrderDraft({ tenantId, conversationId: convoId, idempotencyKey: `pb-${Date.now()}`, lines: [{ variantId, quantity: 5 }], actor: "test" });
    // 10% of 2500 = 250 + B2G1 floor(5/3)*500 = 500 -> 750 total
    expect(d.order.discount).toBe(750);
    await prisma.orderItem.deleteMany({ where: { orderId: d.order.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: d.order.id } });
    await prisma.order.delete({ where: { id: d.order.id } });
  });

  it("get_promotions is tenant-isolated and read-only shaped", async () => {
    const res = await executeTool(tctx(), "get_promotions", {});
    expect(res.success).toBe(true);
    const names = ((res.data as { promotions: Array<{ name: string }> }).promotions ?? []).map((p) => p.name);
    expect(names).toContain("Eid 10%");
    expect(names).not.toContain("Evil");
    const foreign = await executeTool({ tenantId: `nope-${Date.now()}`, conversationId: convoId }, "get_promotions", {});
    expect((foreign.data as { promotions: unknown[] }).promotions).toEqual([]);
  });

  it("rejects invalid promotion definitions", async () => {
    await expect(createPromotion(tenantId, { name: "Bad", kind: "PERCENT", value: 150 }, "test")).rejects.toThrow();
    await expect(createPromotion(tenantId, { name: "Bad2", kind: "BXGY", value: 0, buyQty: 2, getQty: 1 }, "test")).rejects.toThrow();
    await expect(createPromotion(tenantId, { name: "Bad3", kind: "NOPE" as never, value: 1 }, "test")).rejects.toThrow();
  });
});
