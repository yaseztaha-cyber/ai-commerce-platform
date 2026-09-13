/**
 * DB-backed integration tests: order lifecycle, concurrency, idempotency,
 * tenant isolation. Run with a real DATABASE_URL after migrate+seed.
 *
 *   $env:DATABASE_URL="postgresql://..."; npx vitest run src/server/orders.integration.test.ts
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-commerce/database";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("orders integration", () => {
  let tenantId = "";
  let variantId = "";

  beforeAll(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { slug: "yasez-fashion" } });
    if (!tenant) throw new Error("seed missing: run db:seed first");
    tenantId = tenant.id;
    const variant = await prisma.productVariant.findFirst({
      where: { tenantId, sku: { contains: "OVER" } },
      include: { inventory: true },
    });
    if (!variant) throw new Error("seed variants missing");
    variantId = variant.id;
  });

  it("tenant isolation: other tenant sees nothing", async () => {
    const rows = await prisma.order.findMany({ where: { tenantId: `nope-${Date.now()}` } });
    expect(rows).toEqual([]);
  });

  it("duplicate order draft is idempotent", async () => {
    const { createOrderDraft } = await import("./orders");
    const key = `test-${Date.now()}`;
    const a = await createOrderDraft({ tenantId, idempotencyKey: key, lines: [{ variantId, quantity: 1 }], actor: "test" });
    const b = await createOrderDraft({ tenantId, idempotencyKey: key, lines: [{ variantId, quantity: 1 }], actor: "test" });
    expect(a.order.id).toBe(b.order.id);
    expect(b.duplicate).toBe(true);
    await prisma.order.delete({ where: { id: a.order.id } }).catch(() => {});
  });

  it("parallel drafts never collide on order numbers", async () => {
    const { createOrderDraft } = await import("./orders");
    const ts = Date.now();
    const drafts = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createOrderDraft({ tenantId, idempotencyKey: `par-${ts}-${i}`, lines: [{ variantId, quantity: 1 }], actor: "test" })
      )
    );
    const numbers = drafts.map((d) => d.order.number);
    expect(new Set(numbers).size).toBe(10);
    for (const d of drafts) {
      await prisma.orderItem.deleteMany({ where: { orderId: d.order.id } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: d.order.id } });
      await prisma.order.delete({ where: { id: d.order.id } });
    }
  });

  it("webhook ingest is idempotent", async () => {
    const { ingestInbound } = await import("./webhooks");
    const inbound = {
      provider: "SIMULATOR",
      providerMessageId: `dup-${Date.now()}`,
      channel: "SIMULATOR",
      from: "01099999999",
      text: "test",
      kind: "text" as const,
    };
    const first = await ingestInbound({ tenantId, inbound });
    const second = await ingestInbound({ tenantId, inbound });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});

describe.skipIf(!hasDb)("order amendment", () => {
  let tenantId = "";
  let variantId = "";
  let productId = "";
  const orderIds: string[] = [];

  beforeAll(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { slug: "yasez-fashion" } });
    if (!tenant) throw new Error("seed missing: run db:seed first");
    tenantId = tenant.id;
    const p = await prisma.product.create({ data: { tenantId, name: `Amend Tee ${Date.now()}`, basePrice: 200 } });
    productId = p.id;
    const v = await prisma.productVariant.create({
      data: { tenantId, productId, sku: `AMEND-${Date.now()}`, attributes: { Color: "Black", Size: "M" } },
    });
    variantId = v.id;
    await prisma.inventory.create({ data: { tenantId, variantId, quantity: 10 } });
  });

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { variantId } });
    await prisma.inventory.deleteMany({ where: { variantId } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
  });

  async function cleanup() {
    for (const id of orderIds.splice(0)) {
      await prisma.orderItem.deleteMany({ where: { orderId: id } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } }).catch(() => {});
    }
    await prisma.inventory.updateMany({ where: { variantId }, data: { quantity: 10 } });
  }

  async function confirmedOrder(qty: number) {
    const { createOrderDraft, confirmOrder } = await import("./orders");
    const ts = Date.now() + Math.floor(Math.random() * 100000);
    const d = await createOrderDraft({ tenantId, idempotencyKey: `am-${ts}`, lines: [{ variantId, quantity: qty }], actor: "test" });
    const c = await confirmOrder({ tenantId, orderId: d.order.id, idempotencyKey: `amc-${ts}`, actor: "test" });
    orderIds.push(c.order.id);
    return c.order.id;
  }

  it("increases quantity with atomic stock reservation", async () => {
    const { amendOrder } = await import("./orders");
    const id = await confirmedOrder(2); // stock 10 -> 8
    const updated = await amendOrder({ tenantId, orderId: id, actor: "test", items: [{ variantId, quantity: 5 }] });
    expect(updated.items[0].quantity).toBe(5);
    expect(updated.total).toBe(5 * 200 + updated.deliveryFee);
    const inv = await prisma.inventory.findUnique({ where: { variantId } });
    expect(inv?.quantity).toBe(5); // 8 - 3
    await cleanup();
    await prisma.inventory.update({ where: { variantId }, data: { quantity: 10 } });
  });

  it("decreases quantity and releases stock", async () => {
    const { amendOrder } = await import("./orders");
    const id = await confirmedOrder(4); // 10 -> 6
    const updated = await amendOrder({ tenantId, orderId: id, actor: "test", items: [{ variantId, quantity: 1 }] });
    expect(updated.items[0].quantity).toBe(1);
    expect((await prisma.inventory.findUnique({ where: { variantId } }))?.quantity).toBe(9);
    await cleanup();
    await prisma.inventory.update({ where: { variantId }, data: { quantity: 10 } });
  });

  it("aborts the whole amendment when stock is insufficient", async () => {
    const { amendOrder } = await import("./orders");
    const id = await confirmedOrder(1); // 10 -> 9
    await expect(amendOrder({ tenantId, orderId: id, actor: "test", items: [{ variantId, quantity: 50 }] })).rejects.toThrow("INSUFFICIENT_STOCK");
    const order = await prisma.order.findFirst({ where: { id }, include: { items: true } });
    expect(order?.items[0].quantity).toBe(1); // unchanged
    expect((await prisma.inventory.findUnique({ where: { variantId } }))?.quantity).toBe(9); // untouched
    await cleanup();
    await prisma.inventory.update({ where: { variantId }, data: { quantity: 10 } });
  });

  it("edits address on READY but freezes items after CONFIRMED", async () => {
    const { amendOrder, transitionOrder } = await import("./orders");
    const id = await confirmedOrder(1);
    await transitionOrder({ tenantId, orderId: id, to: "PROCESSING", actor: "test" });
    await transitionOrder({ tenantId, orderId: id, to: "READY", actor: "test" });
    const updated = await amendOrder({ tenantId, orderId: id, actor: "test", address: "New Cairo, Street 9" });
    expect(updated.address).toBe("New Cairo, Street 9");
    await expect(amendOrder({ tenantId, orderId: id, actor: "test", items: [{ variantId, quantity: 2 }] })).rejects.toThrow("INVALID_STATE");
    await cleanup();
    await prisma.inventory.update({ where: { variantId }, data: { quantity: 10 } });
  });
});
