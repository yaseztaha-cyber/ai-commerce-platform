import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";
import { deleteMeasurement, getMeasurements, upsertMeasurement } from "./sizing";
import { executeTool } from "./ai/tools";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("size intelligence", () => {
  let tenantId = "";
  let productId = "";
  let customerId = "";
  let convoId = "";

  beforeAll(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { slug: "yasez-fashion" } });
    if (!tenant) throw new Error("seed missing: run db:seed first");
    tenantId = tenant.id;
    const p = await prisma.product.create({ data: { tenantId, name: `Measure Tee ${Date.now()}`, basePrice: 300 } });
    productId = p.id;
    const customer = await prisma.customer.create({ data: { tenantId, phone: `010700000${String(Date.now()).slice(-2)}` } });
    customerId = customer.id;
    const convo = await prisma.conversation.create({
      data: { tenantId, customerId, channel: "SIMULATOR", externalId: `SIMULATOR:size-${Date.now()}`, status: "AI_ACTIVE" },
    });
    convoId = convo.id;
  });

  afterAll(async () => {
    await prisma.productMeasurement.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    await prisma.message.deleteMany({ where: { conversationId: convoId } });
    await prisma.conversation.delete({ where: { id: convoId } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
  });

  const ctx = () => ({ tenantId, conversationId: convoId, customerId, actor: "test" as const });

  it("stores a measurement table and rejects foreign products", async () => {
    await upsertMeasurement(tenantId, productId, { size: "M", chest: 102, length: 70 }, "test");
    await upsertMeasurement(tenantId, productId, { size: "L", chest: 108, length: 72 }, "test");
    const rows = await getMeasurements(tenantId, productId);
    expect(rows.map((r) => r.size).sort()).toEqual(["L", "M"]);
    expect(rows.find((r) => r.size === "M")).toMatchObject({ chest: 102 });
    await expect(upsertMeasurement(tenantId, productId, { size: "", chest: 1 })).rejects.toThrow();
    await expect(upsertMeasurement(tenantId, productId, { size: "M", chest: 999 })).rejects.toThrow("INVALID_MEASURE");
    await expect(getMeasurements(`nope-${Date.now()}`, productId)).rejects.toThrow("PRODUCT_NOT_FOUND");
    await deleteMeasurement(tenantId, productId, "M");
    expect((await getMeasurements(tenantId, productId)).map((r) => r.size)).toEqual(["L"]);
    await expect(deleteMeasurement(tenantId, productId, "M")).rejects.toThrow("MEASUREMENT_NOT_FOUND");
    await upsertMeasurement(tenantId, productId, { size: "M", chest: 102 }, "test");
  });

  it("recommend_size ranks from real numbers, never invents", async () => {
    const res = await executeTool(ctx(), "recommend_size", { product_id: productId, chest_cm: 100 });
    expect(res.success).toBe(true);
    const d = res.data as { recommendations: Array<{ size: string; reason: string }>; confidence: string; table: unknown[] };
    expect(d.confidence).toBe("high");
    expect(d.recommendations[0].size).toBe("L");
    expect(d.recommendations[0].reason).toContain("108");
    expect(d.table).toHaveLength(2);
  });

  it("recommend_size without a table says so", async () => {
    const other = await prisma.product.create({ data: { tenantId, name: `Bare Tee ${Date.now()}`, basePrice: 100 } });
    try {
      const res = await executeTool(ctx(), "recommend_size", { product_id: other.id, height_cm: 180, weight_kg: 80 });
      expect(res.success).toBe(true);
      expect((res.data as { confidence: string }).confidence).toBe("none");
    } finally {
      await prisma.product.delete({ where: { id: other.id } });
    }
  });

  it("remember_customer_size stores self record, rejects others and junk", async () => {
    const ok = await executeTool(ctx(), "remember_customer_size", { size: "l" });
    expect(ok).toMatchObject({ success: true, data: { size: "L" } });
    expect((await prisma.customer.findUnique({ where: { id: customerId } }))?.preferredSize).toBe("L");
    expect((await executeTool(ctx(), "remember_customer_size", { size: "extra huge!!!" })).success).toBe(false);
    const foreign = await executeTool({ tenantId: `nope-${Date.now()}`, conversationId: convoId, customerId }, "remember_customer_size", { size: "M" });
    expect(foreign.success).toBe(false);
  });

  it("agent answers size advice from the table and stores opt-in", async () => {
    const { runAgentTurn } = await import("./ai/agent");
    const p = await prisma.product.create({ data: { tenantId, name: `Zephyr Tee ${Date.now()}`, nameAr: "زفير", basePrice: 300 } });
    const v = await prisma.productVariant.create({
      data: { tenantId, productId: p.id, sku: `ZEPH-${Date.now()}`, attributes: { Color: "Black", Size: "M" } },
    });
    await prisma.inventory.create({ data: { tenantId, variantId: v.id, quantity: 5 } });
    await upsertMeasurement(tenantId, p.id, { size: "M", chest: 102 }, "test");
    await upsertMeasurement(tenantId, p.id, { size: "L", chest: 108 }, "test");
    try {
      const r2 = await runAgentTurn({ tenantId, conversationId: convoId, customerId, userText: "زفير مقاسي ايه؟ محيط الصدر 100" });
      expect(r2.toolsUsed).toContain("recommend_size");
      expect(r2.text).toMatch(/L/);
      expect(r2.text).toMatch(/108/);
      expect(r2.text).not.toMatch(/أي لون|أي مقاس/);
    } finally {
      const draft = await prisma.order.findFirst({ where: { tenantId, conversationId: convoId } });
      if (draft) {
        await prisma.orderItem.deleteMany({ where: { orderId: draft.id } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: draft.id } });
        await prisma.order.delete({ where: { id: draft.id } });
      }
      await prisma.productMeasurement.deleteMany({ where: { productId: p.id } });
      await prisma.inventoryMovement.deleteMany({ where: { variantId: v.id } });
      await prisma.inventory.deleteMany({ where: { variantId: v.id } });
      await prisma.productVariant.delete({ where: { id: v.id } });
      await prisma.product.delete({ where: { id: p.id } });
    }

    const r4 = await runAgentTurn({ tenantId, conversationId: convoId, customerId, userText: "خلاص مقاسي M دايما" });
    expect(r4.toolsUsed).toContain("remember_customer_size");
    expect(r4.text).toMatch(/M/);
    expect((await prisma.customer.findUnique({ where: { id: customerId } }))?.preferredSize).toBe("M");
  });

  it("two consistent confirmed orders remember the size automatically", async () => {
    const v = await prisma.productVariant.create({
      data: { tenantId, productId, sku: `MEM-${Date.now()}`, attributes: { Color: "Black", Size: "XL" } },
    });
    await prisma.inventory.create({ data: { tenantId, variantId: v.id, quantity: 10 } });
    const { createOrderDraft, confirmOrder } = await import("./orders");
    const ts = Date.now();
    try {
      for (const k of [1, 2]) {
        const d = await createOrderDraft({ tenantId, customerId, conversationId: convoId, idempotencyKey: `mem-${ts}-${k}`, lines: [{ variantId: v.id, quantity: 1 }], actor: "test" });
        await confirmOrder({ tenantId, orderId: d.order.id, idempotencyKey: `memc-${ts}-${k}`, actor: "test" });
      }
      // reset the explicit M from the previous test so auto-memory is observable
      await prisma.customer.update({ where: { id: customerId }, data: { preferredSize: null } });
      const d = await createOrderDraft({ tenantId, customerId, conversationId: convoId, idempotencyKey: `mem-${ts}-3`, lines: [{ variantId: v.id, quantity: 1 }], actor: "test" });
      await confirmOrder({ tenantId, orderId: d.order.id, idempotencyKey: `memc-${ts}-3`, actor: "test" });
      await new Promise((r) => setTimeout(r, 300)); // fire-and-forget hook
      expect((await prisma.customer.findUnique({ where: { id: customerId } }))?.preferredSize).toBe("XL");
    } finally {
      const orders = await prisma.order.findMany({ where: { tenantId, customerId }, select: { id: true } });
      for (const o of orders) {
        await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
        await prisma.order.delete({ where: { id: o.id } });
      }
      await prisma.inventoryMovement.deleteMany({ where: { variantId: v.id } });
      await prisma.inventory.deleteMany({ where: { variantId: v.id } });
      await prisma.productVariant.delete({ where: { id: v.id } });
    }
  });

  it("erasure clears the remembered size", async () => {
    await prisma.customer.update({ where: { id: customerId }, data: { preferredSize: "XL" } });
    await prisma.$transaction([
      prisma.customerAddress.deleteMany({ where: { customerId } }),
      prisma.order.updateMany({ where: { customerId }, data: { customerId: null } }),
      prisma.customer.update({ where: { id: customerId }, data: { name: "Deleted customer", preferredSize: null, notes: null, tags: [], marketingConsent: false } }),
    ]);
    expect((await prisma.customer.findUnique({ where: { id: customerId } }))?.preferredSize).toBeNull();
  });
});
